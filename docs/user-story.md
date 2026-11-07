# User Story — Smart Parking Kampus

## 1. Konteks & masalah
Kampus memiliki area parkir **lapangan outdoor** dengan banyak **fakultas/zona**. Sistem yang ada saat ini menyediakan **counter jumlah slot kosong**, namun pengguna masih mengalami kendala:
- Tidak tahu **di zona/posisi mana** slot kosong tersedia, sehingga harus berkeliling.
- Setiap pengguna cenderung ingin parkir di **zona dekat fakultasnya** masing-masing.

Solusi yang diusulkan adalah aplikasi **booking online parkir** berbasis zona dengan alur QR di gate/zona, pembayaran di aplikasi (bukan di gate), serta **AI (VLM)** untuk pembacaan dan verifikasi **plat nomor** kendaraan.

## 2. Tujuan produk (MVP)
- Memberi kepastian tempat parkir berbasis **zona dan fakultas tujuan**.
- Memungkinkan pengguna **booking dari rumah** dan mendapatkan bukti sesi (QR/barcode).
- Mengaktifkan sesi masuk/keluar melalui **QR** dan **gate**.
- Mengunci sesi parkir ke **plat nomor kendaraan** menggunakan **VLM** (gate masuk) dan memverifikasi kecocokan saat keluar (gate keluar).
- Menangani pembayaran di aplikasi (**QRIS** dan opsi lain), bukan di gate.
- Menerapkan aturan waktu (keterlambatan datang, overstay), **violation**, serta **loyalty reward**.
- Menyediakan fondasi data untuk fitur **AI rekomendasi/prediksi**.

## 3. Persona / aktor
| Aktor | Deskripsi | Kebutuhan utama |
|---|---|---|
| Mahasiswa/Dosen/Staf (Pengguna) | Parkir rutin di kampus, target zona dekat fakultas | Booking mudah, kepastian zona, masuk/keluar cepat, bayar non-tunai |
| Sistem Smart Parking | Aplikasi + backend + integrasi gate/kamera | Validasi sesi, kuota, pembayaran, QR, audit, aturan bisnis |
| Kamera + VLM (AI) | Perangkat di gate masuk/keluar | Baca plat nomor, kunci sesi, verifikasi kecocokan |
| Gate Controller (Palang) | Palang masuk/keluar | Buka/tutup berdasarkan validasi sistem |
| Petugas Parkir/Admin (opsional) | Pengelola lapangan | Monitor, penanganan pengecualian, laporan pelanggaran |
| Admin Kampus/Kebijakan (pemangku kepentingan) | Penentu aturan | Tarif, sanksi, privasi, operasional |

## 4. Definisi istilah
| Istilah | Arti |
|---|---|
| Zona | Area parkir yang dipetakan (mis. dekat Fakultas Teknik), memiliki kuota/ketersediaan. |
| Sesi parkir | Satu siklus parkir pengguna: booking → masuk → parkir terkonfirmasi → checkout → bayar → keluar. |
| QR/Barcode Sesi | Kode bukti sesi didapat dari rumah; dipakai di **gate masuk**. |
| QR Zona | Kode fisik di palang/tiang zona; dipakai untuk konfirmasi parkir & menandai mulai checkout. |
| QR/Barcode Keluar | Kode keluar (sekali pakai, TTL singkat) diterbitkan **setelah pembayaran lunas**; dipakai di **gate keluar**. |
| VLM | *Vision-Language Model*/model visi AI untuk membaca/memahami gambar; dalam MVP dipakai untuk membaca/verifikasi **plat nomor**. |
| ETA/ETD | Estimasi waktu datang / estimasi waktu keluar. |
| Overstay | Keluar lebih lambat dari ketentuan (ETD + grace). |
| Violation | Pelanggaran tercatat (no-show/telat datang hangus, overstay, mismatch, abuse). |

## 5. Asumsi & keputusan terbuka
> Harus dikunci sebelum implementasi final.

