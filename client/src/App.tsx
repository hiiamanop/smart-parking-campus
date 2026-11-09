import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

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
  entryQrExpiresAt?: number;
  exitCodeExpiry?: number;
  zoneChangedAt?: string;
  zoneChangeCount?: number;
  zoneChangesAfterEntry?: number;
  zoneScanMisses?: number;
  bill?: {
    baseFee: number;
    penaltyFee: number;
    total: number;
    isOverstay: boolean;
  };
  payment?: {
    method?: string;
    paidAt?: string;
    transactionId?: string;
    amount?: number;
  };
}

const API_BASE = typeof window !== 'undefined' && window.location.port === '5174' ? 'http://127.0.0.1:8788' : '';

const formatRupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

// Swipe-to-confirm control used when the driver wants to go home.
function SwipeToGoHome({ onComplete, loading }: { onComplete: () => void; loading: boolean }) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const maxRef = useRef(0);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!loading) {
      completedRef.current = false;
      setDragX(0);
    }
  }, [loading]);

  const begin = (clientX: number, target: HTMLElement, pointerId?: number) => {
    if (loading) return;
    const track = trackRef.current;
    if (!track) return;
    startXRef.current = clientX;
    maxRef.current = Math.max(0, track.clientWidth - 64);
    setDragging(true);
    if (pointerId !== undefined) target.setPointerCapture?.(pointerId);
  };

  const move = (clientX: number) => {
    if (!dragging || loading) return;
    const dx = Math.max(0, Math.min(maxRef.current, clientX - startXRef.current));
    setDragX(dx);
    if (!completedRef.current && maxRef.current > 0 && dx >= maxRef.current * 0.82) {
      completedRef.current = true;
      setDragging(false);
      onComplete();
    }
  };

  const end = () => {
    if (!dragging) return;
    setDragging(false);
    if (!completedRef.current) setDragX(0);
  };

  const progress = maxRef.current ? Math.min(1, dragX / maxRef.current) : 0;

  return (
    <div className="swipe-home">
      <p className="action-hint">
        Geser tombol ke kanan sebagai tanda mau pulang. Setelah itu lanjut ke pembayaran.
      </p>
      <div
        ref={trackRef}
        className={`swipe-track ${dragging ? 'dragging' : ''} ${loading ? 'loading' : ''}`}
        style={{
          background: `linear-gradient(90deg, #4f46e5 ${progress * 100}%, #e2e8f0 ${progress * 100}%)`,
        }}
      >
        <span className="swipe-track-label" style={{ opacity: Math.max(0.2, 1 - progress * 1.25) }}>
          {loading ? 'Menghitung tagihan…' : 'Geser untuk pulang'}
        </span>
        <button
          type="button"
          className="swipe-knob"
          aria-label="Geser ke kanan untuk pulang dan lanjut ke pembayaran"
          disabled={loading}
          style={{
            transform: `translateX(${dragX}px)`,
            transition: dragging ? 'none' : 'transform 180ms ease',
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            begin(e.clientX, e.currentTarget, e.pointerId);
          }}
          onPointerMove={(e) => move(e.clientX)}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !loading) {
              e.preventDefault();
              onComplete();
            }
          }}
        >
          <span aria-hidden="true">{loading ? '…' : '→'}</span>
        </button>
        <span className="swipe-track-end" aria-hidden="true">Pulang</span>
      </div>
    </div>
  );
}

