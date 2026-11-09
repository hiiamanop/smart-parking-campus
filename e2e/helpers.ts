import type { Page } from '@playwright/test';

export const ADMIN_URL = process.env.E2E_ADMIN_URL || 'http://127.0.0.1:8082';
export const DRIVER_URL = process.env.E2E_DRIVER_URL || 'http://127.0.0.1:8081';
export const GATE_URL = process.env.E2E_GATE_URL || 'http://127.0.0.1:8083';
export const API_URL = process.env.E2E_API_URL || 'http://127.0.0.1:8788';

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || '';
const GATE_TOKEN = process.env.GATE_API_TOKEN || '';

// Seed auth tokens before the app boots so tests work against a secured stack.
export async function seedTokens(page: Page) {
  await page.addInitScript(
    ({ admin, gate }) => {
      try {
        if (admin) localStorage.setItem('smart_parking_admin_token', admin);
        if (gate) localStorage.setItem('smart_parking_gate_token', gate);
      } catch {
        // storage can be unavailable; the tests will surface the real failure
      }
    },
    { admin: ADMIN_TOKEN, gate: GATE_TOKEN }
  );
}

export function adminHeaders(): Record<string, string> {
  return ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};
}

export function gateHeaders(): Record<string, string> {
  return GATE_TOKEN ? { Authorization: `Bearer ${GATE_TOKEN}` } : {};
}