- **Platform:** **web-based saja** (responsive). Aplikasi menyediakan opsi **unduh/tambah shortcut ke layar utama** (installable/PWA, *Add to Home Screen*); bukan native app terpisah di MVP.
- **Granularitas:** booking per **zona/kuota** (MVP), bukan nomor slot individual — kecuali infrastruktur mendukung.
- **Pembayaran:** dilakukan di aplikasi saat **checkout (sebelum terbit QR keluar)**, **bukan di gate**. Metode termasuk **QRIS**.
- **Tarif:** normal **Rp2.000** (statis). Overstay → **violation** + **Rp2.000 + Rp1.000**. *Definisi final:* apakah Rp1.000 adalah denda tambahan (total dibayar saat checkout = 2000 + 1000 bila overstay) — perlu konfirmasi; grace overstay (menit) juga perlu dikunci.
- **Telat datang:** > **10 menit** dari ETA → booking/sesi hangus, slot kembali terbuka. *Kebijakan refund/kompensasi (jika ada pembayaran di fase lain) dikunci terpisah; pada alur ini pembayaran utama terjadi saat checkout keluar.*
- **Identitas pengguna:** NIM/SSO kampus, nomor HP OTP, atau akun — memengaruhi anti-abuse, loyalty, dan pembayaran.
- **Integrasi gate/kamera:** ketersediaan hardware, API controller, penempatan kamera, mode offline/fallback petugas.
- **Privasi/retensi:** rekaman/hasil OCR plat, durasi simpan, akses audit, kepatuhan kebijakan kampus.
- **Akurasi VLM:** kondisi outdoor (malam/hujan/kotor/sudut) → perlu fallback dan metrik evaluasi.

## 6. Alur utama (end-to-end)

### US-01 — Booking dari rumah & terbit QR/barcode sesi
**Sebagai** pengguna, **saya ingin** memesan tempat parkir dari rumah berdasarkan fakultas tujuan, **agar** saya mendapat kepastian zona dan bukti sesi parkir.

**Alur:**
1. Pengguna memilih **fakultas tujuan**.
2. Sistem menampilkan **zona parkir** relevan (prioritas dekat fakultas) dengan status ketersediaan.
3. Pengguna mengisi **ETA** dan **ETD**.
4. Pengguna mengonfirmasi booking.
5. Sistem menerbitkan **QR/barcode sesi** sebagai bukti sesi parkir hari itu.

**Acceptance Criteria (AC):**
- AC1: Pengguna hanya dapat memilih zona yang aktif dan memiliki kuota sesuai aturan.
- AC2: Booking menyimpan fakultas, zona, ETA, ETD, status, dan identitas pengguna/sesi.
- AC3: QR/barcode sesi unik, terikat ke booking, dan memiliki masa berlaku/kontrol penggunaan.
- AC4: Jika kuota habis pada window waktu, sistem menolak/mengusulkan zona alternatif.

### US-02 — Masuk gate: scan QR/barcode sesi + VLM baca plat
**Sebagai** pengguna, **saya ingin** scan QR/barcode sesi di gate masuk agar palang terbuka; **sebagai sistem**, saya ingin membaca plat nomor untuk mengunci sesi ke kendaraan.

**Alur:**
1. Pengguna scan **QR/barcode sesi** di **gate masuk**.
2. Sistem memvalidasi sesi (ada, valid, belum hangus/selesai, sesuai aturan waktu).
3. **VLM di gate masuk** membaca plat nomor dari rekaman/foto kamera.
4. Jika valid: **palang terbuka**, waktu masuk tercatat, sesi **terkunci ke plat nomor**.
5. Jika plat tidak terbaca: sistem menjalankan fallback (foto ulang/input manual terverifikasi/petugas) dan mencatat audit.

**AC:**
- AC1: Sesi invalid/hangus/duplikat ditolak dengan pesan/aksi yang jelas; gate tidak terbuka.
- AC2: Plat nomor (hasil VLM/fallback) tersimpan pada sesi aktif.
- AC3: Kejadian masuk (waktu, gate, hasil VLM, confidence bila ada) tercatat di audit log.
- AC4: **Telat > 10 menit dari ETA** (jika kebijakan aktif) → sesi hangus, slot/kuota kembali tersedia.

