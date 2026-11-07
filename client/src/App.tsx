import { useEffect, useState, useMemo } from 'react';
import QRCode from 'qrcode';

interface Faculty {
  id: string;
  name: string;
  defaultZoneId: string;
}

interface Zone {
  id: string;
  name: string;
  facultyId: string;
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
  facultyId: string;
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

export function App() {
  const [activeTab, setActiveTab] = useState<'parking' | 'timeline'>('parking');
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [redisLive, setRedisLive] = useState(false);
  const [exitNotice, setExitNotice] = useState<string | null>(null);

  // Active Parking Session in localStorage
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

  // Load Zones Master Data
  useEffect(() => {
    fetch('/api/zones')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setFaculties(data.faculties);
          setZones(data.zones);
        }
      })
      .catch(() => {});
  }, []);

  // Rehydrate & validate stored session on load (anonymous: session lives in localStorage)
  useEffect(() => {
    const code = activeSession?.sessionCode;
    if (!code) return;
    let cancelled = false;
    const validate = () => {
      fetch(`/api/sessions/${code}`)
        .then((r) => r.json())
        .then((res) => {
          if (cancelled) return;
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
    const onVis = () => { if (document.visibilityState === 'visible') validate(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live Redis Pub/Sub SSE
  useEffect(() => {
    const sse = new EventSource('/api/events');
    sse.onopen = () => setRedisLive(true);
    sse.onerror = () => setRedisLive(false);

    sse.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'ZONE_SNAPSHOT' || event.type === 'ZONE_UPDATED') {
          if (event.payload?.zones) setZones(event.payload.zones);
          if (event.payload?.faculties) setFaculties(event.payload.faculties);
        }

        // Live sync active session whenever gate or zone action occurs
        if (activeSession && (event.payload?.sessionCode === activeSession.sessionCode || event.type === 'GATE_EXIT_SUCCESS')) {
          if (event.type === 'GATE_EXIT_SUCCESS' && event.payload?.sessionCode === activeSession.sessionCode) {
            setExitNotice('Kendaraan berhasil keluar. Palang gate terbuka, tiket dihapus.');
            setTimeout(() => { updateSession(null); setExitNotice(null); }, 2500);
          } else {
            fetch(`/api/sessions/${activeSession.sessionCode}`)
              .then((r) => r.json())
              .then((res) => {
                if (res.ok && res.session) {
                  if (res.session.status === 'COMPLETED') {
                    setExitNotice('Kendaraan berhasil keluar. Palang gate terbuka, tiket dihapus.');
                    setTimeout(() => { updateSession(null); setExitNotice(null); }, 2500);
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
      {/* Top Profile Header (Matches Image #1) */}
      <header className="mobile-header">
        <div className="profile-group">
          <img
            className="profile-avatar"
            src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
            alt="Profile Avatar"
          />
          <div>
            <div className="profile-name-text">Pengemudi (Anonim)</div>
            <div className="profile-date-text">Oct 29, Wednesday</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="bell-icon-btn">
            <span>🔔</span>
            <span className="bell-alert-dot" />
          </div>
        </div>
      </header>

      {exitNotice && (
        <div className="exit-notice-toast">
          ✅ {exitNotice}
        </div>
      )}
      {/* Main Mobile Content Area */}
      <div className="mobile-content">
        {activeTab === 'parking' ? (
          <ExploreView
            faculties={faculties}
            zones={zones}
            onBookSuccess={(sess) => {
              updateSession(sess);
              setActiveTab('timeline');
            }}
          />
        ) : (
          <TimelineTicketView
            zones={zones}
            faculties={faculties}
            activeSession={activeSession}
            onUpdateSession={updateSession}
            onGoToExplore={() => setActiveTab('parking')}
          />
        )}
      </div>

      {/* Fixed Bottom Dock: Exactly 2 Tabs (Matches Image #1 & #3) */}
      <nav className="mobile-bottom-nav">
        <button
          type="button"
          className={`bottom-tab-item ${activeTab === 'parking' ? 'active' : ''}`}
          onClick={() => setActiveTab('parking')}
        >
          <span className="bottom-tab-icon">🚗</span>
          <span>Parking</span>
        </button>

        <button
          type="button"
          className={`bottom-tab-item ${activeTab === 'timeline' ? 'active' : ''}`}
          onClick={() => setActiveTab('timeline')}
        >
          <span className="bottom-tab-icon">⏱️</span>
          <span>{activeSession ? 'Timeline ●' : 'Timeline'}</span>
        </button>
      </nav>
    </div>
  );
}

// =========================================================================
// TAB 1: PARKING (EXPLORE & SLOTS) - Matches Image #1 & Image #2
// =========================================================================
function ExploreView({
  faculties,
  zones,
  onBookSuccess,
}: {
  faculties: Faculty[];
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
  const motorSpots = Math.round(totalAvailable * 0.65);
  const carSpots = totalAvailable - motorSpots;

  const filteredZones = useMemo(() => {
    let list = zones;
    if (selectedPill !== 'all') list = list.filter((z) => z.facultyId === selectedPill);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((z) => z.name.toLowerCase().includes(q) || z.facultyId.toLowerCase().includes(q));
    }
    return list;
  }, [zones, selectedPill, searchQuery]);

  // Book Spot - NO PLATE INPUT (VLM reads at Gate In!) & NO ETD (only ETA, flat Rp2.000)
  const handleConfirmBooking = async () => {
    if (!bottomSheetZone) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facultyId: bottomSheetZone.facultyId,
          zoneId: bottomSheetZone.id,
          userName: 'Pearl Plaha',
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
      <h1 className="headline-title">Reserve a parking space</h1>

      {/* Search Bar */}
      <div className="search-bar-mobile">
        <span className="search-icon-svg">🔍</span>
        <input
          className="search-field-input"
          type="text"
          placeholder="Tell us where you want to go"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <span style={{ fontSize: 16, color: 'var(--text-muted)' }}>🎙️</span>
      </div>

      {/* Horizontal Category Pills */}
      <div className="category-pills-scroll">
        <button
          type="button"
          className={`category-pill ${selectedPill === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedPill('all')}
        >
          <span>⭐</span>
          <span>Semua ({zones.length})</span>
        </button>
        {faculties.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`category-pill ${selectedPill === f.id ? 'active' : ''}`}
            onClick={() => setSelectedPill(f.id)}
          >
            <span>🏛️</span>
            <span>{f.name}</span>
          </button>
        ))}
      </div>

      {/* Vehicle Selector: Only Two-Wheeler & Four-Wheeler (NO three-wheeler) */}
      <h3 className="sub-headline">What are you driving today?</h3>
      <p className="sub-caption">Helping you find best routes and parking areas</p>

      <div className="vehicles-horizontal-row">
        <div
          className={`vehicle-box ${selectedVehicle === 'motorcycle' ? 'selected' : ''}`}
          onClick={() => setSelectedVehicle('motorcycle')}
        >
          <span className="vehicle-spots-tag">{motorSpots} Spots</span>
          <div className="vehicle-emoji">🏍️</div>
          <div className="vehicle-label">Two-Wheeler</div>
          <div className="vehicle-price-sub">Rp2.000 / flat</div>
        </div>

        <div
          className={`vehicle-box ${selectedVehicle === 'car' ? 'selected' : ''}`}
          onClick={() => setSelectedVehicle('car')}
        >
          <span className="vehicle-spots-tag">{carSpots} Spots</span>
          <div className="vehicle-emoji">🚗</div>
          <div className="vehicle-label">Four-Wheeler</div>
          <div className="vehicle-price-sub">Rp2.000 / flat</div>
        </div>
      </div>

      {/* Showing parking plots near you */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 8 }}>
        <h3 className="sub-headline" style={{ margin: 0 }}>Showing parking plots near you</h3>
        <span style={{ fontSize: 12, color: '#4f46e5', fontWeight: 700 }}>View all</span>
      </div>

      <div>
        {filteredZones.map((z) => {
          const fac = faculties.find((f) => f.id === z.facultyId);
          return (
            <div key={z.id} className="plot-mobile-card">
              <div className="plot-image-header">
                <img
                  className="plot-img"
                  src="https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=500&auto=format&fit=crop&q=80"
                  alt={z.name}
                />
                <span className="rating-pill-float">⭐ 4.2 (50+)</span>
              </div>

              <div className="plot-card-content">
                <h4 className="plot-card-name">{z.name}</h4>
                <div className="plot-card-sub">Plot: {z.gateIn} • Dekat {fac?.name || z.facultyId}</div>
                <div className="plot-card-meta">
                  <span>⏱️ 10 mins</span>
                  <span>📍 1.2 km away</span>
                  <span>🔒 VLM Gate Guard</span>
                </div>

                <div className="plot-card-bottom">
                  <div className="plot-rate-num">
                    Rp2.000 <small style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>/ 4 hrs</small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="plot-spots-badge">
                      {z.isFull ? 'Penuh' : `${z.available} spots left`}
                    </span>
                    <button
                      type="button"
                      className="book-spot-btn"
                      disabled={z.isFull}
                      onClick={() => setBottomSheetZone(z)}
                    >
                      Book Spot
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Sheet Booking Confirmation (Matches Image #2 Screen 3) */}
      {bottomSheetZone && (
        <div className="bottom-sheet-backdrop" onClick={() => setBottomSheetZone(null)}>
          <div className="bottom-sheet-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>Select your vehicle</h3>
              <button
                type="button"
                onClick={() => setBottomSheetZone(null)}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {err && <div className="alert-message err">{err}</div>}

            <div style={{ background: '#f8fafc', padding: 12, borderRadius: 12, marginBottom: 14, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--text-muted)' }}>Lokasi Zona:</span>
                <strong>{bottomSheetZone.name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--text-muted)' }}>Kendaraan:</span>
                <strong>{selectedVehicle === 'car' ? 'Four-Wheeler' : 'Two-Wheeler'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--text-muted)' }}>Tarif Flat:</span>
                <strong style={{ color: '#4f46e5' }}>Rp2.000 / 4 hrs</strong>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                ESTIMASI TIBA (ETA):
              </label>
              <input
                type="time"
                value={etaTime}
                onChange={(e) => setEtaTime(e.target.value)}
                style={{
                  width: '100%',
                  padding: 10,
                  borderRadius: 10,
                  border: '1.5px solid var(--border-strong)',
                  fontSize: 15,
                  fontWeight: 700,
                }}
              />
              <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 4 }}>
                *Tidak perlu ketik plat nomor. Kamera AI VLM di gate masuk akan otomatis membaca plat kendaraan Anda.
              </small>
            </div>

            <button
              type="button"
              className="btn-cta-purple"
              disabled={loading}
              onClick={handleConfirmBooking}
            >
              {loading ? 'Menerbitkan Tiket...' : 'Book Spot'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// TAB 2: TIMELINE (TICKET & CURRENT PARKING) - Matches Image #3
// =========================================================================
function TimelineTicketView({
  zones,
  faculties,
  activeSession,
  onUpdateSession,
  onGoToExplore,
}: {
  zones: Zone[];
  faculties: Faculty[];
  activeSession: ParkingSession | null;
  onUpdateSession: (sess: ParkingSession | null) => void;
  onGoToExplore: () => void;
}) {
  const [qrUrl, setQrUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Live Timer for elapsed duration
  const [elapsedSec, setElapsedSec] = useState(0);

  // Generate QR for Session / Exit
  useEffect(() => {
    const code = activeSession?.exitCode || activeSession?.sessionCode;
    if (code) {
      QRCode.toDataURL(code, { width: 170, margin: 2 }).then(setQrUrl);
    }
  }, [activeSession?.sessionCode, activeSession?.exitCode]);

  // Live Elapsed Timer
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

  // In-Zone Action (Confirm or Checkout)
  const handleZoneAction = async (action: 'confirm_park' | 'checkout') => {
    if (!activeSession) return;
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/zones/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionCode: activeSession.sessionCode,
          scannedZoneId: activeSession.zoneId,
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

  // Pay QRIS
  const handlePay = async () => {
    if (!activeSession) return;
    setLoading(true);
    try {
      const res = await fetch('/api/payments/pay', {
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
      <div style={{ textAlign: 'center', padding: '60px 10px' }}>
        <div style={{ fontSize: 60, marginBottom: 14 }}>🎟️</div>
        <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Belum Ada Tiket Parkir</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
          Pesan tempat parkir terlebih dahulu untuk mendapatkan tiket QR digital Anda.
        </p>
        <button type="button" className="btn-cta-purple" onClick={onGoToExplore}>
          Cari &amp; Pesan Slot Parkir
        </button>
      </div>
    );
  }

  // ==========================================================
  // VIEW 1: PARKING TICKET (Matches Image #3 Screen 2) - BOOKED
  // ==========================================================
  if (activeSession.status === 'BOOKED') {
    return (
      <div>
        <div className="ticket-page-nav">
          <button type="button" className="circle-btn-nav" onClick={onGoToExplore}>←</button>
          <span className="ticket-page-title">Parking Ticket</span>
          <button type="button" className="circle-btn-nav" onClick={() => onUpdateSession(null)}>✕</button>
        </div>

        {statusMsg && (
          <div className={`alert-message ${statusMsg.ok ? 'ok' : 'err'}`}>
            {statusMsg.text}
          </div>
        )}

        {/* Notched Ticket Card */}
        <div className="ticket-box-notched">
          <div className="ticket-upper-part">
            <div className="ticket-circle-badge">🎟️</div>
            <h2 className="ticket-h2">Your parking is booked!</h2>
            <p className="ticket-sub-lead">
              Tunjukkan QR Code ini ke scanner di palang gate masuk kampus.
            </p>

            <div className="ticket-plot-strip">
              <div className="ticket-strip-thumb">🅿️</div>
              <div>
                <strong style={{ fontSize: 14, color: 'var(--text-main)' }}>
                  {currentZone?.name || activeSession.zoneId}
                </strong>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Wednesday Oct 29 | ETA: {activeSession.eta}
                </div>
              </div>
            </div>
          </div>

          {/* Semicircular Cutout Notches */}
          <div className="ticket-notch-row">
            <div className="notch-half notch-l" />
            <div className="notch-dashed" />
            <div className="notch-half notch-r" />
          </div>

          {/* Lower QR Code */}
          <div className="ticket-lower-part">
            <div className="ticket-qr-plate">
              {qrUrl && <img src={qrUrl} alt="QR Sesi" width={170} height={170} />}
            </div>
            <div className="ticket-num-tag">PARKING TICKET NUMBER</div>
            <div className="ticket-num-code">#{activeSession.sessionCode}</div>
          </div>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 14, marginTop: 16, textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
            📸 <strong>Instruksi Gate Masuk:</strong> Tunjukkan QR ini ke scanner gate masuk. Kamera AI VLM gate akan otomatis membaca plat kendaraan Anda dan membuka palang pintu masuk.
          </p>
        </div>
      </div>
    );
  }

  // ==========================================================
  // VIEW 2: CURRENT PARKING (Matches Image #3 Screen 3)
  // ==========================================================
  return (
    <div>
      <div className="ticket-page-nav">
        <button type="button" className="circle-btn-nav" onClick={onGoToExplore}>←</button>
        <span className="ticket-page-title">Current Parking</span>
        <button
          type="button"
          className="circle-btn-nav"
          onClick={() => {
            if (confirm('Batalkan sesi ini?')) {
              onUpdateSession(null);
              onGoToExplore();
            }
          }}
        >
          ✕
        </button>
      </div>

      {statusMsg && (
        <div className={`alert-message ${statusMsg.ok ? 'ok' : 'err'}`}>
          {statusMsg.text}
        </div>
      )}

      {/* Circular Progress Timer Ring */}
      <div className="current-timer-center">
        <div className="circular-timer-box">
          <div className="timer-text-digits">
            {hrs} : {mins} : {secs}
          </div>
          <div className="timer-labels-row">
            <span>hr</span>
            <span>min</span>
            <span>sec</span>
          </div>
        </div>
      </div>

      {/* Info List */}
      <div className="current-info-card">
        <div className="current-row">
          <span className="current-row-label">📍 Parked:</span>
          <span className="current-row-val">{currentZone?.name || activeSession.zoneId}</span>
        </div>

        <div className="current-row">
          <span className="current-row-label">🚗 Car Number:</span>
          <span className="plate-vlm-box">{activeSession.plate || 'Membaca VLM...'}</span>
        </div>

        <div className="current-row">
          <span className="current-row-label">⏱️ Parked At:</span>
          <span className="current-row-val">
            {activeSession.entryTime ? new Date(activeSession.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : activeSession.eta}
          </span>
        </div>

        <div className="current-row">
          <span className="current-row-label">💳 Transaction Status:</span>
          <span className="current-row-val" style={{ color: activeSession.status === 'PAID' ? '#10b981' : '#f59e0b' }}>
            {activeSession.status === 'PAID' ? 'Paid (Rp2.000)' : 'Unpaid (Rp2.000)'}
          </span>
        </div>
      </div>

      {/* Contextual Action Buttons */}
      {activeSession.status === 'ENTERED' && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 10 }}>
            Kendaraan telah melewati gate masuk. Konfirmasi saat tiba di zona Anda:
          </p>
          <button
            type="button"
            className="btn-cta-purple"
            disabled={loading}
            onClick={() => handleZoneAction('confirm_park')}
          >
            {loading ? 'Memproses...' : '📍 Konfirmasi Tiba di Tiang Zona'}
          </button>
        </div>
      )}

      {activeSession.status === 'PARKED_CONFIRMED' && (
        <button
          type="button"
          className="btn-cta-purple"
          disabled={loading}
          onClick={() => handleZoneAction('checkout')}
        >
          {loading ? 'Memproses...' : 'Check Out (Selesai Parkir)'}
        </button>
      )}

      {activeSession.status === 'CHECKOUT_REQUESTED' && (
        <button
          type="button"
          className="btn-cta-purple"
          disabled={loading}
          onClick={handlePay}
        >
          {loading ? 'Memproses...' : 'Bayar Sekarang (QRIS Rp2.000)'}
        </button>
      )}

      {activeSession.status === 'PAID' && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
              QR KELUAR RESMI (LUNAS)
            </div>
            <div style={{ margin: '8px auto', display: 'inline-block' }}>
              {qrUrl && <img src={qrUrl} alt="QR Keluar" width={150} height={150} style={{ borderRadius: 12 }} />}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Plat Terdaftar: <strong>{activeSession.plate}</strong>
            </div>
          </div>

          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 12, padding: 12, textAlign: 'center', fontSize: 12, color: '#065f46', lineHeight: 1.4 }}>
            📸 <strong>Instruksi Gate Keluar:</strong> Arahkan kendaraan ke gate keluar kampus dan tunjukkan QR ini ke scanner gate. Kamera AI gate keluar akan memverifikasi plat nomor kendaraan Anda dan membuka palang.
          </div>
        </div>
      )}
    </div>
  );
}
