import Redis from 'ioredis';
import crypto from 'node:crypto';

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
}

// Get all domains and zones with live occupancy counts
export async function getZonesWithOccupancy() {
  await initMasterData();
  const [domainsRaw, zonesRaw, activeSessionCodes] = await Promise.all([
    redis.get('parking:master:domains'),
    redis.get('parking:master:zones'),
    redis.smembers('parking:active_sessions'),
  ]);

  const domains = JSON.parse(domainsRaw || '[]');
  const zones = JSON.parse(zonesRaw || '[]');

  // Check expiration of active bookings and tally occupancy
  const counts = {};
  for (const zone of zones) counts[zone.id] = 0;

  for (const code of activeSessionCodes) {
    const sess = await getSession(code);
    if (!sess) continue;

    // Check if expired due to 10 min late rule
    if (checkSessionExpired(sess)) {
      sess.status = 'EXPIRED';
      sess.expiredReason = 'Late arrival > 10 minutes from ETA';
      await saveSession(sess);
      await redis.srem('parking:active_sessions', code);
      await publishEvent('SESSION_EXPIRED', { sessionCode: code, zoneId: sess.zoneId });
      continue;
    }

    if (['BOOKED', 'ENTERED', 'PARKED_CONFIRMED', 'CHECKOUT_REQUESTED', 'PAID'].includes(sess.status)) {
      counts[sess.zoneId] = (counts[sess.zoneId] || 0) + 1;
    }
  }

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
  if (!sess.etaTime) return false;
  const now = Date.now();
  const graceMs = 10 * 60 * 1000; // 10 minutes grace period
  return now > sess.etaTime + graceMs;
}

