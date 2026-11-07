import Redis from 'ioredis';
import crypto from 'node:crypto';
import { persistSession } from './persistence.mjs';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
export const EVENT_CHANNEL = 'parking:events';

export const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
export const redisSub = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });

// Master data: domains (area groupings) and parking zones
const INITIAL_DOMAINS = [
  { id: 'DOM-TEKNIK', name: 'Teknik', description: 'Area Fakultas Teknik' },
  { id: 'DOM-EKONOMI', name: 'Ekonomi & Bisnis', description: 'Area Fakultas Ekonomi & Bisnis' },
  { id: 'DOM-KEDOKTERAN', name: 'Kedokteran', description: 'Area Fakultas Kedokteran' },
  { id: 'DOM-ILKOM', name: 'Ilmu Komputer', description: 'Area Fakultas Ilmu Komputer' },
];

const INITIAL_ZONES = [
  { id: 'zone-a', name: 'Zona A - Lapangan Barat', domainId: 'DOM-TEKNIK', vehicleType: 'motorcycle', capacity: 20, gateIn: 'Gate Barat In', gateOut: 'Gate Barat Out' },
  { id: 'zone-b', name: 'Zona B - Lapangan Selatan', domainId: 'DOM-EKONOMI', vehicleType: 'car', capacity: 15, gateIn: 'Gate Selatan In', gateOut: 'Gate Selatan Out' },
  { id: 'zone-c', name: 'Zona C - Lapangan Timur', domainId: 'DOM-KEDOKTERAN', vehicleType: 'motorcycle', capacity: 10, gateIn: 'Gate Timur In', gateOut: 'Gate Timur Out' },
  { id: 'zone-d', name: 'Zona D - Gedung Baru', domainId: 'DOM-ILKOM', vehicleType: 'car', capacity: 25, gateIn: 'Gate Utara In', gateOut: 'Gate Utara Out' },
];

const VEHICLE_TYPES = ['car', 'motorcycle'];

// Per-zone daily reservation counter. Prevents race conditions on quota.
function counterKey(day, zoneId) {
  return `parking:count:${day}:${zoneId}`;
}

const RESERVE_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local capacity = tonumber(ARGV[1])
if current >= capacity then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 172800)
return 1
`;

// Cross-instance lock for session state transitions
async function withSessionLock(sessionCode, fn, ttlMs = 8000) {
  const key = `parking:lock:${sessionCode}`;
  const token = crypto.randomUUID();
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (!ok) throw new Error('Sesi sedang diproses. Coba lagi.');
  try {
    return await fn();
  } finally {
    const release = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end`;
    try { await redis.eval(release, 1, key, token); } catch {}
  }
}

async function releaseBookingSlot(session) {
  const day = session.bookingDate || (session.etaTime ? new Date(session.etaTime).toISOString().slice(0, 10) : null);
  if (!day || !session.zoneId) return;
  const key = counterKey(day, session.zoneId);
  const value = await redis.decr(key);
  if (value < 0) await redis.set(key, 0);
}

// QR validity windows (milliseconds)
export const ENTRY_QR_TTL_MS = 15 * 60 * 1000; // from ETA
const EXIT_QR_TTL_S = 20 * 60;               // from payment
export const EXIT_EXPIRED_PENALTY = 20000;   // denda QR keluar kedaluwarsa

