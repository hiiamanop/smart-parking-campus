import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { consensusPlate } from './plateConsensus.mjs';
import { checkToken, createRateLimiter, clientIp } from './auth.mjs';
import {
  initMasterData,
  getZonesWithOccupancy,
  createBooking,
  getSession,
  processGateIn,
  processZoneScan,
  processPayment,
  processGateOut,
  reissueExitCode,
  createDomain,
  updateDomain,
  deleteDomain,
  createZone,
  updateZone,
  deleteZone,
  getAllSessions,
  getAnalytics,
  recordGateQuality,
  getEventHistory,
  adminOverrideGate,
  cancelBooking,
  requestCheckout,
  changeZone,
  rebuildCounters,
  startScheduler,
  stopScheduler,
  redis,
  redisSub,
  EVENT_CHANNEL,
} from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, '../.env'));

const PORT = Number(process.env.VLM_PROXY_PORT || 8788);
const HOST = process.env.VLM_PROXY_HOST || '127.0.0.1';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const OPENROUTER_MODEL = process.env.OPENROUTER_VLM_MODEL || 'google/gemini-2.5-flash';
const OPENROUTER_ASSISTANT_MODEL =
  process.env.OPENROUTER_ASSISTANT_MODEL || 'deepseek/deepseek-v4-flash';
const OPENROUTER_STT_MODEL = process.env.OPENROUTER_STT_MODEL || 'openai/gpt-audio';
const OPENROUTER_TTS_MODEL = process.env.OPENROUTER_TTS_MODEL || 'openai/gpt-audio';
const OPENROUTER_TTS_VOICE = process.env.OPENROUTER_TTS_VOICE || 'nova';
const VOICE_MAX_SECONDS = Math.max(15, Math.min(600, Number(process.env.VOICE_MAX_SECONDS || 120)));
const VOICE_MAX_BYTES = Number(process.env.VOICE_MAX_BYTES || 8 * 1024 * 1024);

// Plate VLM provider: "vllm" (local OpenAI-compatible server) or "openrouter".
const VLM_PROVIDER = (process.env.VLM_PROVIDER || 'openrouter').toLowerCase();
const VLLM_BASE_URL = (process.env.VLLM_BASE_URL || 'http://host.docker.internal:8001/v1').replace(/\/+$/, '');
const VLLM_MODEL = process.env.VLLM_MODEL || 'gemma-4-12b';
const VLLM_API_KEY = process.env.VLLM_API_KEY || '';
const VLM_TIMEOUT_MS = Number(process.env.VLM_TIMEOUT_MS || (VLM_PROVIDER === 'vllm' ? 90000 : 20000));
const VLM_MODEL = VLM_PROVIDER === 'vllm' ? VLLM_MODEL : OPENROUTER_MODEL;
const SITE_URL = process.env.OPENROUTER_SITE_URL || 'http://localhost:5173';
const APP_NAME = process.env.OPENROUTER_APP_NAME || 'Smart Parking Kampus';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || '';
const GATE_API_TOKEN = process.env.GATE_API_TOKEN || '';

// Structured logging (JSON lines)
function log(level, msg, meta = {}) {
  console.log(JSON.stringify({ level, msg, time: new Date().toISOString(), ...meta }));
}

// Lightweight in-process metrics
const metrics = { requests: 0, errors: 0, rateLimited: 0, authDenied: 0, vlmCalls: 0 };

const limitVlm = createRateLimiter({ windowMs: 60000, max: 30 });
const limitWrite = createRateLimiter({ windowMs: 60000, max: 30 });
const limitRead = createRateLimiter({ windowMs: 60000, max: 180 });

function rateLimited(res, result) {
  metrics.rateLimited += 1;
  res.writeHead(429, {
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': String(result.retryAfter || 1),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ ok: false, error: 'Terlalu banyak permintaan. Coba lagi nanti.' }));
}

function loadEnv(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch {
    // .env optional; system env used as fallback
  }
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Token',
  });
  res.end(data);
}

async function readBody(req, limitBytes = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('Payload terlalu besar');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function extractJsonObject(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
}

let resolvedVllmModel = '';

function vllmHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (VLLM_API_KEY) headers.Authorization = `Bearer ${VLLM_API_KEY}`;
  return headers;
}

