# Admin Dashboard (`app/`)

Dashboard operator Smart Parking Kampus. React 19 + Vite 7 + TypeScript strict. Dev: `http://localhost:5173` (`npm run dev` di folder ini, atau `npm run dev:admin` dari root).

## Halaman (hash route)

Navigasi memakai hash URL, jadi back/forward dan deep-link browser bekerja:

| Hash | Menu | Isi |
|---|---|---|
| `#/overview` | Ringkasan | 6 KPI, hunian zona, keuangan hari ini + 7 hari, jam sibuk, aktivitas domain, kualitas kamera gate, sesi aktif terbaru. Auto-refresh 20 detik |
| `#/domains` | Domain | CRUD domain parkir |
| `#/zones` | Zona parkir | CRUD zona (domain, jenis kendaraan, kapasitas, gate), detail sesi aktif per zona |
| `#/qr-signs` | QR zona | QR per zona, filter domain, cetak per kartu ukuran F5 (215×330 mm) |
| `#/analytics` | Analitik | Prioritas perawatan preventif, kualitas kamera, keuangan, aktivitas domain, jam sibuk, filter rentang tanggal |
| `#/sessions` | Sesi & kendaraan | Sesi aktif + filter tanggal/status, auto-refresh 15 detik |
| `#/logs` | Audit log | Riwayat event Redis + aliran live SSE, filter tanggal |
| `#/vlm` | Uji VLM | Uji baca plat langsung ke OpenRouter |
| `#/profile` | Profil | Nama tampilan, peran, token (masked), logout |

Tab terakhir juga disimpan di `localStorage` (`smart_parking_admin_tab`).

## Login & token

1. Saat dibuka, app memanggil `/api/auth/status`.
2. Jika `adminTokenRequired` dan belum ada token → halaman login.
3. Token dikirim sebagai `Authorization: Bearer <token>` untuk semua `/api/admin/*` dan mutasi domain/zona.
4. Token disimpan di `localStorage` (`smart_parking_admin_token`). Logout menghapusnya.

Jika server tidak mengisi `ADMIN_API_TOKEN` (mode dev), app langsung masuk.

## Asisten operator (chatbot)

Tombol ikon Ganesha di kanan bawah (`src/components/admin/OperatorAssistant.tsx`).

- Chat dikirim ke `POST /api/admin/assistant` (butuh token admin).
- Server menyusun snapshot data live (domain, zona, sesi aktif, KPI hari ini) lalu memanggil model `OPENROUTER_VLM_MODEL`.
- Model **hanya mengusulkan** aksi: `create_domain`, `update_domain`, `delete_domain`, `create_zone`, `update_zone`, `delete_zone`, `cancel_booking`, `reissue_exit`.
- Aksi dieksekusi setelah operator klik **Terapkan**; eksekusi lewat endpoint admin biasa (validasi sama). **Batal** membuang usulan.
- Balasan model dilarang Markdown; UI tetap merapikan `-` menjadi bullet dan `**teks**` menjadi tebal.
- Riwayat chat hanya di memori tab (tidak dipersist).

## Analitik

Sumber: `GET /api/admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` (rentang inklusif).

- **Prioritas perawatan** = 55% volume aktivitas + 30% override manual + 15% mismatch plat. Skor menentukan prioritas (`tinggi`/`sedang`/`rendah`) dan interval cek.
- **Keuangan**: total pendapatan, denda, pembayaran, rata-rata, per kendaraan, per zona, per domain, batang 7 hari. Tabel dibatasi 6 baris + scroll.
- **Kualitas kamera gate**: skor ketajaman, kecerahan, kontras (EWMA + tren).
- **Jam sibuk**: 24 batang, tooltip hover berisi jumlah aktivitas.
- Okupansi selalu kondisi saat ini; angka periode mengikuti filter tanggal.

## QR zona

- Payload QR: `CAMPUS-ZONE-<zoneId>`.
- Filter per domain.
- Cetak satu kartu lewat iframe terisolasi (dialog cetak tidak membawa dashboard), `@page { size: 215mm 330mm; margin: 10mm }`.
- Grid dibatasi tinggi 2 baris; lebih dari itu bisa di-scroll. Aturan cetak melepas batas tersebut.
- Logo header: `/lencana-parkir-pintar.png` (turunan `assets/Lencana Parkir Pintar ITB.png`).

## Struktur

```text
app/src/
├── App.tsx                     # shell, sidebar, hash router, auth gate, SSE
├── components/
│   ├── LoginPage.tsx
│   ├── QrImage.tsx
│   ├── VlmTestView.tsx
│   └── admin/
│       ├── OverviewPanel.tsx
│       ├── DomainManager.tsx
│       ├── ZoneManager.tsx
│       ├── ZoneQRGenerator.tsx
│       ├── AnalyticsPanel.tsx
│       ├── SessionMonitor.tsx
│       ├── LiveEventLog.tsx
│       ├── OperatorAssistant.tsx
│       └── ProfilePanel.tsx
├── lib/api.ts                  # adminFetch + semua endpoint + aksi asisten
├── types.ts                    # Domain, Zone, ParkingSession, Analytics
└── styles.css                  # palet ITB, komponen, print F5
```

## Catatan implementasi

- `adminFetch` menyisipkan bearer token dan melempar `AuthError` pada 401/403.
- Event live dari SSE memperbarui daftar dominio/zona tanpa reload.
- PWA: `public/manifest.webmanifest` + `sw.js`.

## Build

```bash
npm run build     # tsc -p tsconfig.json && vite build
npm run typecheck
```
