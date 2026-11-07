import { useEffect, useState } from 'react';
import type { ParkingSession, Zone } from '../../types';
import { fetchAdminSessions } from '../../lib/api';

interface SessionMonitorProps {
  zones: Zone[];
  lastUpdateTimestamp?: string;
}

export function SessionMonitor({ zones, lastUpdateTimestamp }: SessionMonitorProps) {
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const loadSessions = () => {
    setLoading(true);
    fetchAdminSessions()
      .then((data) => {
        setSessions(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSessions();
    const iv = setInterval(loadSessions, 15000);
    return () => clearInterval(iv);
  }, [lastUpdateTimestamp]);

  const filtered = filterStatus === 'all'
    ? sessions
    : sessions.filter((s) => s.status === filterStatus);

  // Stats calculation
  const totalActive = sessions.length;
  const parkedCount = sessions.filter((s) => s.status === 'PARKED_CONFIRMED').length;
  const waitingPayCount = sessions.filter((s) => s.status === 'CHECKOUT_REQUESTED').length;
  const overstayCount = sessions.filter((s) => s.bill?.isOverstay).length;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'BOOKED':
        return <span className="status-badge badge-booked">Booking (Menunggu)</span>;
      case 'ENTERED':
        return <span className="status-badge badge-entered">Masuk Gate</span>;
      case 'PARKED_CONFIRMED':
        return <span className="status-badge badge-parked">Terparkir</span>;
      case 'CHECKOUT_REQUESTED':
        return <span className="status-badge badge-checkout">Menunggu Bayar</span>;
      case 'PAID':
        return <span className="status-badge badge-paid">Lunas (Menuju Keluar)</span>;
      case 'COMPLETED':
        return <span className="status-badge badge-completed">Selesai</span>;
      case 'EXPIRED':
        return <span className="status-badge badge-expired">Hangus</span>;
      default:
        return <span className="status-badge">{status}</span>;
    }
  };

  return (
    <div className="admin-session-monitor">
      {/* Metric Cards */}
      <div className="grid mb-4">
        <div className="card stat-card">
          <small>Total Sesi Aktif</small>
          <strong className="stat-num">{totalActive}</strong>
          <small className="hint-text">Tercatat di sistem</small>
        </div>
        <div className="card stat-card">
          <small>Sedang Parkir di Zona</small>
          <strong className="stat-num ok">{parkedCount}</strong>
          <small className="hint-text">Konfirmasi QR tiang zona</small>
        </div>
        <div className="card stat-card">
          <small>Menunggu Bayar</small>
          <strong className="stat-num warn">{waitingPayCount}</strong>
          <small className="hint-text">Tagihan diterbitkan</small>
        </div>
        <div className="card stat-card">
          <small>Pelanggaran Overstay</small>
          <strong className="stat-num err">{overstayCount}</strong>
          <small className="hint-text">Melebihi batas ETD (+Rp1.000)</small>
        </div>
      </div>

      <div className="section-header row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2>Monitoring Live Kendaraan &amp; Sesi Parkir</h2>
          <p className="hint-text" style={{ margin: 0 }}>
            Pantau seluruh kendaraan di area kampus secara real-time via Redis Pub/Sub stream.
          </p>
        </div>
        <div className="row">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="all">Semua Status ({sessions.length})</option>
            <option value="BOOKED">Booking</option>
            <option value="ENTERED">Masuk Gate</option>
            <option value="PARKED_CONFIRMED">Terparkir</option>
            <option value="CHECKOUT_REQUESTED">Menunggu Bayar</option>
            <option value="PAID">Lunas</option>
            <option value="COMPLETED">Selesai</option>
          </select>
          <button type="button" className="secondary btn-sm" onClick={loadSessions} disabled={loading}>
            {loading ? 'Menyegarkan...' : 'Segarkan'}
          </button>
        </div>
      </div>

      <section className="card">
        {error && <div className="alert alert-err">Gagal memuat sesi: {error}</div>}
        {filtered.length === 0 ? (
          <p className="hint-text" style={{ textAlign: 'center', padding: 20 }}>
            {error ? 'Data sesi tidak dapat diambil dari server.' : 'Belum ada sesi parkir yang cocok dengan filter.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Kode Sesi</th>
                  <th>Pengemudi</th>
                  <th>Plat Nomor (VLM)</th>
                  <th>Jenis</th>
                  <th>Zona</th>
                  <th>ETA / Masuk</th>
                  <th>Status</th>
                  <th>Tagihan</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const zone = zones.find((z) => z.id === s.zoneId);
                  return (
                    <tr key={s.sessionCode}>
                      <td><strong>{s.sessionCode}</strong></td>
                      <td>{s.userName}</td>
                      <td>
                        {s.plate ? (
                          <span className="plate-badge">{s.plate}</span>
                        ) : (
                          <small className="hint-text">(belum scan gate)</small>
                        )}
                      </td>
                      <td>{s.vehicleType === 'car' ? 'Mobil' : 'Motor'}</td>
                      <td>{zone?.name || s.zoneId}</td>
                      <td>
                        <small>
                          ETA: {s.eta}
                          {s.entryTime ? ` | Masuk: ${new Date(s.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                        </small>
                      </td>
                      <td>{getStatusBadge(s.status)}</td>
                      <td>
                        {s.bill ? (
                          <span>
                            Rp{s.bill.total.toLocaleString()}
                            {s.bill.isOverstay ? <span className="err"> (Overstay)</span> : ''}
                          </span>
                        ) : (
                          <small className="hint-text">-</small>
                        )}
                      </td>
                      <td>
                        {s.exitCode && (
                          <small>QR Keluar: <code>{s.exitCode}</code></small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