// Resolve the model served by vLLM. If the configured name is absent, use the
// first model advertised by /v1/models so a renamed model still works.
async function resolveVllmModel() {
  if (resolvedVllmModel) return resolvedVllmModel;
  try {
    const res = await fetch(`${VLLM_BASE_URL}/models`, {
      headers: vllmHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      const ids = (data?.data || []).map((m) => m?.id).filter(Boolean);
      if (ids.length) {
        resolvedVllmModel =
          !VLLM_MODEL || VLLM_MODEL === 'auto' || !ids.includes(VLLM_MODEL) ? ids[0] : VLLM_MODEL;
        return resolvedVllmModel;
      }
    }
  } catch {
    // vLLM not reachable yet; fall through to the configured name.
  }
  // Do not cache the fallback: once vLLM is up, the next call retries
  // /v1/models and can auto-discover the real served model name.
  return VLLM_MODEL || 'gemma-4-12b';
}

async function readPlate({ imageUrl, imageBase64, mimeType = 'image/jpeg', context = 'entry' }) {
  const isLocal = VLM_PROVIDER === 'vllm';
  if (!isLocal && !OPENROUTER_API_KEY) {
    return { ok: false, error: 'OPENROUTER_API_KEY belum diisi di .env' };
  }

  const dataUrl = imageUrl || (imageBase64 ? `data:${mimeType};base64,${imageBase64}` : null);
  if (!dataUrl) return { ok: false, error: 'imageUrl atau imageBase64 wajib diisi' };

  const prompt = `Anda adalah sistem VLM untuk Smart Parking kampus (Indonesia). Tugas: baca plat nomor kendaraan dari gambar.
Konteks: ${context === 'exit' ? 'verifikasi di gate keluar' : 'pendaftaran/sesi di gate masuk'}.
Balas HANYA JSON valid (tanpa markdown) dengan format:
{"plate":"B 1234 ABC","confidence":0.0-1.0,"vehicle_type":"car|motorcycle|unknown","raw_text":"teks terbaca","notes":"catatan singkat jika ada"}
Jika plat tidak terbaca, isi plate dengan null dan jelaskan di notes.`;

  const model = isLocal ? await resolveVllmModel() : OPENROUTER_MODEL;
  const endpoint = isLocal ? `${VLLM_BASE_URL}/chat/completions` : `${OPENROUTER_BASE_URL}/chat/completions`;
  const headers = isLocal
    ? vllmHeaders()
    : {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': SITE_URL,
        'X-Title': APP_NAME,
      };

  metrics.vlmCalls += 1;
  let response;
  try {
    response = await fetch(endpoint, {
      signal: AbortSignal.timeout(VLM_TIMEOUT_MS),
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    return {
      ok: false,
      provider: isLocal ? 'vllm' : 'openrouter',
      model,
      error: isLocal
        ? `vLLM tidak dapat dihubungi di ${VLLM_BASE_URL}: ${err?.message || String(err)}`
        : `OpenRouter tidak dapat dihubungi: ${err?.message || String(err)}`,
    };
  }

  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  if (!response.ok) {
    return {
      ok: false,
      provider: isLocal ? 'vllm' : 'openrouter',
      model,
      status: response.status,
      error:
        payload?.error?.message ||
        payload?.message ||
        `${isLocal ? 'vLLM' : 'OpenRouter'} error ${response.status}`,
      detail: payload,
    };
  }

  const text = payload?.choices?.[0]?.message?.content;
  const content = Array.isArray(text) ? text.map((p) => p?.text || '').join('\n') : (text || '');
  const parsed = extractJsonObject(content);
  return {
    ok: true,
    provider: isLocal ? 'vllm' : 'openrouter',
    model,
    result: parsed || { plate: null, confidence: 0, vehicle_type: 'unknown', raw_text: content, notes: 'Respons tidak berbentuk JSON.' },
    usage: payload?.usage || null,
  };
}

/* ------------------------- Operator assistant ------------------------- */

const ASSISTANT_TIMEOUT_MS = Number(process.env.ASSISTANT_TIMEOUT_MS || 30000);
const ASSISTANT_ACTION_TYPES = new Set([
  'create_domain',
  'update_domain',
  'delete_domain',
  'create_zone',
  'update_zone',
  'delete_zone',
  'cancel_booking',
  'cancel_bookings',
  'reissue_exit',
  'reissue_exits',
]);

const ASSISTANT_PROMPT = `Anda adalah asisten operator untuk dashboard Smart Parking Kampus (Indonesia).
Tugas: membantu operator membaca data parkir dan menyiapkan perubahan data.

ATURAN:
- Gunakan HANYA data dan ID pada "DATA SAAT INI". Jangan mengarang ID.
- Jika permintaan kurang jelas atau ID tidak ditemukan, tanyakan balik di "reply" dan jangan buat action.
- Jangan mengklaim sudah mengubah data. Perubahan hanya diusulkan lewat "action" dan dieksekusi setelah operator menyetujui.
- Hapus domain/zona hanya bila operator memintanya dengan jelas.
- Jawab ringkas dalam bahasa Indonesia.
- Balas dalam teks biasa, bukan Markdown: jangan pakai **, #, atau tabel. Untuk daftar gunakan baris diawali "- ".

Balas HANYA JSON valid tanpa markdown, salah satu bentuk:
{"reply":"jawaban untuk operator","action":null}
{"reply":"ringkasan perubahan yang akan dilakukan","action":{"type":"<tipe>","params":{...}}}

Tipe action dan params:
- create_domain: {name, description?}
- update_domain: {id, name?, description?}
- delete_domain: {id}
- create_zone: {name, domainId, vehicleType: "car"|"motorcycle", capacity, gateIn?, gateOut?}
- update_zone: {id, name?, domainId?, vehicleType?, capacity?, gateIn?, gateOut?}
- delete_zone: {id}
- cancel_booking: {sessionCode}
- cancel_bookings: {sessionCodes:["SP-...","SP-..."]}  (bulk; hanya sesi status BOOKED)
- reissue_exit: {sessionCode} (terbitkan ulang QR keluar; denda Rp20.000 bila QR lama kedaluwarsa)
- reissue_exits: {sessionCodes:["SP-..."]} (bulk)

ATURAN BULK:
- Jika operator meminta pembatalan beberapa/semua booking sekaligus, gunakan "cancel_bookings" dengan SEMUA sessionCode berstatus BOOKED yang cocok dari DATA SAAT INI. Jangan mengarang kode.
- Jika operator meminta terbitkan ulang beberapa QR keluar sekaligus, gunakan "reissue_exits" dengan SEMUA sessionCode berstatus PAID yang cocok.
- Untuk aksi bulk, tulis di "reply" berapa sesi yang akan diproses agar operator bisa memeriksa sebelum menyetujui.
- Jangan pernah memakai aksi bulk untuk sesi yang statusnya tidak sesuai.`;

async function assistantSnapshot() {
  const { domains, zones } = await getZonesWithOccupancy();
  const sessions = await getAllSessions();
  const today = new Date().toISOString().slice(0, 10);
  const analytics = await getAnalytics({ from: today, to: today });
  return {
    domains: domains.map((d) => ({ id: d.id, name: d.name, description: d.description || '' })),
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      domainId: z.domainId,
      vehicleType: z.vehicleType,
      capacity: z.capacity,
      occupied: z.occupied,
      available: z.available,
      gateIn: z.gateIn,
      gateOut: z.gateOut,
    })),
    activeSessions: sessions.slice(0, 50).map((s) => ({
      sessionCode: s.sessionCode,
      plate: s.displayPlate || s.plate,
      userName: s.userName,
      zoneId: s.zoneId,
      status: s.status,
      createdAt: s.createdAt,
      penaltyTotal: s.penaltyTotal || 0,
    })),
    activeSessionCounts: sessions.reduce((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {}),
    today: {
      totals: analytics.totals,
      finance: {
        totalRevenue: analytics.finance.totalRevenue,
        penaltyRevenue: analytics.finance.penaltyRevenue,
        totalPayments: analytics.finance.totalPayments,
        byVehicle: analytics.finance.byVehicle,
      },
      peakHours: analytics.peakHours,
      zones: analytics.zones.map((z) => ({
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        occupied: z.occupied,
        capacity: z.capacity,
        revenue: z.revenue,
        activity: z.activity,
        priority: z.priority,
      })),
    },
  };
}

async function askOperatorAssistant(messages) {
  if (!OPENROUTER_API_KEY) {
    return { ok: false, error: 'OPENROUTER_API_KEY belum diisi di .env' };
  }

  const snapshot = await assistantSnapshot();
  metrics.vlmCalls += 1;
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': SITE_URL,
      'X-Title': APP_NAME,
    },
    body: JSON.stringify({
      model: OPENROUTER_ASSISTANT_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: ASSISTANT_PROMPT },
        { role: 'system', content: `DATA SAAT INI (JSON):\n${JSON.stringify(snapshot)}` },
        ...messages,
      ],
    }),
  });

  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.error?.message || payload?.message || 'OpenRouter error',
    };
  }

  const text = payload?.choices?.[0]?.message?.content;
  const content = Array.isArray(text) ? text.map((p) => p?.text || '').join('\n') : (text || '');
  const parsed = extractJsonObject(content) || {};
  const proposed = parsed.action;
  const action =
    proposed && typeof proposed === 'object' && ASSISTANT_ACTION_TYPES.has(proposed.type)
      ? { type: proposed.type, params: proposed.params && typeof proposed.params === 'object' ? proposed.params : {} }
      : null;

  return {
    ok: true,
    model: OPENROUTER_ASSISTANT_MODEL,
    reply: typeof parsed.reply === 'string' ? parsed.reply : content || 'Tidak ada jawaban dari model.',
    action,
    usage: payload?.usage || null,
  };
}

