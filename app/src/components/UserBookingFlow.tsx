import { useState, useMemo } from 'react';
import type { Faculty, Zone, ParkingSession } from '../types';
import { createBooking, payBill } from '../lib/api';
import { QRCodeView } from './QRCodeView';

interface UserBookingFlowProps {
  faculties: Faculty[];
  zones: Zone[];
  activeSession: ParkingSession | null;
  onSessionChange: (session: ParkingSession | null) => void;
  onNavigateToTab?: (tab: string) => void;
}

export function UserBookingFlow({
  faculties,
  zones,
  activeSession,
  onSessionChange,
  onNavigateToTab,
}: UserBookingFlowProps) {
  const [selectedFacultyId, setSelectedFacultyId] = useState<string>(faculties[0]?.id || 'FT');
  const [selectedZoneId, setSelectedZoneId] = useState<string>(
    faculties[0]?.defaultZoneId || zones[0]?.id || 'zone-a'
  );
  const [userName, setUserName] = useState('Ahmad (Mahasiswa)');
  const [vehicleType, setVehicleType] = useState<'car' | 'motorcycle'>('motorcycle');
  const [eta, setEta] = useState('08:30');
  const [etd, setEtd] = useState('16:00');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  // Update zone recommendation when faculty changes
  const handleFacultyChange = (fId: string) => {
    setSelectedFacultyId(fId);
    const faculty = faculties.find((f) => f.id === fId);
    if (faculty?.defaultZoneId) {
      setSelectedZoneId(faculty.defaultZoneId);
    }
  };

  const selectedZone = useMemo(
    () => zones.find((z) => z.id === selectedZoneId),
    [zones, selectedZoneId]
  );

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await createBooking({
        facultyId: selectedFacultyId,
        zoneId: selectedZoneId,
        userName,
        vehicleType,
        eta,
        etd,
      });
      onSessionChange(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePay = async () => {
    if (!activeSession) return;
    setPaying(true);
    setError(null);
    try {
      const updated = await payBill({ sessionCode: activeSession.sessionCode, paymentMethod: 'QRIS' });
      onSessionChange(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPaying(false);
    }
  };

  // Helper status badge label & class
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'BOOKED':
        return <span className="status-badge badge-booked">Menunggu Masuk Gate</span>;
      case 'ENTERED':
        return <span className="status-badge badge-entered">Masuk Gate (Menuju Zona)</span>;
      case 'PARKED_CONFIRMED':
        return <span className="status-badge badge-parked">Terparkir di Zona</span>;
      case 'CHECKOUT_REQUESTED':
        return <span className="status-badge badge-checkout">Menunggu Pembayaran</span>;
      case 'PAID':
        return <span className="status-badge badge-paid">Lunas (Menuju Gate Keluar)</span>;
      case 'COMPLETED':
        return <span className="status-badge badge-completed">Selesai</span>;
      case 'EXPIRED':
        return <span className="status-badge badge-expired">Hangus (Telat &gt;10m)</span>;
      default:
        return <span className="status-badge">{status}</span>;
    }
  };

  return (
    <div className="booking-container">
      {/* Zone Live Counter Overview */}
      <section className="card mb-4">
        <h2>Live Ketersediaan Zona Parkir Kampus</h2>
        <p className="hint-text">
          Status slot real-time diperbarui otomatis via <strong>Redis Pub/Sub Cache</strong>.
        </p>
        <div className="zone-grid">
          {zones.map((z) => {
            const faculty = faculties.find((f) => f.id === z.facultyId);
            const percent = Math.round((z.occupied / z.capacity) * 100);
            return (
              <div
                key={z.id}
                className={`zone-card ${z.isFull ? 'zone-full' : ''} ${
                  selectedZoneId === z.id ? 'zone-selected' : ''
                }`}
                onClick={() => setSelectedZoneId(z.id)}
              >
                <div className="zone-card-header">
                  <strong>{z.name}</strong>
                  <span className={`slot-tag ${z.isFull ? 'full' : 'avail'}`}>
                    {z.isFull ? 'Penuh' : `${z.available} Kosong`}
                  </span>
                </div>
                <small className="zone-meta">Dekat: {faculty?.name || z.facultyId}</small>
                <div className="progress-bar-bg">
                  <div
                    className={`progress-bar-fill ${z.isFull ? 'fill-full' : ''}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="zone-card-footer">
                  <small>
                    Terisi: {z.occupied}/{z.capacity} ({percent}%)
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* If user already has an active session, display Session Ticket */}
      {activeSession ? (
        <section className="card active-ticket-card">
          <div className="ticket-header">
            <div>
              <h2>Tiket Sesi Parkir Anda</h2>
              <p>Kode Sesi: <strong>{activeSession.sessionCode}</strong></p>
            </div>
            <div>{getStatusBadge(activeSession.status)}</div>
          </div>

          {error && <div className="alert alert-err">{error}</div>}

          {/* Step 1: BOOKED -> Show Entry QR */}
          {activeSession.status === 'BOOKED' && (
            <div className="ticket-body">
              <div className="qr-box">
                <QRCodeView
                  value={activeSession.sessionCode}
                  title="QR / Barcode Masuk Gate"
                  subtitle="Tunjukkan di Gate Masuk kampus untuk dipindai kamera & diverifikasi VLM."
                />
              </div>
              <div className="ticket-info">
                <dl className="kv">
                  <dt>Pengguna</dt>
                  <dd>{activeSession.userName}</dd>
                  <dt>Zona Tujuan</dt>
                  <dd>{zones.find((z) => z.id === activeSession.zoneId)?.name || activeSession.zoneId}</dd>
                  <dt>Kendaraan</dt>
                  <dd>{activeSession.vehicleType === 'car' ? 'Mobil' : 'Sepeda Motor'}</dd>
                  <dt>ETA Datang</dt>
                  <dd>{activeSession.eta}</dd>
                  <dt>Aturan Telat</dt>
                  <dd className="warn">Hangus jika telat &gt; 10 menit dari ETA</dd>
                </dl>
                <div className="quick-actions">
                  <p><small>Langkah selanjutnya: Bawa kendaraan ke Gate Masuk.</small></p>
                  {onNavigateToTab && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onNavigateToTab('gate-in')}
                    >
                      Buka Simulator Gate Masuk &rarr;
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: ENTERED -> Needs Zone Scan */}
          {activeSession.status === 'ENTERED' && (
            <div className="ticket-body">
              <div className="alert alert-info">
                Gate Masuk berhasil dibuka! Plat terkunci: <strong>{activeSession.plate || activeSession.displayPlate}</strong>.
                Silakan menuju <strong>{zones.find((z) => z.id === activeSession.zoneId)?.name}</strong> dan scan QR di tiang zona untuk konfirmasi parkir.
              </div>
              {onNavigateToTab && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => onNavigateToTab('zone-post')}
                >
                  Buka Simulator Tiang Zona &rarr;
                </button>
              )}
            </div>
          )}

          {/* Step 3: PARKED_CONFIRMED -> Parked peacefully */}
          {activeSession.status === 'PARKED_CONFIRMED' && (
            <div className="ticket-body">
              <div className="alert alert-ok">
                Kendaraan Anda terparkir di {zones.find((z) => z.id === activeSession.zoneId)?.name}.
              </div>
              <dl className="kv">
                <dt>Waktu Masuk</dt>
                <dd>{activeSession.entryTime ? new Date(activeSession.entryTime).toLocaleTimeString() : '-'}</dd>
                <dt>Plat Terkunci</dt>
                <dd>{activeSession.plate}</dd>
                <dt>Batas ETD</dt>
                <dd>{activeSession.etd}</dd>
              </dl>
              <div className="mt-3">
                <p><small>Saat mau pulang, scan kembali QR di tiang zona untuk request checkout & tagihan bill.</small></p>
                {onNavigateToTab && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onNavigateToTab('zone-post')}
                  >
                    Buka Simulator Tiang Zona (Checkout) &rarr;
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step 4: CHECKOUT_REQUESTED -> Bill is calculated, pay in-app */}
          {activeSession.status === 'CHECKOUT_REQUESTED' && (
            <div className="ticket-body">
              <div className="bill-box card">
                <h3>Rincian Tagihan Parkir</h3>
                {activeSession.bill?.isOverstay && (
                  <div className="alert alert-err mb-2">
                    <strong>Peringatan Overstay (Pelanggaran):</strong> Anda keluar melebihi batas ETD. Denda diterapkan.
                  </div>
                )}
                <dl className="kv">
                  <dt>Tarif Dasar</dt>
                  <dd>Rp{activeSession.bill?.baseFee?.toLocaleString() || '2.000'}</dd>
                  {activeSession.bill?.isOverstay && (
                    <>
                      <dt className="err">Denda Overstay</dt>
                      <dd className="err">+Rp{activeSession.bill?.penaltyFee?.toLocaleString() || '1.000'}</dd>
                    </>
                  )}
                  <dt><strong>Total Tagihan</strong></dt>
                  <dd className="total-fee">
                    <strong>Rp{activeSession.bill?.total?.toLocaleString() || '2.000'}</strong>
                  </dd>
                </dl>
                <div className="payment-qris-box">
                  <h4>Pembayaran Non-Tunai di Aplikasi (Bukan di Gate)</h4>
                  <QRCodeView
                    value={`QRIS-CAMPUS-${activeSession.sessionCode}-${activeSession.bill?.total || 2000}`}
                    title="QRIS Standar Nasional"
                    subtitle="Scan dengan m-banking/e-wallet pilihan Anda"
                    size={160}
                  />
                  <button
                    type="button"
                    className="btn btn-pay"
                    onClick={handlePay}
                    disabled={paying}
                  >
                    {paying ? 'Memproses Pembayaran...' : `Konfirmasi Bayar Rp${(activeSession.bill?.total || 2000).toLocaleString()}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: PAID -> Show Exit QR */}
          {activeSession.status === 'PAID' && (
            <div className="ticket-body">
              <div className="alert alert-ok mb-3">
                Pembayaran Sukses (ID: {activeSession.payment?.transactionId}). QR Keluar aktif!
              </div>
              <div className="qr-box">
                <QRCodeView
                  value={activeSession.exitCode || ''}
                  title="QR / Barcode Gate Keluar"
                  subtitle="Tunjukkan di Gate Keluar. VLM akan memverifikasi kecocokan plat nomor."
                  size={190}
                />
              </div>
              <div className="ticket-info">
                <dl className="kv">
                  <dt>Kode Keluar</dt>
                  <dd><strong>{activeSession.exitCode}</strong></dd>
                  <dt>Plat Terdaftar</dt>
                  <dd><strong>{activeSession.plate}</strong></dd>
                  <dt>Masa Berlaku</dt>
                  <dd>15 Menit sejak pembayaran</dd>
                </dl>
                {onNavigateToTab && (
                  <button
                    type="button"
                    className="btn mt-3"
                    onClick={() => onNavigateToTab('gate-out')}
                  >
                    Buka Simulator Gate Keluar &rarr;
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step 6: COMPLETED or EXPIRED */}
          {(activeSession.status === 'COMPLETED' || activeSession.status === 'EXPIRED') && (
            <div className="ticket-body">
              {activeSession.status === 'COMPLETED' ? (
                <div className="alert alert-ok">
                  Sesi parkir telah selesai. Terima kasih telah mematuhi aturan parkir kampus!
                </div>
              ) : (
                <div className="alert alert-err">
                  Booking Anda telah <strong>HANGUS</strong> karena terlambat lebih dari 10 menit dari ETA ({activeSession.eta}). Kuota parkir telah dikembalikan ke zona.
                </div>
              )}
              <button
                type="button"
                className="secondary mt-3"
                onClick={() => onSessionChange(null)}
              >
                Buat Booking Baru
              </button>
            </div>
          )}

          {activeSession.status !== 'COMPLETED' && activeSession.status !== 'EXPIRED' && (
            <div className="ticket-footer mt-4">
              <button
                type="button"
                className="secondary"
                onClick={() => onSessionChange(null)}
              >
                Tutup Tampilan Tiket (Buka Form Booking)
              </button>
            </div>
          )}
        </section>
      ) : (
        /* Booking Form */
        <section className="card">
          <h2>Form Booking Parkir Online</h2>
          <p className="hint-text">
            Pesan dari rumah untuk memastikan slot di zona parkir dekat fakultas Anda.
          </p>

          {error && <div className="alert alert-err">{error}</div>}

          <form onSubmit={handleBook}>
            <div className="form-group">
              <label>
                <strong>1. Pilih Fakultas Tujuan:</strong>
                <select
                  value={selectedFacultyId}
                  onChange={(e) => handleFacultyChange(e.target.value)}
                >
                  {faculties.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.id})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-group">
              <label>
                <strong>2. Pilih Zona Parkir:</strong>
                <select
                  value={selectedZoneId}
                  onChange={(e) => setSelectedZoneId(e.target.value)}
                >
                  {zones.map((z) => {
                    const isRec = z.facultyId === selectedFacultyId;
                    return (
                      <option key={z.id} value={z.id} disabled={z.isFull}>
                        {z.name} {isRec ? '⭐ (Terdekat)' : ''} — {z.isFull ? 'PENUH' : `Sisa ${z.available} slot`}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>
                  Nama Pengemudi:
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="form-group">
                <label>
                  Jenis Kendaraan:
                  <select
                    value={vehicleType}
                    onChange={(e) => setVehicleType(e.target.value as any)}
                  >
                    <option value="motorcycle">Sepeda Motor</option>
                    <option value="car">Mobil</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>
                  Estimasi Waktu Datang (ETA):
                  <input
                    type="time"
                    value={eta}
                    onChange={(e) => setEta(e.target.value)}
                    required
                  />
                  <small>Batas telat: maks 10 menit setelah ETA</small>
                </label>
              </div>
              <div className="form-group">
                <label>
                  Estimasi Waktu Keluar (ETD):
                  <input
                    type="time"
                    value={etd}
                    onChange={(e) => setEtd(e.target.value)}
                    required
                  />
                  <small>Overstay setelah ETD dikenakan denda Rp1.000</small>
                </label>
              </div>
            </div>

            <div className="form-actions mt-3">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || selectedZone?.isFull}
              >
                {loading
                  ? 'Menyimpan Booking...'
                  : selectedZone?.isFull
                  ? 'Zona Penuh'
                  : 'Konfirmasi Booking & Terbitkan QR Sesi'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
