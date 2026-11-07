# BRD — Business Requirements Document
**Proyek:** Smart Parking Kampus  
**Versi:** 0.1 (Draft)  
**Tanggal:** 2026-11-07  
**Status:** Draft untuk diskusi & validasi pemangku kepentingan

## 1. Ringkasan eksekutif
Smart Parking Kampus adalah aplikasi **booking online parkir** untuk area parkir **lapangan outdoor** kampus yang memiliki banyak **fakultas/zona**. Saat ini pengguna hanya melihat **counter ketersediaan total** tanpa panduan lokasi slot/zona kosong, sehingga sering berkeliling dan kesulitan parkir dekat fakultas tujuan.

Solusi MVP memungkinkan pengguna **booking dari rumah** (fakultas, zona, ETA/ETD), memperoleh **QR/barcode sesi** untuk masuk, melakukan konfirmasi di zona, checkout & pembayaran di aplikasi (**QRIS**, bukan di gate), serta keluar menggunakan **QR/barcode keluar** di gate. **AI (VLM)** digunakan di **gate masuk** dan **gate keluar** untuk membaca/memverifikasi **plat nomor** agar sesi parkir terkunci dan terverifikasi ke kendaraan yang benar.

## 2. Latar belakang & masalah bisnis
| Aspek | Kondisi saat ini | Dampak |
|---|---|---|
| Informasi ketersediaan | Ada counter total, tidak ada panduan lokasi/zona kosong | Waktu cari parkir lama, sirkulasi kendaraan meningkat |
| Preferensi lokasi | Banyak fakultas; pengguna ingin dekat fakultas masing-masing | Ketidakpuasan, ketidakteraturan distribusi parkir |
| Kontrol sesi | Belum ada alur booking/check-in/out terintegrasi | Sulit jamin hak parkir, sulit ukur kepatuhan |
| Pembayaran/penertiban | Belum terdefinisi dalam alur digital terintegrasi (sesuai kebutuhan baru) | Potensi overstay, sengketa, rendahnya disiplin |

## 3. Tujuan bisnis
1. Mengurangi waktu pengguna mencari parkir dengan kepastian **zona/fakultas**.
2. Menyediakan proses parkir digital yang tertib: **booking → masuk → konfirmasi zona → checkout → bayar → keluar**.
3. Meningkatkan kepatuhan melalui aturan waktu, **violation**, dan **loyalty reward**.
4. Menyediakan data operasional (okupansi, transaksi, kepatuhan, verifikasi plat) untuk pengambilan keputusan.
5. Mendemonstrasikan pemanfaatan **AI (VLM)** dalam verifikasi kendaraan.

## 4. Ruang lingkup

### 4.1 In-scope (MVP target)
- **Aplikasi web-based saja** (responsive, mobile-first) dengan kemampuan **unduh/tambah shortcut ke layar utama** (installable/PWA, *Add to Home Screen*); bukan native app terpisah di MVP.
- Master data fakultas, zona, kapasitas, aturan/tarif, QR zona.
- Booking dari rumah (fakultas, zona, ETA, ETD) dan penerbitan **QR/barcode sesi**.
- **Gate masuk:** scan QR/barcode sesi; **VLM baca plat**; kunci sesi ke plat; buka palang (integrasi/simulator).
- Konfirmasi parkir di zona via **scan QR zona**.
- Mulai checkout via **scan QR zona**; penerbitan **bill**.
- Pembayaran di aplikasi (**QRIS** dan opsi lain), **bukan di gate**.
- Penerbitan **QR/barcode keluar** setelah lunas.
- **Gate keluar:** **VLM verifikasi plat** + validasi QR keluar + status lunas; buka palang.
- Aturan: **telat datang > 10 menit** → hangus/slot terbuka (kebijakan); **overstay** → **violation** + **Rp2.000 + Rp1.000** (definisi final dikunci).
- Audit log, penanganan pengecualian dasar, dashboard operasional minimal.
- Fondasi **loyalty/violation** dan **rekomendasi AI** (minimal rule-based/historis).