// ---------------------------------------------------------------------------
// Voice conversation (OpenRouter STT + TTS), limited to a short session.
// ---------------------------------------------------------------------------

const voiceSessions = new Map();

function pruneVoiceSessions() {
  const now = Date.now();
  for (const [id, sess] of voiceSessions) {
    if (!sess || sess.expiresAt <= now) voiceSessions.delete(id);
  }
}

function pcm16ToWav(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function transcribeWithOpenRouter({ audioBase64, format = 'wav' }) {
  if (!OPENROUTER_API_KEY) {
    return { ok: false, error: 'OPENROUTER_API_KEY belum diisi di .env' };
  }
  metrics.vlmCalls += 1;
  let response;
  try {
    response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(Number(process.env.VOICE_STT_TIMEOUT_MS || 60000)),
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': SITE_URL,
        'X-Title': APP_NAME,
      },
      body: JSON.stringify({
        model: OPENROUTER_STT_MODEL,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transkripsikan audio ini kata per kata dalam bahasa Indonesia. Balas HANYA teks transkrip, tanpa penjelasan atau tanda kutip.',
              },
              { type: 'input_audio', input_audio: { data: audioBase64, format } },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    return { ok: false, error: `STT tidak dapat dihubungi: ${err?.message || String(err)}` };
  }

  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.error?.message || payload?.message || `STT error ${response.status}`,
    };
  }
  const content = payload?.choices?.[0]?.message?.content;
  const text = (Array.isArray(content) ? content.map((p) => p?.text || '').join(' ') : content || '').trim();
  return { ok: true, text, model: OPENROUTER_STT_MODEL, usage: payload?.usage || null };
}

