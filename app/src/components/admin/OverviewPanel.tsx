import { useCallback, useEffect, useState } from 'react';
import type { Analytics, ParkingSession } from '../../types';
import { fetchAnalytics, fetchAdminSessions } from '../../lib/api';

interface OverviewPanelProps {
  onNavigate: (tab: 'domains' | 'zones' | 'sessions' | 'analytics') => void;
}

const rupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

const STATUS_LABEL: Record<string, string> = {
  BOOKED: 'Dipesan',
  ENTERED: 'Di gate',
  PARKED_CONFIRMED: 'Terparkir',
  CHECKOUT_REQUESTED: 'Siap bayar',
  PAID: 'Lunas',
  EXPIRED: 'Kedaluwarsa',
  COMPLETED: 'Selesai',
};

function statusClass(status: string) {
  switch (status) {
    case 'BOOKED':
      return 'badge-booked';
    case 'ENTERED':
      return 'badge-entered';
    case 'PARKED_CONFIRMED':
      return 'badge-parked';
    case 'CHECKOUT_REQUESTED':
      return 'badge-checkout';
    case 'PAID':
      return 'badge-paid';
    case 'EXPIRED':
      return 'badge-expired';
    default:
      return 'badge-completed';
  }
}

function elapsed(iso?: string) {
  if (!iso) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} mnt`;
  const hours = Math.floor(mins / 60);
  return `${hours} j ${mins % 60} mnt`;
}

export function OverviewPanel({ onNavigate }: OverviewPanelProps) {
  const [today, setToday] = useState<Analytics | null>(null);
  const [week, setWeek] = useState<Analytics | null>(null);
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>('');

  const load = useCallback(() => {
    const date = new Date().toISOString().slice(0, 10);
    Promise.all([fetchAnalytics({ from: date, to: date }), fetchAnalytics(), fetchAdminSessions()])
      .then(([todayData, weekData, sessionData]) => {
        setToday(todayData);
        setWeek(weekData);
        setSessions(sessionData);
        setUpdatedAt(new Date().toISOString());
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, [load]);

  const zones = today?.zones ?? [];
  const capacity = zones.reduce((a, z) => a + z.capacity, 0);
  const occupied = zones.reduce((a, z) => a + z.occupied, 0);
  const occupancyRate = capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
  const activeSessions = sessions.length;
  const busiest = [...zones].sort((a, b) => b.occupancyRate - a.occupancyRate);
  const domains = (today?.domains ?? []).slice(0, 8);
  const gates = week?.gates ?? today?.gates ?? [];
  const hours = today?.hours ?? [];
  const maxHour = Math.max(1, ...hours.map((h) => h.activity));
  const daily = week?.finance.daily ?? [];
  const maxDay = Math.max(1, ...daily.map((d) => d.revenue));
  const weekRevenue = daily.reduce((a, d) => a + d.revenue, 0);
  const finance = today?.finance;
  const vehicleTotal = Math.max(1, (finance?.byVehicle.motorcycle ?? 0) + (finance?.byVehicle.car ?? 0));
  const motorShare = Math.round(((finance?.byVehicle.motorcycle ?? 0) / vehicleTotal) * 100);
  const peak = today?.peakHours?.[0];

  return (
    <div className="admin-session-monitor">
      {error && <div className="alert alert-err">{error}</div>}

      <div className="stat-strip mb-4">
        <div className="stat-card">
          <small>Zona parkir</small>
          <strong className="stat-num">{zones.length}</strong>
          <small className="hint-text">{capacity} slot tersedia</small>
        </div>
        <div className="stat-card">
          <small>Terisi saat ini</small>
          <strong className="stat-num">
            {occupied}
            <span className="stat-suffix">/{capacity}</span>
          </strong>
          <small className="hint-text">{occupancyRate}% hunian</small>
        </div>
        <div className="stat-card">
          <small>Kendaraan aktif</small>
          <strong className="stat-num">{activeSessions}</strong>
          <small className="hint-text">Sesi berjalan</small>
        </div>
        <div className="stat-card">
          <small>Pendapatan hari ini</small>
          <strong className="stat-num">{rupiah(finance?.totalRevenue ?? 0)}</strong>
          <small className="hint-text">{finance?.totalPayments ?? 0} transaksi lunas</small>
        </div>
        <div className="stat-card">
          <small>Denda hari ini</small>
          <strong className="stat-num warn">{rupiah(finance?.penaltyRevenue ?? 0)}</strong>
          <small className="hint-text">{today?.totals.penalties ?? 0} pelanggaran</small>
        </div>
        <div className="stat-card">
          <small>Zona prioritas</small>
          <strong className="stat-num err">{today?.totals.highPriorityZones ?? 0}</strong>
          <small className="hint-text">Perlu pemeriksaan</small>
        </div>
      </div>

      <div className="grid mb-4">
        <section className="card">
          <div className="section-head">
            <div>
              <h3>Hunian zona</h3>
              <p className="hint-text" style={{ margin: 0 }}>
                {zones.filter((z) => z.occupancyRate >= 90).length} zona hampir penuh dari {zones.length}.
              </p>
            </div>
            <button type="button" className="secondary btn-sm" onClick={() => onNavigate('zones')}>
              Kelola zona
            </button>
          </div>
          {busiest.length === 0 ? (
            <p className="hint-text">Belum ada data zona.</p>
          ) : (
            <div className="overview-list overview-scroll">
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
            <div>
              <h3>Keuangan</h3>
              <p className="hint-text" style={{ margin: 0 }}>
                {peak ? `Puncak transaksi jam ${peak.hour}:00.` : 'Belum ada transaksi hari ini.'}
              </p>
            </div>
            <button type="button" className="secondary btn-sm" onClick={() => onNavigate('analytics')}>
              Analitik
            </button>
          </div>

          <div className="overview-money">
            <div>
              <small>Hari ini</small>
              <strong>{rupiah(finance?.totalRevenue ?? 0)}</strong>
            </div>
            <div>
              <small>7 hari terakhir</small>
              <strong>{rupiah(weekRevenue)}</strong>
            </div>
            <div>
              <small>Denda</small>
              <strong className={finance?.penaltyRevenue ? 'warn' : ''}>
                {rupiah(finance?.penaltyRevenue ?? 0)}
              </strong>
            </div>
          </div>

          <div className="overview-split">
            <div className="overview-split-row">
              <span className="overview-split-label">Motor</span>
              <div className="overview-meter">
                <div className="overview-meter-fill" style={{ width: `${motorShare}%` }} />
              </div>
              <span className="overview-row-value">{rupiah(finance?.byVehicle.motorcycle ?? 0)}</span>
            </div>
            <div className="overview-split-row">
              <span className="overview-split-label">Mobil</span>
              <div className="overview-meter">
                <div className="overview-meter-fill" style={{ width: `${100 - motorShare}%` }} />
              </div>
              <span className="overview-row-value">{rupiah(finance?.byVehicle.car ?? 0)}</span>
            </div>
          </div>

          <div className="day-bars">
            {daily.map((d) => (
              <div
                key={d.date}
                className="day-bar-item chart-tip"
                data-tip={`${d.date} — ${rupiah(d.revenue)}`}
              >
                <span className="day-bar-value">
                  {d.revenue > 0 ? `${Math.round(d.revenue / 1000)}k` : ''}
                </span>
                <div className="day-bar-fill" style={{ height: `${Math.max(3, (d.revenue / maxDay) * 100)}%` }} />
                <span className="day-bar-label">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid mb-4">
        <section className="card hour-card">
          <h3>Jam sibuk</h3>
          <p className="hint-text">
            {today && today.peakHours.length > 0
              ? `Puncak: ${today.peakHours.map((h) => `${h.hour}:00`).join(', ')}`
              : 'Belum ada aktivitas hari ini.'}
          </p>
          <div className="hour-bars">
            {hours.map((h) => (
              <div
                key={h.hour}
                className="hour-bar-item chart-tip"
                data-tip={`${h.hour}:00 — ${h.activity} aktivitas`}
              >
                <div
                  className="hour-bar-fill"
                  style={{ height: `${Math.max(3, (h.activity / maxHour) * 100)}%` }}
                />
                <span className="hour-bar-label">{h.hour}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h3>Aktivitas domain</h3>
              <p className="hint-text" style={{ margin: 0 }}>
                Domain teramai hari ini.
              </p>
            </div>
          </div>
          {domains.length === 0 ? (
            <p className="hint-text">Belum ada aktivitas.</p>
          ) : (
            <div className="overview-list overview-scroll">
              {domains.map((d) => (
                <div key={d.domainId} className="overview-row">
                  <div className="overview-row-main">
                    <span className="overview-row-title">{d.domainName}</span>
                    <span className="overview-row-sub">
                      {d.zones} zona · {d.occupancyRate}% hunian
                    </span>
                  </div>
                  <div className="overview-meter">
                    <div
                      className={`overview-meter-fill ${d.occupancyRate >= 90 ? 'full' : ''}`}
                      style={{ width: `${d.occupancyRate}%` }}
                    />
                  </div>
                  <span className="overview-row-value">{d.activity}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid">
        <section className="card">
          <div className="section-head">
            <div>
              <h3>Kualitas kamera gate</h3>
              <p className="hint-text" style={{ margin: 0 }}>
                Skor ketajaman, kecerahan, dan kontras frame.
              </p>
            </div>
            <button type="button" className="secondary btn-sm" onClick={() => onNavigate('analytics')}>
              Lihat analitik
            </button>
          </div>
          {gates.length === 0 ? (
            <p className="hint-text">Belum ada sampel kualitas kamera.</p>
          ) : (
            <div className="overview-list overview-scroll">
              {gates.map((g) => (
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
            <div>
              <h3>Sesi aktif terbaru</h3>
              <p className="hint-text" style={{ margin: 0 }}>
                {activeSessions} kendaraan masih di area parkir.
              </p>
            </div>
            <button type="button" className="secondary btn-sm" onClick={() => onNavigate('sessions')}>
              Semua sesi
            </button>
          </div>
          {sessions.length === 0 ? (
            <p className="hint-text">Tidak ada sesi aktif.</p>
          ) : (
            <div className="overview-list overview-scroll">
              {sessions.slice(0, 8).map((s) => (
                <div key={s.sessionCode} className="overview-row">
                  <div className="overview-row-main">
                    <span className="overview-row-title">
                      {s.plate ? <span className="plate-badge">{s.displayPlate || s.plate}</span> : s.sessionCode}
                    </span>
                    <span className="overview-row-sub">
                      {zones.find((z) => z.zoneId === s.zoneId)?.zoneName || s.zoneId} · {s.userName} ·{' '}
                      {elapsed(s.createdAt)}
                    </span>
                  </div>
                  <span className={`status-badge ${statusClass(s.status)}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="hint-text" style={{ marginTop: 14 }}>
        Diperbarui {updatedAt ? new Date(updatedAt).toLocaleTimeString('id-ID') : '—'} · data dari counter Redis per zona.
      </p>
    </div>
  );
}
