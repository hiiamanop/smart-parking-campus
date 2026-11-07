import { useState } from 'react';
import type { Zone, ParkingSession } from '../types';
import { zoneScan } from '../lib/api';
import { QRCodeView } from './QRCodeView';

interface ZonePostSimulatorProps {
  zones: Zone[];
  activeSession: ParkingSession | null;
  onSessionUpdated: (session: ParkingSession) => void;
  onNavigateToTab?: (tab: string) => void;
}

export function ZonePostSimulator({
  zones,
  activeSession,
  onSessionUpdated,
  onNavigateToTab,
}: ZonePostSimulatorProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string>(activeSession?.zoneId || zones[0]?.id || 'zone-a');
  const [sessionCode, setSessionCode] = useState(activeSession?.sessionCode || '');
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  const handleScanAction = async (action: 'confirm_park' | 'checkout') => {
    if (!sessionCode) {
      setResultMsg({ ok: false, text: 'Masukkan kode sesi parkir' });
      return;
    }
    setLoading(true);
    setResultMsg(null);
    try {
      const updated = await zoneScan({
        sessionCode: sessionCode.trim().toUpperCase(),
        scannedZoneId: selectedZoneId,
        action,
      });
      onSessionUpdated(updated);
      setResultMsg({
        ok: true,
        text:
          action === 'confirm_park'
            ? `Berhasil konfirmasi parkir di ${selectedZone?.name}! Status: PARKED_CONFIRMED`
            : `Checkout dimulai! Tagihan Rp${updated.bill?.total?.toLocaleString()} berhasil dibuat. Silakan bayar di app.`,
      });
    } catch (err) {
      setResultMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="simulator-container">
      <section className="card">
        <h2>Simulator Tiang QR Zona Lapangan Outdoor</h2>
        <p>
          Simulasi QR fisik di tiang parkir zona. Pengemudi memindai kode ini dengan kamera ponsel untuk 2 aksi:
          <strong> (1) Konfirmasi Parkir</strong> saat tiba, dan <strong>(2) Mulai Checkout</strong> saat akan pulang.
        </p>

        {activeSession && (
          <div className="quick-fill-bar mb-3">
            <span>
              Sesi Anda: <strong>{activeSession.sessionCode}</strong> (Status: <em>{activeSession.status}</em>, Zona:{' '}
              {activeSession.zoneId})
            </span>
            <button
              type="button"
              className="secondary btn-sm"
              onClick={() => {
                setSessionCode(activeSession.sessionCode);
                setSelectedZoneId(activeSession.zoneId);
              }}
            >
              Sinkronkan Sesi Aktif
            </button>
          </div>
        )}

        <div className="form-group">
          <label>
            <strong>Pilih Tiang Zona Fisik yang Dikunjungi:</strong>
            <select
              value={selectedZoneId}
              onChange={(e) => setSelectedZoneId(e.target.value)}
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} (ID: {z.id})
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Display physical QR sign on the post */}
        <div className="zone-post-card card">
          <div className="post-header">
            <h3>📍 Tiang Parkir: {selectedZone?.name}</h3>
            <small>Kode Fisik Tiang: {selectedZone?.id}</small>
          </div>
          <div className="post-qr-body">
            <QRCodeView
              value={`CAMPUS-ZONE-${selectedZoneId}`}
              title="QR Fisik Tiang Zona"
              subtitle="Pindai QR ini saat parkir atau saat akan meninggalkan zona"
              size={150}
            />
          </div>
        </div>

        <div className="form-group mt-3">
          <label>
            <strong>Kode Sesi Parkir Pengemudi:</strong>
            <input
              type="text"
              placeholder="Contoh: SP-A1B2C3"
              value={sessionCode}
              onChange={(e) => setSessionCode(e.target.value)}
            />
          </label>
        </div>

        {resultMsg && (
          <div className={`alert ${resultMsg.ok ? 'alert-ok' : 'alert-err'} mt-3`}>
            <strong>{resultMsg.ok ? 'Sukses: ' : 'Gagal: '}</strong>
            {resultMsg.text}
          </div>
        )}

        <div className="zone-actions row mt-4">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleScanAction('confirm_park')}
            disabled={loading || !sessionCode}
          >
            {loading ? 'Memproses...' : '1. Scan: Konfirmasi Sudah Parkir'}
          </button>

          <button
            type="button"
            className="btn secondary"
            onClick={() => handleScanAction('checkout')}
            disabled={loading || !sessionCode}
          >
            {loading ? 'Memproses...' : '2. Scan: Mau Pulang (Mulai Checkout/Bill)'}
          </button>
        </div>

        {resultMsg?.ok && activeSession?.status === 'CHECKOUT_REQUESTED' && onNavigateToTab && (
          <div className="mt-3">
            <button
              type="button"
              className="btn"
              onClick={() => onNavigateToTab('booking')}
            >
              Buka Layar Pembayaran di Aplikasi &rarr;
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
