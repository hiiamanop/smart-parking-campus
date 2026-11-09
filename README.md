# Smart Parking Kampus

Sistem parkir kampus: booking zona, QR masuk/keluar, pembacaan plat nomor dengan VLM, pembayaran di aplikasi, dan pemantauan realtime.

Tiga aplikasi web + satu backend:

| Folder | Aplikasi | Port dev | Isi |
|---|---|---|---|
| `client/` | Driver (mobile web, PWA) | 5174 | Cari slot, booking, tiket QR, bayar, QR keluar |
| `app/` | Admin dashboard | 5173 | Login, ringkasan, CRUD domain/zona, QR zona, analitik, sesi, audit log, asisten operator |
| `gate/` | Kiosk gate | 5175 | Kamera aktif: scan QR lalu baca plat (VLM), buka palang |
| `server/` | REST API + SSE | 8788 | State machine parkir di Redis, proxy OpenRouter, histori |

## Arsitektur

```text
Browser (driver / admin / gate)
   │  /api/*  (Vite dev proxy atau container proxy)
   ▼
smart-parking-api (Node http, :8788)
   ├─ Redis      sesi, master data, counter kuota, event, statistik
   ├─ OpenRouter Claude Haiku 5.5: VLM plat nomor (multimodal)
   └─ OpenRouter asisten operator + voice (STT/TTS)
```

- API key OpenRouter hanya di server.
- VLM plat nomor dan asisten operator sama-sama memakai Claude Haiku 5.5 lewat OpenRouter.
- Live update memakai Redis Pub/Sub → SSE `/api/events` (semua app + browser).

## Alur utama

```text
Driver booking (zona, kendaraan, ETA)
        │  status BOOKED, QR sesi SP-xxxxxxxxxxxxxxxx
        ▼
Gate masuk: scan QR + kamera baca plat (VLM) -> ENTERED, palang buka
        ▼
Di zona: scan QR tiang zona -> PARKED_CONFIRMED
        ▼
Pulang: geser tombol ke kanan -> CHECKOUT_REQUESTED (tanpa scan QR zona)
        ▼
Bayar di app -> PAID + QR keluar OUT-xxxxxxxx (berlaku 20 menit)
        ▼
Gate keluar: scan QR keluar + verifikasi plat -> COMPLETED
```

Aturan penting:

- **QR masuk** berlaku 15 menit sejak ETA. Lewat itu booking dianggap hangus (scheduler melepas kuota).
- **QR keluar** berlaku 20 menit sejak pembayaran. Bila kedaluwarsa, driver menerbitkan QR baru dari HP dengan **denda Rp20.000**.
- **Zona**: hanya zona yang dipesan boleh dikonfirmasi. Salah scan pertama = peringatan; salah scan kedua = pelanggaran tercatat.
- **Ganti zona**: boleh kapan saja sebelum masuk gate, dan **satu kali** setelah masuk gate.
- **Batal booking**: hanya saat status `BOOKED`; kuota dikembalikan.
- **Pembayaran tidak butuh scan QR zona lagi** — checkout dari tombol di app.

## Tarif

Berjenjang per kendaraan dan durasi (dihitung dari waktu masuk):

| Kendaraan | < 60 menit | ≥ 60 menit |
|---|---|---|
| Motor | Rp1.000 | Rp2.000 |
| Mobil | Rp2.000 | Rp3.000 |

Denda QR keluar kedaluwarsa: **Rp20.000**.

## Status sesi

`BOOKED → ENTERED → PARKED_CONFIRMED → CHECKOUT_REQUESTED → PAID → COMPLETED`

Status lain: `EXPIRED` (booking hangus), `CANCELLED` (dibatalkan driver/admin).

## Setup lokal

Prasyarat: Node 24+, Redis (Docker/OrbStack).

```bash
# 1. Redis
docker run -d --name redis-parking -p 6379:6379 redis:alpine

# 2. Env (root .env, tidak di-commit)
cp .env.example .env   # isi OPENROUTER_API_KEY, REDIS_URL, token

# 3. Backend
npm run dev:server     # http://127.0.0.1:8788/health

# 4. Frontend (terminal terpisah / background)
npm run dev:admin      # http://localhost:5173
npm run dev:client     # http://localhost:5174
npm run dev:gate       # http://localhost:5175
```

Vite memproxy `/api` ke `127.0.0.1:8788`.

### Variabel `.env`

