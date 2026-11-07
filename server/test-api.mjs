import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = 'http://127.0.0.1:8788';

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
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
      eta: '10:00',
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

  // 6. Zone checkout
  const checkoutRes = await request('/api/zones/scan', {
    method: 'POST',
    body: JSON.stringify({
      sessionCode: session.sessionCode,
      scannedZoneId: targetZone.id,
      action: 'checkout',
    }),
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

  console.log('All API endpoints verified successfully!');
}

runApiTest().catch((err) => {
  console.error('API test failed:', err);
  process.exit(1);
});
