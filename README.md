# Smart Parking Campus

Sistem Smart Parking kampus dengan tiga aplikasi web terpisah:

| App | Untuk | Subdomain |
|---|---|---|
| `client/` | **Driver** — booking, tiket QR, bayar, tiket keluar | `parkir.hiiamanop.my.id` |
| `app/` | **Admin** — kelola zona, QR tiang, monitoring sesi, override gate | `admin-parkir.hiiamanop.my.id` |
| `gate/` | **Gate kiosk** — scan QR + VLM baca plat, buka palang | `gate-parkir.hiiamanop.my.id` |

Backend `server/` menyediakan REST API + SSE live events + proxy VLM OpenRouter, dengan state live di **Redis**.

## Arsitektur

```text
Browser (driver / admin / gate)
   │  same-origin: /api/*  (proxied)
   ▼
smart-parking-web (static + proxy)  ──► smart-parking-api (Node, :8788)
                                            ├─ Redis (state sesi, zona, event)
                                            └─ OpenRouter (VLM plat nomor)
   ▲
   │
Cloudflare Tunnel ── parkir / admin-parkir / gate-parkir .hiiamanop.my.id
```

- Tiga container web memakai image yang sama; beda hanya `APP_DIR`.
- `/api/*` diproxy ke `smart-parking-api`, termasuk SSE `/api/events` (streaming).
- **API key OpenRouter hanya di server**, tidak dikirim ke browser.

## Struktur

```text
smart-parking/
├── app/                  # Dashboard admin (Vite + React + TS)
├── client/               # Driver app (PWA installable)
├── gate/                 # Gate kiosk (kamera + QR + VLM)
├── server/
│   ├── server.mjs        # REST + SSE + VLM proxy
│   ├── store.mjs         # state machine parkir (Redis)
│   ├── web.mjs           # static server + proxy /api untuk 3 app
│   └── test-store.mjs    # self-test backend
├── deploy/
│   ├── api.Dockerfile
│   └── web.Dockerfile
├── docker-compose.yml    # redis + api + driver + admin + gate
├── supabase/schema.sql   # skema iterasi awal (belum dipakai backend ini)
└── docs/
```

## Setup

1. `.env` (lihat `.env.example`):

   ```env
   OPENROUTER_API_KEY=sk-or-...
   OPENROUTER_VLM_MODEL=google/gemini-3.5-flash
   REDIS_URL=redis://127.0.0.1:6379
   ```

2. Redis lokal:

   ```bash
   docker run -d --name redis-parking -p 6379:6379 redis:alpine
   ```

3. Install & jalankan backend:

   ```bash
   cd server && npm install && npm start
   # health: http://127.0.0.1:8788/health
   # tes:   cd server && node test-store.mjs
   ```

4. Jalankan frontend (terminal terpisah):

   ```bash
   cd app    && npm install && npm run dev   # admin,  http://localhost:5173
   cd client && npm install && npm run dev   # driver, http://localhost:5174
   cd gate   && npm install && npm run dev   # kiosk,  http://localhost:5175
   ```

   Vite memproxy `/api` ke `127.0.0.1:8788`.

## Build & deploy

```bash
npm run build          # build app + client + gate
docker compose up -d --build
```

Container:

| Container | Port lokal | Fungsi |
|---|---|---|
| `smart-parking-api` | `127.0.0.1:8788` | REST + SSE + VLM |
| `smart-parking-driver` | `127.0.0.1:8081` | Driver app |
| `smart-parking-admin` | `127.0.0.1:8082` | Admin dashboard |
| `smart-parking-gate` | `127.0.0.1:8083` | Gate kiosk |
| `smart-parking-redis` | internal | State live (AOF volume) |

Semua container join network `supabase_default` agar bisa diakses `cloudflared` dan (opsional) database Supabase.

### Ingress Cloudflare

`storage/volumes/cloudflared/config.yml`:

```yaml
ingress:
  - hostname: storage.hiiamanop.my.id
    service: http://api-gw:8000
  - hostname: parkir.hiiamanop.my.id
    service: http://smart-parking-driver:8080
  - hostname: admin-parkir.hiiamanop.my.id
    service: http://smart-parking-admin:8080
  - hostname: gate-parkir.hiiamanop.my.id
    service: http://smart-parking-gate:8080
  - service: http_status:404
```

DNS (zone `hiiamanop.my.id`), semua **CNAME** ke `efa3575e-ce9a-400c-ab75-c9edb521479e.cfargotunnel.com`, **Proxied**:

- `parkir`
- `admin-parkir`
- `gate-parkir`

## Alur singkat

1. Driver booking (fakultas, zona, ETA) → QR sesi `SP-xxxxxx`.
2. Gate masuk: scan QR + foto plat → VLM baca plat → sesi `ENTERED`, palang terbuka.
3. Zona: scan QR zona → `PARKED_CONFIRMED`.
4. Mau pulang: scan QR zona → `CHECKOUT_REQUESTED` + bill.
5. Bayar di app (QRIS simulasi) → `PAID` + kode keluar `OUT-xxxxxx`.
6. Gate keluar: scan kode keluar + foto plat → VLM verifikasi plat → `COMPLETED`.

## Catatan status

- Pembayaran & palang gate masih **simulasi**.
- Backend saat ini memakai **Redis** untuk state live. Skema Supabase dari iterasi awal (`supabase/schema.sql`) belum diwire ke backend ini.
- Tarif masih flat **Rp2.000**; aturan overstay (Rp2.000 + Rp1.000) dan loyalty belum diimplementasikan di backend branch ini.
- VLM butuh `OPENROUTER_API_KEY`; tanpa key, gunakan override plat manual di gate kiosk.
- Scan QR kamera: gate memakai `jsQR`; browser modern/HTTPS.

## Dokumen

- [User Story](docs/user-story.md)
- [Product Backlog](docs/backlog.md)
- [BRD](docs/brd.md)

## Keamanan & operasi (P0/P1)

Variabel `.env` tambahan:

```bash
# Wajib untuk produksi. Jika kosong, API admin/gate terbuka (hanya untuk dev).
ADMIN_API_TOKEN=ganti-token-admin-panjang
GATE_API_TOKEN=ganti-token-gate-panjang

# Opsional: arsip historis ke Supabase/Postgres
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key
SUPABASE_TABLE=parking_history

# Opsional
VLM_TIMEOUT_MS=20000
HISTORY_DIR=./data/history
```

- **Admin**: dashboard meminta token saat pertama dibuka (`ADMIN_API_TOKEN`).
- **Gate**: terminal kios meminta token perangkat (`GATE_API_TOKEN`) atau `VITE_GATE_TOKEN` saat build.
- **Rate limit** bawaan: VLM 30/menit, tulis 30/menit, baca 180/menit per IP/token.
- **Health**: `GET /health` memeriksa Redis. **Metrik**: `GET /metrics` (format Prometheus).
- **Histori**: setiap perubahan status sesi ditulis ke `data/history/YYYY-MM-DD.jsonl`; bila Supabase dikonfigurasi, juga dikirim ke tabel `parking_history` (lihat `supabase/history.sql`).
- **Kedaluwarsa**: scheduler internal berjalan tiap 30 detik untuk melepas booking yang hangus.
- **Tes terisolasi**: `npm --prefix server test` memakai Redis DB 15, server sementara di port 8799, dan token tes. CI: `.github/workflows/ci.yml`.
