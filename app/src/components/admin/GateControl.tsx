import { useState } from 'react';
import type { Zone } from '../../types';
import { emergencyGateOverride } from '../../lib/api';

interface GateControlProps {
  zones: Zone[];
}

export function GateControl({ zones }: GateControlProps) {
  const [selectedGate, setSelectedGate] = useState('Gate Barat Masuk');
  const [selectedZoneId, setSelectedZoneId] = useState(zones[0]?.id || 'zone-a');
  const [reason, setReason] = useState('Kendala teknis / kartu QR tidak terbaca');
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleOverride = async (action: 'open' | 'close') => {
    setLoading(true);
    setResultMsg(null);
    try {
      await emergencyGateOverride({
        gateType: selectedGate,
        zoneId: selectedZoneId,
        action,
        reason,
      });
      setResultMsg({
        ok: true,
        text: `Perintah ${action.toUpperCase()} dikirim ke ${selectedGate}! Tercatat di audit log.`,
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
    <div className="admin-gate-control">
      <section className="card">
        <h2>Kontrol Palang Gate Darurat &amp; Petugas Lapangan</h2>
        <p className="hint-text">
          Gunakan fitur ini hanya jika terjadi kondisi darurat, palang macet, atau kendaraan darurat (ambulans/pemadam).
          Semua aksi terekam dalam audit log sistem.
        </p>

        {resultMsg && (
          <div className={`alert ${resultMsg.ok ? 'alert-ok' : 'alert-err'} mb-3`}>
            {resultMsg.text}
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>
              Pilih Titik Gate:
              <select value={selectedGate} onChange={(e) => setSelectedGate(e.target.value)}>
                <option value="Gate Barat Masuk">Gate Barat (Masuk)</option>
                <option value="Gate Barat Keluar">Gate Barat (Keluar)</option>
                <option value="Gate Selatan Masuk">Gate Selatan (Masuk)</option>
                <option value="Gate Selatan Keluar">Gate Selatan (Keluar)</option>
                <option value="Gate Timur Masuk">Gate Timur (Masuk)</option>
                <option value="Gate Timur Keluar">Gate Timur (Keluar)</option>
                <option value="Gate Utara Masuk">Gate Utara (Masuk)</option>
                <option value="Gate Utara Keluar">Gate Utara (Keluar)</option>
              </select>
            </label>
          </div>

          <div className="form-group">
            <label>
              Zona Terkait:
              <select value={selectedZoneId} onChange={(e) => setSelectedZoneId(e.target.value)}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="form-group">
          <label>
            Alasan Override Petugas (Wajib untuk Audit):
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
        </div>

        <div className="row mt-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleOverride('open')}
            disabled={loading}
          >
            {loading ? 'Mengirim Sinyal...' : '🟢 Buka Palang Gate (Manual)'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => handleOverride('close')}
            disabled={loading}
          >
            {loading ? 'Mengirim Sinyal...' : '🔴 Tutup / Kunci Palang'}
          </button>
        </div>
      </section>
    </div>
  );
}