### US-03 — Konfirmasi parkir di zona
**Sebagai** pengguna, **saya ingin** scan QR zona setelah parkir, **agar** sistem mengonfirmasi saya sudah parkir di zona yang benar.

**Alur:**
1. Pengguna parkir di zona.
2. Pengguna scan **QR zona**.
3. Sistem memvalidasi kecocokan sesi/zona dan mencatat status **parkir terkonfirmasi**.

**AC:**
- AC1: Scan QR zona yang tidak sesuai sesi/zona menghasilkan peringatan/penolakan sesuai aturan.
- AC2: Status sesi berubah ke `PARKED_CONFIRMED` (atau setara) dengan timestamp.
- AC3: Konfirmasi zona tercatat untuk audit dan analitik.

### US-04 — Mulai checkout dari zona & terima bill
**Sebagai** pengguna, **saya ingin** scan QR zona saat mau pulang untuk memulai checkout, **agar** saya menerima tagihan yang benar.

**Alur:**
1. Pengguna scan **QR zona** lagi untuk menandai **mulai checkout**.
2. Sistem menghitung durasi/ketepatan waktu terhadap ETD (+ grace) dan menghasilkan **bill**.
3. Bill ditampilkan di aplikasi.

**AC:**
- AC1: Sistem membedakan **normal** vs **overstay** berdasarkan aturan waktu.
- AC2: Bill normal: **Rp2.000**. Bill overstay: **Rp2.000 + Rp1.000** (dan violation tercatat) — sesuai definisi final.
- AC3: Bill terkait sesi, plat, zona, waktu masuk/checkout, dan status pembayaran.

### US-05 — Bayar di aplikasi (bukan di gate)
**Sebagai** pengguna, **saya ingin** membayar bill dari aplikasi (termasuk dari posisi parkir), **agar** saya tidak perlu membayar di palang gate keluar.

**Alur:**
1. Pengguna memilih metode pembayaran (**QRIS**/opsi lain).
2. Sistem memproses pembayaran via provider dan menerima konfirmasi (webhook/callback) yang diverifikasi.
3. Status bill/sesi menjadi **lunas**.

**AC:**
- AC1: Pembayaran tidak dilakukan di gate; gate keluar hanya validasi akses.
- AC2: Konfirmasi pembayaran idempotent dan aman (signature/validasi provider).
- AC3: Kegagalan/pending ditangani jelas; QR keluar tidak terbit sebelum lunas (kebijakan *hard block* default untuk MVP).

### US-06 — Terbit QR/barcode keluar & buka gate keluar dengan verifikasi VLM
**Sebagai** pengguna, **saya ingin** mendapat QR/barcode keluar setelah bayar dan membuka gate dengan mudah; **sebagai sistem**, saya ingin memastikan kendaraan yang keluar sesuai sesi.

**Alur:**
1. Setelah lunas, sistem menerbitkan **QR/barcode keluar** (sekali pakai, TTL singkat).
2. Pengguna menuju **gate keluar** dan scan QR/barcode keluar.
3. **VLM di gate keluar** membaca plat nomor.
4. Sistem memverifikasi: **plat cocok** dengan sesi + **QR keluar valid** + **lunas**.
5. Jika valid: **palang gate keluar terbuka**, sesi selesai, kuota dikembalikan.
6. Jika tidak valid/mismatch: gate tidak terbuka; alur pengecualian/petugas; insiden tercatat.

**AC:**
- AC1: QR keluar tidak dapat dipakai ulang (replay protection) dan kedaluwarsa sesuai TTL.
- AC2: Mismatch plat atau QR invalid menghasilkan penolakan + audit; opsi penanganan petugas tersedia.
- AC3: Sesi selesai menyimpan waktu keluar, gate, hasil verifikasi, dan status akhir.

### US-07 — Overstay & violation
**Sebagai** pengelola, **saya ingin** overstay dikenai violation dan biaya sesuai aturan, **agar** penggunaan slot adil.

