import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = process.env.API_BASE || 'http://127.0.0.1:8788';
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || '';
const GATE_TOKEN = process.env.GATE_API_TOKEN || '';

function authHeader(path) {
  if (path.startsWith('/api/gates/') || path.startsWith('/api/vlm/')) {
    return GATE_TOKEN ? { Authorization: `Bearer ${GATE_TOKEN}` } : {};
  }
  if (path.startsWith('/api/admin/')) {
    return ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};
  }
  if (path.startsWith('/api/domains') || path.startsWith('/api/zones')) {
    // Zone/domain CRUD is admin-only; driver scan stays public
    if (path === '/api/zones/scan') return {};
    return ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};
  }
  return {};
}

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...authHeader(path), ...options.headers },
    ...options,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function runApiTest() {
  console.log('Testing Smart Parking HTTP API & Redis SSE...');

  // 1. Health check
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);

  // 2. Get zones
  const zonesRes = await request('/api/zones');
  assert.equal(zonesRes.status, 200);
  assert.ok(zonesRes.data.zones.length >= 1);
  assert.ok(zonesRes.data.domains.length >= 1);

  const targetZone = zonesRes.data.zones.find(
    (z) => !z.isFull && (z.vehicleType || 'motorcycle') === 'motorcycle'
  );
  assert.ok(targetZone, 'At least one zone with capacity should exist');

  // 3. Create booking
  const bookRes = await request('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      domainId: targetZone.domainId,
      zoneId: targetZone.id,
      userName: 'Api Tester',
      vehicleType: 'motorcycle',
      eta: Date.now() + 30 * 60 * 1000,
      etd: '18:00',
    }),
  });
  assert.equal(bookRes.status, 201);
  const session = bookRes.data.session;
  assert.ok(session.sessionCode.startsWith('SP-'));

  // 4. Gate In entry
  const gateInRes = await request('/api/gates/entry', {
    method: 'POST',
    body: JSON.stringify({
      sessionCode: session.sessionCode,
      manualPlateOverride: 'B 4321 OK',
    }),
  });
  assert.equal(gateInRes.status, 200);
  assert.equal(gateInRes.data.gateOpened, true);
  assert.equal(gateInRes.data.session.status, 'ENTERED');

  // 5. Zone confirm
  const confirmRes = await request('/api/zones/scan', {
    method: 'POST',
    body: JSON.stringify({
      sessionCode: session.sessionCode,
      scannedZoneId: targetZone.id,
      action: 'confirm_park',
    }),
  });
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.data.session.status, 'PARKED_CONFIRMED');

  // 6. Checkout from the app (no zone QR scan needed)
  const checkoutRes = await request('/api/payments/checkout', {
    method: 'POST',
    body: JSON.stringify({ sessionCode: session.sessionCode }),
  });
  assert.equal(checkoutRes.status, 200);
  assert.equal(checkoutRes.data.session.status, 'CHECKOUT_REQUESTED');
  // Motorcycle under one hour is billed Rp1.000 (tiered pricing)
  assert.ok(checkoutRes.data.session.bill.total >= 1000);

  // 7. Payment
  const payRes = await request('/api/payments/pay', {
    method: 'POST',
    body: JSON.stringify({
      sessionCode: session.sessionCode,
      paymentMethod: 'QRIS',
    }),
  });
  assert.equal(payRes.status, 200);
  assert.equal(payRes.data.session.status, 'PAID');
  assert.ok(payRes.data.session.exitCode.startsWith('OUT-'));

  // 8. Gate Out with matching plate
  const exitRes = await request('/api/gates/exit', {
    method: 'POST',
    body: JSON.stringify({
      exitCode: payRes.data.session.exitCode,
      manualPlateOverride: 'B 4321 OK',
    }),
  });
  assert.equal(exitRes.status, 200);
  assert.equal(exitRes.data.gateOpened, true);
  assert.equal(exitRes.data.session.status, 'COMPLETED');

  // 8b. Wrong QR type at the wrong gate must explain itself instead of the
  // misleading "Sesi parkir tidak ditemukan" the kiosk used to show.
  const exitQrAtEntry = await request('/api/gates/entry', {
    method: 'POST',
    body: JSON.stringify({ sessionCode: 'OUT-DEADBEEF00000001', manualPlateOverride: 'B 4321 OK' }),
  });
  assert.equal(exitQrAtEntry.status, 400);
  assert.match(String(exitQrAtEntry.data.error), /QR keluar|Gate Keluar/i);

  const entryQrAtExit = await request('/api/gates/exit', {
    method: 'POST',
    body: JSON.stringify({ exitCode: 'SP-DEADBEEF00000001', manualPlateOverride: 'B 4321 OK' }),
  });
  assert.equal(entryQrAtExit.status, 400);
  assert.match(String(entryQrAtExit.data.error), /QR tiket masuk/i);

  // 9. Cancel booking releases the slot
  const cancelBook = await request('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      domainId: targetZone.domainId,
      zoneId: targetZone.id,
      userName: 'Cancel Tester',
      vehicleType: 'motorcycle',
      eta: Date.now() + 30 * 60 * 1000,
    }),
  });
  assert.equal(cancelBook.status, 201);
  const cancelRes = await request('/api/bookings/cancel', {
    method: 'POST',
    body: JSON.stringify({ sessionCode: cancelBook.data.session.sessionCode }),
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.data.session.status, 'CANCELLED');

  // 10. Change zone before entry
  const altZone = zonesRes.data.zones.find(
    (z) => z.id !== targetZone.id && !z.isFull && (z.vehicleType || 'motorcycle') === 'motorcycle'
  );
  if (altZone) {
    const moveBook = await request('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        domainId: targetZone.domainId,
        zoneId: targetZone.id,
        userName: 'Move Tester',
        vehicleType: 'motorcycle',
        eta: Date.now() + 30 * 60 * 1000,
      }),
    });
    assert.equal(moveBook.status, 201);
    const moveRes = await request('/api/bookings/change-zone', {
      method: 'POST',
      body: JSON.stringify({ sessionCode: moveBook.data.session.sessionCode, zoneId: altZone.id }),
    });
    assert.equal(moveRes.status, 200);
    assert.equal(moveRes.data.session.zoneId, altZone.id);
    await request('/api/bookings/cancel', {
      method: 'POST',
      body: JSON.stringify({ sessionCode: moveBook.data.session.sessionCode }),
    });
  }

  // 11. Zone with an active session cannot be deleted
  const newZone = await request('/api/zones', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Zona Guard',
      domainId: targetZone.domainId,
      vehicleType: 'motorcycle',
      capacity: 2,
    }),
  });
  assert.equal(newZone.status, 201);
  const guardZoneId = newZone.data.zone.id;

  const guardBook = await request('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      domainId: targetZone.domainId,
      zoneId: guardZoneId,
      userName: 'Guard Tester',
      vehicleType: 'motorcycle',
      eta: Date.now() + 30 * 60 * 1000,
    }),
  });
  assert.equal(guardBook.status, 201);

  const blockedDelete = await request(`/api/zones/${guardZoneId}`, { method: 'DELETE' });
  assert.equal(blockedDelete.status, 400);
  assert.match(String(blockedDelete.data.error), /sesi aktif/i);

  await request('/api/bookings/cancel', {
    method: 'POST',
    body: JSON.stringify({ sessionCode: guardBook.data.session.sessionCode }),
  });
  const deleteOk = await request(`/api/zones/${guardZoneId}`, { method: 'DELETE' });
  assert.equal(deleteOk.status, 200);

  console.log('All API endpoints verified successfully!');
}

runApiTest().catch((err) => {
  console.error('API test failed:', err);
  process.exit(1);
});
