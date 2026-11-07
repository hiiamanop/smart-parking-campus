import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    // .env opsional; env sistem tetap dipakai
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      model: OPENROUTER_MODEL,
      hasApiKey: Boolean(OPENROUTER_API_KEY),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/vlm/plate') {
    try {
      const body = JSON.parse(await readBody(req));
      const result = await readPlate(body || {});
      return json(res, result.ok ? 200 : 400, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err?.message || String(err) });
    }
  }

  return json(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`VLM proxy listening on http://${HOST}:${PORT} (model=${OPENROUTER_MODEL}, key=${OPENROUTER_API_KEY ? 'set' : 'MISSING'})`);
});
