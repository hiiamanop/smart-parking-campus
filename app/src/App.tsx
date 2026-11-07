import { useCallback, useEffect, useState } from 'react';
import {
  STATUS_LABEL,
  STATUS_STEP,
  checkoutStart,
  createBooking,
  errorText,
  gateEntry,
  gateExit,
  getActiveCode,
  getBooking,
  getDeviceId,
  listBookings,
  listZones,
  payBooking,
  setActiveCode,
  zoneConfirm,
  type Booking,
  type Zone,
} from './lib/api';
import { dateTime, rupiah, timeOnly, toLocalInput } from './lib/format';
import { QrCode } from './components/QrCode';
import { PlateReader } from './components/PlateReader';
import { QrScanner } from './components/QrScanner';
import { VlmTester } from './components/VlmTester';

type Tab = 'booking' | 'sesi' | 'vlm';
type Notice = { kind: 'ok' | 'err' | 'info'; text: string };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

const OPEN_STATUSES = ['booked', 'active', 'parked', 'checkout', 'paid'];
const STEPS = ['Booking', 'Gate masuk', 'Parkir', 'Checkout', 'Bayar', 'Keluar'];

function isOpen(b: Booking | null | undefined): boolean {
  return Boolean(b && OPEN_STATUSES.includes(b.status));
}

