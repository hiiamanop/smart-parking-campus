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
   ├─ vLLM lokal VLM plat nomor (OpenAI-compatible)
   └─ OpenRouter asisten operator + voice (STT/TTS)
```

- API key OpenRouter hanya di server.
- VLM plat nomor dilayani vLLM lokal agar banyak kamera/gate bisa membaca plat paralel.
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
OPENROUTER_ASSISTANT_MODEL=deepseek/deepseek-v4-flash
OPENROUTER_STT_MODEL=openai/gpt-audio
OPENROUTER_TTS_MODEL=openai/gpt-audio
OPENROUTER_TTS_VOICE=nova
VOICE_MAX_SECONDS=120

# VLM plat nomor: server lokal OpenAI-compatible (vLLM)
# Default: Qwen3-VL-8B-Instruct-AWQ-4bit (muat di GPU 12 GB).
VLM_PROVIDER=vllm
VLLM_BASE_URL=http://host.docker.internal:8001/v1
VLLM_MODEL=qwen3-vl-8b-awq
VLLM_API_KEY=
VLM_TIMEOUT_MS=90000
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

## vLLM lokal (pembacaan plat)

Pembacaan plat memakai VLM lokal lewat vLLM (OpenAI-compatible) supaya banyak
kamera/gate bisa mengirim gambar paralel tanpa rate limit OpenRouter.

Default di repo ini: **Qwen3-VL-8B-Instruct-AWQ-4bit** (~7,6 GB). Model 12B
AWQ (mis. Gemma 4 12B, ~11,25 GB) tidak muat di RTX 3060 12 GB bersama KV cache.

```bash
# 1) Siapkan environment (sekali saja)
cd ~/workspace
uv venv vllm-env --python 3.12
uv pip install --python vllm-env/bin/python --torch-backend=auto vllm
HF_HOME=~/workspace/hf-cache uvx --from 'huggingface_hub[cli]' \
  hf download cyankiwi/Qwen3-VL-8B-Instruct-AWQ-4bit \
  --local-dir ~/workspace/models/qwen3-vl-8b-awq

# 2) Jalankan server (port 8001, otomatis terbaca dari container)
./deploy/start-vllm.sh
```

Cek kesiapan:

```bash
curl -s http://<ip-host>:8001/v1/models
curl -s http://127.0.0.1:8788/api/vlm/status
```

`deploy/start-vllm.sh` memakai `--gpu-memory-utilization 0.90`, `--max-model-len 6144`,
`--max-num-seqs 8`, dan menonaktifkan JIT flashinfer (host tanpa nvcc).

Auto-start saat boot (systemd user, `Linger=yes`):

```bash
mkdir -p ~/.config/systemd/user
cp deploy/vllm-plate.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now vllm-plate.service
systemctl --user status vllm-plate.service
```

## Build, tes, deploy

```bash
npm run build          # build app + client + gate
npm run test:server    # store + consensus + API (Redis DB 15, port 8799)
docker compose up -d --build
```

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
- Asisten operator memakai DeepSeek V4 Flash (terpisah dari VLM); perubahan data selalu perlu persetujuan operator di UI, termasuk aksi bulk.
- VLM plat nomor memakai vLLM lokal (OpenAI-compatible) agar tahan banyak input paralel; tanpa server vLLM, pembacaan plat akan gagal dengan pesan yang jelas.
