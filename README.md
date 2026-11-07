# Smart Parking Campus

Web app **Smart Parking** untuk kampus: booking slot dari rumah, QR sesi, gate masuk/keluar, pembayaran di aplikasi, dan verifikasi plat nomor dengan **VLM (OpenRouter)**. Berjalan sebagai **PWA** sehingga bisa dipasang sebagai shortcut/aplikasi dari browser.

Database memakai **Supabase self-hosted** yang sudah ada di workspace `storage` (schema `public`, tabel ber-prefix `parking_`).

## Arsitektur

```text
Browser (PWA)
   │  same-origin
   ▼
smart-parking-web (Node, container)  ── /api/db/rpc/* ──► Supabase PostgREST (api-gw:8000)
   │                                  └─ /api/vlm/plate ─► OpenRouter (VLM)
   │
   ▼
Cloudflare Tunnel ── parkir.hiiamanop.my.id
```

- **Kunci Supabase & OpenRouter hanya ada di server** (`.env`), tidak dikirim ke browser.
- Browser memanggil `/api/db/rpc/<fungsi>` (proxy) dan `/api/vlm/plate`; keduanya ditangani server yang sama dengan file statis `app/dist`.
- Tabel dikunci RLS; aplikasi hanya memakai fungsi RPC `SECURITY DEFINER` (lihat `supabase/schema.sql`).

## Struktur

```text
smart-parking/
├── Dockerfile
├── docker-compose.yml        # service web, join network supabase_default
├── .env                      # rahasia lokal (gitignored)
├── .env.example
├── app/                      # Vite + React + TS (PWA)
│   ├── public/               # manifest, ikon, service worker
│   ├── scripts/              # generator ikon PNG
│   └── src/
│       ├── components/       # QrCode, QrScanner, PlateReader, VlmTester
│       ├── lib/              # api, format, vlm
│       └── App.tsx
├── server/server.mjs         # static server + proxy DB + proxy VLM
├── supabase/schema.sql       # tabel, RPC, RLS, seed zona
└── docs/                     # user story, backlog, BRD
```

## Setup

1. Isi `.env` (contoh lengkap di `.env.example`):

   ```env
   OPENROUTER_API_KEY=sk-or-...
   OPENROUTER_VLM_MODEL=google/gemini-3.5-flash

   # Supabase self-hosted (server-side)
   SUPABASE_URL=http://127.0.0.1:8000
   SUPABASE_KEY=sb_publishable_...
   ```

   `SUPABASE_KEY` boleh memakai *publishable key* atau *anon key* dari workspace `storage`.

2. Terapkan schema database (sekali / saat ada perubahan):

   ```bash
   docker exec -i supabase-db psql -U postgres -d postgres < supabase/schema.sql
   ```

3. Jalankan secara lokal (tanpa Docker):

   ```bash
   cd app && npm install && npm run build
   cd .. && node server/server.mjs
   # buka http://127.0.0.1:8788  (health: /health)
   ```

   Mode pengembangan UI: `cd app && npm run dev` (proxy Vite meneruskan `/api/vlm` ke `127.0.0.1:8788`).
   Catatan: proxy DB di `server/server.mjs` juga menangani `/api/db/*`, jadi untuk dev penuh jalankan server + Vite.

4. Deploy di PC (Docker):

   ```bash
   docker compose up -d --build
   curl http://127.0.0.1:8788/health
   ```

   Container `smart-parking-web` join network `supabase_default` sehingga dapat mengakses `http://api-gw:8000` tanpa lewat Cloudflare/CORS.

## Domain & Cloudflare Tunnel

Ingress tunnel ada di workspace storage: `storage/volumes/cloudflared/config.yml`.

```yaml
ingress:
  - hostname: storage.hiiamanop.my.id
    service: http://api-gw:8000
  - hostname: parkir.hiiamanop.my.id
    service: http://smart-parking-web:8788
  - service: http_status:404
```

Setelah mengubah config: `cd storage && docker compose restart cloudflared`.

DNS yang dibutuhkan di Cloudflare (zone `hiiamanop.my.id`):

| Type  | Name    | Target                                     | Proxy |
|-------|---------|--------------------------------------------|-------|
| CNAME | `parkir`| `efa3575e-ce9a-400c-ab75-c9edb521479e.cfargotunnel.com` | Proxied |

Buat lewat dashboard Cloudflare **DNS → Records → Add record**, atau dengan API token yang punya izin **Zone → DNS → Edit**.

## Alur MVP

1. **Booking** dari rumah: pilih zona/fakultas, isi plat, ETA, ETD → dapat **QR sesi** (`SP...`).
2. **Gate masuk**: scan QR sesi + foto plat (VLM) → plat harus cocok → sesi `active`, palang terbuka.
   Telat > 10 menit dari ETA → booking `expired`, slot dibuka.
3. **Zona**: scan QR zona (`ZONE-...`) → konfirmasi terparkir.
4. **Checkout**: scan QR zona lagi → bill dihitung.
5. **Bayar** di aplikasi (simulasi QRIS): normal **Rp2.000**; overstay (ETD + 10 menit) → **violation + Rp1.000**, total **Rp3.000**.
6. **Gate keluar**: scan QR keluar (`EX...`) + foto plat (VLM) → plat harus sama dengan yang dikunci saat masuk → sesi `closed`.
7. **Loyalty**: sesi bersih +2 poin; overstay −1 poin (minimal 0).

## Status & batasan MVP

- Pembayaran masih **simulasi** (belum terhubung QRIS gateway).
- Gate/palang masih **simulasi** (belum ada kontroler perangkat keras).
- Scan QR memakai `BarcodeDetector` (Chrome Android); browser lain memakai input kode manual.
- Belum ada login pengguna; riwayat sesi diikat ke **device id** acak di browser.
- Fungsi RPC dapat dipanggil siapa pun yang tahu endpoint publik; kode sesi bersifat rahasia/unggues. Untuk produksi perlu auth + rate limiting.

## Dokumen

- [User Story](docs/user-story.md)
- [Product Backlog](docs/backlog.md)
- [BRD](docs/brd.md)
