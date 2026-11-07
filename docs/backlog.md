# Product Backlog — Smart Parking Kampus

> Backlog MVP + lanjutan. **Prioritas:** P0 = wajib MVP/demo, P1 = penting setelah alur inti stabil, P2 = peningkatan. Estimasi bersifat relatif (S/M/L/XL) dan perlu *refinement* tim. **Platform:** web-based only + installable shortcut/PWA (bukan native app terpisah).

## Ringkasan epic
| ID | Epic | Prioritas | Tujuan |
|---|---|---|---|
| E1 | Fondasi & Master Data | P0 | Fakultas, zona, kuota, konfigurasi aturan/tarif |
| E2 | Booking & QR Sesi | P0 | Booking dari rumah, terbit QR/barcode sesi |
| E3 | Gate Masuk & VLM Plat (Entry) | P0 | Scan QR sesi, VLM baca plat, kunci sesi, buka gate masuk |
| E4 | Konfirmasi Zona & Checkout Request | P0 | Scan QR zona (parkir) dan scan QR zona (mulai checkout/bill) |
| E5 | Billing & Pembayaran | P0 | Hitung bill, QRIS/pembayaran app, lunas bukan di gate |
| E6 | Gate Keluar & Verifikasi VLM | P0 | QR keluar, VLM verifikasi plat, buka gate keluar |
| E7 | Aturan Waktu, Overstay & Violation | P0/P1 | Telat datang hangus, overstay, denda, pelanggaran |
| E8 | Loyalty & Reward | P1 | Poin, reward pengguna kooperatif |
| E9 | Anti-Abuse & Fairness | P1 | Pencegahan slot/sesi dimakan orang lain, strike |
| E10 | AI Rekomendasi/Prediksi | P1 | Rekomendasi zona, prediksi ketersediaan/risiko |
| E11 | Admin, Petugas & Operasional | P1 | Dashboard, pengecualian, override, laporan |
| E12 | Keamanan, Privasi & Audit | P0 (baseline) | QR security, audit, privasi plat/rekaman, idempotensi |
| E13 | Integrasi Hardware/Gate/Kamera | P0/P1 | API/controller gate, alur kamera, fallback |
| E14 | Notifikasi & UX | P1 | Reminder, status real-time, error handling UX |

---

## E1 — Fondasi & Master Data
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E1-S1 | Sebagai admin, saya bisa mengelola data **fakultas** (nama/kode/lokasi referensi) | P0 | S | CRUD fakultas; data tampil di pilihan booking | - |
| E1-S2 | Sebagai admin, saya bisa mengelola **zona parkir** (nama, fakultas terkait, kapasitas, gate/QR zona, status aktif) | P0 | M | Zona terkait fakultas; kapasitas > 0; QR zona identifier unik; aktif/nonaktif | E1-S1 |
| E1-S3 | Sebagai sistem, saya menyimpan **konfigurasi aturan** (tarif dasar, denda overstay, grace telat datang, grace overstay, TTL QR) | P0 | S | Parameter dapat diubah via config/admin; default: Rp2000, +Rp1000, telat datang 10 menit | - |
| E1-S4 | Sebagai sistem, saya menghitung **ketersediaan zona** secara konsisten (kapasitas - sesi/booking aktif sesuai aturan) | P0 | M | Perhitungan atomic/konsisten; tidak negatif; *near real-time* | E1-S2, E2 |
| E1-S5 | Sebagai admin, saya bisa memetakan **titik gate masuk/keluar** dan **QR zona fisik** | P1 | M | Metadata gate/zona untuk validasi dan audit | E1-S2 |

## E2 — Booking & QR Sesi
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E2-S1 | Sebagai pengguna, saya bisa memilih fakultas, zona, **ETA, ETD** dan melihat ketersediaan | P0 | M | UI alur booking; validasi input waktu; tampilkan zona relevan | E1 |
| E2-S2 | Sebagai pengguna, saya bisa mengonfirmasi booking dari rumah | P0 | M | Booking tersimpan dengan status awal; identitas pengguna tercatat | E2-S1 |
| E2-S3 | Sebagai pengguna, saya mendapat **QR/barcode sesi** sebagai bukti sesi hari itu | P0 | M | QR unik, terikat booking, dapat ditampilkan/disimpan; masa berlaku jelas | E2-S2, E12 |
| E2-S4 | Sebagai sistem, saya menolak/mengalihkan booking jika kuota tidak cukup | P0 | S | Validasi kuota pada konfirmasi; pesan jelas/alternatif zona | E1-S4 |
| E2-S5 | Sebagai pengguna, saya bisa membatalkan booking (sebelum masuk) sesuai kebijakan | P1 | S | Status cancelled; kuota kembali; audit; aturan cutoff opsional | E2-S2 |

