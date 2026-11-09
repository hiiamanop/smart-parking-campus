import { expect, test } from '@playwright/test';
import { ADMIN_URL, seedTokens } from './helpers';

test.beforeEach(async ({ page }) => {
  await seedTokens(page);
});

test('dashboard admin tampil dan navigasi antar menu bekerja', async ({ page }) => {
  await page.goto(ADMIN_URL);

  await expect(page.getByRole('heading', { name: 'Ringkasan operasional' })).toBeVisible();
  await expect(page.getByText('Zona parkir', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Pendapatan hari ini')).toBeVisible();

  await page.locator('.side-nav-item', { hasText: 'Zona parkir' }).click();
  await expect(page.getByRole('heading', { name: 'Zona parkir' })).toBeVisible();

  await page.locator('.side-nav-item', { hasText: 'Sesi & kendaraan' }).click();
  await expect(page.getByRole('heading', { name: 'Sesi & kendaraan' })).toBeVisible();

  await page.locator('.side-nav-item', { hasText: 'Analitik' }).click();
  await expect(page.getByRole('heading', { name: 'Analitik & perawatan preventif' })).toBeVisible();
});

test('asisten operator menampilkan balasan kaya dan menerapkan aksi non-destruktif', async ({
  page,
}) => {
  let assistantCalls = 0;
  let zoneUpdated = false;

  await page.route('**/api/admin/assistant', async (route) => {
    assistantCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        model: 'e2e-test',
        reply:
          '### Ringkasan\n- Okupansi Zona A masih 0 dari 20 slot.\n- Tidak ada sesi aktif saat ini.\n\nSaya usulkan menaikkan kapasitas Zona A menjadi 25 slot agar siap menghadapi jam sibuk.',
        actions: [
          {
            type: 'update_zone',
            params: { id: 'zone-a', capacity: 25 },
            destructive: false,
          },
        ],
        requiresConfirmation: false,
      }),
    });
  });

  await page.route('**/api/zones/zone-a', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    zoneUpdated = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        zone: {
          id: 'zone-a',
          name: 'Zona A - Lapangan Barat',
          domainId: 'DOM-TEKNIK',
          vehicleType: 'motorcycle',
          capacity: 25,
          occupied: 0,
          available: 25,
          isFull: false,
          gateIn: 'Gate Utara In',
          gateOut: 'Gate Utara Out',
        },
      }),
    });
  });

  await page.goto(ADMIN_URL);
  await page.locator('.operator-fab').click();

  const panel = page.locator('.operator-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Halo, saya Nusa')).toBeVisible();
  await expect(panel.locator('.operator-online')).toBeVisible();

  await page.locator('.operator-input input').fill('Naikkan kapasitas Zona A menjadi 25');
  await page.locator('.operator-send').click();

  await expect(panel.getByText('Okupansi Zona A masih 0 dari 20 slot.')).toBeVisible();
  await expect(panel.getByText('Ubah zona zone-a')).toBeVisible();
  await expect(panel.locator('.operator-meta', { hasText: 'Nusa' })).toBeVisible();

  await panel.getByRole('button', { name: 'Terapkan', exact: true }).click();

  await expect(panel.getByText('Zona "Zona A - Lapangan Barat" diperbarui.')).toBeVisible();
  expect(assistantCalls).toBe(1);
  expect(zoneUpdated).toBe(true);
});

test('asisten menandai aksi hapus sebagai berisiko dan menunggu persetujuan', async ({ page }) => {
  await page.route('**/api/admin/assistant', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        model: 'e2e-test',
        reply:
          'Saya siapkan dua aksi berurutan: hapus Zona D lebih dulu, lalu domain Ilmu Komputer. Keduanya permanen dan baru dijalankan setelah Anda menyetujui.',
        actions: [
          { type: 'delete_zone', params: { id: 'zone-d' }, destructive: true },
          { type: 'delete_domain', params: { id: 'DOM-ILKOM' }, destructive: true },
        ],
        requiresConfirmation: true,
      }),
    });
  });

  await page.goto(ADMIN_URL);
  await page.locator('.operator-fab').click();
  await page.locator('.operator-input input').fill('Hapus zona D lalu domain Ilmu Komputer');
  await page.locator('.operator-send').click();

  const panel = page.locator('.operator-panel');
  await expect(panel.locator('.operator-action-warn')).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Setujui & terapkan' })).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Terapkan semua (2)' })).toBeVisible();

  // Dismiss the first proposal without calling any delete endpoint.
  await panel.getByRole('button', { name: 'Batal', exact: true }).first().click();
  await expect(panel.locator('.operator-action.dismissed')).toHaveCount(1);
  await expect(panel.getByText('Dibatalkan.')).toBeVisible();
});

test('panel asisten tetap rapi di layar mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ADMIN_URL);
  await page.locator('.operator-fab').click();

  const panel = page.locator('.operator-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.operator-online')).toBeVisible();
  await expect(panel.locator('.operator-empty-title')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
