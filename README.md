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
├── .env                 # konfigurasi lokal (ISI API key; jangan commit)
├── .env.example         # template env
├── .gitignore
├── README.md
├── docs/
│   ├── user-story.md
│   ├── backlog.md
│   └── brd.md
├── server/              # proxy lokal OpenRouter VLM (API key tetap di server)
│   ├── package.json
│   └── server.mjs
└── app/                 # web app (Vite + React + TS, PWA)
    ├── public/          # manifest, icon, service worker
    └── src/
        └── lib/vlm.ts   # client ke proxy /api/vlm/plate
```

## Setup cepat
1. Isi API key OpenRouter:
   ```bash
   # edit file .env
   OPENROUTER_API_KEY=isi_key_openrouter_anda
   OPENROUTER_VLM_MODEL=google/gemini-2.5-flash
   ```
   Template lengkap: `.env.example`. **Jangan commit `.env`.**

2. Jalankan proxy VLM (terminal 1):
   ```bash
   cd smart-parking/server
   node server.mjs
   # cek: http://127.0.0.1:8788/health
   ```

3. Jalankan web app (terminal 2):
   ```bash
   cd smart-parking/app
   npm install
   npm run dev
   # buka: http://localhost:5173
   ```

4. Uji VLM: di web app, upload foto plat/kendaraan → “Baca plat (VLM)”. Proxy meneruskan gambar ke OpenRouter (model dari `.env`) dan mengembalikan JSON (`plate`, `confidence`, dll.).

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