## E3 — Gate Masuk & VLM Plat (Entry)
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E3-S1 | Sebagai pengguna, saya scan **QR/barcode sesi** di gate masuk untuk validasi | P0 | M | Validasi server-side: sesi ada/valid/tidak hangus/tidak selesai; hasil jelas | E2-S3, E12 |
| E3-S2 | Sebagai sistem, **VLM di gate masuk** membaca plat nomor kendaraan | P0 | L | Integrasi kamera/VLM; hasil OCR + confidence; fallback jika gagal | E13 |
| E3-S3 | Sebagai sistem, sesi aktif **dikunci ke plat nomor** saat masuk berhasil | P0 | M | Plat tersimpan pada sesi; `ENTERED` + timestamp; audit | E3-S1, E3-S2 |
| E3-S4 | Sebagai sistem, saya membuka **palang gate masuk** hanya jika validasi sukses | P0 | M | Perintah buka gate setelah valid; idempotent; log hasil gate | E3-S1, E13 |
| E3-S5 | Sebagai sistem, booking/sesi **hangus jika telat > 10 menit** dari ETA | P0 | M | Job/scheduler mengecek deadline; status `EXPIRED`; kuota kembali; notifikasi opsional | E1-S3, E2-S2 |
| E3-S6 | Sebagai petugas, saya bisa menangani kasus VLM gagal baca/QR bermasalah (fallback) | P1 | M | Override manual dengan alasan; input plat manual terverifikasi; audit wajib | E11, E12 |

## E4 — Konfirmasi Zona & Checkout Request
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E4-S1 | Sebagai pengguna, saya scan **QR zona** untuk konfirmasi sudah parkir di zona tersebut | P0 | M | Validasi QR zona vs zona sesi; status `PARKED_CONFIRMED`; timestamp | E3-S3, E1-S2 |
| E4-S2 | Sebagai pengguna, saya scan **QR zona** lagi saat mau pulang untuk mulai checkout | P0 | M | Status `CHECKOUT_REQUESTED`; waktu checkout dicatat | E4-S1 |
| E4-S3 | Sebagai sistem, saya menghasilkan **bill/tagihan** saat checkout dimulai | P0 | M | Bill normal/overstay sesuai aturan; tampil di app; terkait sesi | E4-S2, E7 |
| E4-S4 | Sebagai sistem, saya menolak scan QR zona yang tidak sesuai konteks/status sesi | P0 | S | Validasi state machine; pesan error jelas | E4-S1 |

## E5 — Billing & Pembayaran
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E5-S1 | Sebagai pengguna, saya melihat rincian bill (zona, plat, waktu, tarif, denda jika ada) | P0 | S | Transparan; sesuai aturan E1-S3/E7 | E4-S3 |
| E5-S2 | Sebagai pengguna, saya membayar bill di app via **QRIS** (dan opsi lain jika tersedia) | P0 | L | Integrasi payment gateway; status pending/sukses/gagal; bukan di gate | E5-S1 |
| E5-S3 | Sebagai sistem, saya memproses konfirmasi pembayaran secara **aman & idempotent** | P0 | M | Verifikasi callback/webhook; anti duplikasi; update `PAID` | E5-S2, E12 |
| E5-S4 | Sebagai sistem, saya **tidak menerbitkan QR keluar** sebelum bill lunas (kebijakan default) | P0 | S | Gate keluar hanya setelah `PAID` (atau kebijakan lunas) | E5-S3, E6 |
| E5-S5 | Sebagai pengguna, saya mendapat bukti pembayaran/riwayat transaksi | P1 | S | Receipt/invoice reference; riwayat di app | E5-S3 |