```env
# WAJIB
OPENROUTER_API_KEY=sk-or-...
REDIS_URL=redis://127.0.0.1:6379

# Asisten operator + voice (STT/TTS) via OpenRouter
OPENROUTER_ASSISTANT_MODEL=anthropic/claude-haiku-5.5
OPENROUTER_STT_MODEL=openai/gpt-audio
OPENROUTER_TTS_MODEL=openai/gpt-audio
OPENROUTER_TTS_VOICE=nova
VOICE_MAX_SECONDS=120

# VLM plat nomor: Gemini 2.5 Flash (vision) via OpenRouter
OPENROUTER_VLM_MODEL=google/gemini-2.5-flash
VLM_PROVIDER=openrouter
VLM_TIMEOUT_MS=60000
ASSISTANT_TIMEOUT_MS=60000
# Kuota VLM per menit. Dihitung per gate (header x-gate-id), lalu token, lalu IP.
VLM_RATE_LIMIT=120

# Token akses. Kosong = API terbuka (hanya untuk dev)
ADMIN_API_TOKEN=token-admin-panjang
GATE_API_TOKEN=token-gate-panjang

# Opsional
ASSISTANT_TIMEOUT_MS=30000
HISTORY_DIR=./data/history
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_TABLE=parking_history
```

## Model VLM & asisten operator

VLM plat nomor memakai **Gemini 2.5 Flash** (`google/gemini-2.5-flash`), model
vision yang cepat untuk OCR gambar. Asisten operator tetap memakai **Claude
Haiku 5.5** (`anthropic/claude-haiku-5.5`) lewat OpenRouter.

- `OPENROUTER_VLM_MODEL` untuk OCR plat nomor (input gambar).
- `OPENROUTER_ASSISTANT_MODEL` untuk asisten operator (percakapan + perencanaan aksi).
- API key hanya ada di server; browser tidak pernah menerima key.
- Cek kesiapan: `curl -s http://127.0.0.1:8788/api/vlm/status` dan
  `POST /api/admin/assistant`.

Asisten operator bisa:

- membaca data live (zona, sesi, analitik, kualitas kamera, event terakhir);
- mengusulkan satu atau banyak aksi sekaligus (maksimal 10 per balasan);
- menjalankan aksi massal: batalkan/reissue/checkout/bayar banyak sesi, ubah banyak
  zona, hapus banyak zona/domain;
- mengusulkan aksi berisiko (hapus, bayar, buka gate darurat) yang **selalu**
  menunggu persetujuan operator di kartu aksi.

### Kembali ke vLLM lokal (opsional)

Script `deploy/start-vllm.sh` dan `deploy/vllm-plate.service` tetap disimpan untuk
deployment offline. Set `VLM_PROVIDER=vllm`, isi `VLLM_BASE_URL` dan `VLLM_MODEL`,
lalu jalankan service. Konfigurasi default repo tidak memakai jalur ini.

## Build, tes, deploy

```bash
npm run build          # build app + client + gate
npm run test:server    # store + consensus + API (Redis DB 15, port 8799)
docker compose up -d --build
```

### Tes E2E

Ada dua lapis tes end-to-end:

**1. E2E backend/API** (`npm run test:server`) — menjalankan server terisolasi di
Redis DB 15 dan menguji siklus penuh lewat HTTP: booking → gate masuk → konfirmasi
zona → checkout → bayar → gate keluar, plus pembatalan, pindah zona, dan proteksi
hapus zona yang masih dipakai. Tidak butuh browser atau OpenRouter.

**2. E2E browser/UI** (Playwright) — menguji aplikasi yang sedang berjalan:

```bash
docker compose up -d              # stack harus hidup
npm run test:e2e:install          # sekali saja, unduh Chromium
npm run test:e2e                  # jalankan semua skenario
npm run test:e2e:ui               # mode interaktif untuk debug
npm run test:e2e:report           # buka laporan HTML
```

Skenario yang dicakup:

- Dashboard admin tampil dan navigasi antar menu bekerja.
- Asisten operator: balasan kaya, kartu aksi, persetujuan aksi, peringatan aksi
  hapus, tombol **Terapkan semua**, dan layout mobile.
- Booking dari aplikasi driver → tiket terbit → sesi muncul di admin → booking
  dibatalkan lagi (cleanup otomatis).
- Kiosk gate tampil dan bisa berpindah mode masuk/keluar.

