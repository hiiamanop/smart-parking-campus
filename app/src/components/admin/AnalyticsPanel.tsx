import { useEffect, useState } from 'react';
import type { Analytics, ZoneAnalytics } from '../../types';
import { fetchAnalytics } from '../../lib/api';

const formatRupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

function priorityClass(p: ZoneAnalytics['priority']) {
  if (p === 'tinggi') return 'badge-expired';
  if (p === 'sedang') return 'badge-checkout';
  return 'badge-parked';
}

function formatRelative(iso: string | null) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

export function AnalyticsPanel() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchAnalytics()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, []);

  const maxHour = Math.max(1, ...(data?.hours.map((h) => h.activity) ?? [1]));
  const maxDay = Math.max(1, ...((data?.finance.daily ?? []).map((d) => d.revenue) || [1]));

  return (
    <div className="admin-session-monitor">
      <div className="section-header row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Analitik &amp; perawatan preventif</h2>
          <p className="hint-text" style={{ margin: 0 }}>
            Zona dengan aktivitas tertinggi menandakan titik yang paling cepat aus — kamera gate di sana
            perlu diperiksa lebih sering.
          </p>
        </div>
        <button type="button" className="secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Memuat…' : 'Segarkan'}
        </button>
      </div>

      {error && <div className="alert alert-err">{error}</div>}

      <div className="grid mb-4">
        <div className="card stat-card">
          <small>Total aktivitas</small>
          <strong className="stat-num">{data?.totals.activity ?? 0}</strong>
          <small className="hint-text">Booking, masuk, dan keluar</small>
        </div>
        <div className="card stat-card">
          <small>Zona prioritas tinggi</small>
          <strong className="stat-num err">{data?.totals.highPriorityZones ?? 0}</strong>
          <small className="hint-text">Periksa harian</small>
        </div>
        <div className="card stat-card">
          <small>Override manual petugas</small>
          <strong className="stat-num warn">{data?.totals.manualOverrides ?? 0}</strong>
          <small className="hint-text">Indikasi kamera gagal baca</small>
        </div>
        <div className="card stat-card">
          <small>Mismatch plat keluar</small>
          <strong className="stat-num err">{data?.totals.mismatches ?? 0}</strong>
          <small className="hint-text">Cek akurasi VLM</small>
        </div>
        <div className="card stat-card">
          <small>Pelanggaran zona</small>
          <strong className="stat-num err">{data?.totals.zoneViolations ?? 0}</strong>
          <small className="hint-text">Scan QR di zona bukan haknya</small>
        </div>
      </div>

      <section className="card mb-4">
        <h3>Prioritas pemeriksaan per zona</h3>
        <p className="hint-text">
          Skor = 55% volume aktivitas + 30% override manual + 15% mismatch plat.
        </p>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Zona</th>
                <th>Domain</th>
                <th>Aktivitas</th>
                <th>Masuk / keluar</th>
                <th>Override</th>
                <th>Mismatch</th>
                <th>Pelanggaran zona</th>
                <th>Hunian</th>
                <th>Aktivitas terakhir</th>
                <th>Skor</th>
                <th>Prioritas</th>
                <th>Cek tiap</th>
              </tr>
            </thead>
            <tbody>
              {(data?.zones ?? []).map((z) => (
                <tr key={z.zoneId}>
                  <td>
                    <strong>{z.zoneName}</strong>
                  </td>
                  <td>{z.domainId}</td>
                  <td>{z.activity}</td>
                  <td>
                    {z.entries} / {z.exits}
                  </td>
                  <td>{z.manualOverrides}</td>
                  <td>{z.mismatches}</td>
                  <td>{z.zoneViolations}</td>
                  <td>{z.occupancyRate}%</td>
                  <td>
                    <small>{formatRelative(z.lastActivity)}</small>
                  </td>
                  <td>
                    <strong>{z.maintenanceScore}</strong>
                  </td>
                  <td>
                    <span className={`status-badge ${priorityClass(z.priority)}`}>{z.priority}</span>
                  </td>
                  <td>{z.checkIntervalDays} hari</td>
                </tr>
              ))}
              {data && data.zones.length === 0 && (
                <tr>
                  <td colSpan={12} className="hint-text" style={{ textAlign: 'center', padding: 18 }}>
                    Belum ada aktivitas tercatat.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card mb-4">
        <h3>Keuangan</h3>
        <p className="hint-text">
          Pendapatan tercatat sejak counter keuangan aktif; transaksi lama sebelum itu tidak ikut dihitung.
        </p>

        <div className="grid mb-4">
          <div className="stat-card">
            <small>Total pendapatan</small>
            <strong className="stat-num">{formatRupiah(data?.finance.totalRevenue ?? 0)}</strong>
            <small className="hint-text">{data?.finance.totalPayments ?? 0} transaksi lunas</small>
          </div>
          <div className="stat-card">
            <small>Rata-rata per transaksi</small>
            <strong className="stat-num">
              {formatRupiah(
                data && data.finance.totalPayments > 0
                  ? Math.round(data.finance.totalRevenue / data.finance.totalPayments)
                  : 0
              )}
            </strong>
            <small className="hint-text">Tarif berjenjang per kendaraan &amp; durasi</small>
          </div>
          <div className="stat-card">
            <small>Motor</small>
            <strong className="stat-num">{formatRupiah(data?.finance.byVehicle.motorcycle ?? 0)}</strong>
            <small className="hint-text">Rp1.000 &lt;1 jam · Rp2.000 setelahnya</small>
          </div>
          <div className="stat-card">
            <small>Mobil</small>
            <strong className="stat-num">{formatRupiah(data?.finance.byVehicle.car ?? 0)}</strong>
            <small className="hint-text">Rp2.000 &lt;1 jam · Rp3.000 setelahnya</small>
          </div>
        </div>

        <div className="grid">
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Pendapatan</th>
                  <th>Transaksi</th>
                  <th>Rata-rata</th>
                </tr>
              </thead>
              <tbody>
                {(data?.finance.byDomain ?? []).map((d) => (
                  <tr key={d.domainId}>
                    <td>
                      <strong>{d.domainName}</strong>
                    </td>
                    <td>{formatRupiah(d.revenue)}</td>
                    <td>{d.payments}</td>
                    <td>{formatRupiah(d.average)}</td>
                  </tr>
                ))}
                {data && data.finance.byDomain.length === 0 && (
                  <tr>
                    <td colSpan={4} className="hint-text" style={{ textAlign: 'center', padding: 18 }}>
                      Belum ada transaksi.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>Pendapatan</th>
                  <th>Transaksi</th>
                  <th>Rata-rata</th>
                </tr>
              </thead>
              <tbody>
                {(data?.finance.byZone ?? []).slice(0, 8).map((z) => (
                  <tr key={z.zoneId}>
                    <td>
                      <strong>{z.zoneName}</strong>
                    </td>
                    <td>{formatRupiah(z.revenue)}</td>
                    <td>{z.payments}</td>
                    <td>{formatRupiah(z.average)}</td>
                  </tr>
                ))}
                {data && data.finance.byZone.length === 0 && (
                  <tr>
                    <td colSpan={4} className="hint-text" style={{ textAlign: 'center', padding: 18 }}>
                      Belum ada transaksi.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <h4 style={{ marginTop: 18 }}>Pendapatan 7 hari terakhir</h4>
        <div className="day-bars">
          {(data?.finance.daily ?? []).map((d) => (
            <div key={d.date} className="day-bar-item" title={`${d.date} — ${formatRupiah(d.revenue)}`}>
              <span className="day-bar-value">{d.revenue > 0 ? `${Math.round(d.revenue / 1000)}k` : ''}</span>
              <div className="day-bar-fill" style={{ height: `${Math.max(3, (d.revenue / maxDay) * 100)}%` }} />
              <span className="day-bar-label">{d.date.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid mb-4">
        <section className="card">
          <h3>Aktivitas per domain</h3>
          <p className="hint-text">Domain paling ramai jadi kandidat penambahan CCTV dan pengecekan rutin.</p>
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Zona</th>
                  <th>Aktivitas</th>
                  <th>Hunian</th>
                  <th>Override</th>
                  <th>Mismatch</th>
                  <th>Pelanggaran zona</th>
                </tr>
              </thead>
              <tbody>
                {(data?.domains ?? []).map((d) => (
                  <tr key={d.domainId}>
                    <td>
                      <strong>{d.domainName}</strong>
                    </td>
                    <td>{d.zones}</td>
                    <td>{d.activity}</td>
                    <td>{d.occupancyRate}%</td>
                    <td>{d.manualOverrides}</td>
                    <td>{d.mismatches}</td>
                    <td>{d.zoneViolations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h3>Jam sibuk</h3>
          <p className="hint-text">
            {data && data.peakHours.length > 0
              ? `Puncak: ${data.peakHours.map((h) => `${h.hour}:00`).join(', ')}`
              : 'Belum ada data jam.'}
          </p>
          <div className="hour-bars">
            {(data?.hours ?? []).map((h) => (
              <div key={h.hour} className="hour-bar-item" title={`${h.hour}:00 — ${h.activity} aktivitas`}>
                <div
                  className="hour-bar-fill"
                  style={{ height: `${Math.max(3, (h.activity / maxHour) * 100)}%` }}
                />
                <span className="hour-bar-label">{h.hour}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="hint-text">
        Diperbarui {data ? new Date(data.generatedAt).toLocaleTimeString('id-ID') : '—'} · data dihitung dari
        counter Redis per zona.
      </p>
    </div>
  );
}
