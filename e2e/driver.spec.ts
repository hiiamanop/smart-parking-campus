import { expect, test } from '@playwright/test';
import { ADMIN_URL, API_URL, DRIVER_URL, gateHeaders, seedTokens } from './helpers';

test('booking dari aplikasi driver muncul di dashboard admin lalu dibatalkan', async ({
  page,
  context,
  request,
}) => {
  let sessionCode = '';

  try {
    await page.goto(DRIVER_URL);
    await expect(page.getByRole('heading', { name: 'Pesan tempat parkir' })).toBeVisible();

    const bookButton = page.getByRole('button', { name: 'Pesan slot' }).first();
    await expect(bookButton).toBeVisible();
    await expect(bookButton).toBeEnabled();
    await bookButton.click();

    await expect(page.getByRole('heading', { name: 'Konfirmasi pesanan' })).toBeVisible();
    await page.getByRole('button', { name: /Konfirmasi & terbitkan tiket/ }).click();

    await expect(page.locator('.ticket-title')).toHaveText('Tiket parkir terbit');
    sessionCode = (await page.locator('.ticket-code').innerText()).replace('#', '').trim();
    expect(sessionCode).toMatch(/^SP-/);

    // Cross-app check: the admin session monitor must see the new booking.
    const admin = await context.newPage();
    await seedTokens(admin);
    await admin.goto(ADMIN_URL);
    await admin.locator('.side-nav-item', { hasText: 'Sesi & kendaraan' }).click();
    await expect(admin.locator('td', { hasText: sessionCode }).first()).toBeVisible();
    await admin.close();
  } finally {
    if (sessionCode) {
      // Always release the slot, even if an assertion failed.
      await request.post(`${API_URL}/api/bookings/cancel`, {
        data: { sessionCode },
        failOnStatusCode: false,
      });
    }
  }
});

test('tombol reset tiket terlihat di mobile dan mengembalikan ke halaman cari parkir', async ({
  page,
  request,
}) => {
  let sessionCode = '';

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DRIVER_URL);
    await expect(page.getByRole('heading', { name: 'Pesan tempat parkir' })).toBeVisible();

    // Create a real BOOKED session so the reset button exercises the cancel API.
    const bookButton = page.getByRole('button', { name: 'Pesan slot' }).first();
    await expect(bookButton).toBeVisible();
    await bookButton.click();
    await expect(page.getByRole('heading', { name: 'Konfirmasi pesanan' })).toBeVisible();
    await page.getByRole('button', { name: /Konfirmasi & terbitkan tiket/ }).click();

    await expect(page.locator('.ticket-title')).toHaveText('Tiket parkir terbit');
    sessionCode = (await page.locator('.ticket-code').innerText()).replace('#', '').trim();
    expect(sessionCode).toMatch(/^SP-/);

    const reset = page.getByRole('button', { name: 'Reset tiket' });
    await expect(reset).toBeVisible();
    await reset.scrollIntoViewIfNeeded();
    await expect(reset).toBeInViewport();

    page.on('dialog', (dialog) => dialog.accept());
    await reset.click();

    await expect(page.getByRole('heading', { name: 'Pesan tempat parkir' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('smart_parking_driver_real_session')))
      .toBeNull();

    // The slot must be released server-side, not just hidden on the device.
    const sessionRes = await request.get(`${API_URL}/api/sessions/${sessionCode}`);
    expect(sessionRes.ok()).toBe(true);
    const sessionBody = await sessionRes.json();
    expect(sessionBody.session.status).toBe('CANCELLED');
    sessionCode = '';
  } finally {
    if (sessionCode) {
      await request.post(`${API_URL}/api/bookings/cancel`, {
        data: { sessionCode },
        failOnStatusCode: false,
      });
    }
  }
});