### 4.2 Out-of-scope (sementara, dapat menjadi fase berikutnya)
- Navigasi turn-by-turn ke slot individual presisi tinggi.
- Deteksi okupansi otomatis per slot seluruh lapangan (CV skala penuh) kecuali pilot terbatas.
- Reservasi slot bernomor individual (kecuali zona/marking mendukung).
- Integrasi SSO kampus kompleks, sistem keuangan kampus penuh, atau *refund* otomatis kompleks (kecuali disepakati).
- Dynamic pricing kompleks.
- Penegakan fisik berbahaya/penguncian kendaraan otomatis.

## 5. Pemangku kepentingan
| Pemangku kepentingan | Peran/kepentingan | Pengaruh |
|---|---|---|
| Pengguna (mhs/dosen/staf) | Pengguna utama | Tinggi |
| Pengelola parkir/petugas | Operasional harian, pengecualian | Tinggi |
| Unit IT kampus | Infrastruktur, integrasi, keamanan | Tinggi |
| Pimpinan/fakultas | Kebijakan zona, adopsi | Sedang–Tinggi |
| Vendor gate/kamera/payment | Integrasi teknis | Sedang |
| Tim pengembang/data/AI | Implementasi & evaluasi | Tinggi |

## 6. Kebutuhan bisnis (high-level)
| ID | Kebutuhan | Prioritas | Kriteria keberhasilan |
|---|---|---:|---|
| BR-01 | Pengguna dapat booking berdasarkan fakultas & zona | P0 | Booking berhasil dan menghasilkan QR/barcode sesi |
| BR-02 | Pengguna dapat masuk gate dengan QR sesi yang valid | P0 | Validasi benar; gate buka saat valid |
| BR-03 | Sesi dikunci ke plat nomor via VLM di gate masuk | P0 | Plat terekam/terkait sesi; fallback tersedia |
| BR-04 | Pengguna mengonfirmasi parkir di zona via QR zona | P0 | Status parkir terkonfirmasi tercatat |
| BR-05 | Pengguna memulai checkout via QR zona dan menerima bill | P0 | Bill akurat sesuai aturan |
| BR-06 | Pengguna membayar di app (QRIS, bukan gate) | P0 | Pembayaran terkonfirmasi; idempotent |
| BR-07 | Pengguna mendapat QR keluar setelah lunas dan gate keluar terbuka | P0 | Akses keluar hanya saat syarat terpenuhi |
| BR-08 | Plat diverifikasi VLM di gate keluar terhadap sesi | P0 | Mismatch terdeteksi dan ditangani aman |
| BR-09 | Aturan telat datang/overstay/violation diterapkan | P0 | Hangus >10 menit (kebijakan), denda overstay benar |
| BR-10 | Tersedia audit, monitoring, dan penanganan pengecualian | P1 | Petugas/admin dapat menindak insiden |
| BR-11 | Loyalty reward untuk pengguna kooperatif | P1 | Poin diberikan sesuai aturan |
| BR-12 | AI membantu rekomendasi/prediksi | P1 | Rekomendasi tampil dan dapat dievaluasi |

## 7. Aturan bisnis utama (draft, perlu konfirmasi)
| Kode | Aturan | Nilai/Parameter (draft) |
|---|---|---|
| RB-01 | Tarif parkir normal (statis) | **Rp2.000** |
| RB-02 | Overstay (keluar lebih lambat dari ketentuan) | **Violation** + **Rp2.000 + Rp1.000** (definisi final: total kewajiban saat overstay) |
| RB-03 | Grace keterlambatan kedatangan (ETA) | **> 10 menit** → sesi/booking hangus, kuota terbuka |
| RB-04 | Grace overstay setelah ETD | **TBD** (mis. 10–15 menit) — dikunci kebijakan |
| RB-05 | Waktu pembayaran | Saat **checkout di app**, **bukan di gate** |
| RB-06 | Metode pembayaran | Termasuk **QRIS** (+ opsi lain sesuai integrasi) |
| RB-07 | Syarat terbit QR keluar | Pembayaran **lunas** + sesi valid (kebijakan default *hard block*) |
| RB-08 | Syarat buka gate keluar | QR keluar valid + verifikasi **plat cocok (VLM)** + status lunas/sesuai kebijakan |
| RB-09 | Identifikasi kendaraan | Plat nomor dibaca **VLM** di gate masuk (kunci sesi) & gate keluar (verifikasi) |
| RB-10 | Penanganan mismatch/kegagalan | Gate tidak dibuka otomatis; eskalasi ke petugas; audit tercatat |

