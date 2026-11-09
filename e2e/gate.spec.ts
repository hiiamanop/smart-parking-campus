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
