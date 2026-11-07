import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REDIS_TEST_URL = process.env.REDIS_TEST_URL || 'redis://127.0.0.1:6379/15';
const PORT = Number(process.env.TEST_PORT || 8799);
const ADMIN_TOKEN = 'test-admin-token';
const GATE_TOKEN = 'test-gate-token';

async function flushTestDb() {
  const client = new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: 2 });
  await client.flushdb();
  await client.quit();
}

async function waitForHealth(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return true;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function run() {
  await flushTestDb();

  const server = spawn('node', ['server.mjs'], {
    cwd: __dirname,
    env: {
      ...process.env,
      REDIS_URL: REDIS_TEST_URL,
      VLM_PROXY_PORT: String(PORT),
      VLM_PROXY_HOST: '127.0.0.1',
      ADMIN_API_TOKEN: ADMIN_TOKEN,
      GATE_API_TOKEN: GATE_TOKEN,
      HISTORY_DIR: path.join(__dirname, '../data/history-test'),
    },
    stdio: 'inherit',
  });

  const cleanup = async () => {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    try {
      await flushTestDb();
    } catch {
      // ignore
    }
  };

  try {
    const healthy = await waitForHealth();
    if (!healthy) throw new Error('Server tidak siap dalam batas waktu');

    const test = spawn('node', ['test-api.mjs'], {
      cwd: __dirname,
      env: {
        ...process.env,
        API_BASE: `http://127.0.0.1:${PORT}`,
        ADMIN_API_TOKEN: ADMIN_TOKEN,
        GATE_API_TOKEN: GATE_TOKEN,
      },
      stdio: 'inherit',
    });

    const code = await new Promise((resolve) => test.on('exit', resolve));
    process.exitCode = code ?? 1;
  } finally {
    await cleanup();
  }
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exitCode = 1;
});