## 8. Proses bisnis (to-be, ringkas)
1. **Booking:** pengguna pilih fakultas/zona/ETA/ETD → sistem terbitkan QR/barcode sesi.
2. **Entry:** scan QR sesi di gate masuk → VLM baca plat → sesi terkunci ke plat → gate masuk terbuka.
3. **Parkir:** scan QR zona → konfirmasi parkir.
4. **Checkout init:** scan QR zona → bill dibuat.
5. **Payment:** bayar di app (QRIS) → lunas.
6. **Exit:** terbit QR keluar → di gate keluar VLM verifikasi plat + scan QR keluar → gate terbuka → sesi selesai.
7. **Exception:** expired/no-show, overstay, gagal bayar, VLM gagal, mismatch, gate error → alur fallback/petugas + violation/audit.

## 9. Kebutuhan data (konseptual)
- Master: fakultas, zona, gate, konfigurasi aturan/tarif.
- Transaksi: booking/sesi, event status, QR token metadata (bukan rahasia plaintext jika tidak perlu), bill, pembayaran, exit pass.
- AI/Verifikasi: hasil baca plat (nilai, confidence, timestamp, gate), referensi rekaman terbatas sesuai privasi.
- Kepatuhan: violation, loyalty ledger.
- Audit: log semua aksi kritis dan override.

*(Implementasi fisik pada Supabase: tabel, view `zone_availability`, fungsi SQL atomic, Realtime, Storage terbatas, worker expiry/scheduler.)*

## 10. Kebutuhan integrasi
| Integrasi | Kebutuhan | Catatan |
|---|---|---|
| Gate masuk/keluar | Buka/tutup via controller/API/sinyal | Perlu protokol vendor; fallback petugas |
| Kamera gate masuk/keluar | Capture untuk VLM | Penempatan, pencahayaan outdoor, night mode |
| VLM/AI service | OCR/identifikasi plat | Latency, akurasi, confidence threshold, fallback |
| Payment gateway | QRIS & metode lain, webhook | Verifikasi signature, idempotensi, rekonsiliasi |
| Supabase | DB/Auth/Realtime/Storage/API | Service key hanya server-side; RLS sesuai model |
| Notifikasi (opsional) | Push/WA/SMS reminder | Tergantung kebutuhan operasional |

## 11. Kebutuhan non-fungsional
- **Keamanan:** QR sekali pakai/TTL, anti-replay, validasi server-side, proteksi webhook, RBAC admin/petugas.
- **Privasi:** minimisasi & retensi data plat/rekaman; akses audit; kepatuhan kebijakan kampus/UU PDP yang berlaku.
- **Keandalan & keselamatan:** gate *fail-safe* sesuai SOP (tidak menciptakan bahaya); fallback saat VLM/gate/jaringan gagal.
- **Performa:** validasi gate cukup cepat untuk antrean; status ketersediaan *near real-time*.
- **Ketersediaan:** pencatatan transaksi tahan gangguan; strategi offline/fallback operasional.
- **Auditability & traceability:** seluruh transisi sesi, pembayaran, verifikasi, override dapat ditelusuri.
- **Skalabilitas:** mampu ditambah zona/fakultas/kamera secara bertahap.

