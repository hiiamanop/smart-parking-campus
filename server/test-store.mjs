import assert from 'node:assert/strict';
import {
  initMasterData,
  getZonesWithOccupancy,
  createBooking,
  processGateIn,
  processZoneScan,
  processPayment,
  processGateOut,
  redis,
  redisSub,
} from './store.mjs';

async function runSelfCheck() {
  console.log('Running smart parking store verification...');

  // 1. Initialize master data
  await initMasterData();
  const { faculties, zones } = await getZonesWithOccupancy();
  assert.ok(faculties.length >= 4, 'Should have at least 4 faculties');
  assert.ok(zones.length >= 4, 'Should have at least 4 zones');
  const zoneA = zones.find((z) => z.id === 'zone-a');
  assert.ok(zoneA, 'Zone A should exist');
  const initialAvailable = zoneA.available;

  // 2. Create booking
  const booking = await createBooking({
    facultyId: 'FT',
    zoneId: 'zone-a',
    userName: 'Budi Test',
    vehicleType: 'car',
    eta: '09:00',
    etd: '16:00',
  });
  assert.equal(booking.status, 'BOOKED');
  assert.ok(booking.sessionCode.startsWith('SP-'));

  // Quota should decrement
  const { zones: zonesAfterBooking } = await getZonesWithOccupancy();
  const zoneAfter = zonesAfterBooking.find((z) => z.id === 'zone-a');
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
    scannedZoneId: 'zone-a',
    action: 'confirm_park',
  });
  assert.equal(parked.status, 'PARKED_CONFIRMED');

  // 5. Scan zone QR to checkout
  const checkout = await processZoneScan({
    sessionCode: booking.sessionCode,
    scannedZoneId: 'zone-a',
    action: 'checkout',
  });
  assert.equal(checkout.status, 'CHECKOUT_REQUESTED');
  assert.equal(checkout.bill.baseFee, 2000);
  assert.ok(checkout.bill.total >= 2000);

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
  const zoneFinal = zonesAfterExit.find((z) => z.id === 'zone-a');
  assert.equal(zoneFinal.available, initialAvailable, 'Zone quota should be restored after exit');

  console.log('All store assertions passed cleanly!');
  await redis.quit();
  await redisSub.quit();
}

runSelfCheck().catch((err) => {
  console.error('Self-check failed:', err);
  process.exit(1);
});
