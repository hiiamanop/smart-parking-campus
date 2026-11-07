# Driver App (`client/`)

Aplikasi web mobile untuk pengemudi. React 19 + Vite 7 + TypeScript, PWA installable. Dev: `http://localhost:5174` (`npm run dev` di folder ini, atau `npm run dev:client` dari root).

## Dua tab

1. **Cari slot**
   - Ringkasan ketersediaan + pencarian.
   - Pilih jenis kendaraan (motor/mobil) → daftar zona difilter sesuai jenis.
   - Pilih domain sebagai filter.
   - Booking: pilih zona, isi **ETA** (tidak ada plat, tidak ada ETD), konfirmasi.
2. **Tiket** (tab kanan)
   - Sesi aktif pengemudi dengan QR dan status.

## Isi halaman tiket per status

| Status | Yang ditampilkan |
|---|---|
| `BOOKED` | Kode sesi `SP-…`, QR masuk, hitung mundur berlaku (15 menit dari ETA), tombol batal, kotak "Salah pilih zona?" |
| `ENTERED` | Kode sesi, input kode QR zona untuk konfirmasi parkir, kotak ganti zona (sekali) |
| `PARKED_CONFIRMED` | Tombol **Lanjut ke pembayaran** (checkout tanpa scan QR zona) |
| `CHECKOUT_REQUESTED` | Rincian tagihan + tombol bayar |
| `PAID` | QR keluar `OUT-…` + hitung mundur 20 menit. Bila kedaluwarsa: tombol **Bayar denda Rp20.000 & terbitkan QR keluar baru** |
| `EXPIRED` | Booking hangus; mulai booking baru |

## Aturan yang terlihat di UI

- **QR masuk** kedaluwarsa 15 menit setelah ETA → booking hangus, kuota kembali.
- **QR keluar** kedaluwarsa 20 menit setelah pembayaran; QR baru berbayar denda Rp20.000 dari HP.
- **Konfirmasi zona** hanya untuk zona yang dipesan. Salah scan pertama = peringatan; kedua = pelanggaran tercatat (pesan berbeda).
- **Ganti zona**: bebas sebelum masuk gate; setelah masuk gate hanya **satu kali** ("Salah pilih zona?").
- **Batal booking** hanya sebelum masuk gate.
- Pembayaran **tidak** memerlukan scan QR zona.

## Alur data

```text
GET  /api/zones                       daftar domain + zona + okupansi
POST /api/bookings                    buat booking (domainId, zoneId, userName, vehicleType, eta)
GET  /api/sessions/:code              polling status sesi
POST /api/zones/scan                  konfirmasi zona (kode CAMPUS-ZONE-<id> atau id zona)
POST /api/bookings/change-zone        pindah zona
POST /api/bookings/cancel             batalkan booking
POST /api/payments/checkout           mulai checkout (tanpa scan)
POST /api/payments/pay                bayar → QR keluar
POST /api/payments/reissue            QR keluar baru (+ denda bila kedaluwarsa)
```

Live update lewat SSE `GET /api/events`; sesi aktif juga dipulihkan dari `localStorage` (`smart_parking_driver_real_session`).

## Catatan dev

- Saat dibuka di `:5174` (Vite dev), app memanggil `http://127.0.0.1:8788` langsung (`API_BASE`) karena proxy dev bisa menyajikan HTML untuk `/api`. Build produksi tetap same-origin.
- Service worker di-unregister saat dev agar tidak menyajikan chunk lama.
- Logo header: `/lencana-parkir-pintar.png`.

## Struktur

```text
client/src/
├── App.tsx        # tab, booking sheet, tiket, aksi sesi
├── main.tsx
├── styles.css     # layout mobile, bottom nav, kartu tiket
└── types.ts
client/public/     # logo, manifest, service worker, ikon PWA
```

## Build

```bash
npm run build
```