Tes berjalan berurutan (`workers: 1`) dan membuat satu booking sementara yang
selalu dibatalkan di blok `finally`. Untuk data yang benar-benar terisolasi,
arahkan tes ke stack staging, bukan produksi.

Variabel opsional:

| Variabel | Default | Fungsi |
|---|---|---|
| `E2E_ADMIN_URL` | `http://127.0.0.1:8082` | URL dashboard admin |
| `E2E_DRIVER_URL` | `http://127.0.0.1:8081` | URL aplikasi driver |
| `E2E_GATE_URL` | `http://127.0.0.1:8083` | URL kiosk gate |
| `E2E_API_URL` | `http://127.0.0.1:8788` | URL API |
| `ADMIN_API_TOKEN` | kosong | Token admin bila API diamankan |
| `GATE_API_TOKEN` | kosong | Token gate bila API diamankan |
| `PLAYWRIGHT_CHROMIUM_PATH` | — | Pakai binary Chromium yang sudah ada |

Contoh menjalankan ke staging dengan token:

```bash
ADMIN_API_TOKEN=... GATE_API_TOKEN=... \
E2E_ADMIN_URL=https://admin-parkir.example.com \
E2E_DRIVER_URL=https://parkir.example.com \
E2E_GATE_URL=https://gate-parkir.example.com \
E2E_API_URL=https://admin-parkir.example.com \
npm run test:e2e
```

File tes ada di `e2e/` (`admin.spec.ts`, `driver.spec.ts`, `gate.spec.ts`).

| Container | Port lokal | Fungsi |
|---|---|---|
| `smart-parking-api` | 8788 | REST + SSE + VLM |
| `smart-parking-driver` | 8081 | Driver app |
| `smart-parking-admin` | 8082 | Admin dashboard |
| `smart-parking-gate` | 8083 | Gate kiosk |
| `smart-parking-redis` | internal | State live (AOF) |

Ingress Cloudflare: `parkir.` → driver, `admin-parkir.` → admin, `gate-parkir.` → gate.

## Keamanan & operasi

- Route `/api/admin/*`, mutasi domain/zona, `/api/gates/*`, `/api/vlm/*` dijaga bearer token.
- Rate limit: VLM `VLM_RATE_LIMIT`/menit (default 120, key: `x-gate-id` → token → IP), tulis 30/menit, baca 180/menit.
- `GET /health` (Redis ping), `GET /metrics` (Prometheus), log JSON terstruktur.
- Histori: `data/history/YYYY-MM-DD.jsonl`; opsional upsert Supabase `parking_history` (`supabase/history.sql`).
- Scheduler 30 detik melepas booking `BOOKED` yang lewat ETA + 15 menit.
- Kuota zona diamankan dengan Lua `INCR` atomik + lock per sesi.

## Struktur repo

```text
app/        Dashboard admin (React 19 + Vite + TS)
client/     Driver app (React 19 + Vite + TS, PWA)
gate/       Gate kiosk (React 19 + Vite + TS, jsQR + ONNX plate detector)
assets/     Logo sumber (lencana + ikon chatbot)
server/     API, state machine, VLM, persistence
deploy/     Dockerfile api + web
supabase/   history.sql (dipakai), schema.sql (arsip iterasi awal)
docs/       BRD, user story, backlog
```

## Dokumentasi per sisi

- [Admin dashboard](app/README.md)
- [Driver app](client/README.md)
- [Gate kiosk](gate/README.md)
- [Backend API](server/README.md)
- [BRD](docs/brd.md) · [User Story](docs/user-story.md) · [Backlog](docs/backlog.md)

## Batasan saat ini

- Pembayaran QRIS masih simulasi (tanpa gateway).
- Palang gate fisik belum diintegrasikan; status palang hanya di layar kiosk.
- Identitas driver belum ada autentikasi (cukup nama pada booking).
- Asisten operator dan VLM plat nomor sama-sama memakai Claude Haiku 5.5 lewat OpenRouter; perubahan data selalu perlu persetujuan operator di UI, termasuk aksi bulk dan hapus.
- Asisten bisa mengusulkan maksimal 10 aksi per balasan dan memuat hingga 150 sesi aktif dalam snapshot; untuk data lebih besar, persempit filter.
- Pembacaan plat bergantung pada kuota/koneksi OpenRouter; tidak ada lagi server VLM lokal secara default.
