import { useState } from 'react';
import type { ParkingSession } from '../types';
import { fileToDataUrl } from '../lib/vlm';
import { gateOutExit } from '../lib/api';

interface GateOutSimulatorProps {
  activeSession: ParkingSession | null;
  onSessionUpdated: (session: ParkingSession) => void;
}

export function GateOutSimulator({ activeSession, onSessionUpdated }: GateOutSimulatorProps) {
  const [exitCode, setExitCode] = useState(activeSession?.exitCode || '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [manualOverride, setManualOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handlePickFile = async (f: File | null) => {
    setFile(f);
    setResultMsg(null);
    setGateOpen(false);
    if (f) {
      const url = await fileToDataUrl(f);
      setPreview(url);
    } else {
      setPreview('');
    }
  };

  const handleUseSample = (plateText: string) => {
    setManualOverride(plateText);
    setResultMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exitCode) {
      setResultMsg({ ok: false, text: 'Masukkan kode / scan QR keluar' });
      return;
    }
    if (!preview && !manualOverride) {
      setResultMsg({ ok: false, text: 'Upload foto kendaraan/plat di gate keluar atau isi override manual' });
      return;
    }

    setLoading(true);
    setResultMsg(null);
    setGateOpen(false);

    try {
      let base64Data: string | undefined;
      let mimeType: string | undefined;

      if (preview) {
        const m = preview.match(/^data:(.*?);base64,(.*)$/);
        mimeType = m?.[1] || 'image/jpeg';
        base64Data = m?.[2] || preview;
      }

      const res = await gateOutExit({
        exitCode: exitCode.trim().toUpperCase(),
        platePhotoBase64: base64Data,
        mimeType,
        manualPlateOverride: manualOverride ? manualOverride.trim() : undefined,
      });

      setGateOpen(true);
      onSessionUpdated(res.session);
      setResultMsg({
        ok: true,
        text: `VERIFIKASI PLAT COCOK! Palang Gate Keluar TERBUKA. Sesi parkir selesai, slot kuota zona telah dikembalikan.`,
      });
    } catch (err) {
      setGateOpen(false);
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
        <div className="simulator-header">
          <div>
            <h2>Simulator Gate Keluar (Verifikasi VLM & Selesai)</h2>
            <p>
              Scan QR Keluar $\to$ VLM membaca plat nomor $\to$ Verifikasi kecocokan plat dengan sesi masuk $\to$ Buka palang gate keluar.
            </p>
          </div>
          <div className={`barrier-indicator ${gateOpen ? 'barrier-open' : 'barrier-closed'}`}>
            <span className="barrier-icon">{gateOpen ? '🟢' : '🔴'}</span>
            <strong>{gateOpen ? 'PALANG KELUAR TERBUKA' : 'PALANG KELUAR TERTUTUP'}</strong>
          </div>
        </div>

        {activeSession?.exitCode && (
          <div className="quick-fill-bar">
            <span>
              Kode keluar aktif: <strong>{activeSession.exitCode}</strong> (Plat terdaftar: <strong>{activeSession.plate}</strong>)
            </span>
            <button
              type="button"
              className="secondary btn-sm"
              onClick={() => {
                setExitCode(activeSession.exitCode || '');
                if (activeSession.plate) setManualOverride(activeSession.plate);
              }}
            >
              Gunakan Data Sesi Ini
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>
              <strong>1. Kode Keluar (Setelah Bayar):</strong>
              <input
                type="text"
                placeholder="Contoh: OUT-7B1C"
                value={exitCode}
                onChange={(e) => setExitCode(e.target.value)}
                required
              />
            </label>
          </div>

          <div className="form-group">
            <label>
              <strong>2. Kamera Gate Keluar (VLM Verifikasi Plat):</strong>
              <p className="hint-text">Upload foto kendaraan/plat di gate keluar untuk dicocokkan dengan gate masuk.</p>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handlePickFile(e.target.files?.[0] || null)}
              />
            </label>
            {preview && <img className="preview" src={preview} alt="Kamera gate keluar" />}
          </div>

          <div className="form-group fallback-box">
            <label>
              <strong>Simulasi Input / Petugas Override Plat:</strong>
              <small className="d-block">Uji kecocokan plat yang benar vs plat berbeda (mismatch):</small>
              <input
                type="text"
                placeholder="Contoh: B 1234 ABC"
                value={manualOverride}
                onChange={(e) => setManualOverride(e.target.value)}
              />
            </label>
            <div className="sample-chips">
              <small>Uji Kasus: </small>
              {activeSession?.plate && (
                <button
                  type="button"
                  className="chip chip-ok"
                  onClick={() => handleUseSample(activeSession.plate!)}
                >
                  Plat Cocok ({activeSession.plate})
                </button>
              )}
              <button
                type="button"
                className="chip chip-warn"
                onClick={() => handleUseSample('B 9999 SALAH')}
              >
                Uji Plat Beda (B 9999 SALAH)
              </button>
            </div>
          </div>

          {resultMsg && (
            <div className={`alert ${resultMsg.ok ? 'alert-ok' : 'alert-err'} mt-3`}>
              <strong>{resultMsg.ok ? 'Sukses: ' : 'Peringatan / Ditolak: '}</strong>
              {resultMsg.text}
            </div>
          )}

          <div className="mt-4">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !exitCode}
            >
              {loading ? 'AI Memverifikasi Kecocokan Plat...' : 'Verifikasi Plat & Buka Gate Keluar'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
