import { useState } from 'react';
import type { ParkingSession } from '../types';
import { fileToDataUrl } from '../lib/vlm';
import { gateInEntry } from '../lib/api';

interface GateInSimulatorProps {
  activeSession: ParkingSession | null;
  onSessionUpdated: (session: ParkingSession) => void;
}

export function GateInSimulator({ activeSession, onSessionUpdated }: GateInSimulatorProps) {
  const [sessionCode, setSessionCode] = useState(activeSession?.sessionCode || '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [manualOverride, setManualOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string; details?: any } | null>(null);

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
    if (!sessionCode) {
      setResultMsg({ ok: false, text: 'Masukkan kode sesi parkir' });
      return;
    }
    if (!preview && !manualOverride) {
      setResultMsg({ ok: false, text: 'Upload foto kendaraan/plat nomor atau isi override manual petugas' });
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

      const res = await gateInEntry({
        sessionCode: sessionCode.trim().toUpperCase(),
        platePhotoBase64: base64Data,
        mimeType,
        manualPlateOverride: manualOverride ? manualOverride.trim() : undefined,
      });

      setGateOpen(true);
      onSessionUpdated(res.session);
      setResultMsg({
        ok: true,
        text: `Palang Gate Masuk TERBUKA! Sesi dikunci ke plat: ${res.session.plate}`,
        details: res.session,
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
            <h2>Simulator Gate Masuk (Kiosk & AI Kamera)</h2>
            <p>
              Kendaraan berhenti di gate $\to$ Scan QR Sesi $\to$ Kamera VLM membaca plat nomor $\to$ Kunci sesi $\to$ Palang Terbuka.
            </p>
          </div>
          <div className={`barrier-indicator ${gateOpen ? 'barrier-open' : 'barrier-closed'}`}>
            <span className="barrier-icon">{gateOpen ? '🟢' : '🔴'}</span>
            <strong>{gateOpen ? 'PALANG TERBUKA' : 'PALANG TERTUTUP'}</strong>
          </div>
        </div>

        {activeSession && activeSession.status === 'BOOKED' && (
          <div className="quick-fill-bar">
            <span>Sesi aktif terdeteksi: <strong>{activeSession.sessionCode}</strong> ({activeSession.userName})</span>
            <button
              type="button"
              className="secondary btn-sm"
              onClick={() => setSessionCode(activeSession.sessionCode)}
            >
              Gunakan Sesi Ini
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>
              <strong>1. Kode / QR Sesi Parkir:</strong>
              <input
                type="text"
                placeholder="Contoh: SP-A1B2C3"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value)}
                required
              />
            </label>
          </div>

          <div className="form-group">
            <label>
              <strong>2. Kamera Gate (VLM OCR Plat Nomor):</strong>
              <p className="hint-text">Upload foto kendaraan/plat nomor depan di gate masuk.</p>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handlePickFile(e.target.files?.[0] || null)}
              />
            </label>
            {preview && <img className="preview" src={preview} alt="Kamera gate masuk" />}
          </div>

          <div className="form-group fallback-box">
            <label>
              <strong>Fallback Petugas (Manual Plat Override):</strong>
              <small className="d-block">Jika kamera VLM gagal/plat kotor, petugas dapat memasukkan plat manual:</small>
              <input
                type="text"
                placeholder="Contoh: B 1234 ABC"
                value={manualOverride}
                onChange={(e) => setManualOverride(e.target.value)}
              />
            </label>
            <div className="sample-chips">
              <small>Contoh Cepat: </small>
              <button type="button" className="chip" onClick={() => handleUseSample('B 1234 ABC')}>B 1234 ABC</button>
              <button type="button" className="chip" onClick={() => handleUseSample('D 5678 EFG')}>D 5678 EFG</button>
              <button type="button" className="chip" onClick={() => handleUseSample('B 9999 XYZ')}>B 9999 XYZ</button>
            </div>
          </div>

          {resultMsg && (
            <div className={`alert ${resultMsg.ok ? 'alert-ok' : 'alert-err'} mt-3`}>
              <strong>{resultMsg.ok ? 'Sukses: ' : 'Gagal: '}</strong>
              {resultMsg.text}
            </div>
          )}

          <div className="mt-4">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !sessionCode}
            >
              {loading ? 'AI Membaca Plat & Memverifikasi...' : 'Proses Masuk Gate'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