// Helper to normalize plate string for matching
export function normalizePlate(str) {
  if (!str) return '';
  return str.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Seed master data; migrate legacy "faculties" key to "domains" once
export async function initMasterData() {
  const hasDomains = await redis.exists('parking:master:domains');
  if (!hasDomains) {
    const legacyFaculties = await redis.get('parking:master:faculties');
    if (legacyFaculties) {
      const parsed = JSON.parse(legacyFaculties || '[]');
      const domains = parsed.map((f) => ({ id: f.id, name: f.name, description: '' }));
      await redis.set('parking:master:domains', JSON.stringify(domains));
    } else {
      await redis.set('parking:master:domains', JSON.stringify(INITIAL_DOMAINS));
    }
    // Migrate zones facultyId -> domainId
    const zonesRaw = await redis.get('parking:master:zones');
    if (zonesRaw) {
      const zones = JSON.parse(zonesRaw || '[]').map((z) => {
        if (z.domainId) return z;
        const { facultyId, ...rest } = z;
        return { ...rest, domainId: facultyId };
      });
      await redis.set('parking:master:zones', JSON.stringify(zones));
    }
  }

  const hasZones = await redis.exists('parking:master:zones');
  if (!hasZones) {
    await redis.set('parking:master:zones', JSON.stringify(INITIAL_ZONES));
  } else {
    // Backfill vehicleType for zones created before the attribute existed.
    // Defaults to motorcycle (dominant campus vehicle type).
    const zonesRaw = await redis.get('parking:master:zones');
    const zones = JSON.parse(zonesRaw || '[]');
    let changed = false;
    for (const z of zones) {
      if (!z.vehicleType) {
        z.vehicleType = 'motorcycle';
        changed = true;
      }
    }
    if (changed) await redis.set('parking:master:zones', JSON.stringify(zones));
  }
}

// Publish event to Redis channel
export async function publishEvent(type, payload) {
  const event = {
    type,
    payload,
    timestamp: new Date().toISOString(),
  };
  await redis.publish(EVENT_CHANNEL, JSON.stringify(event));
  // Keep a capped history for the audit log date filter
  try {
    const multi = redis.multi();
    multi.lpush('parking:events:log', JSON.stringify(event));
    multi.ltrim('parking:events:log', 0, 4999);
    await multi.exec();
  } catch {
    // history is best-effort
  }
}

// Audit log history for a given date (YYYY-MM-DD), newest first
export async function getEventHistory({ date, from, to, limit = 200 } = {}) {
  const start = from || date || null;
  const end = to || date || start;
  const raw = await redis.lrange('parking:events:log', 0, 4999);
  const events = [];
  for (const item of raw) {
    try {
      const event = JSON.parse(item);
      const day = String(event.timestamp || '').slice(0, 10);
      const inRange = (!start || day >= start) && (!end || day <= end);
      if (inRange) {
        events.push(event);
        if (events.length >= limit) break;
      }
    } catch {
      // skip malformed entries
    }
  }
  return events;
}

// Get all domains and zones with live occupancy counts
export async function getZonesWithOccupancy() {
  await initMasterData();
  const [domainsRaw, zonesRaw] = await Promise.all([
    redis.get('parking:master:domains'),
    redis.get('parking:master:zones'),
  ]);

  const domains = JSON.parse(domainsRaw || '[]');
  const zones = JSON.parse(zonesRaw || '[]');

  // Occupancy for today comes from the per-date reservation counters
  const today = new Date().toISOString().slice(0, 10);
  const counts = {};
  await Promise.all(
    zones.map(async (zone) => {
      counts[zone.id] = Number((await redis.get(counterKey(today, zone.id))) || 0);
    })
  );

  const zonesWithLive = zones.map((z) => {
    const occupied = counts[z.id] || 0;
    const available = Math.max(0, z.capacity - occupied);
    return {
      ...z,
      occupied,
      available,
      isFull: available === 0,
    };
  });

  return { domains, zones: zonesWithLive };
}

// Check if a session has expired (ETA + 10 mins)
export function checkSessionExpired(sess) {
  if (sess.status !== 'BOOKED') return false;
  const expiry = sess.entryQrExpiresAt || (sess.etaTime ? sess.etaTime + ENTRY_QR_TTL_MS : 0);
  if (!expiry) return false;
  return Date.now() > expiry;
}

// Activity counters per zone, used for preventive-maintenance analytics.
// Manual plate overrides and plate mismatches are early signals that a gate
// camera / VLM reader needs inspection.
export async function recordActivity(zoneId, event, { amount = 1, countActivity = true } = {}) {
  if (!zoneId) return;
  const key = `parking:stats:zone:${zoneId}`;
  const now = new Date();
  const hour = String(now.getHours()).padStart(2, '0');
  const day = now.toISOString().slice(0, 10);
  const multi = redis.multi();
  multi.hincrby(key, event, amount);
  multi.hset(key, 'lastActivity', now.toISOString());
  multi.hincrby(`parking:stats:zone:day:${day}`, `${zoneId}:${event}`, amount);
  if (countActivity) {
    multi.hincrby(key, 'activity', amount);
    multi.hincrby(`parking:stats:zone:day:${day}`, `${zoneId}:activity`, amount);
    multi.hincrby('parking:stats:hours', hour, amount);
    multi.hincrby(`parking:stats:hours:${day}`, hour, amount);
  }
  try {
    await multi.exec();
  } catch {
    // Analytics must never block the parking flow
  }
}

// Revenue counters per zone and per day, for financial analytics
export async function recordRevenue(zoneId, amount, vehicleType) {
  if (!zoneId || !amount) return;
  const key = `parking:stats:zone:${zoneId}`;
  const day = new Date().toISOString().slice(0, 10);
  const multi = redis.multi();
  multi.hincrby(key, 'revenue', amount);
  multi.hincrby(key, 'payments', 1);
  multi.hincrby(key, vehicleType === 'car' ? 'revenueCar' : 'revenueMotorcycle', amount);
  multi.hincrbyfloat('parking:stats:revenue:days', day, amount);
  multi.hincrby(`parking:stats:zone:revenue:day:${day}`, zoneId, amount);
  multi.hincrby(`parking:stats:zone:revenue:day:${day}`, `${zoneId}:${vehicleType === 'car' ? 'car' : 'motorcycle'}`, amount);
  multi.hincrby(`parking:stats:zone:payments:day:${day}`, zoneId, 1);
  try {
    await multi.exec();
  } catch {
    // Financial analytics must never block payment
  }
}

// Gate camera image-quality sampling (local CV metrics sent by the kiosk)
export function scoreImageQuality({ sharpness = 0, brightness = 128, contrast = 0 }) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const sharpScore = clamp(sharpness / 40);
  const brightScore = clamp(1 - Math.abs(brightness - 128) / 128);
  const contrastScore = clamp(contrast / 50);
  return Math.round(100 * (0.5 * sharpScore + 0.3 * brightScore + 0.2 * contrastScore));
}

export async function recordGateQuality(gateId, metrics = {}) {
  if (!gateId) throw new Error('gateId wajib diisi');
  const score = scoreImageQuality(metrics);
  const key = `parking:stats:gate:${gateId}`;
  const recentKey = `parking:quality:recent:${gateId}`;
  const now = new Date().toISOString();

  const previous = Number((await redis.hget(key, 'ewma')) || score);
  const ewma = Math.round(previous * 0.8 + score * 0.2);

  const multi = redis.multi();
  multi.hincrby(key, 'samples', 1);
  multi.hincrby(key, 'scoreSum', score);
  multi.hincrby(key, 'lowSamples', score < 50 ? 1 : 0);
  multi.hset(key, {
    ewma,
    lastScore: score,
    lastAt: now,
    lastSharpness: Math.round(metrics.sharpness || 0),
    lastBrightness: Math.round(metrics.brightness || 0),
    lastContrast: Math.round(metrics.contrast || 0),
  });
  multi.lpush(recentKey, score);
  multi.ltrim(recentKey, 0, 19);
  await multi.exec();

  await publishEvent('GATE_QUALITY', { gateId, score, ewma });
  return { gateId, score, ewma, at: now };
}

export async function getGateQuality() {
  const keys = await redis.keys('parking:stats:gate:*');
  const gates = [];
  for (const key of keys) {
    const gateId = key.replace('parking:stats:gate:', '');
    const raw = await redis.hgetall(key);
    const recent = (await redis.lrange(`parking:quality:recent:${gateId}`, 0, 9)).map(Number);
    const samples = Number(raw.samples || 0);
    const sorted = [...recent];
    const latest = sorted.slice(0, 3);
    const previous = sorted.slice(3, 6);
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const trend = previous.length ? Math.round(avg(latest) - avg(previous)) : 0;
    const ewma = Number(raw.ewma || 0);

    let status = 'baik';
    if (ewma < 50 || (latest.length >= 3 && avg(latest) < 50)) status = 'perlu-perhatian';
    else if (trend <= -8) status = 'menurun';

    gates.push({
      gateId,
      samples,
      ewma,
      lastScore: Number(raw.lastScore || 0),
      lastAt: raw.lastAt || null,
      lowSamples: Number(raw.lowSamples || 0),
      average: samples > 0 ? Math.round(Number(raw.scoreSum || 0) / samples) : 0,
      recent,
      trend,
      status,
      lastSharpness: Number(raw.lastSharpness || 0),
      lastBrightness: Number(raw.lastBrightness || 0),
      lastContrast: Number(raw.lastContrast || 0),
    });
  }
  return gates.sort((a, b) => a.ewma - b.ewma);
}

