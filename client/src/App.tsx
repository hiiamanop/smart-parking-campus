import { useEffect, useState, useMemo } from 'react';
import QRCode from 'qrcode';

interface Domain {
  id: string;
  name: string;
  description?: string;
}

interface Zone {
  id: string;
  name: string;
  domainId: string;
  vehicleType?: 'car' | 'motorcycle';
  capacity: number;
  occupied: number;
  available: number;
  isFull: boolean;
  gateIn: string;
  gateOut: string;
}

interface ParkingSession {
  id: string;
  sessionCode: string;
  domainId: string;
  zoneId: string;
  userName: string;
  vehicleType: 'car' | 'motorcycle';
  eta: string;
  status: string;
  plate: string | null;
  displayPlate?: string;
  entryTime?: string;
  parkedTime?: string;
  checkoutTime?: string;
  exitTime?: string;
  exitCode?: string;
  bill?: {
    baseFee: number;
    penaltyFee: number;
    total: number;
    isOverstay: boolean;
  };
}

const API_BASE = typeof window !== 'undefined' && window.location.port === '5174' ? 'http://127.0.0.1:8788' : '';

const formatRupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

export function App() {
  const [activeTab, setActiveTab] = useState<'parking' | 'timeline'>('parking');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [redisLive, setRedisLive] = useState(false);
  const [exitNotice, setExitNotice] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(new Date());

  const [activeSession, setActiveSession] = useState<ParkingSession | null>(() => {
    try {
      const saved = localStorage.getItem('smart_parking_driver_real_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const updateSession = (sess: ParkingSession | null) => {
    setActiveSession(sess);
    try {
      if (sess) localStorage.setItem('smart_parking_driver_real_session', JSON.stringify(sess));
      else localStorage.removeItem('smart_parking_driver_real_session');
    } catch {}
  };

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/zones`)
      .then(async (r) => {
        const contentType = r.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) return null;
        return r.json();
      })
      .then((data) => {
        if (data && data.ok && Array.isArray(data.zones)) {
          setDomains(data.domains || []);
          setZones(data.zones || []);
        }
      })
      .catch((err) => console.warn('Gagal memuat /api/zones:', err));
  }, []);

  useEffect(() => {
    const code = activeSession?.sessionCode;
    if (!code) return;
    let cancelled = false;
    const validate = () => {
      fetch(`${API_BASE}/api/sessions/${code}`)
        .then(async (r) => {
          const contentType = r.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) return null;
          return r.json();
        })
        .then((res) => {
          if (cancelled || !res) return;
          if (!res.ok || !res.session) {
            updateSession(null);
            return;
          }
          if (res.session.status === 'COMPLETED' || res.session.status === 'EXPIRED') {
            updateSession(null);
          } else {
            updateSession(res.session);
          }
        })
        .catch(() => {});
    };
    validate();
    const onVis = () => {
      if (document.visibilityState === 'visible') validate();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sse = new EventSource(`${API_BASE}/api/events`);
    sse.onopen = () => setRedisLive(true);
    sse.onerror = () => setRedisLive(false);

    sse.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'ZONE_SNAPSHOT' || event.type === 'ZONE_UPDATED') {
          if (event.payload?.zones) setZones(event.payload.zones);
          if (event.payload?.domains) setDomains(event.payload.domains);
        }

        if (activeSession && (event.payload?.sessionCode === activeSession.sessionCode || event.type === 'GATE_EXIT_SUCCESS')) {
          if (event.type === 'GATE_EXIT_SUCCESS' && event.payload?.sessionCode === activeSession.sessionCode) {
            setExitNotice('Kendaraan tercatat keluar. Tiket ditutup.');
            setTimeout(() => {
              updateSession(null);
              setExitNotice(null);
            }, 2500);
          } else {
            fetch(`${API_BASE}/api/sessions/${activeSession.sessionCode}`)
              .then((r) => r.json())
              .then((res) => {
                if (res.ok && res.session) {
                  if (res.session.status === 'COMPLETED') {
                    setExitNotice('Kendaraan tercatat keluar. Tiket ditutup.');
                    setTimeout(() => {
                      updateSession(null);
                      setExitNotice(null);
                    }, 2500);
                  } else {
                    updateSession(res.session);
                  }
                }
              });
          }
        }
      } catch {}
    };

    return () => sse.close();
  }, [activeSession]);

  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <div className="brand-block">
          <img className="brand-logo" src="/logo-itb.png" alt="Logo ITB" />
          <div>
            <div className="brand-name">Parkir Kampus</div>
            <div className="brand-date">
              {now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' · '}
              {now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>

        <div className={`live-pill ${redisLive ? 'on' : ''}`}>
          <span className="live-dot" />
          {redisLive ? 'Tersinkron' : 'Luring'}
        </div>
      </header>

      {exitNotice && <div className="toast-notice">{exitNotice}</div>}

      <div className="mobile-content">
        {activeTab === 'parking' ? (
          <ExploreView
            domains={domains}
            zones={zones}
            onBookSuccess={(sess) => {
              updateSession(sess);
              setActiveTab('timeline');
            }}
          />
        ) : (
          <TimelineTicketView
            zones={zones}
            domains={domains}
            activeSession={activeSession}
            onUpdateSession={updateSession}
            onGoToExplore={() => setActiveTab('parking')}
          />
        )}
      </div>

      <nav className="mobile-bottom-nav">
        <button
          type="button"
          className={`bottom-tab-item ${activeTab === 'parking' ? 'active' : ''}`}
          onClick={() => setActiveTab('parking')}
        >
          Cari parkir
        </button>
        <button
          type="button"
          className={`bottom-tab-item ${activeTab === 'timeline' ? 'active' : ''}`}
          onClick={() => setActiveTab('timeline')}
        >
          Tiket saya
          {activeSession && <span className="tab-dot" />}
        </button>
      </nav>
    </div>
  );
}

// =========================================================================
// TAB 1 — Cari & pesan slot
// =========================================================================
function ExploreView({
  domains,
  zones,
  onBookSuccess,
}: {
  domains: Domain[];
  zones: Zone[];
  onBookSuccess: (sess: ParkingSession) => void;
}) {
  const [selectedPill, setSelectedPill] = useState<string>('all');
  const [selectedVehicle, setSelectedVehicle] = useState<'motorcycle' | 'car'>('motorcycle');
  const [searchQuery, setSearchQuery] = useState('');
  const [bottomSheetZone, setBottomSheetZone] = useState<Zone | null>(null);
  const [etaTime, setEtaTime] = useState('08:30');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalAvailable = useMemo(() => zones.reduce((a, b) => a + b.available, 0), [zones]);
  const totalCapacity = useMemo(() => zones.reduce((a, b) => a + b.capacity, 0), [zones]);
  const isMotorZone = (z: Zone) => (z.vehicleType || 'motorcycle') === 'motorcycle';
  const motorSpots = useMemo(
    () => zones.filter(isMotorZone).reduce((a, z) => a + z.available, 0),
    [zones]
  );
  const carSpots = useMemo(
    () => zones.filter((z) => !isMotorZone(z)).reduce((a, z) => a + z.available, 0),
    [zones]
  );

  const filteredZones = useMemo(() => {
    // Zone list follows the selected vehicle type
    let list = zones.filter((z) =>
      selectedVehicle === 'motorcycle' ? (z.vehicleType || 'motorcycle') === 'motorcycle' : z.vehicleType === 'car'
    );
    if (selectedPill !== 'all') list = list.filter((z) => z.domainId === selectedPill);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (z) => z.name.toLowerCase().includes(q) || z.domainId.toLowerCase().includes(q)
      );
    }
    return list;
  }, [zones, selectedPill, searchQuery, selectedVehicle]);

  const handleConfirmBooking = async () => {
    if (!bottomSheetZone) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domainId: bottomSheetZone.domainId,
          zoneId: bottomSheetZone.id,
          userName: 'Pengguna Kampus',
          vehicleType: selectedVehicle,
          eta: etaTime,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Pemesanan slot gagal');

      setBottomSheetZone(null);
      onBookSuccess(data.session);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <section className="summary-panel">
        <div className="summary-main">
          <span className="summary-number">{totalAvailable}</span>
          <span className="summary-unit">slot tersedia</span>
        </div>
        <div className="summary-meta">
          {totalCapacity} kapasitas · {zones.length} zona
        </div>
      </section>

      <h1 className="headline-title">Pesan tempat parkir</h1>
      <p className="page-sub">Pilih area, kendaraan, dan perkiraan waktu tiba.</p>

      <div className="search-bar">
        <input
          className="search-field"
          type="text"
          placeholder="Cari zona atau fakultas"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="filter-scroll">
        <button
          type="button"
          className={`filter-chip ${selectedPill === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedPill('all')}
        >
          Semua area
        </button>
        {domains.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`filter-chip ${selectedPill === f.id ? 'active' : ''}`}
            onClick={() => setSelectedPill(f.id)}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div className="section-head">
        <h2 className="section-title">Jenis kendaraan</h2>
      </div>

      <div className="vehicle-row">
        <button
          type="button"
          className={`vehicle-card ${selectedVehicle === 'motorcycle' ? 'selected' : ''}`}
          onClick={() => setSelectedVehicle('motorcycle')}
        >
          <span className="vehicle-label">Motor</span>
          <span className="vehicle-spots">{motorSpots} slot</span>
          <span className="vehicle-price">Rp1.000 / Rp2.000</span>
        </button>

        <button
          type="button"
          className={`vehicle-card ${selectedVehicle === 'car' ? 'selected' : ''}`}
          onClick={() => setSelectedVehicle('car')}
        >
          <span className="vehicle-label">Mobil</span>
          <span className="vehicle-spots">{carSpots} slot</span>
          <span className="vehicle-price">Rp2.000 / Rp3.000</span>
        </button>
      </div>

      <div className="section-head">
        <h2 className="section-title">Zona parkir</h2>
        <span className="section-count">{filteredZones.length} area</span>
      </div>

      {filteredZones.length === 0 ? (
        <div className="empty-state">
          <strong>{zones.length === 0 ? 'Menghubungkan ke server' : 'Tidak ada zona yang cocok'}</strong>
          <p>
            {zones.length === 0
              ? 'Data ketersediaan slot sedang dimuat.'
              : 'Ubah kata kunci pencarian atau filter fakultas.'}
          </p>
        </div>
      ) : (
        <div className="zone-list-scroll">
          {filteredZones.map((z) => {
            const fac = domains.find((f) => f.id === z.domainId);
            const ratio = z.capacity > 0 ? Math.round((z.occupied / z.capacity) * 100) : 0;
            return (
              <article key={z.id} className="zone-item">
                <div className="zone-item-top">
                  <div>
                    <h3 className="zone-item-name">{z.name}</h3>
                    <div className="zone-item-sub">
                      {fac?.name || z.domainId} · {z.vehicleType === 'car' ? 'Mobil' : 'Motor'}
                    </div>
                  </div>
                  <div className={`zone-count ${z.isFull ? 'full' : ''}`}>
                    <span className="zone-count-number">{z.isFull ? '0' : z.available}</span>
                    <span className="zone-count-label">{z.isFull ? 'penuh' : 'tersedia'}</span>
                  </div>
                </div>

                <div className="meter">
                  <div className={`meter-fill ${z.isFull ? 'full' : ''}`} style={{ width: `${ratio}%` }} />
                </div>

                <div className="zone-item-bottom">
                  <span className="zone-item-meta">
                    {z.occupied}/{z.capacity} terisi · {z.gateIn}
                  </span>
                  <button
                    type="button"
                    className="btn-primary-sm"
                    disabled={z.isFull}
                    onClick={() => setBottomSheetZone(z)}
                  >
                    {z.isFull ? 'Penuh' : 'Pesan slot'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {bottomSheetZone && (
        <div className="sheet-backdrop" onClick={() => setBottomSheetZone(null)}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h3>Konfirmasi pesanan</h3>
              <button type="button" className="icon-close" onClick={() => setBottomSheetZone(null)}>
                Tutup
              </button>
            </div>

            {err && <div className="alert-message err">{err}</div>}

            <dl className="detail-list">
              <div className="detail-row">
                <dt>Zona</dt>
                <dd>{bottomSheetZone.name}</dd>
              </div>
              <div className="detail-row">
                <dt>Kendaraan</dt>
                <dd>{selectedVehicle === 'car' ? 'Mobil' : 'Motor'}</dd>
              </div>
              <div className="detail-row">
                <dt>Tarif</dt>
                <dd>
                  {selectedVehicle === 'car'
                    ? 'Rp2.000 (<1 jam) · Rp3.000 (>1 jam)'
                    : 'Rp1.000 (<1 jam) · Rp2.000 (>1 jam)'}
                </dd>
              </div>
            </dl>

            <label className="field-label">
              Perkiraan waktu tiba
              <input
                type="time"
                value={etaTime}
                onChange={(e) => setEtaTime(e.target.value)}
                className="time-input"
              />
            </label>
            <p className="field-hint">
              Plat nomor tidak perlu diisi. Kamera gate membaca plat otomatis saat kendaraan tiba.
            </p>

            <button type="button" className="btn-primary-block" disabled={loading} onClick={handleConfirmBooking}>
              {loading ? 'Menerbitkan tiket…' : 'Konfirmasi & terbitkan tiket'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// TAB 2 — Tiket & sesi parkir
// =========================================================================
function TimelineTicketView({
  zones,
  domains,
  activeSession,
  onUpdateSession,
  onGoToExplore,
}: {
  zones: Zone[];
  domains: Domain[];
  activeSession: ParkingSession | null;
  onUpdateSession: (sess: ParkingSession | null) => void;
  onGoToExplore: () => void;
}) {
  const [qrUrl, setQrUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [zoneQr, setZoneQr] = useState('');

  useEffect(() => {
    const code = activeSession?.exitCode || activeSession?.sessionCode;
    if (code) {
      QRCode.toDataURL(code, { width: 170, margin: 2 })
        .then(setQrUrl)
        .catch((err) => console.warn('QR gen error:', err));
    }
  }, [activeSession?.sessionCode, activeSession?.exitCode]);

  useEffect(() => {
    if (activeSession?.entryTime && activeSession.status !== 'COMPLETED') {
      const startMs = new Date(activeSession.entryTime).getTime();
      const update = () => {
        const diff = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        setElapsedSec(diff);
      };
      update();
      const iv = setInterval(update, 1000);
      return () => clearInterval(iv);
    }
  }, [activeSession?.entryTime, activeSession?.status]);

  const hrs = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');

  const currentZone = zones.find((z) => z.id === activeSession?.zoneId);
  const currentDomain = domains.find(
    (d) => d.id === (activeSession?.domainId || currentZone?.domainId)
  );

  // Accepts a physical zone QR payload ("CAMPUS-ZONE-<zoneId>") or a raw zone id
  const parseZoneQr = (raw: string) => {
    const value = raw.trim();
    const match = value.match(/CAMPUS-ZONE-(.+)$/i);
    return match ? match[1].trim() : value;
  };

  const handleZoneAction = async (action: 'confirm_park' | 'checkout') => {
    if (!activeSession) return;
    const scannedZoneId = parseZoneQr(zoneQr);
    if (!scannedZoneId) {
      setStatusMsg({ ok: false, text: 'Pindai atau masukkan kode QR zona terlebih dahulu.' });
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/zones/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionCode: activeSession.sessionCode,
          scannedZoneId,
          action,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Aksi zona gagal');
      onUpdateSession(data.session);
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handlePay = async () => {
    if (!activeSession) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/payments/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: activeSession.sessionCode, paymentMethod: 'QRIS' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Pembayaran gagal');
      onUpdateSession(data.session);
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  if (!activeSession) {
    return (
      <div className="empty-state tall">
        <strong>Belum ada tiket aktif</strong>
        <p>Pesan slot terlebih dahulu untuk mendapatkan tiket QR parkir.</p>
        <button type="button" className="btn-primary-block" onClick={onGoToExplore}>
          Cari slot parkir
        </button>
      </div>
    );
  }

  if (activeSession.status === 'BOOKED') {
    return (
      <div>
        <div className="page-nav">
          <button type="button" className="icon-nav" onClick={onGoToExplore}>
            Kembali
          </button>
          <span className="page-nav-title">Tiket parkir</span>
          <button type="button" className="icon-nav" onClick={() => onUpdateSession(null)}>
            Batalkan
          </button>
        </div>

        {statusMsg && (
          <div className={`alert-message ${statusMsg.ok ? 'ok' : 'err'}`}>{statusMsg.text}</div>
        )}

        <div className="ticket">
          <div className="ticket-top">
            <div className="ticket-badge">Belum masuk</div>
            <h2 className="ticket-title">Tiket parkir terbit</h2>
            <p className="ticket-lead">
              Tunjukkan QR ini ke pemindai di palang masuk. Palang terbuka setelah plat nomor terbaca.
            </p>

            <div className="ticket-meta">
              <div>
                <span className="ticket-meta-label">Zona</span>
                <span className="ticket-meta-value">{currentZone?.name || activeSession.zoneId}</span>
              </div>
              <div>
                <span className="ticket-meta-label">Domain</span>
                <span className="ticket-meta-value">{currentDomain?.name || activeSession.domainId}</span>
              </div>
              <div>
                <span className="ticket-meta-label">ETA</span>
                <span className="ticket-meta-value">{activeSession.eta}</span>
              </div>
            </div>
          </div>

          <div className="ticket-divider">
            <span className="notch left" />
            <span className="dash" />
            <span className="notch right" />
          </div>

          <div className="ticket-bottom">
            <div className="qr-frame">
              {qrUrl && <img src={qrUrl} alt="QR tiket" width={170} height={170} />}
            </div>
            <div className="ticket-code-label">Nomor tiket</div>
            <div className="ticket-code">#{activeSession.sessionCode}</div>
          </div>
        </div>

        <div className="note-box">
          <strong>Di gate masuk.</strong> Tempelkan QR ke pemindai. Kamera membaca plat kendaraan, lalu palang terbuka otomatis.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-nav">
        <button type="button" className="icon-nav" onClick={onGoToExplore}>
          Kembali
        </button>
        <span className="page-nav-title">Sesi berjalan</span>
        <button
          type="button"
          className="icon-nav"
          onClick={() => {
            if (confirm('Batalkan sesi ini?')) {
              onUpdateSession(null);
              onGoToExplore();
            }
          }}
        >
          Batalkan
        </button>
      </div>

      {statusMsg && (
        <div className={`alert-message ${statusMsg.ok ? 'ok' : 'err'}`}>{statusMsg.text}</div>
      )}

      <section className="timer-panel">
        <div className="timer-caption">Durasi parkir</div>
        <div className="timer-digits">
          {hrs}:{mins}:{secs}
        </div>
        <div className="timer-units">
          <span>jam</span>
          <span>menit</span>
          <span>detik</span>
        </div>
      </section>

      <dl className="detail-list">
        <div className="detail-row">
          <dt>Zona</dt>
          <dd>{currentZone?.name || activeSession.zoneId}</dd>
        </div>
        <div className="detail-row">
          <dt>Plat nomor</dt>
          <dd>
            <span className="plate-chip">{activeSession.plate || 'Belum terbaca'}</span>
          </dd>
        </div>
        <div className="detail-row">
          <dt>Waktu masuk</dt>
          <dd>
            {activeSession.entryTime
              ? new Date(activeSession.entryTime).toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : activeSession.eta}
          </dd>
        </div>
        <div className="detail-row">
          <dt>Pembayaran</dt>
          <dd className={activeSession.status === 'PAID' ? 'text-ok' : 'text-warn'}>
            {activeSession.status === 'PAID'
              ? `Lunas · ${formatRupiah(activeSession.bill?.total ?? 2000)}`
              : `Belum dibayar · ${formatRupiah(activeSession.bill?.total ?? 2000)}`}
          </dd>
        </div>
      </dl>

      {(activeSession.status === 'ENTERED' || activeSession.status === 'PARKED_CONFIRMED') && (
        <label className="field-label">
          Kode QR zona yang dipindai
          <input
            className="time-input"
            type="text"
            placeholder="CAMPUS-ZONE-…"
            value={zoneQr}
            onChange={(e) => setZoneQr(e.target.value)}
          />
        </label>
      )}

      {activeSession.status === 'ENTERED' && (
        <div>
          <p className="action-hint">
            Tempelkan QR tiang zona ke kamera. Sesi ini hanya sah di zona tujuan Anda.
          </p>
          <button type="button" className="btn-primary-block" disabled={loading} onClick={() => handleZoneAction('confirm_park')}>
            {loading ? 'Memproses…' : 'Konfirmasi tiba di zona'}
          </button>
        </div>
      )}

      {activeSession.status === 'PARKED_CONFIRMED' && (
        <button type="button" className="btn-primary-block" disabled={loading} onClick={() => handleZoneAction('checkout')}>
          {loading ? 'Memproses…' : 'Selesai parkir'}
        </button>
      )}

      {activeSession.status === 'CHECKOUT_REQUESTED' && (
        <button type="button" className="btn-primary-block" disabled={loading} onClick={handlePay}>
          {loading
            ? 'Memproses…'
            : `Bayar ${formatRupiah(activeSession.bill?.total ?? 2000)} via QRIS`}
        </button>
      )}

      {activeSession.status === 'PAID' && (
        <div>
          <div className="exit-qr">
            <div className="qr-frame">
              {qrUrl && <img src={qrUrl} alt="QR keluar" width={150} height={150} />}
            </div>
            <div className="ticket-code-label">QR keluar</div>
            <div className="ticket-code small">{activeSession.exitCode}</div>
            <div className="exit-qr-plate">Plat terdaftar {activeSession.plate}</div>
          </div>

          <div className="note-box">
            <strong>Di gate keluar.</strong> Tempelkan QR ini ke pemindai. Kamera memverifikasi plat sebelum palang terbuka.
          </div>
        </div>
      )}
    </div>
  );
}