## E6 — Gate Keluar & Verifikasi VLM
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E6-S1 | Sebagai sistem, saya menerbitkan **QR/barcode keluar** setelah pembayaran lunas | P0 | M | Sekali pakai, TTL pendek, terikat sesi/gate; replay protection | E5-S4, E12 |
| E6-S2 | Sebagai sistem, **VLM di gate keluar** membaca plat nomor kendaraan | P0 | L | Integrasi kamera/VLM; confidence; fallback | E13 |
| E6-S3 | Sebagai sistem, saya memverifikasi **plat cocok** + QR keluar valid + lunas sebelum buka gate | P0 | M | Semua syarat terpenuhi → izinkan; mismatch/invalid → tolak + audit | E6-S1, E6-S2 |
| E6-S4 | Sebagai sistem, saya membuka **palang gate keluar** dan menyelesaikan sesi | P0 | M | Gate open command; status `COMPLETED`; kuota kembali; timestamp keluar | E6-S3, E13 |
| E6-S5 | Sebagai petugas, saya menangani mismatch/QR invalid/gate error dengan aman | P1 | M | Override tercatat; tidak membahayakan; resolusi insiden | E11, E12 |

## E7 — Aturan Waktu, Overstay & Violation
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E7-S1 | Sebagai sistem, saya mendeteksi **telat datang > 10 menit** dan menghanguskan sesi | P0 | M | Deadline ETA+10m; expire job; kuota release | E3-S5 |
| E7-S2 | Sebagai sistem, saya mendeteksi **overstay** (lewat ETD + grace) | P0 | M | Parameter grace; status/flag overstay | E1-S3, E4-S3 |
| E7-S3 | Sebagai sistem, saya menghitung bill overstay **Rp2.000 + Rp1.000** dan mencatat violation | P0 | S | Sesuai definisi final; violation ledger | E7-S2, E5-S1 |
| E7-S4 | Sebagai admin, saya bisa melihat riwayat violation per pengguna/sesi | P1 | S | Filter, detail, export dasar | E7-S3, E11 |

## E8 — Loyalty & Reward
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E8-S1 | Sebagai sistem, saya memberi poin untuk perilaku kooperatif (tepat waktu, patuh alur) | P1 | M | Aturan poin terdefinisi; ledger append-only | E6-S4, E7 |
| E8-S2 | Sebagai pengguna, saya melihat poin/status loyalty saya | P1 | S | Transparan; riwayat poin | E8-S1 |
| E8-S3 | Sebagai admin, saya mengatur manfaat reward (tanpa merusak fairness) | P2 | M | Konfigurasi benefit; guardrails kuota | E8-S1 |

## E9 — Anti-Abuse & Fairness
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E9-S1 | Sebagai sistem, saya mendeteksi anomali (mismatch berulang, pola abuse QR/sesi) | P1 | M | Flag/violation; threshold; notifikasi admin | E6-S3, E12 |
| E9-S2 | Sebagai sistem, saya menerapkan konsekuensi kebijakan (strike/pembatasan booking) | P1 | M | Bertahap, transparan, dapat di-override admin; sesuai kebijakan kampus | E9-S1, E7-S4 |
| E9-S3 | Sebagai pengguna, saya melihat status peringatan/pembatasan (jika ada) | P2 | S | Komunikasi jelas, jalur banding/proses opsional | E9-S2 |

## E10 — AI Rekomendasi/Prediksi
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E10-S1 | Sebagai pengguna, saya mendapat **rekomendasi zona** berdasarkan fakultas tujuan & ETA | P1 | M | Ranking zona (jarak/ketersediaan/historis); alasan sederhana | E1, E2, data historis |
| E10-S2 | Sebagai sistem, saya mengumpulkan data historis okupansi/sesi untuk analitik/model | P1 | S | Event/log terstruktur; retensi sesuai privasi | E2-E7 |
| E10-S3 | Sebagai sistem, saya memprediksi ketersediaan/risiko (overstay/no-show) per zona-waktu | P2 | L | Model/evaluasi; metrik; fallback rule-based | E10-S2 |
| E10-S4 | Sebagai tim, saya mengevaluasi akurasi **VLM plat** (kondisi outdoor) dan menetapkan fallback | P0/P1 | M | Dataset uji, akurasi/recall, ambang confidence, SOP fallback | E3-S2, E6-S2 |