// Activity counters per zone, used for preventive-maintenance analytics.
// Manual plate overrides and plate mismatches are early signals that a gate
// camera / VLM reader needs inspection.
export async function recordActivity(zoneId, event, { amount = 1, countActivity = true } = {}) {
  if (!zoneId) return;
  const key = `parking:stats:zone:${zoneId}`;
  const now = new Date();
  const hour = String(now.getHours()).padStart(2, '0');
  const multi = redis.multi();
  multi.hincrby(key, event, amount);
  multi.hset(key, 'lastActivity', now.toISOString());
  if (countActivity) {
    multi.hincrby(key, 'activity', amount);
    multi.hincrby('parking:stats:hours', hour, amount);
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
  try {
    await multi.exec();
  } catch {
    // Financial analytics must never block payment
  }
}

// Analytics: zone/domain activity, occupancy, peak hours, maintenance priority
export async function getAnalytics() {
  const { domains, zones } = await getZonesWithOccupancy();

  const zoneStats = {};
  for (const z of zones) {
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

  const hoursRaw = await redis.hgetall('parking:stats:hours');
  const hours = Array.from({ length: 24 }, (_, h) => {
    const key = String(h).padStart(2, '0');
    return { hour: key, activity: Number(hoursRaw[key] || 0) };
  });
  const peakHours = [...hours].sort((a, b) => b.activity - a.activity).slice(0, 3);

  const daysRaw = await redis.hgetall('parking:stats:revenue:days');
  const dayList = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dayList.push({ date: key, revenue: Math.round(Number(daysRaw[key] || 0)) });
  }

  const finance = {
    totalRevenue: enrichedZones.reduce((a, z) => a + z.revenue, 0),
    totalPayments: enrichedZones.reduce((a, z) => a + z.payments, 0),
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

  return {
    generatedAt: new Date().toISOString(),
    finance,
    totals: {
      activity: enrichedZones.reduce((a, z) => a + z.activity, 0),
      entries: enrichedZones.reduce((a, z) => a + z.entries, 0),
      exits: enrichedZones.reduce((a, z) => a + z.exits, 0),
      manualOverrides: enrichedZones.reduce((a, z) => a + z.manualOverrides, 0),
      mismatches: enrichedZones.reduce((a, z) => a + z.mismatches, 0),
      zoneViolations: enrichedZones.reduce((a, z) => a + z.zoneViolations, 0),
      revenue: finance.totalRevenue,
      payments: finance.totalPayments,
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
  if (targetZone.available <= 0) throw new Error('Kuota parkir di zona ini sudah penuh');

  const vehicle = vehicleType || 'motorcycle';
  if (targetZone.vehicleType && targetZone.vehicleType !== vehicle) {
    throw new Error(
      `Zona ${targetZone.name} hanya untuk ${targetZone.vehicleType === 'car' ? 'mobil' : 'motor'}.`
    );
  }

  const sessionCode = `SP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

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

  const session = {
    id: crypto.randomUUID(),
    sessionCode,
    domainId: domainId || targetZone.domainId,
    zoneId,
    userName: userName || 'Pengemudi Kampus',
    vehicleType: vehicle,
    eta: eta || '08:30',
    etaTime,
    status: 'BOOKED',
    createdAt: now.toISOString(),
    plate: null, // Will be read and locked by VLM at Gate In
  };

  await saveSession(session);
  await redis.sadd('parking:active_sessions', sessionCode);

  await recordActivity(zoneId, 'bookings');

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
    await redis.set(`parking:exit:${session.exitCode}`, session.sessionCode, 'EX', 3600);
  }
}

// Gate In entry processing
export async function processGateIn({ sessionCode, plateRead, manualPlateOverride }) {
  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');

  if (session.status !== 'BOOKED') {
    throw new Error(`Status sesi tidak valid untuk masuk: ${session.status}`);
  }

  // Check 10 minute rule
  if (checkSessionExpired(session)) {
    session.status = 'EXPIRED';
    session.expiredReason = 'Late arrival > 10 minutes from ETA';
    await saveSession(session);
    await redis.srem('parking:active_sessions', sessionCode);
    await publishEvent('SESSION_EXPIRED', { sessionCode, zoneId: session.zoneId });
    throw new Error('Booking hangus karena telat lebih dari 10 menit dari ETA');
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

  await publishEvent('GATE_ENTERED', { sessionCode, plate: session.plate, zoneId: session.zoneId });
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());

  return { session, gateOpened: true };
}

// Zone QR scan: confirm parking or initiate checkout
export async function processZoneScan({ sessionCode, scannedZoneId, action }) {
  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');

  // Zone enforcement: a session may only be confirmed/checked out at its own zone.
  if (session.zoneId !== scannedZoneId) {
    await recordActivity(session.zoneId, 'zoneViolations', { countActivity: false });
    await publishEvent('ZONE_VIOLATION', {
      sessionCode,
      expectedZoneId: session.zoneId,
      scannedZoneId: scannedZoneId || null,
      action,
    });
    throw new Error(
      `QR zona tidak sesuai. Sesi ini hanya berlaku di zona ${session.zoneId}; Anda memindai ${scannedZoneId}.`
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
    await publishEvent('BILL_CREATED', { sessionCode, bill: session.bill });
    return session;
  }

  throw new Error(`Aksi tidak valid: ${action}`);
}

// Process payment
export async function processPayment({ sessionCode, paymentMethod = 'QRIS' }) {
  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');

  if (session.status !== 'CHECKOUT_REQUESTED') {
    throw new Error(`Status tidak valid untuk bayar: ${session.status}`);
  }

  const now = new Date();
  const exitCode = `OUT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  session.status = 'PAID';
  session.exitCode = exitCode;
  session.exitCodeExpiry = Date.now() + 15 * 60 * 1000; // 15 mins to exit
  session.payment = {
    method: paymentMethod,
    paidAt: now.toISOString(),
    transactionId: `TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    amount: session.bill?.total || 2000,
  };

  await saveSession(session);
  await recordRevenue(session.zoneId, session.payment.amount, session.vehicleType);
  await publishEvent('PAYMENT_SUCCESS', { sessionCode, exitCode, amount: session.payment.amount });
  return session;
}

// Gate Out exit processing with VLM plate verification
export async function processGateOut({ exitCode, plateRead, manualPlateOverride }) {
  const sessionCode = await redis.get(`parking:exit:${exitCode}`);
  if (!sessionCode) throw new Error('QR/Kode keluar tidak valid atau sudah kedaluwarsa');

  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');

  if (session.status !== 'PAID') {
    throw new Error(`Status sesi belum lunas: ${session.status}`);
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
