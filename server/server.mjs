import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initMasterData,
  getZonesWithOccupancy,
  createBooking,
  getSession,
  processGateIn,
  processZoneScan,
  processPayment,
  processGateOut,
  createDomain,
  updateDomain,
  deleteDomain,
  createZone,
  updateZone,
  deleteZone,
  getAllSessions,
  getAnalytics,
  adminOverrideGate,
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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
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
  if (req.method === 'OPTIONS') return json(res, 204, {});

  // Health check
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      model: OPENROUTER_MODEL,
      hasApiKey: Boolean(OPENROUTER_API_KEY),
      activeSseClients: sseClients.size,
    });
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

  // Admin: Activity analytics & preventive-maintenance priorities
  if (req.method === 'GET' && url.pathname === '/api/admin/analytics') {
    try {
      const analytics = await getAnalytics();
      return json(res, 200, { ok: true, ...analytics });
    } catch (err) {
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

// Initialize master data on startup
initMasterData().catch(console.error);

server.listen(PORT, HOST, () => {
  console.log(`Smart Parking server listening on http://${HOST}:${PORT} (model=${OPENROUTER_MODEL}, Redis=connected)`);
});
