import assert from 'node:assert/strict';
import {
  initMasterData,
  getZonesWithOccupancy,
  createBooking,
  getSession,
  processGateIn,
  processZoneScan,
  processPayment,
  processGateOut,
  cancelBooking,
  changeZone,
  sweepExpiredBookings,
  redis,
  redisSub,
} from './store.mjs';

async function runSelfCheck() {
  console.log('Running smart parking store verification...');

  // Isolated runs only: never flush the database used by the app
  if (process.env.ALLOW_TEST_FLUSH === '1' && /\/15$/.test(process.env.REDIS_URL || '')) {
    await redis.flushdb();
  }

  // 1. Initialize master data
  await initMasterData();
  const { domains, zones } = await getZonesWithOccupancy();
  assert.ok(domains.length >= 1, 'Should have at least 1 domain');
  assert.ok(zones.length >= 1, 'Should have at least 1 zone');

  // Pick any zone that still has room, so the test is independent of seeded IDs
  const zone = zones.find((z) => !z.isFull && (z.vehicleType || 'motorcycle') === 'motorcycle');
  assert.ok(zone, 'At least one zone with available capacity should exist');
  const zoneId = zone.id;
  const initialAvailable = zone.available;

  // 2. Create booking
  const booking = await createBooking({
    domainId: zone.domainId,
    zoneId,
    userName: 'Budi Test',
    vehicleType: 'motorcycle',
    eta: Date.now() + 30 * 60 * 1000,
    etd: '16:00',
  });
  assert.equal(booking.status, 'BOOKED');
  assert.ok(booking.sessionCode.startsWith('SP-'));

  // Quota should decrement
  const { zones: zonesAfterBooking } = await getZonesWithOccupancy();
  const zoneAfter = zonesAfterBooking.find((z) => z.id === zoneId);
  assert.equal(zoneAfter.available, initialAvailable - 1, 'Zone available quota should decrease by 1');

  // 3. Gate In with VLM plate detection
  const entryResult = await processGateIn({
    sessionCode: booking.sessionCode,
    plateRead: { plate: 'B 1234 ABC', confidence: 0.95 },
  });
  assert.equal(entryResult.gateOpened, true);
  assert.equal(entryResult.session.status, 'ENTERED');
  assert.equal(entryResult.session.plate, 'B1234ABC');

  // 4. Scan zone QR to confirm parking
  const parked = await processZoneScan({
    sessionCode: booking.sessionCode,
    scannedZoneId: zoneId,
    action: 'confirm_park',
  });
  assert.equal(parked.status, 'PARKED_CONFIRMED');

  // 5. Scan zone QR to checkout
  const checkout = await processZoneScan({
    sessionCode: booking.sessionCode,
    scannedZoneId: zoneId,
    action: 'checkout',
  });
  assert.equal(checkout.status, 'CHECKOUT_REQUESTED');
  assert.equal(checkout.bill.baseFee, 1000, 'Motorcycle under one hour is Rp1.000');
  assert.ok(checkout.bill.total >= 1000);

  // 6. Pay bill
  const paid = await processPayment({
    sessionCode: booking.sessionCode,
    paymentMethod: 'QRIS',
  });
  assert.equal(paid.status, 'PAID');
  assert.ok(paid.exitCode.startsWith('OUT-'));

  // 7. Gate Out with mismatched plate should throw
  await assert.rejects(
    async () => {
      await processGateOut({
        exitCode: paid.exitCode,
        plateRead: { plate: 'D 9999 XYZ' },
      });
    },
    /Plat nomor tidak cocok/,
    'Gate out should reject mismatched license plate'
  );

  // 8. Gate Out with matching plate should succeed and free quota
  const exitResult = await processGateOut({
    exitCode: paid.exitCode,
    plateRead: { plate: 'B 1234 ABC' },
  });
  assert.equal(exitResult.gateOpened, true);
  assert.equal(exitResult.session.status, 'COMPLETED');

  // Quota should be restored
  const { zones: zonesAfterExit } = await getZonesWithOccupancy();
  const zoneFinal = zonesAfterExit.find((z) => z.id === zoneId);
  assert.equal(zoneFinal.available, initialAvailable, 'Zone quota should be restored after exit');

  // 9. Cancel a booking: slot must return
  const before = (await getZonesWithOccupancy()).zones.find((z) => z.id === zoneId).available;
  const cancelTarget = await createBooking({
    domainId: zone.domainId,
    zoneId,
    userName: 'Cancel Test',
    vehicleType: 'motorcycle',
    eta: Date.now() + 30 * 60 * 1000,
  });
  await cancelBooking({ sessionCode: cancelTarget.sessionCode });
  const afterCancel = (await getZonesWithOccupancy()).zones.find((z) => z.id === zoneId).available;
  assert.equal(afterCancel, before, 'Cancelling a booking must return the slot');
  assert.equal((await getSession(cancelTarget.sessionCode)).status, 'CANCELLED');

  // 10. Scheduler sweep expires stale bookings and releases the slot
  const beforeSweep = (await getZonesWithOccupancy()).zones.find((z) => z.id === zoneId).available;
  const stale = await createBooking({
    domainId: zone.domainId,
    zoneId,
    userName: 'Sweep Test',
    vehicleType: 'motorcycle',
    eta: Date.now() - 30 * 60 * 1000,
  });
  const swept = await sweepExpiredBookings();
  assert.ok(swept >= 1, 'Sweep should expire at least one booking');
  assert.equal((await getSession(stale.sessionCode)).status, 'EXPIRED');
  const afterSweep = (await getZonesWithOccupancy()).zones.find((z) => z.id === zoneId).available;
  assert.equal(afterSweep, beforeSweep, 'Sweep must release the slot');

  // 11. Move zone before gate entry (A -> another motorcycle zone)
  const { zones: allZones } = await getZonesWithOccupancy();
  const altZone = allZones.find(
    (z) => z.id !== zoneId && !z.isFull && (z.vehicleType || 'motorcycle') === 'motorcycle'
  );
  assert.ok(altZone, 'A second motorcycle zone should exist for the change-zone test');

  const moveBooking = await createBooking({
    domainId: zone.domainId,
    zoneId,
    userName: 'Move Test',
    vehicleType: 'motorcycle',
    eta: Date.now() + 30 * 60 * 1000,
  });
  const moved = await changeZone({ sessionCode: moveBooking.sessionCode, zoneId: altZone.id });
  assert.equal(moved.zoneId, altZone.id, 'Session should move to the new zone');
  assert.ok(moved.zoneChangedAt, 'Zone change timestamp should be recorded');
  const afterMove = await getZonesWithOccupancy();
  assert.equal(afterMove.zones.find((z) => z.id === altZone.id).available, altZone.available - 1);

  // 12. After gate entry only one zone change is allowed
  await processGateIn({
    sessionCode: moveBooking.sessionCode,
    manualPlateOverride: 'B 7777 MV',
  });
  const movedAgain = await changeZone({ sessionCode: moveBooking.sessionCode, zoneId });
  assert.equal(movedAgain.zoneId, zoneId);
  await assert.rejects(
    () => changeZone({ sessionCode: moveBooking.sessionCode, zoneId: altZone.id }),
    /hanya boleh satu kali/i
  );

  // 13. First wrong-zone scan is a warning, second is a violation
  const graceBooking = await createBooking({
    domainId: zone.domainId,
    zoneId,
    userName: 'Grace Test',
    vehicleType: 'motorcycle',
    eta: Date.now() + 30 * 60 * 1000,
  });
  await processGateIn({ sessionCode: graceBooking.sessionCode, manualPlateOverride: 'B 8888 GR' });

  const violationsBefore = Number(
    (await redis.hget(`parking:stats:zone:${zoneId}`, 'zoneViolations')) || 0
  );
  const wrongZone = altZone.id;

  await assert.rejects(
    () => processZoneScan({ sessionCode: graceBooking.sessionCode, scannedZoneId: wrongZone, action: 'confirm_park' }),
    /kekeliruan/i
  );
  const afterFirst = await getSession(graceBooking.sessionCode);
  assert.equal(afterFirst.zoneScanMisses, 1);
  assert.equal(
    Number((await redis.hget(`parking:stats:zone:${zoneId}`, 'zoneViolations')) || 0),
    violationsBefore,
    'First wrong scan must not be counted as a violation'
  );

  await assert.rejects(
    () => processZoneScan({ sessionCode: graceBooking.sessionCode, scannedZoneId: wrongZone, action: 'confirm_park' }),
    /pelanggaran tercatat/i
  );
  assert.equal(
    Number((await redis.hget(`parking:stats:zone:${zoneId}`, 'zoneViolations')) || 0),
    violationsBefore + 1,
    'Second wrong scan must be counted'
  );

  console.log('All store assertions passed cleanly!');
  await redis.quit();
  await redisSub.quit();
}

runSelfCheck().catch((err) => {
  console.error('Self-check failed:', err);
  process.exit(1);
});