**AC:**
- AC1: Overstay terdeteksi berdasarkan ETD + grace (parameter kebijakan).
- AC2: Bill overstay = **Rp2.000 + Rp1.000** (definisi final dikunci) dan violation tercatat.
- AC3: Riwayat violation dapat dilihat admin dan memengaruhi reputasi/loyalty sesuai kebijakan.

### US-08 — Pencegahan penyalahgunaan & sanksi
**Sebagai** pengelola, **saya ingin** mencegah pengguna mengambil/memakai sesi/slot secara tidak sah, **agar** sistem adil.

**AC:**
- AC1: Sesi terkunci ke plat nomor (VLM) dan divalidasi di gate keluar.
- AC2: Indikasi abuse (QR sharing mencurigakan, mismatch berulang, manipulasi status) menghasilkan flag/violation.
- AC3: Konsekuensi bersifat kebijakan (peringatan, strike, pembatasan booking) dan terdokumentasi; tidak ada aksi fisik berbahaya otomatis.

### US-09 — Loyalty reward
**Sebagai** pengguna kooperatif, **saya ingin** mendapat reward, **agar** saya termotivasi mematuhi aturan.

**AC:**
- AC1: Perilaku positif (tepat waktu, konfirmasi zona, checkout/bayar tertib, tanpa violation) menghasilkan poin/reward.
- AC2: Aturan poin transparan dan dapat diaudit (ledger).
- AC3: Manfaat reward tidak merusak fairness (mis. tidak memonopoli kuota secara tidak adil).

### US-10 — Rekomendasi/prediksi AI
**Sebagai** pengguna, **saya ingin** rekomendasi zona/waktu berbasis AI, **agar** saya lebih mudah parkir dekat fakultas tujuan.

**AC:**
- AC1: Sistem memberi rekomendasi zona berdasarkan fakultas, waktu/ETA, dan ketersediaan/historis.
- AC2: Sumber data dan logika rekomendasi terdokumentasi (model/rule) untuk evaluasi.
- AC3: (Lanjutan) prediksi ketersediaan/risiko overstay/no-show dari data historis.

### US-11 — Admin/petugas monitoring & pengecualian
**Sebagai** petugas/admin, **saya ingin** memantau sesi, gate, dan menangani pengecualian, **agar** operasional tetap berjalan saat ada kegagalan.

**AC:**
- AC1: Dashboard melihat status zona, sesi aktif, antrian masuk/keluar, bill, violation.
- AC2: Petugas dapat menangani kasus: VLM gagal baca, mismatch, pembayaran bermasalah, gate error — dengan audit trail.
- AC3: Mode fallback aman (manual override tercatat) tersedia.

## 7. Status sesi (state machine usulan)
```text
DRAFT/BOOKED
  -> ISSUED (QR sesi terbit)
  -> ENTERED (scan gate masuk + VLM plat OK)        [atau EXPIRED jika telat > 10 menit]
  -> PARKED_CONFIRMED (scan QR zona)
  -> CHECKOUT_REQUESTED (scan QR zona mulai checkout, bill terbit)
  -> PAID (pembayaran lunas)
  -> EXIT_VERIFIED (VLM plat cocok + QR keluar valid)
  -> COMPLETED

Cabang: EXPIRED, CANCELLED, NO_SHOW, VIOLATION_FLAGGED, EXCEPTION (petugas)
```
*Status final dikunci saat desain teknis; transisi harus atomic dan tercatat.*

## 8. Non-functional stories (ringkas)
- **Platform/UX:** web-based responsif (mobile-first), dapat dipasang sebagai **shortcut/installable PWA** dari browser.
- **Keamanan:** QR sekali pakai/TTL, verifikasi server-side, idempotensi webhook, proteksi replay, audit log.
- **Privasi:** minimisasi data plat/rekaman, retensi terbatas, akses berbasis peran.
- **Keandalan:** fallback saat VLM/kamera/gate/offline gagal; tidak ada aksi gate yang membahayakan.
- **Performa:** validasi gate responsif; update ketersediaan near real-time.
- **Auditability:** semua transisi sesi, pembayaran, verifikasi, override tercatat.