import crypto from 'node:crypto';

// Constant-time string comparison for API tokens
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function bearerToken(req) {
  const header = req.headers['authorization'] || '';
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const alt = req.headers['x-api-token'];
  if (typeof alt === 'string') return alt.trim();
  return '';
}

/**
 * Returns null when allowed, or { status, error } when denied.
 * When no token is configured, the check is disabled (development mode).
 */
export function checkToken(req, expected, label) {
  if (!expected) return null;
  const token = bearerToken(req);
  if (!token) return { status: 401, error: `Token ${label} wajib dikirim` };
  if (!safeEqual(token, expected)) return { status: 403, error: `Token ${label} tidak valid` };
  return null;
}

// Simple fixed-window rate limiter, per key (IP or token)
export function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();

  return function hit(key) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: max - 1, retryAfter: 0 };
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
    }
    return { allowed: true, remaining: max - bucket.count, retryAfter: 0 };
  };
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
