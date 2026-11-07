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
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchAnalytics({ from: from || undefined, to: to || undefined })
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
  }, [from, to]);

  const allZones = data?.zones ?? [];
  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(allZones.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageZones = allZones.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const maxHour = Math.max(1, ...(data?.hours.map((h) => h.activity) ?? [1]));
  const maxDay = Math.max(1, ...((data?.finance.daily ?? []).map((d) => d.revenue) || [1]));

  return (
    <div className="admin-session-monitor">
      <div className="page-toolbar">
        <div className="row" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 6 }}>
            <span className="hint-text" style={{ margin: 0 }}>Dari:</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
              style={{ width: 'auto' }}
            />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="hint-text" style={{ margin: 0 }}>Sampai:</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
              style={{ width: 'auto' }}
            />
          </label>
          {(from || to) && (
            <button
              type="button"
              className="secondary btn-sm"
              onClick={() => {
                setFrom('');
                setTo('');
                setPage(0);
              }}
            >
              Semua
            </button>
          )}
          <button type="button" className="secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Memuat…' : 'Segarkan'}
          </button>
        </div>
      </div>

      <p className="hint-text" style={{ marginTop: -6 }}>
        Periode: {from || to ? `${from || '…'} sampai ${to || '…'}` : 'semua waktu'} · okupansi selalu menampilkan kondisi saat ini.
      </p>

      {error && <div className="alert alert-err">{error}</div>}

      <div className="stat-strip mb-4">
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
              {pageZones.map((z) => (
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
              {data && allZones.length === 0 && (
                <tr>
                  <td colSpan={12} className="hint-text" style={{ textAlign: 'center', padding: 18 }}>
                    Belum ada aktivitas tercatat.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {allZones.length > PAGE_SIZE && (
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span className="hint-text" style={{ margin: 0 }}>
              Menampilkan {currentPage * PAGE_SIZE + 1}–
              {Math.min(allZones.length, (currentPage + 1) * PAGE_SIZE)} dari {allZones.length} zona
            </span>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="secondary btn-sm"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Sebelumnya
              </button>
              <span className="hint-text" style={{ margin: 0 }}>
                {currentPage + 1}/{totalPages}
              </span>
              <button
                type="button"
                className="secondary btn-sm"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                Berikutnya
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card mb-4">
        <h3>Kualitas kamera gate</h3>
        <p className="hint-text">
          Skor dari ketajaman, kecerahan, dan kontras frame kamera. Tren turun 3 sampel terakhir
          menandakan kamera perlu dibersihkan atau digeser.
        </p>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Gate</th>
                <th>Skor terakhir</th>
                <th>Rata-rata (EWMA)</th>
                <th>Rata-rata total</th>
                <th>Tren</th>
                <th>Sampel rendah</th>
                <th>Terakhir</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.gates ?? []).map((g) => (
                <tr key={g.gateId}>
                  <td>
                    <strong>{g.gateId}</strong>
                  </td>
                  <td>{g.lastScore}/100</td>
                  <td>{g.ewma}/100</td>
                  <td>
                    {g.average}/100 <small>({g.samples} sampel)</small>
                  </td>
                  <td className={g.trend < 0 ? 'err' : 'ok'}>
                    {g.trend > 0 ? '+' : ''}
                    {g.trend}
                  </td>
                  <td>{g.lowSamples}</td>
                  <td>
                    <small>{g.lastAt ? new Date(g.lastAt).toLocaleString('id-ID') : '—'}</small>
                  </td>
                  <td>
                    <span
                      className={`status-badge ${
                        g.status === 'baik' ? 'badge-parked' : g.status === 'menurun' ? 'badge-checkout' : 'badge-expired'
                      }`}
                    >
                      {g.status}
                    </span>
                  </td>
                </tr>
              ))}
              {data && data.gates.length === 0 && (
                <tr>
                  <td colSpan={8} className="hint-text" style={{ textAlign: 'center', padding: 18 }}>
                    Belum ada sampel kualitas kamera. Buka terminal gate untuk mulai mengirim data.
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
          <div className="table-scroll finance-scroll">
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

          <div className="table-scroll finance-scroll">
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
                {(data?.finance.byZone ?? []).map((z) => (
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
            <div
              key={d.date}
              className="day-bar-item chart-tip"
              data-tip={`${d.date} — ${formatRupiah(d.revenue)}`}
            >
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
          <div className="table-scroll table-scroll-4">
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

        <section className="card hour-card">
          <h3>Jam sibuk</h3>
          <p className="hint-text">
            {data && data.peakHours.length > 0
              ? `Puncak: ${data.peakHours.map((h) => `${h.hour}:00`).join(', ')}`
              : 'Belum ada data jam.'}
          </p>
          <div className="hour-bars">
            {(data?.hours ?? []).map((h) => (
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
      </div>

      <p className="hint-text">
        Diperbarui {data ? new Date(data.generatedAt).toLocaleTimeString('id-ID') : '—'} · data dihitung dari
        counter Redis per zona.
      </p>
    </div>
  );
}
