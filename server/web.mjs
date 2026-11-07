import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const APP_DIR = path.resolve(process.env.APP_DIR || './app/dist');
const API_TARGET = new URL(process.env.API_TARGET || 'http://127.0.0.1:8788');
const API_BASE = API_TARGET.origin;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function proxy(req, res) {
  const headers = { ...req.headers, host: API_TARGET.host };
  const upstream = http.request(
    {
      hostname: API_TARGET.hostname,
      port: API_TARGET.port || 80,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ ok: false, error: `API tidak dapat dihubungi: ${err.message}` }));
  });
  req.pipe(upstream);
}

async function serveStatic(req, res, pathname) {
  let urlPath;
  try { urlPath = decodeURIComponent(pathname); } catch { return false; }
  if (urlPath.includes('\0')) return false;

  const requested = path.resolve(APP_DIR, `.${urlPath}`);
  if (!isInside(APP_DIR, requested)) return false;

  let filePath = requested;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (path.extname(urlPath)) return false;
    filePath = path.join(APP_DIR, 'index.html');
  }

  if (!isInside(APP_DIR, filePath)) return false;

  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (base === 'index.html' || base === 'sw.js' || ext === '.webmanifest') {
    headers['Cache-Control'] = 'no-cache';
  } else if (urlPath.startsWith('/assets/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else {
    headers['Cache-Control'] = 'public, max-age=3600';
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  res.end(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'smart-parking-web', appDir: APP_DIR, api: API_BASE }));
  }

  if (url.pathname.startsWith('/api/')) return proxy(req, res);

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (await serveStatic(req, res, url.pathname)) return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`smart-parking-web on http://${HOST}:${PORT} (app=${APP_DIR}, api=${API_BASE})`);
});