## 12. KPI / metrik keberhasilan (usulan)
| KPI | Target awal (contoh, TBD) | Cara ukur |
|---|---|---|
| Waktu cari parkir | Turun dibanding baseline survei | Survei/sampling waktu |
| Tingkat keberhasilan booking→masuk | Tinggi (mis. >95% sesi valid) | Log sesi |
| No-show/telat datang hangus | Terukur & menurun dengan reminder | Event `EXPIRED/NO_SHOW` |
| Overstay rate | Terukur; turun dengan insentif/sanksi | Event violation |
| Akurasi baca plat VLM (entry/exit) | Di atas ambang operasional (TBD) | Evaluasi berlabel, confidence |
| Mismatch/insiden gate | Rendah; tertangani < SLA | Log insiden/override |
| Kepuasan pengguna | Skor positif | Survei |
| Adopsi pembayaran non-tunai | > target (TBD) | Transaksi lunas |

## 13. Risiko & mitigasi
| Risiko | Dampak | Mitigasi |
|---|---|---|
| VLM tidak akurat (malam/hujan/plat kotor/outdoor) | Gate/sesi salah tolak/terima | Pilot, dataset lokal, confidence threshold, fallback manual, pencahayaan/kamera memadai |
| Integrasi gate/kamera/payment kompleks | Delay MVP | Simulator MVP, integrasi bertahap, kontrak API jelas |
| QR disalahgunakan/dibagikan | Fraud sesi | QR unik/TTL/sekali pakai, validasi server, binding plat, audit |
| Jaringan/gateway bermasalah | Antrean/gate terganggu | Fallback SOP petugas, idempotensi, desain *safety-first* |
| Sengketa biaya/overstay/refund | Ketidakpuasan | Aturan transparan, audit, bukti waktu/verifikasi, kebijakan tertulis |
| Privasi data plat/rekaman | Risiko hukum/reputasi | Minimasi, retensi, akses terbatas, persetujuan kebijakan |
| Adopsi pengguna rendah | Manfaat tidak tercapai | UX sederhana, sosialisasi, insentif loyalty, dukungan petugas |

## 14. Ketergantungan & asumsi proyek
- Ketersediaan data master zona/fakultas dan peta area.
- Dukungan kebijakan kampus untuk tarif, denda, sanksi, dan privasi.
- Akses/izin pemasangan atau integrasi kamera & gate (atau simulator untuk demo).
- Akses payment gateway (sandbox/production) untuk QRIS.
- Lingkungan deployment (Supabase self-hosted sudah tersedia di workspace) dan layanan AI/VLM.

## 15. Deliverables MVP (usulan)
1. Aplikasi pengguna **web-based** (responsive) + **installable shortcut/PWA** (*Add to Home Screen*) untuk booking, status, pembayaran, QR.
2. Backend/API + skema Supabase + aturan bisnis + audit.
3. Integrasi/simulator gate masuk/keluar + alur VLM plat.
4. Dashboard petugas/admin minimal (web).
5. Dokumentasi: user story, backlog, BRD, arsitektur teknis, SOP fallback.
6. Hasil evaluasi pilot (akurasi VLM, metrik operasional).

## 16. Persetujuan & keputusan terbuka
| Item | Pemilik keputusan | Status |
|---|---|---|
| Platform aplikasi | Tim/produk | **Diputuskan: web-based only + installable shortcut/PWA** |
| Definisi final tarif/overstay (Rp2000 + Rp1000) & grace | Pengelola/kampus | Terbuka |
| Kebijakan telat datang >10 menit (refund/kompensasi) | Pengelola/kampus | Terbuka |
| Identitas pengguna (NIM/SSO/OTP) | IT/kampus | Terbuka |
| Integrasi gate/kamera/payment (vendor & API) | IT/vendor | Terbuka |
| Kebijakan privasi & retensi plat/rekaman | Kampus/legal | Terbuka |
| Granularitas booking (zona vs slot) | Pengelola | Draft: zona |