async function synthesizeWithOpenRouter(text) {
  if (!OPENROUTER_API_KEY) {
    return { ok: false, error: 'OPENROUTER_API_KEY belum diisi di .env' };
  }
  const spoken = String(text || '').slice(0, 1500);
  if (!spoken.trim()) return { ok: false, error: 'Teks untuk TTS kosong' };

  metrics.vlmCalls += 1;
  let response;
  try {
    response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(Number(process.env.VOICE_TTS_TIMEOUT_MS || 120000)),
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': SITE_URL,
        'X-Title': APP_NAME,
      },
      body: JSON.stringify({
        model: OPENROUTER_TTS_MODEL,
        temperature: 0.2,
        stream: true,
        modalities: ['text', 'audio'],
        audio: { voice: OPENROUTER_TTS_VOICE, format: 'pcm16' },
        messages: [
          {
            role: 'system',
            content:
              'You are a text-to-speech engine. Read the user text exactly and verbatim in Indonesian. Do not add greetings, preambles, explanations, or extra words.',
          },
          { role: 'user', content: spoken },
        ],
      }),
    });
  } catch (err) {
    return { ok: false, error: `TTS tidak dapat dihubungi: ${err?.message || String(err)}` };
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = { raw }; }
    return {
      ok: false,
      status: response.status,
      error: payload?.error?.message || payload?.message || `TTS error ${response.status}`,
    };
  }

  const chunks = [];
  let transcript = '';
  let buffer = '';
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      if (event?.error) {
        return { ok: false, error: event.error?.message || 'TTS stream error' };
      }
      for (const choice of event?.choices || []) {
        const audio = choice?.delta?.audio;
        if (audio?.data) chunks.push(Buffer.from(audio.data, 'base64'));
        if (audio?.transcript) transcript += audio.transcript;
      }
    }
  }

  const pcm = Buffer.concat(chunks);
  if (!pcm.length) return { ok: false, error: 'TTS tidak menghasilkan audio' };
  return {
    ok: true,
    audioBase64: pcm16ToWav(pcm, 24000).toString('base64'),
    mimeType: 'audio/wav',
    model: OPENROUTER_TTS_MODEL,
    voice: OPENROUTER_TTS_VOICE,
    transcript,
  };
}

// SSE Connection Management hooked to Redis Pub/Sub
const sseClients = new Set();

redisSub.subscribe(EVENT_CHANNEL, (err) => {
  if (err) console.error('Redis subscribe error:', err);
  else console.log(`Redis Subscribed to channel: ${EVENT_CHANNEL}`);
});