// Penalty counters (expired exit QR redemption)
export async function recordPenalty(zoneId, amount) {
  if (!zoneId || !amount) return;
  const key = `parking:stats:zone:${zoneId}`;
  const day = new Date().toISOString().slice(0, 10);
  const multi = redis.multi();
  multi.hincrby(key, 'penaltyRevenue', amount);
  multi.hincrby(key, 'penaltyCount', 1);
  multi.hincrby(key, 'expiredExitCount', 1);
  multi.hincrbyfloat('parking:stats:penalty:days', day, amount);
  multi.hincrby(`parking:stats:zone:penalty:day:${day}`, zoneId, amount);
  multi.hincrby(`parking:stats:zone:day:${day}`, `${zoneId}:penalty`, amount);
  multi.hincrby(`parking:stats:zone:day:${day}`, `${zoneId}:penaltyCount`, 1);
  try {
    await multi.exec();
  } catch {
    // best-effort
  }
}

// Analytics: zone/domain activity, occupancy, peak hours, maintenance priority
function buildDayRange(from, to, maxDays = 92) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const days = [];
  for (let d = new Date(start); d <= end && days.length < maxDays; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

async function sumHashes(keys) {
  const total = {};
  for (const key of keys) {
    const hash = await redis.hgetall(key);
    for (const [field, value] of Object.entries(hash)) {
      total[field] = Number(total[field] || 0) + Number(value || 0);
    }
  }
  return total;
}

export async function getAnalytics({ date, from, to } = {}) {
  const { domains, zones } = await getZonesWithOccupancy();

  const rangeFrom = from || to || date;
  const rangeTo = to || from || date;
  const days = rangeFrom && rangeTo ? buildDayRange(rangeFrom, rangeTo) : [];
  const rangeMode = days.length > 0;

  let dayActivity = null;
  let dayRevenue = null;
  let dayPayments = null;
  let rangeHours = null;
  if (rangeMode) {
    dayActivity = await sumHashes(days.map((d) => `parking:stats:zone:day:${d}`));
    dayRevenue = await sumHashes(days.map((d) => `parking:stats:zone:revenue:day:${d}`));
    dayPayments = await sumHashes(days.map((d) => `parking:stats:zone:payments:day:${d}`));
    rangeHours = await sumHashes(days.map((d) => `parking:stats:hours:${d}`));
  }

  const zoneStats = {};
  for (const z of zones) {
    if (rangeMode) {
      const ev = (name) => Number(dayActivity[`${z.id}:${name}`] || 0);
      zoneStats[z.id] = {
        bookings: ev('bookings'),
        entries: ev('entries'),
        exits: ev('exits'),
        manualOverrides: ev('manualOverrides'),
        mismatches: ev('mismatches'),
        zoneViolations: ev('zoneViolations'),
        revenue: Number(dayRevenue[z.id] || 0),
        payments: Number(dayPayments[z.id] || 0),
        revenueMotorcycle: Number(dayRevenue[`${z.id}:motorcycle`] || 0),
        revenueCar: Number(dayRevenue[`${z.id}:car`] || 0),
        penaltyRevenue: ev('penalty'),
        penaltyCount: ev('penaltyCount'),
        activity: ev('activity') || ev('bookings') + ev('entries') + ev('exits'),
        lastActivity: null,
      };
      continue;
    }
    const raw = await redis.hgetall(`parking:stats:zone:${z.id}`);
    zoneStats[z.id] = {
      bookings: Number(raw.bookings || 0),
      entries: Number(raw.entries || 0),
      exits: Number(raw.exits || 0),
      manualOverrides: Number(raw.manualOverrides || 0),
      mismatches: Number(raw.mismatches || 0),
      zoneViolations: Number(raw.zoneViolations || 0),
      revenue: Number(raw.revenue || 0),
      payments: Number(raw.payments || 0),
      revenueMotorcycle: Number(raw.revenueMotorcycle || 0),
      revenueCar: Number(raw.revenueCar || 0),
      penaltyRevenue: Number(raw.penaltyRevenue || 0),
      penaltyCount: Number(raw.penaltyCount || 0),
      activity: Number(raw.activity || 0),
      lastActivity: raw.lastActivity || null,
    };
  }

  const maxActivity = Math.max(1, ...Object.values(zoneStats).map((s) => s.activity));
  const maxOverrides = Math.max(1, ...Object.values(zoneStats).map((s) => s.manualOverrides));
  const maxMismatches = Math.max(1, ...Object.values(zoneStats).map((s) => s.mismatches));

  const enrichedZones = zones.map((z) => {
    const s = zoneStats[z.id];
    const activityShare = s.activity / maxActivity;
    const overrideShare = s.manualOverrides / maxOverrides;
    const mismatchShare = s.mismatches / maxMismatches;
    // Higher activity => more wear, overrides/mismatches => probable camera issues
    const maintenanceScore = Math.round(
      100 * (0.55 * activityShare + 0.3 * overrideShare + 0.15 * mismatchShare)
    );
    const priority = maintenanceScore >= 70 ? 'tinggi' : maintenanceScore >= 40 ? 'sedang' : 'rendah';
    const checkIntervalDays = priority === 'tinggi' ? 1 : priority === 'sedang' ? 3 : 7;

    return {
      zoneId: z.id,
      zoneName: z.name,
      domainId: z.domainId,
      capacity: z.capacity,
      occupied: z.occupied,
      available: z.available,
      occupancyRate: z.capacity > 0 ? Math.round((z.occupied / z.capacity) * 100) : 0,
      ...s,
      maintenanceScore,
      priority,
      checkIntervalDays,
    };
  }).sort((a, b) => b.maintenanceScore - a.maintenanceScore);

  const domainRollup = domains.map((d) => {
    const zs = enrichedZones.filter((z) => z.domainId === d.id);
    const capacity = zs.reduce((a, z) => a + z.capacity, 0);
    const occupied = zs.reduce((a, z) => a + z.occupied, 0);
    return {
      domainId: d.id,
      domainName: d.name,
      zones: zs.length,
      capacity,
      occupied,
      occupancyRate: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0,
      activity: zs.reduce((a, z) => a + z.activity, 0),
      manualOverrides: zs.reduce((a, z) => a + z.manualOverrides, 0),
      mismatches: zs.reduce((a, z) => a + z.mismatches, 0),
      zoneViolations: zs.reduce((a, z) => a + z.zoneViolations, 0),
      topScore: zs.length ? Math.max(...zs.map((z) => z.maintenanceScore)) : 0,
    };
  }).sort((a, b) => b.activity - a.activity);

  const hoursRaw = rangeMode ? rangeHours : await redis.hgetall('parking:stats:hours');
  const hours = Array.from({ length: 24 }, (_, h) => {
    const key = String(h).padStart(2, '0');
    return { hour: key, activity: Number(hoursRaw[key] || 0) };
  });
  const peakHours = [...hours].sort((a, b) => b.activity - a.activity).slice(0, 3);

  const daysRaw = await redis.hgetall('parking:stats:revenue:days');
  const dayList = [];
  if (rangeMode) {
    for (const key of days.slice(-31)) {
      dayList.push({ date: key, revenue: Math.round(Number(daysRaw[key] || 0)) });
    }
  } else {
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayList.push({ date: key, revenue: Math.round(Number(daysRaw[key] || 0)) });
    }
  }

  const totalPenaltyRevenue = enrichedZones.reduce((a, z) => a + (z.penaltyRevenue || 0), 0);
  const finance = {
    totalRevenue: enrichedZones.reduce((a, z) => a + z.revenue, 0),
    totalPayments: enrichedZones.reduce((a, z) => a + z.payments, 0),
    penaltyRevenue: totalPenaltyRevenue,
    grandTotal: enrichedZones.reduce((a, z) => a + z.revenue + (z.penaltyRevenue || 0), 0),
    byVehicle: {
      motorcycle: enrichedZones.reduce((a, z) => a + z.revenueMotorcycle, 0),
      car: enrichedZones.reduce((a, z) => a + z.revenueCar, 0),
    },
    byZone: enrichedZones
      .map((z) => ({
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        domainId: z.domainId,
        revenue: z.revenue,
        payments: z.payments,
        penaltyRevenue: z.penaltyRevenue || 0,
        average: z.payments > 0 ? Math.round(z.revenue / z.payments) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue),
    byDomain: domainRollup
      .map((d) => {
        const zs = enrichedZones.filter((z) => z.domainId === d.domainId);
        const revenue = zs.reduce((a, z) => a + z.revenue, 0);
        const payments = zs.reduce((a, z) => a + z.payments, 0);
        return {
          domainId: d.domainId,
          domainName: d.domainName,
          revenue,
          payments,
          average: payments > 0 ? Math.round(revenue / payments) : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue),
    daily: dayList,
  };

  const gateQuality = await getGateQuality();

  return {
    generatedAt: new Date().toISOString(),
    period: rangeMode ? `${days[0]}..${days[days.length - 1]}` : 'all',
    finance,
    gates: gateQuality,
    totals: {
      activity: enrichedZones.reduce((a, z) => a + z.activity, 0),
      entries: enrichedZones.reduce((a, z) => a + z.entries, 0),
      exits: enrichedZones.reduce((a, z) => a + z.exits, 0),
      manualOverrides: enrichedZones.reduce((a, z) => a + z.manualOverrides, 0),
      mismatches: enrichedZones.reduce((a, z) => a + z.mismatches, 0),
      zoneViolations: enrichedZones.reduce((a, z) => a + z.zoneViolations, 0),
      revenue: finance.totalRevenue,
      payments: finance.totalPayments,
      penaltyRevenue: finance.penaltyRevenue,
      penalties: enrichedZones.reduce((a, z) => a + (z.penaltyCount || 0), 0),
      highPriorityZones: enrichedZones.filter((z) => z.priority === 'tinggi').length,
    },
    zones: enrichedZones,
    domains: domainRollup,
    hours,
    peakHours,
  };
}

// Create a new booking (only ETA, no ETD, plate is detected by VLM at Gate In)
export async function createBooking({ domainId, zoneId, userName, vehicleType, eta }) {
  const { zones } = await getZonesWithOccupancy();
  const targetZone = zones.find((z) => z.id === zoneId);
  if (!targetZone) throw new Error('Zona tidak ditemukan');

  const vehicle = vehicleType || 'motorcycle';
  if (targetZone.vehicleType && targetZone.vehicleType !== vehicle) {
    throw new Error(
      `Zona ${targetZone.name} hanya untuk ${targetZone.vehicleType === 'car' ? 'mobil' : 'motor'}.`
    );
  }

  // Calculate ETA timestamp
  const now = new Date();
  let etaTime;
  if (typeof eta === 'number') {
    etaTime = eta;
  } else if (eta && eta.includes('T')) {
    etaTime = new Date(eta).getTime();
  } else if (eta && eta.includes(':')) {
    const [etaH, etaM] = eta.split(':').map(Number);
    const d = new Date(now);
    d.setHours(etaH, etaM, 0, 0);
    // If selected hour:min today is already past by more than 10 mins, treat as tomorrow
    if (d.getTime() < now.getTime() - 10 * 60 * 1000) {
      d.setDate(d.getDate() + 1);
    }
    etaTime = d.getTime();
  } else {
    etaTime = now.getTime() + 30 * 60 * 1000; // default 30 min from now
  }

  // Quota is reserved per booking date; atomic INCR avoids overbooking races.
  const bookingDate = new Date(etaTime).toISOString().slice(0, 10);
  const reserved = await redis.eval(RESERVE_LUA, 1, counterKey(bookingDate, zoneId), targetZone.capacity);
  if (!reserved) {
    throw new Error('Kuota parkir di zona ini sudah penuh untuk tanggal tersebut');
  }

  const sessionCode = `SP-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const session = {
    id: crypto.randomUUID(),
    sessionCode,
    domainId: domainId || targetZone.domainId,
    zoneId,
    userName: userName || 'Pengemudi Kampus',
    vehicleType: vehicle,
    eta: eta || '08:30',
    etaTime,
    bookingDate,
    entryQrExpiresAt: etaTime + ENTRY_QR_TTL_MS,
    status: 'BOOKED',
    createdAt: now.toISOString(),
    plate: null, // Will be read and locked by VLM at Gate In
  };

  try {
    await saveSession(session);
    await redis.sadd('parking:active_sessions', sessionCode);
  } catch (err) {
    await releaseBookingSlot(session);
    throw err;
  }

  await recordActivity(zoneId, 'bookings');
  persistSession(session);

  await publishEvent('BOOKING_CREATED', { sessionCode, zoneId, available: targetZone.available - 1 });
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());

  return session;
}

// Get session by code
export async function getSession(sessionCode) {
  if (!sessionCode) return null;
  const raw = await redis.get(`parking:session:${sessionCode}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

// Save session
export async function saveSession(session) {
  // Store session with 24 hour TTL
  await redis.set(`parking:session:${session.sessionCode}`, JSON.stringify(session), 'EX', 86400);
  if (session.exitCode) {
    // Also index exitCode for fast lookup
    await redis.set(`parking:exit:${session.exitCode}`, session.sessionCode, 'EX', EXIT_QR_TTL_S);
  }
}

// Gate In entry processing
async function processGateInInner({ sessionCode, plateRead, manualPlateOverride }) {
  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');

  if (session.status === 'EXPIRED') {
    throw new Error('QR masuk sudah kedaluwarsa (15 menit sejak ETA). Silakan booking ulang.');
  }
  if (session.status !== 'BOOKED') {
    throw new Error(`Status sesi tidak valid untuk masuk: ${session.status}`);
  }

  // Check 10 minute rule
  if (checkSessionExpired(session)) {
    session.status = 'EXPIRED';
    session.expiredReason = 'QR masuk kedaluwarsa (15 menit dari ETA)';
    await saveSession(session);
    await redis.srem('parking:active_sessions', sessionCode);
    await releaseBookingSlot(session);
    persistSession(session);
    await publishEvent('SESSION_EXPIRED', { sessionCode, zoneId: session.zoneId });
    throw new Error('QR masuk sudah kedaluwarsa (15 menit sejak ETA). Silakan booking ulang.');
  }

  const rawPlate = manualPlateOverride || plateRead?.plate;
  if (!rawPlate) {
    throw new Error('Plat nomor tidak terbaca oleh VLM dan tidak ada input manual petugas');
  }

  session.plate = normalizePlate(rawPlate);
  session.displayPlate = rawPlate;
  session.status = 'ENTERED';
  session.entryTime = new Date().toISOString();
  session.plateVlmResult = plateRead || null;

  await saveSession(session);

  await recordActivity(session.zoneId, 'entries');
  if (manualPlateOverride) await recordActivity(session.zoneId, 'manualOverrides', { countActivity: false });
  persistSession(session);

  await publishEvent('GATE_ENTERED', { sessionCode, plate: session.plate, zoneId: session.zoneId });
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());

  return { session, gateOpened: true };
}

// Zone QR scan: confirm parking or initiate checkout
async function processZoneScanInner({ sessionCode, scannedZoneId, action }) {
  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');

  // Zone enforcement: a session may only be confirmed/checked out at its own zone.
  if (session.zoneId !== scannedZoneId) {
    const previousMisses = Number(session.zoneScanMisses || 0);
    session.zoneScanMisses = previousMisses + 1;

    // Grace: one wrong scan is treated as a mistake (warning only).
    // Violations count from the second miss onward, in any session status.
    const countsAsViolation = previousMisses >= 1;
    if (countsAsViolation) {
      await recordActivity(session.zoneId, 'zoneViolations', { countActivity: false });
    }
    await saveSession(session);

    await publishEvent('ZONE_MISMATCH', {
      sessionCode,
      expectedZoneId: session.zoneId,
      scannedZoneId: scannedZoneId || null,
      action,
      countedAsViolation: countsAsViolation,
    });

    if (countsAsViolation) {
      await publishEvent('ZONE_VIOLATION', {
        sessionCode,
        expectedZoneId: session.zoneId,
        scannedZoneId: scannedZoneId || null,
        action,
      });
      throw new Error(
        `QR zona tidak sesuai (pelanggaran tercatat). Sesi ini hanya berlaku di zona ${session.zoneId}; Anda memindai ${scannedZoneId}. Silakan pindai ulang di zona yang benar.`
      );
    }

    throw new Error(
      `QR zona tidak sesuai. Sesi ini hanya berlaku di zona ${session.zoneId}; Anda memindai ${scannedZoneId}. ` +
        'Ini masih dianggap kekeliruan — pindai ulang di zona yang benar.'
    );
  }

  const now = new Date();

  if (action === 'confirm_park') {
    if (session.status !== 'ENTERED') {
      throw new Error(`Status tidak valid untuk konfirmasi parkir: ${session.status}`);
    }
    session.status = 'PARKED_CONFIRMED';
    session.parkedTime = now.toISOString();
    await saveSession(session);
    persistSession(session);
    await publishEvent('PARKED_CONFIRMED', { sessionCode, zoneId: session.zoneId });
    return session;
  }

  if (action === 'checkout') {
    if (session.status !== 'PARKED_CONFIRMED') {
      throw new Error(`Status tidak valid untuk checkout: ${session.status}`);
    }

    // Tarif: motor <1 jam Rp1.000, flat Rp2.000; mobil <1 jam Rp2.000, flat Rp3.000
    const nowMs = now.getTime();
    const startMs = session.entryTime
      ? new Date(session.entryTime).getTime()
      : (session.parkedTime ? new Date(session.parkedTime).getTime() : new Date(session.createdAt).getTime());
    const durationMin = Math.max(1, Math.round((nowMs - startMs) / 60000));
    const isMotor = (session.vehicleType || 'motorcycle') === 'motorcycle';
    let baseFee;
    if (isMotor) {
      baseFee = durationMin < 60 ? 1000 : 2000;
    } else {
      baseFee = durationMin < 60 ? 2000 : 3000;
    }

    session.status = 'CHECKOUT_REQUESTED';
    session.checkoutTime = now.toISOString();
    session.bill = {
      baseFee,
      penaltyFee: 0,
      total: baseFee,
      isOverstay: false,
      durationMin,
      vehicleType: session.vehicleType || 'motorcycle',
      notes: isMotor
        ? (durationMin < 60 ? 'Tarif motor <1 jam' : 'Tarif motor flat')
        : (durationMin < 60 ? 'Tarif mobil <1 jam' : 'Tarif mobil flat'),
    };

    await saveSession(session);
    persistSession(session);
    await publishEvent('BILL_CREATED', { sessionCode, bill: session.bill });
    return session;
  }

  throw new Error(`Aksi tidak valid: ${action}`);
}

// Process payment
async function processPaymentInner({ sessionCode, paymentMethod = 'QRIS' }) {
  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');

  if (session.status !== 'CHECKOUT_REQUESTED') {
    throw new Error(`Status tidak valid untuk bayar: ${session.status}`);
  }

  const now = new Date();
  const exitCode = `OUT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;

  session.status = 'PAID';
  session.exitCode = exitCode;
  session.exitCodeExpiry = Date.now() + EXIT_QR_TTL_S * 1000; // 20 menit sejak pembayaran
  session.payment = {
    method: paymentMethod,
    paidAt: now.toISOString(),
    transactionId: `TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    amount: session.bill?.total || 2000,
  };

  await saveSession(session);
  persistSession(session);
  await recordRevenue(session.zoneId, session.payment.amount, session.vehicleType);
  await publishEvent('PAYMENT_SUCCESS', { sessionCode, exitCode, amount: session.payment.amount });
  return session;
}

// Re-issue an expired exit QR for a paid session (15 minutes from now)
export async function reissueExitCode({ sessionCode }) {
  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');
  if (session.status !== 'PAID') throw new Error(`Sesi belum lunas: ${session.status}`);

  const expired = Boolean(session.exitCodeExpiry) && Date.now() > session.exitCodeExpiry;
  const charged = expired ? EXIT_EXPIRED_PENALTY : 0;

  if (session.exitCode) await redis.del(`parking:exit:${session.exitCode}`);

  session.exitCode = `OUT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  session.exitCodeExpiry = Date.now() + EXIT_QR_TTL_S * 1000;

  if (expired) {
    session.penaltyTotal = Number(session.penaltyTotal || 0) + charged;
    session.penalties = [
      ...(Array.isArray(session.penalties) ? session.penalties : []),
      {
        type: 'EXPIRED_EXIT_QR',
        amount: charged,
        paidAt: new Date().toISOString(),
      },
    ];
    await recordPenalty(session.zoneId, charged);
    await publishEvent('EXIT_QR_PENALTY_PAID', {
      sessionCode,
      amount: charged,
      exitCode: session.exitCode,
      zoneId: session.zoneId,
    });
  } else {
    await publishEvent('EXIT_QR_REISSUED', { sessionCode, exitCode: session.exitCode });
  }

  await saveSession(session);
  persistSession(session);
  return { session, charged, penalty: charged > 0 };
}

// Gate Out exit processing with VLM plate verification
async function processGateOutInner({ exitCode, plateRead, manualPlateOverride }) {
  const sessionCode = await redis.get(`parking:exit:${exitCode}`);
  if (!sessionCode) throw new Error('QR/Kode keluar tidak valid atau sudah kedaluwarsa');

  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');

  if (session.status !== 'PAID') {
    throw new Error(`Status sesi belum lunas: ${session.status}`);
  }

  if (session.exitCodeExpiry && Date.now() > session.exitCodeExpiry) {
    await redis.del(`parking:exit:${exitCode}`);
    throw new Error('QR keluar sudah kedaluwarsa. Buka aplikasi driver dan bayar denda Rp20.000 untuk menerbitkan QR keluar baru.');
  }

  const rawPlate = manualPlateOverride || plateRead?.plate;
  if (!rawPlate) {
    throw new Error('Plat nomor tidak terbaca oleh VLM di gate keluar');
  }

  const detectedPlate = normalizePlate(rawPlate);
  const lockedPlate = session.plate;

  // Verify plate matches locked plate from entry
  if (lockedPlate && detectedPlate !== lockedPlate) {
    await recordActivity(session.zoneId, 'mismatches', { countActivity: false });
    await publishEvent('GATE_EXIT_MISMATCH', {
      sessionCode,
      expectedPlate: lockedPlate,
      detectedPlate,
    });
    throw new Error(`Plat nomor tidak cocok! Terkunci: ${lockedPlate}, Terdeteksi: ${detectedPlate}`);
  }

  // Mark completed and free quota
  session.status = 'COMPLETED';
  session.exitTime = new Date().toISOString();
  await saveSession(session);

  await redis.srem('parking:active_sessions', sessionCode);
  await redis.del(`parking:exit:${exitCode}`);

  await releaseBookingSlot(session);
  persistSession(session);
  await recordActivity(session.zoneId, 'exits');
  if (manualPlateOverride) await recordActivity(session.zoneId, 'manualOverrides', { countActivity: false });

  await publishEvent('GATE_EXIT_SUCCESS', { sessionCode, plate: detectedPlate, zoneId: session.zoneId });
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());

  return { session, gateOpened: true };
}

// Admin CRUD for domains
export async function createDomain({ name, description }) {
  if (!name || !name.trim()) throw new Error('Nama domain wajib diisi');

  await initMasterData();
  const domainsRaw = await redis.get('parking:master:domains');
  const domains = JSON.parse(domainsRaw || '[]');

  const id = `DOM-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 100)}`;
  const newDomain = { id, name: name.trim(), description: (description || '').trim() };

  domains.push(newDomain);
  await redis.set('parking:master:domains', JSON.stringify(domains));
  await publishEvent('DOMAIN_UPDATED', await getZonesWithOccupancy());
  return newDomain;
}

export async function updateDomain(id, { name, description }) {
  await initMasterData();
  const domainsRaw = await redis.get('parking:master:domains');
  const domains = JSON.parse(domainsRaw || '[]');

  const idx = domains.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error('Domain tidak ditemukan');

  if (name && name.trim()) domains[idx].name = name.trim();
  if (typeof description === 'string') domains[idx].description = description.trim();

  await redis.set('parking:master:domains', JSON.stringify(domains));
  await publishEvent('DOMAIN_UPDATED', await getZonesWithOccupancy());
  return domains[idx];
}

export async function deleteDomain(id) {
  await initMasterData();
  const zonesRaw = await redis.get('parking:master:zones');
  const zones = JSON.parse(zonesRaw || '[]');
  const used = zones.filter((z) => z.domainId === id);
  if (used.length > 0) {
    throw new Error(`Domain masih dipakai ${used.length} zona. Pindahkan atau hapus zona tersebut dulu.`);
  }

  const domainsRaw = await redis.get('parking:master:domains');
  const domains = JSON.parse(domainsRaw || '[]');
  const idx = domains.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error('Domain tidak ditemukan');

  const removed = domains.splice(idx, 1)[0];
  await redis.set('parking:master:domains', JSON.stringify(domains));
  await publishEvent('DOMAIN_UPDATED', await getZonesWithOccupancy());
  return removed;
}

// Admin CRUD for parking zones
export async function createZone({ name, domainId, vehicleType, capacity, gateIn, gateOut }) {
  if (!name || !capacity) throw new Error('Nama dan kapasitas zona wajib diisi');
  if (!domainId) throw new Error('Domain zona wajib dipilih');
  if (!VEHICLE_TYPES.includes(vehicleType)) throw new Error('Jenis kendaraan zona wajib dipilih (mobil/motor)');
  const cap = Number(capacity);
  if (isNaN(cap) || cap <= 0) throw new Error('Kapasitas zona harus berupa angka > 0');

  await initMasterData();
  const zonesRaw = await redis.get('parking:master:zones');
  const zones = JSON.parse(zonesRaw || '[]');

  const id = `zone-${name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}-${Date.now().toString().slice(-4)}`;
  const newZone = {
    id,
    name,
    domainId,
    vehicleType,
    capacity: cap,
    gateIn: gateIn || `Gate ${name} In`,
    gateOut: gateOut || `Gate ${name} Out`,
  };

  zones.push(newZone);
  await redis.set('parking:master:zones', JSON.stringify(zones));
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());
  return newZone;
}

export async function updateZone(id, { name, domainId, vehicleType, capacity, gateIn, gateOut }) {
  await initMasterData();
  const zonesRaw = await redis.get('parking:master:zones');
  const zones = JSON.parse(zonesRaw || '[]');

  const idx = zones.findIndex((z) => z.id === id);
  if (idx === -1) throw new Error('Zona tidak ditemukan');

  if (name) zones[idx].name = name;
  if (domainId) zones[idx].domainId = domainId;
  if (vehicleType) {
    if (!VEHICLE_TYPES.includes(vehicleType)) throw new Error('Jenis kendaraan tidak valid');
    zones[idx].vehicleType = vehicleType;
  }
  if (capacity) {
    const cap = Number(capacity);
    if (isNaN(cap) || cap <= 0) throw new Error('Kapasitas zona harus > 0');
    zones[idx].capacity = cap;
  }
  if (gateIn) zones[idx].gateIn = gateIn;
  if (gateOut) zones[idx].gateOut = gateOut;

  await redis.set('parking:master:zones', JSON.stringify(zones));
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());
  return zones[idx];
}

export async function deleteZone(id) {
  await initMasterData();

  const activeCodes = await redis.smembers('parking:active_sessions');
  for (const code of activeCodes) {
    const session = await getSession(code);
    if (session && session.zoneId === id) {
      throw new Error('Zona masih memiliki sesi aktif. Selesaikan atau batalkan sesi tersebut dulu.');
    }
  }

  const zonesRaw = await redis.get('parking:master:zones');
  const zones = JSON.parse(zonesRaw || '[]');

  const idx = zones.findIndex((z) => z.id === id);
  if (idx === -1) throw new Error('Zona tidak ditemukan');

  const removed = zones.splice(idx, 1)[0];
  await redis.set('parking:master:zones', JSON.stringify(zones));
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());
  return removed;
}

// Admin get all active sessions for monitoring
export async function getAllSessions() {
  const activeSessionCodes = await redis.smembers('parking:active_sessions');
  const sessions = [];
  for (const code of activeSessionCodes) {
    const sess = await getSession(code);
    if (sess) sessions.push(sess);
  }
  return sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Admin manual gate or session override
export async function adminOverrideGate({ gateType, zoneId, action = 'open', reason = 'Admin emergency override' }) {
  await publishEvent('ADMIN_GATE_OVERRIDE', {
    gateType,
    zoneId,
    action,
    reason,
    timestamp: new Date().toISOString(),
  });
  return { ok: true, gateType, zoneId, action, reason };
}


// Move a session to another zone. Allowed before gate entry (BOOKED) and once
// after entry (ENTERED, before parking confirmation). Capacity is reserved
// atomically on the new zone first, then the old reservation is released.
export async function changeZone({ sessionCode, zoneId }) {
  return withSessionLock(sessionCode, async () => {
    const session = await getSession(sessionCode);
    if (!session) throw new Error('Sesi parkir tidak ditemukan');

    const allowed = ['BOOKED', 'ENTERED'];
    if (!allowed.includes(session.status)) {
      throw new Error(`Zona hanya bisa diubah sebelum konfirmasi parkir (status: ${session.status})`);
    }
    if (session.status === 'ENTERED' && Number(session.zoneChangesAfterEntry || 0) >= 1) {
      throw new Error('Perpindahan zona setelah masuk gate hanya boleh satu kali.');
    }
    if (session.zoneId === zoneId) {
      throw new Error('Zona tujuan sama dengan zona saat ini.');
    }

    const { zones } = await getZonesWithOccupancy();
    const target = zones.find((z) => z.id === zoneId);
    if (!target) throw new Error('Zona tujuan tidak ditemukan');
    if (target.vehicleType && target.vehicleType !== session.vehicleType) {
      throw new Error(
        `Zona ${target.name} hanya untuk ${target.vehicleType === 'car' ? 'mobil' : 'motor'}.`
      );
    }

    const bookingDate = session.bookingDate || new Date(session.etaTime).toISOString().slice(0, 10);
    const reserved = await redis.eval(RESERVE_LUA, 1, counterKey(bookingDate, zoneId), target.capacity);
    if (!reserved) throw new Error('Kuota zona tujuan sudah penuh.');

    const previousZoneId = session.zoneId;
    session.zoneId = zoneId;
    session.domainId = target.domainId;
    session.zoneChangedAt = new Date().toISOString();
    session.zoneChangeCount = Number(session.zoneChangeCount || 0) + 1;
    if (session.status === 'ENTERED') {
      session.zoneChangesAfterEntry = Number(session.zoneChangesAfterEntry || 0) + 1;
    }

    try {
      await saveSession(session);
      await releaseBookingSlot({ ...session, zoneId: previousZoneId });
    } catch (err) {
      // roll back the new reservation if persistence fails
      await redis.decr(counterKey(bookingDate, zoneId));
      throw err;
    }

    persistSession(session);
    await publishEvent('ZONE_CHANGED', {
      sessionCode,
      fromZoneId: previousZoneId,
      toZoneId: zoneId,
      status: session.status,
    });
    await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());
    return session;
  });
}

/* ------------------------- locked transition wrappers ------------------------- */

export async function processGateIn(args) {
  return withSessionLock(args.sessionCode, () => processGateInInner(args));
}

export async function processZoneScan(args) {
  return withSessionLock(args.sessionCode, () => processZoneScanInner(args));
}

export async function processPayment(args) {
  return withSessionLock(args.sessionCode, () => processPaymentInner(args));
}

export async function processGateOut(args) {
  const sessionCode = await redis.get(`parking:exit:${args.exitCode}`);
  if (!sessionCode) throw new Error('QR/Kode keluar tidak valid atau sudah kedaluwarsa');
  return withSessionLock(sessionCode, () => processGateOutInner(args));
}

// Start checkout from the app without re-scanning the zone QR.
// The session is already locked to its booked zone; the server uses that zone.
export async function requestCheckout({ sessionCode }) {
  return withSessionLock(sessionCode, async () => {
    const session = await getSession(sessionCode);
    if (!session) throw new Error('Sesi parkir tidak ditemukan');
    return processZoneScanInner({
      sessionCode,
      scannedZoneId: session.zoneId,
      action: 'checkout',
    });
  });
}

// Cancel a booking that has not entered the gate yet
export async function cancelBooking({ sessionCode }) {
  return withSessionLock(sessionCode, async () => {
    const session = await getSession(sessionCode);
    if (!session) throw new Error('Sesi parkir tidak ditemukan');
    if (session.status !== 'BOOKED') {
      throw new Error(`Hanya booking yang belum masuk gate bisa dibatalkan (status: ${session.status})`);
    }

    session.status = 'CANCELLED';
    session.cancelledAt = new Date().toISOString();
    await saveSession(session);
    await redis.srem('parking:active_sessions', sessionCode);
    await releaseBookingSlot(session);
    persistSession(session);
    await publishEvent('BOOKING_CANCELLED', { sessionCode, zoneId: session.zoneId });
    await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());
    return session;
  });
}

// Expire bookings whose entry QR has lapsed. Safe to run repeatedly.
export async function sweepExpiredBookings() {
  const codes = await redis.smembers('parking:active_sessions');
  let expired = 0;
  for (const code of codes) {
    const session = await getSession(code);
    if (!session || session.status !== 'BOOKED' || !checkSessionExpired(session)) continue;

    try {
      await withSessionLock(code, async () => {
        const fresh = await getSession(code);
        if (!fresh || fresh.status !== 'BOOKED' || !checkSessionExpired(fresh)) return;
        fresh.status = 'EXPIRED';
        fresh.expiredReason = 'QR masuk kedaluwarsa (15 menit dari ETA)';
        await saveSession(fresh);
        await redis.srem('parking:active_sessions', code);
        await releaseBookingSlot(fresh);
        persistSession(fresh);
        await publishEvent('SESSION_EXPIRED', { sessionCode: code, zoneId: fresh.zoneId });
        expired += 1;
      });
    } catch {
      // another worker owns the lock; skip this round
    }
  }
  if (expired > 0) await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());
  return expired;
}

// Rebuild per-date counters from active sessions (run at boot for consistency)
export async function rebuildCounters() {
  const codes = await redis.smembers('parking:active_sessions');
  const counts = new Map();
  for (const code of codes) {
    const session = await getSession(code);
    if (!session) continue;
    if (!['BOOKED', 'ENTERED', 'PARKED_CONFIRMED', 'CHECKOUT_REQUESTED', 'PAID'].includes(session.status)) continue;
    const day = session.bookingDate || (session.etaTime ? new Date(session.etaTime).toISOString().slice(0, 10) : null);
    if (!day) continue;
    const key = counterKey(day, session.zoneId);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const existing = await redis.keys('parking:count:*');
  if (existing.length) await redis.del(...existing);
  for (const [key, value] of counts.entries()) {
    await redis.set(key, value, 'EX', 172800);
  }
  return counts.size;
}

let schedulerTimer = null;

export function startScheduler(intervalMs = 30000) {
  if (schedulerTimer) return schedulerTimer;
  schedulerTimer = setInterval(() => {
    sweepExpiredBookings().catch((err) => console.error('[scheduler]', err?.message || err));
  }, intervalMs);
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
  return schedulerTimer;
}

export function stopScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}