// Full-screen camera scanner for the zone QR posted at each parking pillar.
function ZoneQrScanner({
  onDetected,
  onClose,
}: {
  onDetected: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let cancelled = false;

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const scan = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && video.videoWidth) {
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(image.data, image.width, image.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (qr?.data?.trim()) {
            const value = qr.data.trim();
            cancelled = true;
            stop();
            onDetectedRef.current(value);
            return;
          }
        }
      }
      rafRef.current = requestAnimationFrame(scan);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Kamera tidak didukung browser ini. Ketik kode zona secara manual.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);
        rafRef.current = requestAnimationFrame(scan);
      } catch (err: any) {
        const name = err?.name || '';
        setError(
          name === 'NotAllowedError' || name === 'PermissionDeniedError'
            ? 'Izin kamera ditolak. Aktifkan izin kamera di browser, lalu coba lagi.'
            : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'Tidak ada kamera terdeteksi. Ketik kode zona secara manual.'
            : `Kamera tidak dapat dibuka (${name || 'unknown'}). Ketik kode zona secara manual.`
        );
      }
    };

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (qr?.data?.trim()) {
          onDetectedRef.current(qr.data.trim());
          URL.revokeObjectURL(url);
          return;
        }
      }
      URL.revokeObjectURL(url);
      setError('QR tidak ditemukan di foto. Coba foto ulang dengan QR lebih jelas.');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError('Gagal membaca file gambar.');
    };
    img.src = url;
  };

  return (
    <div className="zone-scanner-backdrop" role="dialog" aria-modal="true" aria-label="Pindai QR zona">
      <div className="zone-scanner-card">
        <div className="zone-scanner-head">
          <div>
            <strong>Pindai QR zona</strong>
            <p>Arahkan kamera ke QR yang tertempel di tiang zona.</p>
          </div>
          <button type="button" className="icon-close" onClick={onClose}>
            Tutup
          </button>
        </div>

        <div className="zone-scanner-video">
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} className="zone-scanner-canvas" />
          {!ready && !error && <div className="zone-scanner-overlay">Mengaktifkan kamera…</div>}
          <div className="zone-scanner-frame" aria-hidden="true" />
        </div>

        {error && <div className="alert-message err">{error}</div>}

        <label className="zone-scanner-upload">
          Unggah foto QR
          <input type="file" accept="image/*" onChange={handleFile} />
        </label>
      </div>
    </div>
  );
}

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
          // A completed session stays visible as the exit receipt until the
          // driver dismisses it. Only cancelled/expired tickets are dropped.
          if (res.session.status === 'EXPIRED' || res.session.status === 'CANCELLED') {
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

        if (activeSession && event.payload?.sessionCode === activeSession.sessionCode) {
          if (event.type === 'GATE_EXIT_SUCCESS') {
            setExitNotice('Kendaraan tercatat keluar. Tiket tetap tersimpan sebagai bukti.');
            setTimeout(() => setExitNotice(null), 5000);
          }
          fetch(`${API_BASE}/api/sessions/${activeSession.sessionCode}`)
            .then((r) => r.json())
            .then((res) => {
              if (res.ok && res.session) {
                // Keep COMPLETED so the driver still sees the exit receipt;
                // only drop tickets that can no longer be used.
                if (res.session.status === 'EXPIRED' || res.session.status === 'CANCELLED') {
                  updateSession(null);
                } else {
                  updateSession(res.session);
                }
              }
            });
        }
      } catch {}
    };

    return () => sse.close();
  }, [activeSession]);

  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <div className="brand-block">
          <img className="brand-logo" src="/lencana-parkir-pintar.png" alt="Parkir Pintar ITB" />
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
          {activeSession && activeSession.status !== 'COMPLETED' && <span className="tab-dot" />}
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
      list = list.filter((z) => z.name.toLowerCase().includes(q));
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
          placeholder="Cari nama zona"
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

                <div className="meter" title={`${z.occupied}/${z.capacity} terisi (${ratio}%)`}>
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
              <div className="time-field">
                <select
                  className="time-select"
                  aria-label="Jam tiba"
                  value={etaTime.slice(0, 2)}
                  onChange={(e) => setEtaTime(`${e.target.value}:${etaTime.slice(3, 5)}`)}
                >
                  {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <span className="time-colon">:</span>
                <select
                  className="time-select"
                  aria-label="Menit tiba"
                  value={etaTime.slice(3, 5)}
                  onChange={(e) => setEtaTime(`${etaTime.slice(0, 2)}:${e.target.value}`)}
                >
                  {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
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
  const [scannerOpen, setScannerOpen] = useState(false);
  const [changeZoneId, setChangeZoneId] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

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

  const canChangeZone =
    activeSession?.status === 'BOOKED' ||
    (activeSession?.status === 'ENTERED' && !activeSession.zoneChangesAfterEntry);
  const changeableZones = zones.filter(
    (z) =>
      z.id !== activeSession?.zoneId &&
      !z.isFull &&
      ((z.vehicleType || 'motorcycle') === (activeSession?.vehicleType || 'motorcycle'))
  );

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

  const remaining = (ts?: number) => {
    if (!ts) return null;
    const sec = Math.max(0, Math.floor((ts - nowMs) / 1000));
    return { sec, text: `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` };
  };

  const handleChangeZone = async () => {
    if (!activeSession || !changeZoneId) return;
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/bookings/change-zone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: activeSession.sessionCode, zoneId: changeZoneId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memindahkan zona');
      onUpdateSession(data.session);
      setChangeZoneId('');
      setStatusMsg({ ok: true, text: 'Zona berhasil dipindahkan. Kode tiket tetap sama.' });
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckoutRequest = async () => {
    if (!activeSession) return;
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: activeSession.sessionCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal membuat tagihan');
      onUpdateSession(data.session);
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelBooking = async () => {
    if (!activeSession) return;
    if (!confirm('Batalkan booking ini?')) return;
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/bookings/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: activeSession.sessionCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal membatalkan booking');
      onUpdateSession(null);
      onGoToExplore();
    } catch (e: any) {
      setStatusMsg({ ok: false, text: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  // Reset darurat: lepaskan tiket dari perangkat ini. Untuk booking yang belum
  // masuk gate, batalkan juga di server supaya slot langsung tersedia lagi.
  const handleResetTicket = async () => {
    if (!activeSession) {
      onUpdateSession(null);
      onGoToExplore();
      return;
    }

    const isBooked = activeSession.status === 'BOOKED';
    const confirmed = confirm(
      isBooked
        ? 'Reset tiket ini? Booking akan dibatalkan dan slot dilepas.'
        : 'Reset tiket dari perangkat ini? Sesi di server tetap tercatat sampai kendaraan keluar gate.'
    );
    if (!confirmed) return;

    setLoading(true);
    setStatusMsg(null);

    if (!isBooked) {
      onUpdateSession(null);
      setLoading(false);
      onGoToExplore();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/bookings/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: activeSession.sessionCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal membatalkan booking');
      onUpdateSession(null);
      onGoToExplore();
    } catch (e: any) {
      // Tetap izinkan reset lokal walau server gagal, dengan peringatan jelas.
      onUpdateSession(null);
      window.alert(
        `Tiket di perangkat sudah direset, tetapi pembatalan di server gagal: ${
          e.message || String(e)
        }. Slot mungkin masih tertahan; hubungi petugas bila perlu.`
      );
      onGoToExplore();
    } finally {
      setLoading(false);
    }
  };

  const renderResetControl = () => (
    <div className="ticket-reset">
      <button
        type="button"
        className="btn-danger-block"
        onClick={handleResetTicket}
        disabled={loading}
      >
        {loading ? 'Mereset…' : 'Reset tiket'}
      </button>
      <p className="ticket-reset-hint">
        Pakai bila QR tidak bisa dipakai atau tiket macet di perangkat ini.
      </p>
    </div>
  );

  const handleReissueExit = async () => {
    if (!activeSession) return;
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/payments/reissue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: activeSession.sessionCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menerbitkan QR baru');
      onUpdateSession(data.session);
      setStatusMsg({
        ok: true,
        text:
          data.charged > 0
            ? `Denda ${formatRupiah(data.charged)} dibayar. QR keluar baru berlaku 20 menit.`
            : 'QR keluar baru diterbitkan, berlaku 20 menit.',
      });
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

  if (activeSession.status === 'COMPLETED') {
    const entryMs = activeSession.entryTime ? new Date(activeSession.entryTime).getTime() : null;
    const exitMs = activeSession.exitTime ? new Date(activeSession.exitTime).getTime() : null;
    const durationMin =
      entryMs && exitMs ? Math.max(0, Math.round((exitMs - entryMs) / 60000)) : null;
    const clock = (iso?: string) =>
      iso
        ? new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        : '—';

    return (
      <div>
        <div className="page-nav">
          <span className="page-nav-title">Sesi selesai</span>
        </div>

        <div className="receipt-hero">
          <div className="receipt-check" aria-hidden="true">✓</div>
          <strong>Kendaraan sudah keluar</strong>
          <p>Palang keluar terbuka. Tiket tetap tersimpan sebagai bukti parkir Anda.</p>
        </div>

        <dl className="detail-list">
          <div className="detail-row">
            <dt>Zona</dt>
            <dd>{currentZone?.name || activeSession.zoneId}</dd>
          </div>
          <div className="detail-row">
            <dt>Plat nomor</dt>
            <dd>
              <span className="plate-chip">{activeSession.plate || '—'}</span>
            </dd>
          </div>
          <div className="detail-row">
            <dt>Masuk</dt>
            <dd>{clock(activeSession.entryTime)}</dd>
          </div>
          <div className="detail-row">
            <dt>Keluar</dt>
            <dd>{clock(activeSession.exitTime)}</dd>
          </div>
          {durationMin !== null && (
            <div className="detail-row">
              <dt>Durasi</dt>
              <dd>
                {durationMin < 60
                  ? `${durationMin} menit`
                  : `${Math.floor(durationMin / 60)} jam ${durationMin % 60} menit`}
              </dd>
            </div>
          )}
          <div className="detail-row">
            <dt>Total dibayar</dt>
            <dd className="text-ok">{formatRupiah(activeSession.bill?.total ?? 0)}</dd>
          </div>
          {activeSession.payment?.method && (
            <div className="detail-row">
              <dt>Metode</dt>
              <dd>{activeSession.payment.method}</dd>
            </div>
          )}
        </dl>

        <button
          type="button"
          className="btn-primary-block"
          onClick={() => {
            onUpdateSession(null);
            onGoToExplore();
          }}
        >
          Selesai
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
          <button type="button" className="icon-nav" onClick={handleCancelBooking} disabled={loading}>
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

            {(() => {
              const r = remaining(activeSession.entryQrExpiresAt);
              if (!r) return null;
              return (
                <div className={`expiry-line ${r.sec === 0 ? 'expired' : ''}`}>
                  {r.sec === 0
                    ? 'QR masuk kedaluwarsa — booking hangus.'
                    : `QR masuk berlaku ${r.text} (15 menit sejak ETA)`}
                </div>
              );
            })()}
          </div>
        </div>

        <div className="note-box">
          <strong>Di gate masuk.</strong> Tempelkan QR ke pemindai. Kamera membaca plat kendaraan, lalu palang terbuka otomatis.
        </div>

        {renderResetControl()}
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
          onClick={handleCancelBooking}
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

      {canChangeZone && (
        <div className="zone-change-box">
          <div className="zone-change-title">Salah pilih zona?</div>
          {changeableZones.length === 0 ? (
            <p className="action-hint">Tidak ada zona lain yang tersedia untuk kendaraan ini.</p>
          ) : (
            <>
              <select
                className="time-input"
                value={changeZoneId}
                onChange={(e) => setChangeZoneId(e.target.value)}
              >
                <option value="">Pilih zona lain…</option>
                {changeableZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} · {z.available} slot
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-cta-sub"
                disabled={!changeZoneId || loading}
                onClick={handleChangeZone}
              >
                {loading ? 'Memindahkan…' : 'Pindahkan ke zona ini'}
              </button>
              <p className="field-hint">
                {activeSession.status === 'ENTERED'
                  ? 'Setelah masuk gate, perpindahan hanya boleh satu kali dan tetap harus konfirmasi di tiang zona baru.'
                  : 'Kode tiket tidak berubah; cukup pindai QR di zona baru saat tiba.'}
              </p>
            </>
          )}
        </div>
      )}

      {activeSession.status === 'ENTERED' && (
        <div className="zone-confirm-box">
          <div className="zone-confirm-title">Konfirmasi tiba di zona</div>
          <p className="action-hint">
            Pindai QR yang tertempel di tiang zona. Tombol konfirmasi membuka kamera bila QR belum terbaca.
          </p>

          {zoneQr.trim() ? (
            <div className="zone-qr-detected">
              <span className="zone-qr-detected-label">QR zona terdeteksi</span>
              <span className="zone-qr-detected-value">{zoneQr.trim()}</span>
            </div>
          ) : null}

          <button
            type="button"
            className="btn-primary-block"
            disabled={loading}
            onClick={() => {
              if (!zoneQr.trim()) {
                setStatusMsg(null);
                setScannerOpen(true);
                return;
              }
              handleZoneAction('confirm_park');
            }}
          >
            {loading
              ? 'Memproses…'
              : zoneQr.trim()
              ? 'Konfirmasi tiba di zona'
              : 'Pindai QR zona untuk konfirmasi'}
          </button>

          {zoneQr.trim() ? (
            <button
              type="button"
              className="link-action zone-rescan"
              onClick={() => setScannerOpen(true)}
            >
              Pindai ulang QR zona
            </button>
          ) : null}

          <details className="manual-zone">
            <summary>Atau masukkan kode zona manual</summary>
            <input
              className="time-input"
              type="text"
              placeholder="CAMPUS-ZONE-…"
              value={zoneQr}
              onChange={(e) => setZoneQr(e.target.value)}
            />
          </details>
        </div>
      )}

      {scannerOpen && (
        <ZoneQrScanner
          onDetected={(value) => {
            setZoneQr(value.trim());
            setScannerOpen(false);
            setStatusMsg({ ok: true, text: 'QR zona terbaca. Tekan konfirmasi tiba di zona.' });
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {activeSession.status === 'PARKED_CONFIRMED' && (
        <SwipeToGoHome onComplete={handleCheckoutRequest} loading={loading} />
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

            {(() => {
              const r = remaining(activeSession.exitCodeExpiry);
              if (!r) return null;
              if (r.sec === 0) {
                return (
                  <div className="expiry-line expired">
                    QR keluar kedaluwarsa — kendaraan tidak dapat keluar.
                    <div style={{ marginTop: 6 }}>
                      <button type="button" className="link-action" onClick={handleReissueExit} disabled={loading}>
                        Bayar denda Rp20.000 &amp; terbitkan QR keluar baru
                      </button>
                    </div>
                  </div>
                );
              }
              return <div className="expiry-line">QR keluar berlaku {r.text} (20 menit sejak pembayaran)</div>;
            })()}
          </div>

          <div className="note-box">
            <strong>Di gate keluar.</strong> Tempelkan QR ini ke pemindai. Kamera memverifikasi plat sebelum palang terbuka.
          </div>
        </div>
      )}

      {renderResetControl()}
    </div>
  );
}