redisSub.on('message', (channel, message) => {
  if (channel === EVENT_CHANNEL) {
    const sseData = `data: ${message}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(sseData);
      } catch {
        sseClients.delete(client);
      }
    }
  }
});

// Send keep-alive every 15s to keep connections alive
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(':keepalive\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 15000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  metrics.requests += 1;
  res.on('finish', () => {
    if (res.statusCode >= 500) metrics.errors += 1;
  });

  if (req.method === 'OPTIONS') return json(res, 204, {});

  // Health check (verifies Redis too)
  if (req.method === 'GET' && url.pathname === '/health') {
    let redisOk = false;
    try {
      redisOk = (await redis.ping()) === 'PONG';
    } catch {
      redisOk = false;
    }
    return json(res, redisOk ? 200 : 503, {
      ok: redisOk,
      redis: redisOk,
      vlmConfigured: VLM_PROVIDER === 'vllm' || Boolean(OPENROUTER_API_KEY),
      vlmProvider: VLM_PROVIDER,
      vlmModel: VLM_MODEL,
      assistantModel: OPENROUTER_ASSISTANT_MODEL,
      voice: {
        sttModel: OPENROUTER_STT_MODEL,
        ttsModel: OPENROUTER_TTS_MODEL,
        maxSeconds: VOICE_MAX_SECONDS,
      },
      activeSseClients: sseClients.size,
      uptimeSeconds: Math.round(process.uptime()),
    });
  }

  // Prometheus-style metrics
  if (req.method === 'GET' && url.pathname === '/metrics') {
    const body = [
      `smart_parking_requests_total ${metrics.requests}`,
      `smart_parking_errors_total ${metrics.errors}`,
      `smart_parking_rate_limited_total ${metrics.rateLimited}`,
      `smart_parking_auth_denied_total ${metrics.authDenied}`,
      `smart_parking_vlm_calls_total ${metrics.vlmCalls}`,
      `smart_parking_sse_clients ${sseClients.size}`,
    ].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    return res.end(`${body}\n`);
  }

  // Public auth capability info (no secrets): lets the UI decide to show a login page
  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    return json(res, 200, {
      ok: true,
      adminTokenRequired: Boolean(ADMIN_API_TOKEN),
      gateTokenRequired: Boolean(GATE_API_TOKEN),
    });
  }

  // Rate limiting: VLM is the most expensive surface
  const isVlmPath = url.pathname.startsWith('/api/vlm/');
  const isWrite = ['POST', 'PUT', 'DELETE'].includes(req.method || '');
  const limiter = isVlmPath ? limitVlm : isWrite ? limitWrite : limitRead;
  const rateKey = req.headers['x-api-token'] || clientIp(req);
  const rateResult = limiter(String(rateKey));
  if (!rateResult.allowed) return rateLimited(res, rateResult);

  // Authorization: admin console routes/mutations and gate/VLM routes
  const isAdminRoute = url.pathname.startsWith('/api/admin/');
  const domainMutation =
    isWrite && (url.pathname === '/api/domains' || url.pathname.startsWith('/api/domains/'));
  // /api/zones/scan belongs to the driver flow; only zone CRUD is admin-only.
  const zoneMutation =
    (req.method === 'POST' && url.pathname === '/api/zones') ||
    (['PUT', 'DELETE'].includes(req.method || '') && /^\/api\/zones\/[^/]+$/.test(url.pathname));
  const isAdminMutation = domainMutation || zoneMutation;

  if (isAdminRoute || isAdminMutation) {
    const denied = checkToken(req, ADMIN_API_TOKEN, 'admin');
    if (denied) {
      metrics.authDenied += 1;
      return json(res, denied.status, { ok: false, error: denied.error });
    }
  }

  if (url.pathname.startsWith('/api/gates/') || isVlmPath) {
    const denied = checkToken(req, GATE_API_TOKEN, 'gate');
    if (denied) {
      metrics.authDenied += 1;
      return json(res, denied.status, { ok: false, error: denied.error });
    }
  }

  // SSE Live update stream
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':connected\n\n');
    sseClients.add(res);

    // Send initial snapshot
    getZonesWithOccupancy().then((data) => {
      res.write(`data: ${JSON.stringify({ type: 'ZONE_SNAPSHOT', payload: data })}\n\n`);
    }).catch(() => {});

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // VLM provider diagnostics (no secrets). Used by the gate terminal and ops.
  if (req.method === 'GET' && url.pathname === '/api/vlm/status') {
    if (VLM_PROVIDER !== 'vllm') {
      return json(res, 200, {
        ok: true,
        provider: 'openrouter',
        model: OPENROUTER_VLM_MODEL,
        configured: Boolean(OPENROUTER_API_KEY),
      });
    }
    try {
      const r = await fetch(`${VLLM_BASE_URL}/models`, {
        headers: vllmHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      const data = r.ok ? await r.json().catch(() => ({})) : {};
      const models = (data?.data || []).map((m) => m?.id).filter(Boolean);
      return json(res, 200, {
        ok: true,
        provider: 'vllm',
        baseUrl: VLLM_BASE_URL,
        configuredModel: VLLM_MODEL,
        resolvedModel: resolvedVllmModel || null,
        reachable: r.ok,
        status: r.status,
        models,
      });
    } catch (err) {
      return json(res, 200, {
        ok: true,
        provider: 'vllm',
        baseUrl: VLLM_BASE_URL,
        configuredModel: VLLM_MODEL,
        reachable: false,
        error: err?.message || String(err),
      });
    }
  }

  // Standalone VLM plate OCR endpoint
  if (req.method === 'POST' && url.pathname === '/api/vlm/plate') {
    try {
      const body = JSON.parse(await readBody(req));
      const result = await readPlate(body || {});
      return json(res, result.ok ? 200 : 400, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Multi-frame plate OCR: read up to 5 frames, return a consensus decision
  if (req.method === 'POST' && url.pathname === '/api/vlm/plate/consensus') {
    try {
      const body = JSON.parse(await readBody(req, 24 * 1024 * 1024));
      const frames = Array.isArray(body?.frames) ? body.frames.slice(0, 5) : [];
      if (frames.length === 0) {
        return json(res, 400, { ok: false, error: 'frames wajib berisi minimal 1 gambar' });
      }

      const results = await Promise.all(
        frames.map(async (frame) => {
          const result = await readPlate({
            imageBase64: frame.imageBase64,
            mimeType: frame.mimeType || 'image/jpeg',
            context: body.context || 'entry',
          });
          return {
            plate: result.ok ? result.result?.plate || null : null,
            confidence: result.ok ? result.result?.confidence : undefined,
            error: result.ok ? undefined : result.error,
            provider: result.provider,
            model: result.model,
          };
        })
      );

      const decision = consensusPlate(results);
      const first = results.find((r) => r.model) || {};
      return json(res, 200, {
        ok: true,
        provider: first.provider || VLM_PROVIDER,
        model: first.model || VLM_MODEL,
        ...decision,
        frames: results,
      });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Get master domains and zones with live occupancy
  if (req.method === 'GET' && url.pathname === '/api/zones') {
    try {
      const data = await getZonesWithOccupancy();
      return json(res, 200, { ok: true, ...data });
    } catch (err) {
      return json(res, 500, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: Create a domain
  if (req.method === 'POST' && url.pathname === '/api/domains') {
    try {
      const body = JSON.parse(await readBody(req));
      const domain = await createDomain(body || {});
      return json(res, 201, { ok: true, domain });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: Update / delete a domain
  const domainMatch = url.pathname.match(/^\/api\/domains\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'PUT' && domainMatch) {
    try {
      const body = JSON.parse(await readBody(req));
      const domain = await updateDomain(domainMatch[1], body || {});
      return json(res, 200, { ok: true, domain });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  if (req.method === 'DELETE' && domainMatch) {
    try {
      const domain = await deleteDomain(domainMatch[1]);
      return json(res, 200, { ok: true, domain });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: Create new parking zone
  if (req.method === 'POST' && url.pathname === '/api/zones') {
    try {
      const body = JSON.parse(await readBody(req));
      const zone = await createZone(body || {});
      return json(res, 201, { ok: true, zone });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: Update parking zone
  const zoneMatch = url.pathname.match(/^\/api\/zones\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'PUT' && zoneMatch) {
    try {
      const zoneId = zoneMatch[1];
      const body = JSON.parse(await readBody(req));
      const zone = await updateZone(zoneId, body || {});
      return json(res, 200, { ok: true, zone });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: Delete parking zone
  if (req.method === 'DELETE' && zoneMatch) {
    try {
      const zoneId = zoneMatch[1];
      const zone = await deleteZone(zoneId);
      return json(res, 200, { ok: true, zone });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: Get all active sessions for monitoring
  if (req.method === 'GET' && url.pathname === '/api/admin/sessions') {
    try {
      const sessions = await getAllSessions();
      return json(res, 200, { ok: true, sessions });
    } catch (err) {
      return json(res, 500, { ok: false, error: err?.message || String(err) });
    }
  }

  // Gate kiosk: report local image-quality metrics (sharpness/brightness/contrast)
  const qualityMatch = url.pathname.match(/^\/api\/gates\/([A-Za-z0-9_-]+)\/quality$/);
  if (req.method === 'POST' && qualityMatch) {
    try {
      const body = JSON.parse(await readBody(req));
      const result = await recordGateQuality(qualityMatch[1], body || {});
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: Activity analytics & preventive-maintenance priorities
  if (req.method === 'GET' && url.pathname === '/api/admin/analytics') {
    try {
      const date = url.searchParams.get('date') || undefined;
      const from = url.searchParams.get('from') || undefined;
      const to = url.searchParams.get('to') || undefined;
      const analytics = await getAnalytics({ date, from, to });
      return json(res, 200, { ok: true, ...analytics });
    } catch (err) {
      return json(res, 500, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: Audit log history (date filter, default = latest events)
  if (req.method === 'GET' && url.pathname === '/api/admin/events') {
    try {
      const date = url.searchParams.get('date') || undefined;
      const from = url.searchParams.get('from') || undefined;
      const to = url.searchParams.get('to') || undefined;
      const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500);
      const events = await getEventHistory({ date, from, to, limit });
      return json(res, 200, { ok: true, events });
    } catch (err) {
      return json(res, 500, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: start a short voice conversation session (default 120 seconds)
  if (req.method === 'POST' && url.pathname === '/api/admin/voice/session') {
    pruneVoiceSessions();
    const id = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + VOICE_MAX_SECONDS * 1000;
    voiceSessions.set(id, { expiresAt, createdAt: Date.now() });
    return json(res, 200, {
      ok: true,
      voiceSessionId: id,
      maxSeconds: VOICE_MAX_SECONDS,
      expiresAt,
      sttModel: OPENROUTER_STT_MODEL,
      ttsModel: OPENROUTER_TTS_MODEL,
    });
  }

  // Admin: one voice turn — audio -> STT -> operator assistant -> TTS
  if (req.method === 'POST' && url.pathname === '/api/admin/voice') {
    try {
      pruneVoiceSessions();
      const body = JSON.parse((await readBody(req, 24 * 1024 * 1024)) || '{}');
      const voiceSessionId = String(body.voiceSessionId || '');
      const voiceSession = voiceSessions.get(voiceSessionId);
      if (!voiceSession || Date.now() > voiceSession.expiresAt) {
        voiceSessions.delete(voiceSessionId);
        return json(res, 410, {
          ok: false,
          error: `Sesi suara ${VOICE_MAX_SECONDS} detik sudah berakhir. Mulai sesi baru.`,
        });
      }

      let audioBase64 = String(body.audioBase64 || '');
      if (audioBase64.startsWith('data:')) {
        audioBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '');
      }
      if (!audioBase64) return json(res, 400, { ok: false, error: 'audioBase64 wajib diisi' });

      const audioBuffer = Buffer.from(audioBase64, 'base64');
      if (!audioBuffer.length) return json(res, 400, { ok: false, error: 'Audio kosong' });
      if (audioBuffer.length > VOICE_MAX_BYTES) {
        return json(res, 413, { ok: false, error: 'Audio terlalu besar' });
      }

      const format = String(body.format || 'wav').toLowerCase();
      if (!['wav', 'mp3'].includes(format)) {
        return json(res, 400, { ok: false, error: 'Format audio harus wav atau mp3' });
      }

      const stt = await transcribeWithOpenRouter({ audioBase64, format });
      if (!stt.ok) return json(res, 502, stt);
      if (!stt.text) {
        return json(res, 422, {
          ok: false,
          error: 'Suara tidak terdeteksi. Coba bicara lebih dekat ke mikrofon.',
        });
      }

      const history = Array.isArray(body.messages)
        ? body.messages
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
        : [];

      const assistant = await askOperatorAssistant([
        ...history,
        { role: 'user', content: stt.text },
      ]);
      if (!assistant.ok) return json(res, 502, assistant);

      const tts = await synthesizeWithOpenRouter(assistant.reply);
      return json(res, 200, {
        ok: true,
        transcript: stt.text,
        reply: assistant.reply,
        action: assistant.action,
        audioBase64: tts.ok ? tts.audioBase64 : null,
        audioMimeType: tts.ok ? tts.mimeType : null,
        audioError: tts.ok ? null : tts.error,
        models: {
          stt: stt.model,
          assistant: assistant.model,
          tts: tts.ok ? tts.model : OPENROUTER_TTS_MODEL,
        },
        usage: { stt: stt.usage || null, assistant: assistant.usage || null },
      });
    } catch (err) {
      metrics.errors += 1;
      log('error', 'voice_failed', { error: err?.message || String(err) });
      return json(res, 500, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: operator assistant (LLM; proposes actions, never executes them)
  if (req.method === 'POST' && url.pathname === '/api/admin/assistant') {
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      const messages = Array.isArray(body.messages)
        ? body.messages
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
        : [];
      if (messages.length === 0) {
        return json(res, 400, { ok: false, error: 'messages wajib diisi' });
      }
      const result = await askOperatorAssistant(messages);
      return json(res, result.ok ? 200 : 502, result);
    } catch (err) {
      metrics.errors += 1;
      log('error', 'assistant_failed', { error: err?.message || String(err) });
      return json(res, 500, { ok: false, error: err?.message || String(err) });
    }
  }

  // Admin: Emergency gate override
  if (req.method === 'POST' && url.pathname === '/api/admin/override') {
    try {
      const body = JSON.parse(await readBody(req));
      const result = await adminOverrideGate(body || {});
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Create booking
  if (req.method === 'POST' && url.pathname === '/api/bookings') {
    try {
      const body = JSON.parse(await readBody(req));
      const session = await createBooking(body || {});
      return json(res, 201, { ok: true, session });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Get session details
  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'GET' && sessionMatch) {
    try {
      const sessionCode = sessionMatch[1];
      const session = await getSession(sessionCode);
      if (!session) return json(res, 404, { ok: false, error: 'Sesi parkir tidak ditemukan' });
      return json(res, 200, { ok: true, session });
    } catch (err) {
      return json(res, 500, { ok: false, error: err?.message || String(err) });
    }
  }

  // Driver: move the session to another zone (before entry, or once after entry)
  if (req.method === 'POST' && url.pathname === '/api/bookings/change-zone') {
    try {
      const body = JSON.parse(await readBody(req));
      const session = await changeZone(body || {});
      return json(res, 200, { ok: true, session });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Driver: start checkout without scanning the zone QR again
  if (req.method === 'POST' && url.pathname === '/api/payments/checkout') {
    try {
      const body = JSON.parse(await readBody(req));
      const session = await requestCheckout(body || {});
      return json(res, 200, { ok: true, session });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Driver: cancel a booking before entering the gate
  if (req.method === 'POST' && url.pathname === '/api/bookings/cancel') {
    try {
      const body = JSON.parse(await readBody(req));
      const session = await cancelBooking(body || {});
      return json(res, 200, { ok: true, session });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Gate In: Scan session QR + VLM plate reading
  if (req.method === 'POST' && url.pathname === '/api/gates/entry') {
    try {
      const body = JSON.parse(await readBody(req));
      let plateRead = null;
      let vlmError = null;

      // Run VLM if image provided and no manual override
      if (body.platePhotoBase64 && !body.manualPlateOverride) {
        const vlmRes = await readPlate({
          imageBase64: body.platePhotoBase64,
          mimeType: body.mimeType || 'image/jpeg',
          context: 'entry',
        });
        if (vlmRes.ok) {
          plateRead = vlmRes.result;
        } else {
          vlmError = vlmRes.error;
        }
      }

      const result = await processGateIn({
        sessionCode: body.sessionCode,
        plateRead,
        manualPlateOverride: body.manualPlateOverride,
      });

      return json(res, 200, { ok: true, ...result, vlmError });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Zone QR scan: confirm parking or initiate checkout
  if (req.method === 'POST' && url.pathname === '/api/zones/scan') {
    try {
      const body = JSON.parse(await readBody(req));
      const session = await processZoneScan(body || {});
      return json(res, 200, { ok: true, session });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // In-app Payment (QRIS / mock)
  if (req.method === 'POST' && url.pathname === '/api/payments/pay') {
    try {
      const body = JSON.parse(await readBody(req));
      const session = await processPayment(body || {});
      return json(res, 200, { ok: true, session });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Re-issue expired exit QR (paid sessions only)
  if (req.method === 'POST' && url.pathname === '/api/payments/reissue') {
    try {
      const body = JSON.parse(await readBody(req));
      const result = await reissueExitCode(body || {});
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  // Gate Out: Scan exit QR + VLM plate verification
  if (req.method === 'POST' && url.pathname === '/api/gates/exit') {
    try {
      const body = JSON.parse(await readBody(req));
      let plateRead = null;
      let vlmError = null;

      // Run VLM if image provided and no manual override
      if (body.platePhotoBase64 && !body.manualPlateOverride) {
        const vlmRes = await readPlate({
          imageBase64: body.platePhotoBase64,
          mimeType: body.mimeType || 'image/jpeg',
          context: 'exit',
        });
        if (vlmRes.ok) {
          plateRead = vlmRes.result;
        } else {
          vlmError = vlmRes.error;
        }
      }

      const result = await processGateOut({
        exitCode: body.exitCode,
        plateRead,
        manualPlateOverride: body.manualPlateOverride,
      });

      return json(res, 200, { ok: true, ...result, vlmError });
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  return json(res, 404, { ok: false, error: 'Not found' });
});

// Startup: master data, counter rebuild, expiry scheduler, config warnings
initMasterData()
  .then(async () => {
    const rebuilt = await rebuildCounters();
    log('info', 'counters_rebuilt', { keys: rebuilt });
    startScheduler(30000);
    if (!ADMIN_API_TOKEN) log('warn', 'admin_token_missing', { note: 'admin API is open' });
    if (!GATE_API_TOKEN) log('warn', 'gate_token_missing', { note: 'gate/VLM API is open' });
    if (VLM_PROVIDER === 'vllm') {
      log('info', 'vlm_provider', { provider: 'vllm', baseUrl: VLLM_BASE_URL, model: VLLM_MODEL });
    } else if (!OPENROUTER_API_KEY) {
      log('warn', 'openrouter_key_missing');
    }
    if (!OPENROUTER_API_KEY) log('warn', 'voice_and_assistant_unavailable');
  })
  .catch((err) => log('error', 'startup_failed', { error: String(err) }));

server.listen(PORT, HOST, () => {
  log('info', 'server_listening', {
    url: `http://${HOST}:${PORT}`,
    vlmProvider: VLM_PROVIDER,
    vlmModel: VLM_MODEL,
    assistantModel: OPENROUTER_ASSISTANT_MODEL,
  });
});

function shutdown(signal) {
  log('info', 'shutdown', { signal });
  stopScheduler();
  server.close(() => {
    Promise.allSettled([redis.quit(), redisSub.quit()]).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