test('tombol konfirmasi zona membuka kamera pemindai QR di mobile', async ({ page, request }) => {
  let sessionCode = '';
  let zoneId = '';

  try {
    const zonesRes = await request.get(`${API_URL}/api/zones`);
    const zonesBody = await zonesRes.json();
    const zone = (zonesBody.zones || []).find((z: any) => z.available > 0);
    expect(zone).toBeTruthy();
    zoneId = zone.id;

    const eta = new Date(Date.now() + 10 * 60 * 1000).toTimeString().slice(0, 5);
    const bookingRes = await request.post(`${API_URL}/api/bookings`, {
      data: {
        domainId: zone.domainId,
        zoneId: zone.id,
        userName: 'E2E Scanner',
        vehicleType: zone.vehicleType || 'motorcycle',
        eta,
      },
    });
    const booking = await bookingRes.json();
    sessionCode = booking.session.sessionCode;

    const entryRes = await request.post(`${API_URL}/api/gates/entry`, {
      headers: gateHeaders(),
      data: { sessionCode, manualPlateOverride: 'B 1234 ABC' },
    });
    const entry = await entryRes.json();
    expect(entry.session.status).toBe('ENTERED');

    await page.addInitScript((session) => {
      localStorage.setItem('smart_parking_driver_real_session', JSON.stringify(session));
    }, entry.session);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DRIVER_URL);
    await page.getByRole('button', { name: 'Tiket saya' }).click();

    await expect(page.locator('.page-nav-title')).toHaveText('Sesi berjalan');
    const scanButton = page.getByRole('button', { name: 'Pindai QR zona untuk konfirmasi' });
    await expect(scanButton).toBeVisible();
    await scanButton.click();

    await expect(page.locator('.zone-scanner-card')).toBeVisible();
    await expect(page.locator('.zone-scanner-video video')).toBeVisible();

    await page.getByRole('button', { name: 'Tutup' }).click();
    await expect(page.locator('.zone-scanner-card')).toBeHidden();
  } finally {
    if (sessionCode) {
      // Complete the session so the test does not leave an active entry behind.
      await request.post(`${API_URL}/api/zones/scan`, {
        data: { sessionCode, scannedZoneId: zoneId, action: 'confirm_park' },
        failOnStatusCode: false,
      });
      await request.post(`${API_URL}/api/payments/checkout`, {
        data: { sessionCode },
        failOnStatusCode: false,
      });
      const payRes = await request.post(`${API_URL}/api/payments/pay`, {
        data: { sessionCode, paymentMethod: 'QRIS' },
        failOnStatusCode: false,
      });
      const payBody = await payRes.json().catch(() => null);
      const exitCode = payBody?.session?.exitCode;
      if (exitCode) {
        await request.post(`${API_URL}/api/gates/exit`, {
          headers: gateHeaders(),
          data: { exitCode, manualPlateOverride: 'B 1234 ABC' },
          failOnStatusCode: false,
        });
      } else {
        await request.post(`${API_URL}/api/bookings/cancel`, {
          data: { sessionCode },
          failOnStatusCode: false,
        });
      }
    }
  }
});

test('tiket tetap tampil sebagai bukti setelah palang keluar terbuka', async ({ page, request }) => {
  let sessionCode = '';
  let exitCode = '';
  let completed = false;

  try {
    const zonesRes = await request.get(`${API_URL}/api/zones`);
    const zonesBody = await zonesRes.json();
    const zone = (zonesBody.zones || []).find((z: any) => z.available > 0);
    expect(zone).toBeTruthy();

    const eta = new Date(Date.now() + 10 * 60 * 1000).toTimeString().slice(0, 5);
    const bookingRes = await request.post(`${API_URL}/api/bookings`, {
      data: {
        domainId: zone.domainId,
        zoneId: zone.id,
        userName: 'E2E Receipt',
        vehicleType: zone.vehicleType || 'motorcycle',
        eta,
      },
    });
    const booking = await bookingRes.json();
    expect(booking.ok, booking.error).toBe(true);
    sessionCode = booking.session.sessionCode;

    const entryRes = await request.post(`${API_URL}/api/gates/entry`, {
      headers: gateHeaders(),
      data: { sessionCode, manualPlateOverride: 'B 1234 ABC' },
    });
    expect((await entryRes.json()).session.status).toBe('ENTERED');

    await request.post(`${API_URL}/api/zones/scan`, {
      data: { sessionCode, scannedZoneId: zone.id, action: 'confirm_park' },
    });
    await request.post(`${API_URL}/api/payments/checkout`, { data: { sessionCode } });
    const payRes = await request.post(`${API_URL}/api/payments/pay`, {
      data: { sessionCode, paymentMethod: 'QRIS' },
    });
    const paid = await payRes.json();
    expect(paid.session.status).toBe('PAID');
    exitCode = paid.session.exitCode;

    await page.addInitScript((session) => {
      localStorage.setItem('smart_parking_driver_real_session', JSON.stringify(session));
    }, paid.session);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DRIVER_URL);
    await page.getByRole('button', { name: 'Tiket saya' }).click();
    await expect(page.getByText('QR keluar', { exact: true })).toBeVisible();

    // The gate opens the barrier -> session becomes COMPLETED.
    const exitRes = await request.post(`${API_URL}/api/gates/exit`, {
      headers: gateHeaders(),
      data: { exitCode, manualPlateOverride: 'B 1234 ABC' },
    });
    expect((await exitRes.json()).session.status).toBe('COMPLETED');
    completed = true;

    // Force the app's validation path too, so the assertion does not depend only
    // on the live SSE event arriving in time.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expect(page.locator('.receipt-hero')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Kendaraan sudah keluar')).toBeVisible();
    await expect(page.getByText('Sesi selesai')).toBeVisible();
    await expect(page.getByText('Belum ada tiket aktif')).toHaveCount(0);

    // The completed ticket is kept on the device until dismissed.
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('smart_parking_driver_real_session') || 'null')
    );
    expect(stored?.status).toBe('COMPLETED');

    await page.getByRole('button', { name: 'Selesai' }).click();
    await expect(page.getByRole('heading', { name: 'Pesan tempat parkir' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('smart_parking_driver_real_session')))
      .toBeNull();
  } finally {
    // Never leave a PAID session holding a slot if an assertion failed.
    if (sessionCode && !completed && exitCode) {
      await request.post(`${API_URL}/api/gates/exit`, {
        headers: gateHeaders(),
        data: { exitCode, manualPlateOverride: 'B 1234 ABC' },
        failOnStatusCode: false,
      });
    } else if (sessionCode && !completed) {
      await request.post(`${API_URL}/api/bookings/cancel`, {
        data: { sessionCode },
        failOnStatusCode: false,
      });
    }
  }
});
