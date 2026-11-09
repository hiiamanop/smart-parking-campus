import { expect, test } from '@playwright/test';
import { GATE_URL, seedTokens } from './helpers';

test('kiosk gate tampil dan bisa berpindah mode masuk/keluar', async ({ page }) => {
  await seedTokens(page);
  await page.goto(GATE_URL);

  // With ADMIN/GATE tokens enabled, the kiosk asks for a device token first.
  const tokenHeading = page.getByRole('heading', { name: 'Token perangkat gate' });
  if (await tokenHeading.count()) {
    test.skip(true, 'Gate dilindungi token. Set GATE_API_TOKEN untuk menjalankan tes ini.');
    return;
  }

  await expect(page.locator('.mode-toggle-btn')).toHaveCount(2);
  await expect(page.getByText('PALANG MASUK:')).toBeVisible();

  await page.getByRole('button', { name: 'Gate Keluar' }).click();
  await expect(page.getByText('PALANG KELUAR:')).toBeVisible();

  await page.getByRole('button', { name: 'Gate Masuk' }).click();
  await expect(page.getByText('PALANG MASUK:')).toBeVisible();
});

// Regression for "Perhatian: Sesi parkir tidak ditemukan": an exit QR (OUT-…)
// read while the kiosk is left on "Gate Masuk" used to be posted to
// /api/gates/entry as a session code. The gate must route by QR type instead.
test('QR keluar tetap diproses ke endpoint keluar walau mode kiosk masih masuk', async ({ page }) => {
  await seedTokens(page);
  await page.goto(GATE_URL);

  const tokenHeading = page.getByRole('heading', { name: 'Token perangkat gate' });
  if (await tokenHeading.count()) {
    test.skip(true, 'Gate dilindungi token. Set GATE_API_TOKEN untuk menjalankan tes ini.');
    return;
  }

  let entryCalls = 0;
  let exitCalls = 0;
  let exitPayload: any = null;

  await page.route('**/api/vlm/plate/consensus', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, plate: 'B 1234 ABC', accepted: true, confidence: 0.99 }),
    });
  });
  await page.route('**/api/gates/gate-*/quality', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, score: 80 }) });
  });
  await page.route('**/api/gates/entry', async (route) => {
    entryCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: { plate: 'B1234ABC' } }),
    });
  });
  await page.route('**/api/gates/exit', async (route) => {
    exitCalls += 1;
    exitPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, session: { plate: 'B1234ABC' }, gateOpened: true }),
    });
  });

  // Kiosk starts on "Gate Masuk"; do not switch it.
  await expect(page.getByText('PALANG MASUK:')).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/exit-pass-qr.png');

  await expect
    .poll(() => (exitCalls > 0 ? 'exit' : entryCalls > 0 ? 'entry' : 'none'), { timeout: 15000 })
    .toBe('exit');

  expect(entryCalls).toBe(0);
  expect(exitPayload?.exitCode).toMatch(/^OUT-/);
  // The kiosk should also flip its banner to the exit side.
  await expect(page.getByText('PALANG KELUAR:')).toBeVisible();
});
