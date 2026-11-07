# Gate Kiosk (`gate/`)

Terminal kamera di pintu masuk/keluar. React 19 + Vite 7 + TypeScript, `jsQR` untuk QR dan `onnxruntime-web` untuk deteksi plat lokal. Dev: `http://localhost:5175` (`npm run dev`, atau `npm run dev:gate` dari root).

## Alur kamera (satu tarikan, tanpa klik dua kali)

```text
Kamera aktif terus
   │  jsQR menemukan QR
   ▼
1. Scan QR  ──► QR sesi (masuk) / QR keluar (keluar)
   │            pipeline otomatis lanjut
   ▼
2. Capture burst frame (3 frame, 2 bila percobaan ulang)
   ▼
3. Deteksi plat lokal (ONNX) + crop
   ▼
4. POST /api/vlm/plate/consensus  ──► plate + confidence
   ▼
5. POST /api/gates/entry | /api/gates/exit  (QR + plate)
   ▼
6. Palang terbuka HANYA setelah plat tersimpan & sesi lolos verifikasi
```

- Tidak ada tombol kedua; QR memicu pembacaan plat secara sekuensial.
- Tombol **Scan ulang** tersedia setelah hasil.
- Mode masuk/keluar dipilih di layar kiosk.

## Token perangkat

- Layar awal meminta `GATE_API_TOKEN`.
- Disimpan di `localStorage` (`smart_parking_gate_token`) atau dari `VITE_GATE_TOKEN` saat build.
- Dikirim sebagai `Authorization: Bearer` ke `/api/gates/*` dan `/api/vlm/*`.

## Telemetri kualitas kamera

- Setiap capture mengirim skor kualitas (ketajaman Laplacian, kecerahan, kontras) ke `POST /api/gates/<gateId>/quality`.
- Skor terakhir tampil sebagai chip di layar kiosk.
- Data ini muncul di analitik admin sebagai tren/EWMA per gate.

## Endpoint yang dipakai

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/gates/entry` | Verifikasi QR masuk + plat, set `ENTERED` |
| POST | `/api/gates/exit` | Verifikasi QR keluar + plat, set `COMPLETED` |
| POST | `/api/vlm/plate/consensus` | Kirim beberapa frame, terima plat hasil voting |
| POST | `/api/gates/:id/quality` | Kirim metrik kualitas frame |
| GET | `/api/events` | SSE status gate/sesi |

`API_BASE` memakai `http://127.0.0.1:8788` saat dev di port 5175.

## Model lokal

```text
gate/public/models/
├── plate_detector_yolo11n.onnx
└── plate_recognizer_yolo11n.onnx
```

Dimuat sekali saat aplikasi siap; kamera tidak aktif jika model gagal dimuat (pesan error di layar).

## Struktur

```text
gate/src/
├── App.tsx          # state layar, loop kamera, pipeline QR → VLM → gate
├── plateDetector.ts # load ONNX, detectPlate, cropPlate, recognizePlate
├── styles.css       # tema terang, kiosk auth, quality chip
└── main.tsx
gate/public/         # model ONNX, logo, manifest, service worker
```

## Kebutuhan browser

- Kamera butuh HTTPS atau `localhost`.
- Izin kamera harus diberikan; kiosk sebaiknya dijalankan fullscreen.
- `jsQR` bekerja pada frame canvas; pencahayaan cukup penting untuk hasil stabil.

## Build

```bash
npm run build
```
