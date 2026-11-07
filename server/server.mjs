import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

async function readPlate({ imageUrl, imageBase64, mimeType = 'image/jpeg', context = 'entry' }) {
  if (!OPENROUTER_API_KEY) {
    return { ok: false, error: 'OPENROUTER_API_KEY belum diisi di .env' };
  }

  const dataUrl = imageUrl || (imageBase64 ? `data:${mimeType};base64,${imageBase64}` : null);
  if (!dataUrl) return { ok: false, error: 'imageUrl atau imageBase64 wajib diisi' };

  const prompt = `Anda adalah sistem VLM untuk Smart Parking kampus (Indonesia). Tugas: baca plat nomor kendaraan dari gambar.
Konteks: ${context === 'exit' ? 'verifikasi di gate keluar' : 'pendaftaran/sesi di gate masuk'}.
Balas HANYA JSON valid (tanpa markdown) dengan format:
{"plate":"B 1234 ABC","confidence":0.0-1.0,"vehicle_type":"car|motorcycle|unknown","raw_text":"teks terbaca","notes":"catatan singkat jika ada"}
Jika plat tidak terbaca, isi plate dengan null dan jelaskan di notes.`;

  metrics.vlmCalls += 1;
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    signal: AbortSignal.timeout(Number(process.env.VLM_TIMEOUT_MS || 20000)),
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': SITE_URL,
      'X-Title': APP_NAME,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
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

  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  if (!response.ok) {
    return { ok: false, status: response.status, error: payload?.error?.message || payload?.message || 'OpenRouter error', detail: payload };
  }

  const text = payload?.choices?.[0]?.message?.content;
  const content = Array.isArray(text) ? text.map((p) => p?.text || '').join('\n') : (text || '');
  const parsed = extractJsonObject(content);
  return {
    ok: true,
    model: OPENROUTER_MODEL,
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
  'reissue_exit',
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
- reissue_exit: {sessionCode} (terbitkan ulang QR keluar; denda Rp20.000 bila QR lama kedaluwarsa)`;

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
      model: OPENROUTER_MODEL,
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
    model: OPENROUTER_MODEL,
    reply: typeof parsed.reply === 'string' ? parsed.reply : content || 'Tidak ada jawaban dari model.',
    action,
    usage: payload?.usage || null,
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
      vlmConfigured: Boolean(OPENROUTER_API_KEY),
      model: OPENROUTER_MODEL,
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
          };
        })
      );

      const decision = consensusPlate(results);
      return json(res, 200, { ok: true, model: OPENROUTER_MODEL, ...decision, frames: results });
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
    if (!OPENROUTER_API_KEY) log('warn', 'openrouter_key_missing');
  })
  .catch((err) => log('error', 'startup_failed', { error: String(err) }));

server.listen(PORT, HOST, () => {
  log('info', 'server_listening', {
    url: `http://${HOST}:${PORT}`,
    model: OPENROUTER_MODEL,
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
