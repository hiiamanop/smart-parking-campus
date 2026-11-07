import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = process.env.HISTORY_DIR || path.resolve(__dirname, '../data/history');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'parking_history';

let dirReady = false;

function ensureDir() {
  if (dirReady) return;
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  dirReady = true;
}

// Append-only JSONL archive. Durable locally, independent of Redis TTL.
export function archive(record) {
  try {
    ensureDir();
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(HISTORY_DIR, `${day}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'history_archive_failed', error: String(err) }));
  }
}

// Optional Supabase persistence (Postgres) via REST. No-op when unconfigured.
export async function persistToSupabase(record) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { skipped: true };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
    }
    return { ok: true };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'supabase_persist_failed', error: String(err) }));
    return { ok: false, error: String(err) };
  }
}

// Persist a session snapshot (called on meaningful status changes)
export function persistSession(session) {
  const record = {
    kind: 'session',
    session_code: session.sessionCode,
    status: session.status,
    zone_id: session.zoneId,
    domain_id: session.domainId,
    vehicle_type: session.vehicleType,
    plate: session.plate,
    bill_total: session.bill?.total ?? null,
    penalty_total: session.penaltyTotal ?? 0,
    eta: session.eta,
    created_at: session.createdAt,
    entry_time: session.entryTime ?? null,
    exit_time: session.exitTime ?? null,
    recorded_at: new Date().toISOString(),
    payload: session,
  };
  archive(record);
  void persistToSupabase(record);
}
