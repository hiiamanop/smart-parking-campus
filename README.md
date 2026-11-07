# Smart Parking Campus

Proyek **Smart Parking** untuk mengatasi masalah parkir di kampus (lapangan *outdoor*, banyak fakultas/zona): pengguna sudah melihat *counter* ketersediaan, tetapi belum tahu **lokasi/area kosong** dan ingin parkir di **zona dekat fakultasnya**.

MVP berfokus pada **booking online** berbasis zona dengan alur QR di gate/zona, pembayaran di aplikasi (bukan di gate), serta **AI (VLM)** untuk pembacaan/verifikasi **plat nomor** di gate masuk dan gate keluar.

## Status
- Tahap: **Fondasi awal dikerjakan** (docs + scaffold web + proxy VLM OpenRouter).
- Platform: **web-based saja** (responsive). Pengguna dapat **mengunduh/menambah shortcut aplikasi** dari web (installable/PWA, *Add to Home Screen*).
- VLM (otak AI): **OpenRouter**. Model default: `google/gemini-2.5-flash` (cepat, vision/OCR kuat untuk MVP). Bisa diganti di `.env`.

## Struktur
```text
smart-parking/
├── .env                 # konfigurasi lokal (API key & Redis)
├── .env.example         # template env
├── server/              # Backend API + Redis Pub/Sub + SSE + OpenRouter VLM (Port 8788)
│   ├── store.mjs        # state machine parkir, Redis cache & channel
│   ├── server.mjs       # REST API & SSE bridge
│   └── test-store.mjs   # automated tests
├── app/                 # Dashboard Admin (Port 5173)
│   ├── src/components/admin/ZoneManager.tsx     # CRUD zona parkir
│   ├── src/components/admin/ZoneQRGenerator.tsx  # cetak QR tiang zona
│   ├── src/components/admin/SessionMonitor.tsx   # monitoring sesi & kendaraan
│   ├── src/components/admin/GateControl.tsx      # override palang gate
│   └── src/components/admin/LiveEventLog.tsx    # audit log real-time Redis
├── client/              # Driver Mobile App (Port 5174)
│   └── src/App.tsx      # reservasi spot, tiket QR masuk, circular timer, bayar QRIS, tiket keluar
└── gate/                # Gate Kiosk & Scanner Terminal (Port 5175)
    └── src/App.tsx      # scan QR masuk -> AI VLM baca plat -> plat tersimpan -> buka gate
```

## Setup cepat
1. Pastikan **Redis** menyala (via Docker/OrbStack):
   ```bash
   docker run -d --name redis-parking -p 6379:6379 redis:alpine
   ```

2. Jalankan Backend Server (terminal 1, port 8788):
   ```bash
   cd server && npm start
   # cek: http://127.0.0.1:8788/health
   ```

3. Jalankan Dashboard Admin (terminal 2, port 5173):
   ```bash
   cd app && npm run dev
   # buka: http://localhost:5173
   ```

4. Jalankan Driver Mobile App (terminal 3, port 5174):
   ```bash
   cd client && npm run dev
   # buka: http://localhost:5174
   ```

5. Jalankan Gate Kiosk & AI Scanner (terminal 4, port 5175):
   ```bash
   cd gate && npm run dev
   # buka: http://localhost:5175
   ```

## Model VLM (OpenRouter)
Default dipilih untuk MVP gate/plat: **`google/gemini-2.5-flash`** — keseimbangan akurasi vision/OCR, latensi, dan biaya; mudah diganti.

Alternatif (ubah `OPENROUTER_VLM_MODEL` di `.env`):
- `google/gemini-2.5-pro` — lebih kuat, biasanya lebih mahal/lambat.
- `google/gemini-3-flash-preview` — lebih baru (preview; ketersediaan/ID bisa berubah).
- `qwen/qwen3-vl-235b-a22b-instruct` — VLM kuat, klaim OCR multibahasa.
- `anthropic/claude-sonnet-4.6` — vision kuat, biaya lebih tinggi.
- `openai/gpt-4o` — vision umum kuat.

> Catatan: “terbaik” tergantung akurasi plat Indonesia outdoor, latensi gate, dan biaya. Validasi dengan dataset/foto nyata (siang/malam/hujan/sudut miring) sebelum produksi; sediakan fallback manual/petugas (lihat backlog E10-S4, E3-S6).

## Ringkasan alur MVP
1. Booking dari rumah (fakultas, zona, ETA, ETD) → dapat **QR/barcode sesi**.
2. **Gate masuk**: scan QR/barcode sesi + **VLM baca plat** (sesi terkunci ke plat) → palang terbuka. *Telat > 10 menit dari ETA → booking hangus, slot terbuka* (kebijakan).
3. **Zona**: scan **QR zona** → konfirmasi sudah parkir.
4. **Zona (mau pulang)**: scan **QR zona** → mulai checkout → **bill**.
5. **Bayar di app** (bukan di gate): normal **Rp2.000**; overstay → **violation** + **Rp2.000 + Rp1.000** (kebijakan).
6. Lunas → dapat **QR/barcode keluar**.
7. **Gate keluar**: **VLM verifikasi plat** cocok + scan QR/barcode keluar → palang terbuka.

## Dokumen
- [User Story Lengkap](docs/user-story.md)
- [Product Backlog Lengkap](docs/backlog.md)
- [BRD — Business Requirements Document](docs/brd.md)

## Catatan penting
- `.env` berisi `OPENROUTER_API_KEY` — jangan commit/publish. Panggilan OpenRouter dilakukan lewat **`server/` proxy**, bukan dari browser.
- Integrasi Supabase, gate controller, kamera, dan payment gateway belum diimplementasi (lihat backlog).
- Hukuman fisik otomatis berisiko; MVP mengutamakan validasi sistem, verifikasi plat, audit, dan konsekuensi kebijakan yang aman.