export function App() {
  const [device] = useState(getDeviceId);
  const [tab, setTab] = useState<Tab>('booking');
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  const [zones, setZones] = useState<Zone[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [active, setActive] = useState<Booking | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<'motorcycle' | 'car' | 'unknown'>('motorcycle');
  const [zoneId, setZoneId] = useState('');
  const [eta, setEta] = useState(() => toLocalInput(new Date(Date.now() + 30 * 60 * 1000)));
  const [etd, setEtd] = useState(() => toLocalInput(new Date(Date.now() + 3 * 60 * 60 * 1000)));
  const [phone, setPhone] = useState('');
  const [zoneCode, setZoneCode] = useState('');

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const refreshZones = useCallback(async () => {
    const r = await listZones();
    if (r.ok && r.zones) {
      setZones(r.zones);
      setZoneId((current) => current || r.zones?.find((z) => z.available > 0)?.id || r.zones?.[0]?.id || '');
    }
  }, []);

  const refreshBookings = useCallback(async () => {
    const r = await listBookings(device);
    if (r.ok && r.items) setBookings(r.items);
  }, [device]);

  const loadActive = useCallback(async (code?: string | null) => {
    const target = code ?? getActiveCode();
    if (!target) {
      setActive(null);
      return;
    }
    const r = await getBooking(target);
    if (r.ok && r.booking) {
      setActive(r.booking);
      setZoneCode(r.booking.zone_public_code);
      if (isOpen(r.booking)) setActiveCode(r.booking.session_code);
      else setActiveCode(null);
    } else {
      setActive(null);
      setActiveCode(null);
    }
  }, []);

  useEffect(() => {
    void refreshZones();
    void refreshBookings();
    void loadActive();
  }, [refreshZones, refreshBookings, loadActive]);

  function applyBooking(b?: Booking) {
    if (!b) return;
    setActive(b);
    setZoneCode(b.zone_public_code || b.zone_id);
    setActiveCode(isOpen(b) ? b.session_code : null);
    void refreshBookings();
    void refreshZones();
  }

  async function install() {
    if (!installEvt) return;
    await installEvt.prompt();
    await installEvt.userChoice.catch(() => null);
    setInstallEvt(null);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!zoneId) {
      setNotice({ kind: 'err', text: 'Pilih zona parkir terlebih dahulu.' });
      return;
    }
    setBusy('create');
    setNotice(null);
    try {
      const r = await createBooking({
        deviceId: device,
        plate,
        zoneId,
        eta: new Date(eta).toISOString(),
        etd: new Date(etd).toISOString(),
        phone,
        vehicleType,
      });
      if (r.ok && r.booking) {
        applyBooking(r.booking);
        setNotice({ kind: 'ok', text: 'Booking dibuat. Tunjukkan QR sesi di gate masuk.' });
        setTab('sesi');
        setPlate('');
      } else {
        setNotice({ kind: 'err', text: errorText(r.error) });
      }
    } finally {
      setBusy(null);
    }
  }

  async function onEntry(detectedPlate: string, confidence?: number) {
    if (!active || busy) return;
    setBusy('entry');
    setNotice(null);
    try {
      const r = await gateEntry(active.session_code, detectedPlate, confidence);
      if (r.ok && r.booking) {
        applyBooking(r.booking);
        setNotice({ kind: 'ok', text: `Plat ${r.booking.plate_locked || detectedPlate} cocok. Palang masuk terbuka.` });
      } else {
        setNotice({
          kind: 'err',
          text: `${errorText(r.error)}${r.expected ? ` — seharusnya: ${r.expected}` : ''}${r.detected ? `, terdeteksi: ${r.detected}` : ''}`,
        });
        if (r.error === 'expired_late') await loadActive(active.session_code);
      }
    } finally {
      setBusy(null);
    }
  }

  async function onConfirmParked() {
    if (!active || busy) return;
    setBusy('parked');
    setNotice(null);
    try {
      const r = await zoneConfirm(active.session_code, zoneCode.trim());
      if (r.ok && r.booking) {
        applyBooking(r.booking);
        setShowScanner(false);
        setNotice({ kind: 'ok', text: 'Konfirmasi parkir diterima. Saat pulang, scan QR zona lagi untuk checkout.' });
      } else {
        setNotice({ kind: 'err', text: errorText(r.error) });
      }
    } finally {
      setBusy(null);
    }
  }

  async function onCheckout() {
    if (!active || busy) return;
    setBusy('checkout');
    setNotice(null);
    try {
      const r = await checkoutStart(active.session_code);
      if (r.ok && r.booking) {
        applyBooking(r.booking);
        setNotice({ kind: 'ok', text: 'Checkout dimulai. Silakan bayar di aplikasi (bukan di gate).' });
      } else {
        setNotice({ kind: 'err', text: errorText(r.error) });
      }
    } finally {
      setBusy(null);
    }
  }

  async function onPay() {
    if (!active || busy) return;
    setBusy('pay');
    setNotice(null);
    try {
      const r = await payBooking(active.session_code);
      if (r.ok && r.booking) {
        applyBooking(r.booking);
        setNotice({ kind: 'ok', text: 'Pembayaran berhasil. QR keluar sudah diterbitkan.' });
      } else {
        setNotice({ kind: 'err', text: errorText(r.error) });
      }
    } finally {
      setBusy(null);
    }
  }

  async function onExit(detectedPlate: string, confidence?: number) {
    if (!active || busy) return;
    setBusy('exit');
    setNotice(null);
    try {
      const r = await gateExit(active.exit_code || active.session_code, detectedPlate, confidence);
      if (r.ok && r.booking) {
        applyBooking(r.booking);
        setNotice({ kind: 'ok', text: 'Verifikasi plat cocok. Palang keluar terbuka. Terima kasih!' });
      } else {
        setNotice({
          kind: 'err',
          text: `${errorText(r.error)}${r.expected ? ` — seharusnya: ${r.expected}` : ''}${r.detected ? `, terdeteksi: ${r.detected}` : ''}`,
        });
      }
    } finally {
      setBusy(null);
    }
  }

  const handleScanZone = useCallback((value: string) => {
    setZoneCode(value.trim().toUpperCase());
    setShowScanner(false);
    setNotice({ kind: 'info', text: 'QR zona terbaca. Tekan tombol konfirmasi.' });
  }, []);

  function openBooking(b: Booking) {
    setActive(b);
    setZoneCode(b.zone_public_code || '');
    setActiveCode(isOpen(b) ? b.session_code : null);
    setTab('sesi');
  }

  function startNewBooking() {
    setActive(null);
    setActiveCode(null);
    setNotice(null);
    setTab('booking');
    void refreshZones();
  }

  const step = active ? STATUS_STEP[active.status] : 0;
  const hasOpen = isOpen(active);

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={36} height={36} />
          <div>
            <h1>Smart Parking Kampus</h1>
            <small>Booking · QR gate · verifikasi plat (VLM)</small>
          </div>
        </div>
        <div className="row">
          <span className="badge">PWA</span>
          {installEvt ? (
            <button className="secondary small" onClick={() => void install()}>Pasang aplikasi</button>
          ) : (
            <small className="hint">Menu browser → “Add to Home Screen”</small>
          )}
        </div>
      </header>

      <nav className="tabs" aria-label="Navigasi utama">
        <button className={tab === 'booking' ? 'tab active' : 'tab'} onClick={() => setTab('booking')}>Booking</button>
        <button className={tab === 'sesi' ? 'tab active' : 'tab'} onClick={() => setTab('sesi')}>
          Sesi {hasOpen && <span className="dot" />}
        </button>
        <button className={tab === 'vlm' ? 'tab active' : 'tab'} onClick={() => setTab('vlm')}>Tes VLM</button>
      </nav>

      {notice && (
        <div className={`callout ${notice.kind === 'ok' ? 'ok' : notice.kind === 'err' ? 'err' : 'info'}`}>
          <strong>{notice.text}</strong>
          <button className="link" onClick={() => setNotice(null)} aria-label="Tutup">×</button>
        </div>
      )}

      {tab === 'booking' && (
        <>
          <section className="hero card">
            <div>
              <span className="badge">Dari rumah</span>
              <h2>Pesan slot sebelum berangkat</h2>
              <p>Pilih zona dekat fakultas, dapatkan QR sesi, lalu tunjukkan di gate masuk. Plat diverifikasi otomatis oleh VLM.</p>
            </div>
            <div className="hero-stats">
              <div><strong>{zones.reduce((n, z) => n + z.available, 0)}</strong><small>slot tersedia</small></div>
              <div><strong>{zones.length}</strong><small>zona aktif</small></div>
            </div>
          </section>

          <section className="card">
            <h2>Ketersediaan zona</h2>
            {zones.length === 0 ? <p>Memuat zona…</p> : (
              <div className="zone-grid">
                {zones.map((z) => {
                  const ratio = z.capacity ? Math.max(0, Math.min(1, z.available / z.capacity)) : 0;
                  return (
                    <button
                      type="button"
                      key={z.id}
                      className={zoneId === z.id ? 'zone selected' : 'zone'}
                      onClick={() => setZoneId(z.id)}
                      disabled={z.available <= 0}
                    >
                      <div className="zone-head">
                        <strong>{z.name}</strong>
                        <span className={z.available > 0 ? 'pill ok' : 'pill err'}>{z.available > 0 ? `${z.available}/${z.capacity}` : 'Penuh'}</span>
                      </div>
                      <small>{z.faculty}</small>
                      <div className="bar"><span style={{ width: `${ratio * 100}%` }} /></div>
                      <code>{z.code}</code>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {hasOpen && active ? (
            <section className="card">
              <h2>Masih ada sesi aktif</h2>
              <p>Selesaikan sesi berikut sebelum membuat booking baru.</p>
              <div className="session-line">
                <span className={`status status-${active.status}`}>{STATUS_LABEL[active.status]}</span>
                <strong>{active.plate}</strong>
                <span>{active.zone_name}</span>
                <span>{timeOnly(active.eta)}–{timeOnly(active.etd)}</span>
              </div>
              <button onClick={() => setTab('sesi')}>Buka sesi</button>
            </section>
          ) : (
            <section className="card">
              <h2>Buat booking</h2>
              <form onSubmit={(e) => void onCreate(e)} className="form">
                <div className="grid-2">
                  <label className="field">
                    <span>Plat nomor</span>
                    <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())}
                      placeholder="B 1234 XYZ" autoComplete="off" required />
                  </label>
                  <label className="field">
                    <span>Jenis kendaraan</span>
                    <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value as typeof vehicleType)}>
                      <option value="motorcycle">Motor</option>
                      <option value="car">Mobil</option>
                      <option value="unknown">Lainnya</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Zona</span>
                    <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} required>
                      <option value="">Pilih zona</option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id} disabled={z.available <= 0}>
                          {z.name} — {z.available}/{z.capacity} tersedia
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Nomor HP (opsional)</span>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" inputMode="tel" />
                  </label>
                  <label className="field">
                    <span>Perkiraan datang (ETA)</span>
                    <input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} required />
                  </label>
                  <label className="field">
                    <span>Perkiraan pulang (ETD)</span>
                    <input type="datetime-local" value={etd} onChange={(e) => setEtd(e.target.value)} required />
                  </label>
                </div>
                <p className="fineprint">Tarif normal <strong>Rp2.000</strong>. Telat datang &gt; 10 menit: booking hangus. Overstay: violation + total <strong>Rp3.000</strong>.</p>
                <button type="submit" disabled={busy === 'create'}>
                  {busy === 'create' ? 'Membuat booking…' : 'Booking & dapatkan QR sesi'}
                </button>
              </form>
            </section>
          )}

          <section className="card">
            <h2>Riwayat di perangkat ini</h2>
            {bookings.length === 0 ? <p>Belum ada booking.</p> : (
              <ul className="history">
                {bookings.map((b) => (
                  <li key={b.id}>
                    <div>
                      <strong>{b.plate}</strong>
                      <small>{b.zone_name} · {dateTime(b.created_at)}</small>
                    </div>
                    <div className="row">
                      <span className={`status status-${b.status}`}>{STATUS_LABEL[b.status]}</span>
                      <button className="secondary small" onClick={() => openBooking(b)}>Lihat</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === 'sesi' && (
        <>
          {!active ? (
            <section className="card empty">
              <h2>Belum ada sesi aktif</h2>
              <p>Buat booking dulu, lalu QR sesi muncul di sini.</p>
              <button onClick={() => setTab('booking')}>Ke halaman booking</button>
            </section>
          ) : (
            <>
              <section className="card">
                <div className="session-head">
                  <div>
                    <span className={`status status-${active.status}`}>{STATUS_LABEL[active.status]}</span>
                    <h2>{active.plate}</h2>
                    <p>{active.zone_name} · {active.zone_faculty}</p>
                  </div>
                  <div className="session-times">
                    <small>ETA {dateTime(active.eta)}</small>
                    <small>ETD {dateTime(active.etd)}</small>
                    <small>Poin loyalty: <strong>{active.loyalty_points ?? 0}</strong></small>
                  </div>
                </div>

                <ol className="steps">
                  {STEPS.map((label, i) => (
                    <li key={label} className={step > i ? 'done' : step === i + 1 ? 'current' : ''}>
                      <span>{i + 1}</span>
                      <small>{label}</small>
                    </li>
                  ))}
                </ol>
              </section>

              {active.status === 'booked' && (
                <section className="card">
                  <h2>1. Gate masuk</h2>
                  <p>Tunjukkan QR sesi ke kamera gate, lalu sistem membaca plat dan membuka palang.</p>
                  <div className="qr-wrap">
                    <QrCode value={active.session_code} />
                    <div className="qr-meta">
                      <small>Kode sesi</small>
                      <strong>{active.session_code}</strong>
                      <small>Berlaku sampai {dateTime(active.eta)} + 10 menit</small>
                    </div>
                  </div>
                  <hr />
                  <PlateReader context="entry" disabled={busy === 'entry'} onPlate={(p, c) => void onEntry(p, c)} />
                </section>
              )}

              {active.status === 'active' && (
                <section className="card">
                  <h2>2. Konfirmasi sudah parkir</h2>
                  <p>Scan QR yang tertempel di zona <strong>{active.zone_name}</strong> ({active.zone_public_code}).</p>
                  <div className="row">
                    <input value={zoneCode} onChange={(e) => setZoneCode(e.target.value.toUpperCase())} placeholder="ZONE-..." />
                    <button className="secondary" onClick={() => setShowScanner(true)}>Scan kamera</button>
                  </div>
                  {showScanner && <QrScanner onResult={handleScanZone} onClose={() => setShowScanner(false)} />}
                  <div className="row" style={{ marginTop: 10 }}>
                    <button onClick={() => void onConfirmParked()} disabled={busy === 'parked' || zoneCode.trim().length < 4}>
                      {busy === 'parked' ? 'Menyimpan…' : 'Konfirmasi parkir'}
                    </button>
                  </div>
                  <small>Masuk gate: {dateTime(active.entry_at)} · Plat terkunci: {active.plate_locked || active.plate}</small>
                </section>
              )}

              {active.status === 'parked' && (
                <section className="card">
                  <h2>3. Mau pulang? Mulai checkout</h2>
                  <p>Scan lagi QR zona <strong>{active.zone_public_code}</strong> untuk menghitung tagihan.</p>
                  <div className="row">
                    <input value={zoneCode} onChange={(e) => setZoneCode(e.target.value.toUpperCase())} />
                    <button className="secondary" onClick={() => setShowScanner(true)}>Scan kamera</button>
                  </div>
                  {showScanner && <QrScanner onResult={handleScanZone} onClose={() => setShowScanner(false)} />}
                  <div className="row" style={{ marginTop: 10 }}>
                    <button onClick={() => void onCheckout()} disabled={busy === 'checkout'}>
                      {busy === 'checkout' ? 'Menghitung bill…' : 'Scan QR zona → mulai checkout'}
                    </button>
                  </div>
                  <small>Terparkir sejak {dateTime(active.parked_at)}. Overstay setelah {dateTime(active.etd)} + 10 menit.</small>
                </section>
              )}

              {active.status === 'checkout' && (
                <section className="card">
                  <h2>4. Tagihan & pembayaran</h2>
                  <div className="bill">
                    <div><span>Tarif dasar</span><strong>{rupiah(active.base_fee)}</strong></div>
                    <div><span>Denda overstay</span><strong className={active.violation_fee > 0 ? 'err' : ''}>{rupiah(active.violation_fee)}</strong></div>
                    <div className="total"><span>Total</span><strong>{rupiah(active.total_fee)}</strong></div>
                  </div>
                  <p>Pembayaran dilakukan di aplikasi, bukan di gate. Simulasi QRIS untuk MVP.</p>
                  <button onClick={() => void onPay()} disabled={busy === 'pay'}>
                    {busy === 'pay' ? 'Memproses pembayaran…' : `Bayar QRIS ${rupiah(active.total_fee)}`}
                  </button>
                </section>
              )}

              {active.status === 'paid' && (
                <section className="card">
                  <h2>5. QR keluar</h2>
                  <p>Pembayaran lunas. Tunjukkan QR ini di gate keluar; VLM akan memverifikasi plat.</p>
                  <div className="qr-wrap">
                    <QrCode value={active.exit_code || ''} />
                    <div className="qr-meta">
                      <small>Kode keluar</small>
                      <strong>{active.exit_code}</strong>
                      <small>Dibayar {dateTime(active.paid_at)} · {rupiah(active.total_fee)}</small>
                      {active.violation_fee > 0 && <small className="err">Termasuk denda overstay {rupiah(active.violation_fee)}</small>}
                    </div>
                  </div>
                  <hr />
                  <PlateReader context="exit" disabled={busy === 'exit'} onPlate={(p, c) => void onExit(p, c)} />
                </section>
              )}

              {active.status === 'closed' && (
                <section className="card">
                  <h2>Sesi selesai</h2>
                  <p>Terima kasih. Plat {active.plate_locked || active.plate} keluar dari {active.zone_name} pada {dateTime(active.exit_at)}.</p>
                  <div className="bill">
                    <div><span>Total dibayar</span><strong>{rupiah(active.total_fee)}</strong></div>
                    <div><span>Poin loyalty</span><strong>{active.loyalty_points ?? 0}</strong></div>
                  </div>
                  <button onClick={startNewBooking}>Booking lagi</button>
                </section>
              )}

              {(active.status === 'expired' || active.status === 'cancelled') && (
                <section className="card">
                  <h2>{active.status === 'expired' ? 'Booking hangus' : 'Booking dibatalkan'}</h2>
                  <p>{active.status === 'expired'
                    ? 'Anda telat lebih dari 10 menit dari ETA, sehingga slot dibuka kembali untuk pengguna lain.'
                    : 'Booking ini sudah dibatalkan.'}</p>
                  <button onClick={startNewBooking}>Booking ulang</button>
                </section>
              )}
            </>
          )}
        </>
      )}

      {tab === 'vlm' && <VlmTester />}

      <footer>
        <small>
          Database: Supabase self-hosted (storage) · VLM: OpenRouter · Web/PWA.
          Data sesi disimpan per perangkat ini.
        </small>
      </footer>
    </main>
  );
}
