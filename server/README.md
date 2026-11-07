# Backend API (`server/`)

Node 24, `http` bawaan (tanpa framework), ESM `.mjs`, state live di **Redis** (ioredis) dan VLM/asisten lewat **OpenRouter**.

```bash
npm start            # :8788 (127.0.0.1)
npm run dev          # node --watch
npm test             # store + consensus + API (terisolasi)
```

## Modul

| File | Isi |
|---|---|
| `server.mjs` | HTTP server, routing, auth, rate limit, SSE, proxy VLM + asisten operator, startup/shutdown |
| `store.mjs` | State machine parkir, master data, kuota atomik, analitik, event, scheduler |
| `auth.mjs` | `checkToken`, `safeEqual`, `createRateLimiter`, `clientIp` |
| `plateConsensus.mjs` | Normalisasi plat, validasi format Indonesia, voting multi-frame |
| `persistence.mjs` | Arsip JSONL + opsional upsert Supabase |
| `web.mjs` | Static server + proxy `/api` untuk image container |
| `test-*.mjs` | Tes store, konsensus, dan API end-to-end |

## Endpoint

### Publik / driver

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | Status Redis (tanpa secret) |
| GET | `/metrics` | Metrik Prometheus teks |
| GET | `/api/auth/status` | `{adminTokenRequired, gateTokenRequired}` |
| GET | `/api/zones` | Domain + zona + okupansi saat ini |
| GET | `/api/sessions/:code` | Detail sesi |
| GET | `/api/events` | SSE live (Redis Pub/Sub) |
| POST | `/api/bookings` | `{domainId, zoneId, userName, vehicleType, eta}` |
| POST | `/api/bookings/cancel` | `{sessionCode}` — hanya `BOOKED` |
| POST | `/api/bookings/change-zone` | `{sessionCode, zoneId}` — bebas sebelum masuk, sekali setelah masuk |
| POST | `/api/zones/scan` | `{sessionCode, qrCode, action}` — konfirmasi zona / checkout |
| POST | `/api/payments/checkout` | `{sessionCode}` — tagihan tanpa scan |
| POST | `/api/payments/pay` | `{sessionCode, method}` — QR keluar terbit |
| POST | `/api/payments/reissue` | `{sessionCode}` — QR keluar baru (denda Rp20.000 bila kedaluwarsa) |

### Admin (`Authorization: Bearer ADMIN_API_TOKEN`)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/admin/sessions` | Sesi aktif |
| GET | `/api/admin/analytics?from&to` | Analitik + keuangan + kualitas gate |
| GET | `/api/admin/events?date&from&to&limit` | Riwayat event (maks 500) |
| POST | `/api/admin/assistant` | Asisten operator (LLM, hanya mengusulkan aksi) |
| POST | `/api/admin/override` | Override gate darurat (publish event) |
| POST/PUT/DELETE | `/api/domains`, `/api/domains/:id` | CRUD domain |
| POST/PUT/DELETE | `/api/zones`, `/api/zones/:id` | CRUD zona |

### Gate (`Authorization: Bearer GATE_API_TOKEN`)

| Method | Path | Keterangan |
|---|---|---|
| POST | `/api/gates/entry` | `{sessionCode/qr, plate, gateId}` → `ENTERED` |
| POST | `/api/gates/exit` | `{exitCode, plate, gateId}` → `COMPLETED` |
| POST | `/api/gates/:id/quality` | Metrik kualitas kamera |
| POST | `/api/vlm/plate` | Baca plat satu gambar |
| POST | `/api/vlm/plate/consensus` | `{frames:[dataUrl...]}` → voting plat |

401 bila token tidak dikirim, 403 bila salah. Token kosong di env = pengecekan dimatikan (dev).

## State machine

```text
BOOKED ──gate in──► ENTERED ──scan zona──► PARKED_CONFIRMED
   │                   │                        │
   │                   └──ganti zona (1x)       └──checkout──► CHECKOUT_REQUESTED
   │                                                            │
   └──(ETA+15m)──► EXPIRED                             pay ──► PAID
                                                     │            │
                                                cancel       gate out
                                                     ▼            ▼
                                                CANCELLED    COMPLETED
```

Transisi memakai lock per sesi (`SET NX PX`) + `compare-and-transition`; kuota zona memakai Lua `INCR` atomik sehingga tidak bisa overbook meski request paralel.

## Aturan bisnis (implementasi)

