import Redis from 'ioredis';
import crypto from 'node:crypto';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
export const EVENT_CHANNEL = 'parking:events';

export const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
export const redisSub = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });

// Default master data for campus faculties and parking zones
const INITIAL_FACULTIES = [
  { id: 'FT', name: 'Fakultas Teknik', defaultZoneId: 'zone-a' },
  { id: 'FEB', name: 'Fakultas Ekonomi & Bisnis', defaultZoneId: 'zone-b' },
  { id: 'FK', name: 'Fakultas Kedokteran', defaultZoneId: 'zone-c' },
  { id: 'FASILKOM', name: 'Fakultas Ilmu Komputer', defaultZoneId: 'zone-d' },
];

const INITIAL_ZONES = [
  { id: 'zone-a', name: 'Zona A - Lapangan Barat', facultyId: 'FT', capacity: 20, gateIn: 'Gate Barat In', gateOut: 'Gate Barat Out' },
  { id: 'zone-b', name: 'Zona B - Lapangan Selatan', facultyId: 'FEB', capacity: 15, gateIn: 'Gate Selatan In', gateOut: 'Gate Selatan Out' },
  { id: 'zone-c', name: 'Zona C - Lapangan Timur', facultyId: 'FK', capacity: 10, gateIn: 'Gate Timur In', gateOut: 'Gate Timur Out' },
  { id: 'zone-d', name: 'Zona D - Gedung Baru', facultyId: 'FASILKOM', capacity: 25, gateIn: 'Gate Utara In', gateOut: 'Gate Utara Out' },
];

// Helper to normalize plate string for matching
export function normalizePlate(str) {
  if (!str) return '';
  return str.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Seed initial zone master data into Redis if not present
export async function initMasterData() {
  const exists = await redis.exists('parking:master:zones');
  if (!exists) {
    await redis.set('parking:master:faculties', JSON.stringify(INITIAL_FACULTIES));
    await redis.set('parking:master:zones', JSON.stringify(INITIAL_ZONES));
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

// Get all faculties and zones with live occupancy counts
export async function getZonesWithOccupancy() {
  await initMasterData();
  const [facultiesRaw, zonesRaw, activeSessionCodes] = await Promise.all([
    redis.get('parking:master:faculties'),
    redis.get('parking:master:zones'),
    redis.smembers('parking:active_sessions'),
  ]);

  const faculties = JSON.parse(facultiesRaw || '[]');
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

  return { faculties, zones: zonesWithLive };
}

// Check if a session has expired (ETA + 10 mins)
export function checkSessionExpired(sess) {
  if (sess.status !== 'BOOKED') return false;
  if (!sess.etaTime) return false;
  const now = Date.now();
  const graceMs = 10 * 60 * 1000; // 10 minutes grace period
  return now > sess.etaTime + graceMs;
}

// Create a new booking (only ETA, no ETD, plate is detected by VLM at Gate In)
export async function createBooking({ facultyId, zoneId, userName, vehicleType, eta }) {
  const { zones } = await getZonesWithOccupancy();
  const targetZone = zones.find((z) => z.id === zoneId);
  if (!targetZone) throw new Error('Zona tidak ditemukan');
  if (targetZone.available <= 0) throw new Error('Kuota parkir di zona ini sudah penuh');

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
    facultyId,
    zoneId,
    userName: userName || 'Pengemudi Kampus',
    vehicleType: vehicleType || 'motorcycle',
    eta: eta || '08:30',
    etaTime,
    status: 'BOOKED',
    createdAt: now.toISOString(),
    plate: null, // Will be read and locked by VLM at Gate In
  };

  await saveSession(session);
  await redis.sadd('parking:active_sessions', sessionCode);

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
  await publishEvent('GATE_ENTERED', { sessionCode, plate: session.plate, zoneId: session.zoneId });
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());

  return { session, gateOpened: true };
}

// Zone QR scan: confirm parking or initiate checkout
export async function processZoneScan({ sessionCode, scannedZoneId, action }) {
  const session = await getSession(sessionCode);
  if (!session) throw new Error('Sesi parkir tidak ditemukan');

  if (session.zoneId !== scannedZoneId) {
    throw new Error(`Zona QR tidak cocok. Sesi dibooking untuk ${session.zoneId}, Anda scan ${scannedZoneId}`);
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

  await publishEvent('GATE_EXIT_SUCCESS', { sessionCode, plate: detectedPlate, zoneId: session.zoneId });
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());

  return { session, gateOpened: true };
}

// Admin CRUD for parking zones
export async function createZone({ name, facultyId, capacity, gateIn, gateOut }) {
  if (!name || !capacity) throw new Error('Nama dan kapasitas zona wajib diisi');
  const cap = Number(capacity);
  if (isNaN(cap) || cap <= 0) throw new Error('Kapasitas zona harus berupa angka > 0');

  await initMasterData();
  const zonesRaw = await redis.get('parking:master:zones');
  const zones = JSON.parse(zonesRaw || '[]');

  const id = `zone-${name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}-${Date.now().toString().slice(-4)}`;
  const newZone = {
    id,
    name,
    facultyId: facultyId || 'FT',
    capacity: cap,
    gateIn: gateIn || `Gate ${name} In`,
    gateOut: gateOut || `Gate ${name} Out`,
  };

  zones.push(newZone);
  await redis.set('parking:master:zones', JSON.stringify(zones));
  await publishEvent('ZONE_UPDATED', await getZonesWithOccupancy());
  return newZone;
}

export async function updateZone(id, { name, facultyId, capacity, gateIn, gateOut }) {
  await initMasterData();
  const zonesRaw = await redis.get('parking:master:zones');
  const zones = JSON.parse(zonesRaw || '[]');

  const idx = zones.findIndex((z) => z.id === id);
  if (idx === -1) throw new Error('Zona tidak ditemukan');

  if (name) zones[idx].name = name;
  if (facultyId) zones[idx].facultyId = facultyId;
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
