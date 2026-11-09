import { expect, test } from '@playwright/test';
import { ADMIN_URL, API_URL, DRIVER_URL, seedTokens } from './helpers';

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