- `ENTRY_QR_TTL_MS = 15 menit` dari ETA. ETA lewat >10 menit otomatis digeser ke hari berikutnya.
- `EXIT_QR_TTL_S = 20 menit` sejak pembayaran; lewat itu gate keluar menolak dan `reissue` mengenakan denda `EXIT_EXPIRED_PENALTY = 20000`.
- Tarif: motor Rp1.000 (<60 mnt) / Rp2.000; mobil Rp2.000 / Rp3.000.
- Zona mismatch: panggilan pertama hanya peringatan (`zoneScanMisses`), panggilan kedua dicatat sebagai pelanggaran (`zoneViolations`).
- Ganti zona: sebelum masuk bebas; setelah masuk dibatasi `zoneChangesAfterEntry < 1` dan memvalidasi jenis kendaraan.
- `deleteDomain` menolak bila masih ada zona yang memakainya; `deleteZone` menolak bila zona masih punya sesi aktif.
- Scheduler tiap 30 detik: `sweepExpiredBookings()` melepas kuota booking hangus.
- `rebuildCounters()` saat startup: bangun ulang counter kuota harian dari sesi aktif.

## Redis

| Key | Tipe | Isi |
|---|---|---|
| `parking:master:domains` | string JSON | master domain |
| `parking:master:zones` | string JSON | master zona |
| `parking:session:<code>` | string JSON, TTL 24 jam | sesi |
| `parking:exit:<code>` | string, TTL 20 menit | indeks QR keluar → sesi |
| `parking:active_sessions` | set | kode sesi aktif |
| `parking:count:<date>:<zone>` | counter | kuota harian per zona |
| `parking:lock:<code>` | string NX PX | lock transisi |
| `parking:events` | pub/sub | kanal live event |
| `parking:events:log` | list (maks 5000) | riwayat event |
| `parking:stats:zone:<id>` | hash | counter aktivitas/revenue zona |
| `parking:stats:zone:day:<date>` | hash | aktivitas harian `<zone>:<event>` |
| `parking:stats:zone:revenue:day:<date>` | hash | revenue harian per zona/jenis |
| `parking:stats:zone:payments:day:<date>` | hash | jumlah pembayaran harian |
| `parking:stats:hours`, `parking:stats:hours:<date>` | hash | histogram jam |
| `parking:stats:revenue:days` | hash | revenue per tanggal |
| `parking:stats:gate:<id>` | hash | EWMA + skor kualitas gate |
| `parking:quality:recent:<id>` | list | 10 sampel terakhir |

Event yang dipublish: `BOOKED`, `GATE_ENTRY`, `ZONE_CONFIRMED`, `ZONE_MISMATCH`, `ZONE_VIOLATION`, `ZONE_CHANGED`, `CHECKOUT_REQUESTED`, `PAID`, `GATE_EXIT`, `COMPLETED`, `BOOKING_CANCELLED`, `BOOKING_EXPIRED`, `DOMAIN_UPDATED`, `ZONE_UPDATED`, `ADMIN_GATE_OVERRIDE`, `ZONE_SNAPSHOT`.

## Asisten operator

`POST /api/admin/assistant` menerima `{messages:[{role,content}]}` (maks 12 pesan, 4000 char/pesan).

1. Server menyusun snapshot live: domain, zona, sesi aktif, KPI hari ini.
2. Model `OPENROUTER_VLM_MODEL` (default `google/gemini-2.5-flash`) dipaksa menjawab JSON `{reply, action}`.
3. `action` di-whitelist (`create_domain`, `update_domain`, `delete_domain`, `create_zone`, `update_zone`, `delete_zone`, `cancel_booking`, `reissue_exit`) dan **tidak dieksekusi server**; UI yang menerapkan lewat endpoint admin biasa.

## Konsensus plat

`plateConsensus.mjs`:

- Normalisasi: buang spasi/tanda baca, uppercase.
- Validasi format Indonesia: `/^[A-Z]{1,2}\d{1,4}[A-Z]{0,3}$/`.
- Voting frame: nilai terbanyak menang; fallback gabung per posisi bila suara seri.
- Terima bila ≥2 frame sepakat atau satu frame confidence ≥0.85.

## Persistensi

- Semua perubahan status sesi ditulis ke `data/history/YYYY-MM-DD.jsonl` (`HISTORY_DIR` bisa dioverride).
- Bila `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` diisi, juga `POST` upsert ke tabel `parking_history` (`supabase/history.sql`).
- Kegagalan persistensi tidak memblokir transisi (best-effort, dicatat di log).

## Keamanan & ops

- Bearer token timing-safe (`crypto.timingSafeEqual`).
- Rate limit fixed window per IP/token: VLM 30/mnt, tulis 30/mnt, baca 180/mnt.
- Log JSON per baris (`{"level","msg","time",...}`), metrik in-process di `/metrics`.
- Graceful shutdown `SIGINT`/`SIGTERM`: stop scheduler, tutup Redis.
- Peringatan startup bila token/API key kosong.

## Tes

```bash
npm test
```

- `test-store.mjs` — alur penuh, kuota, mismatch, cancel, sweep, ganti zona, grace.
- `test-consensus.mjs` — normalisasi + voting.
- `test-api.mjs` — lewat `test-runner.mjs`: Redis **DB 15**, port **8799**, token tes, flush hanya bila `ALLOW_TEST_FLUSH=1`.

Tes tidak pernah menyentuh Redis produksi atau endpoint remote.
