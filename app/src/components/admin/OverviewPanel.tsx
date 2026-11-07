import { useEffect, useState } from 'react';
import type { Analytics, ParkingSession } from '../../types';
import { fetchAnalytics, fetchAdminSessions } from '../../lib/api';

interface OverviewPanelProps {
  onNavigate: (tab: 'domains' | 'zones' | 'sessions' | 'analytics') => void;
}

const rupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

export function OverviewPanel({ onNavigate }: OverviewPanelProps) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    fetchAnalytics({ from: today, to: today })
      .then(setAnalytics)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    fetchAdminSessions()
      .then(setSessions)
      .catch(() => {});
  }, []);

  const active = sessions.length;
  const zones = analytics?.zones ?? [];
  const busiest = [...zones].sort((a, b) => b.occupancyRate - a.occupancyRate).slice(0, 4);
  const gates = analytics?.gates ?? [];

  return (
    <div>
      {error && <div className="alert alert-err">{error}</div>}

      <div className="stat-strip mb-4">
        <div className="stat-card">
          <small>Zona parkir</small>
          <strong className="stat-num">{zones.length}</strong>
          <small className="hint-text">Aktif di kampus</small>
        </div>
        <div className="stat-card">
          <small>Kendaraan terparkir</small>
          <strong className="stat-num">{active}</strong>
          <small className="hint-text">Sesi aktif saat ini</small>
        </div>
        <div className="stat-card">
          <small>Pendapatan hari ini</small>
          <strong className="stat-num">{rupiah(analytics?.finance.totalRevenue ?? 0)}</strong>
          <small className="hint-text">{analytics?.finance.totalPayments ?? 0} transaksi</small>
        </div>
        <div className="stat-card">
          <small>Denda hari ini</small>
          <strong className="stat-num warn">{rupiah(analytics?.finance.penaltyRevenue ?? 0)}</strong>
          <small className="hint-text">{analytics?.totals.penalties ?? 0} pelanggaran</small>
        </div>
        <div className="stat-card">
          <small>Zona prioritas</small>
          <strong className="stat-num err">{analytics?.totals.highPriorityZones ?? 0}</strong>
          <small className="hint-text">Perlu pemeriksaan</small>
        </div>
      </div>

      <div className="grid">
        <section className="card">
          <div className="section-head">
            <h3>Hunian zona</h3>
            <button type="button" className="secondary btn-sm" onClick={() => onNavigate('zones')}>
              Kelola zona
            </button>
          </div>
          {busiest.length === 0 ? (
            <p className="hint-text">Belum ada data zona.</p>
          ) : (
            <div className="overview-list">
              {busiest.map((z) => (
                <div key={z.zoneId} className="overview-row">
                  <div className="overview-row-main">
                    <span className="overview-row-title">{z.zoneName}</span>
                    <span className="overview-row-sub">
                      {z.occupied}/{z.capacity} terisi · {z.domainId}
                    </span>
                  </div>
                  <div className="overview-meter">
                    <div
                      className={`overview-meter-fill ${z.occupancyRate >= 90 ? 'full' : ''}`}
                      style={{ width: `${z.occupancyRate}%` }}
                    />
                  </div>
                  <span className="overview-row-value">{z.occupancyRate}%</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="section-head">
            <h3>Kualitas kamera gate</h3>
            <button type="button" className="secondary btn-sm" onClick={() => onNavigate('analytics')}>
              Lihat analitik
            </button>
          </div>
          {gates.length === 0 ? (
            <p className="hint-text">Belum ada sampel kualitas kamera.</p>
          ) : (
            <div className="overview-list">
              {gates.slice(0, 4).map((g) => (
                <div key={g.gateId} className="overview-row">
                  <div className="overview-row-main">
                    <span className="overview-row-title">{g.gateId}</span>
                    <span className="overview-row-sub">
                      {g.samples} sampel · {g.lowSamples} rendah
                    </span>
                  </div>
                  <span
                    className={`status-badge ${
                      g.status === 'baik' ? 'badge-parked' : g.status === 'menurun' ? 'badge-checkout' : 'badge-expired'
                    }`}
                  >
                    {g.ewma}/100 · {g.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="section-head">
            <h3>Sesi aktif terbaru</h3>
            <button type="button" className="secondary btn-sm" onClick={() => onNavigate('sessions')}>
              Semua sesi
            </button>
          </div>
          {sessions.length === 0 ? (
            <p className="hint-text">Tidak ada sesi aktif.</p>
          ) : (
            <div className="overview-list">
              {sessions.slice(0, 5).map((s) => (
                <div key={s.sessionCode} className="overview-row">
                  <div className="overview-row-main">
                    <span className="overview-row-title">
                      {s.plate ? <span className="plate-badge">{s.displayPlate || s.plate}</span> : s.sessionCode}
                    </span>
                    <span className="overview-row-sub">
                      {s.zoneId} · {s.userName}
                    </span>
                  </div>
                  <span className={`status-badge badge-${String(s.status).toLowerCase()}`}>{s.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