## E11 — Admin, Petugas & Operasional
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E11-S1 | Sebagai admin/petugas, saya melihat dashboard zona, sesi, gate, pembayaran, violation | P1 | M | *Near real-time*; filter; ringkasan KPI | E1-E7 |
| E11-S2 | Sebagai petugas, saya menangani pengecualian dengan override tercatat | P1 | M | Alasan wajib; audit; peran/izin | E12 |
| E11-S3 | Sebagai admin, saya melihat laporan (okupansi, pendapatan, overstay, no-show, akurasi VLM) | P2 | M | Periode/fakultas/zona; export | E10-S2 |

## E12 — Keamanan, Privasi & Audit
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E12-S1 | Sebagai sistem, QR/barcode sesi & keluar aman (unik, TTL, sekali pakai, anti replay) | P0 | M | Validasi server-side; `jti/nonce`; expiry; used marker | E2-S3, E6-S1 |
| E12-S2 | Sebagai sistem, semua transisi penting tercatat di **audit log** | P0 | M | Booking, gate, VLM, pembayaran, override, violation | Semua epic inti |
| E12-S3 | Sebagai sistem, data plat/rekaman dikelola sesuai **privasi & retensi** | P0 | M | Minimasi, akses terbatas, retensi, kebijakan hapus | E3/E6 |
| E12-S4 | Sebagai sistem, integrasi pembayaran & operasi kritis **idempotent** | P0 | S | Aman dari retry/duplikasi webhook/command | E5, E6 |
| E12-S5 | Sebagai sistem, kontrol akses berbasis peran (pengguna/petugas/admin) | P1 | M | AuthZ; least privilege | E11 |

## E13 — Integrasi Hardware/Gate/Kamera
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E13-S1 | Sebagai sistem, saya terintegrasi dengan **controller gate masuk/keluar** (atau simulator MVP) | P0 | L | Open/deny command; status; timeout; fallback aman | - |
| E13-S2 | Sebagai sistem, saya menerima input **kamera/VLM** di gate masuk & keluar | P0 | L | Pipeline capture → inference → result; latency dapat diterima | E10-S4 |
| E13-S3 | Sebagai sistem, saya punya mode **fallback/degradasi** saat gate/kamera/VLM/offline bermasalah | P1 | M | SOP + fitur override; keselamatan prioritas | E11-S2 |

## E14 — Notifikasi & UX
| ID | Story | Prioritas | Est. | Acceptance Criteria (ringkas) | Dependensi |
|---|---|---:|:---:|---|---|
| E14-S1 | Sebagai pengguna, saya mendapat pengingat (ETA mendekat, risiko hangus >10 menit, waktu checkout) | P1 | M | Push/in-app; preferensi; tidak spam | E2, E3-S5 |
| E14-S2 | Sebagai pengguna, saya melihat status sesi & ketersediaan zona secara jelas (*near real-time*) | P1 | M | Status state machine mudah dipahami; update realtime/polling | E1-S4 |
| E14-S3 | Sebagai pengguna, saya mendapat pesan error/pengecualian yang dapat ditindaklanjuti | P0 | S | QR invalid, belum bayar, mismatch, gate error → instruksi | Semua |
| E14-S4 | Sebagai pengguna, saya bisa memakai aplikasi **web-based** dan **mengunduh/menambah shortcut** ke layar utama (installable/PWA) | P0 | M | Responsive (mobile-first); web manifest + install prompt/Add to Home Screen; ikon/nama app; perilaku dasar layak dipasang; bukan native app terpisah | E2 (alur inti) |

---

## Definition of Done (DoD) — MVP
- Kriteria AC story terpenuhi dan didemokan pada alur end-to-end.
- Aturan tarif/waktu sesuai konfigurasi yang disepakati.
- Validasi kritis berjalan server-side (kuota, QR, pembayaran, verifikasi plat/sesi).
- Audit log untuk transisi/pembayaran/gate/override tersedia.
- Penanganan error & fallback dasar terdokumentasi.
- Pengujian skenario utama: normal, telat datang hangus, overstay+denda, mismatch plat, pembayaran gagal.

## Urutan implementasi disarankan (MVP)
1. **E1, E12 (baseline), E2** — master data, booking, QR sesi.
2. **E3, E13 (simulator jika perlu)** — entry + VLM/plat lock.
3. **E4, E5, E7** — konfirmasi zona, checkout, bill, bayar, overstay.
4. **E6** — exit QR + verifikasi VLM + gate keluar.
5. **E11, E14, E9, E8, E10** — operasional, UX, fairness, loyalty, AI lanjutan.