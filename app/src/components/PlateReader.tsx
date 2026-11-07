import { useRef, useState } from 'react';
import { fileToDataUrl, readPlateFromDataUrl } from '../lib/vlm';

type Props = {
  context: 'entry' | 'exit';
  disabled?: boolean;
  onPlate: (plate: string, confidence?: number) => void;
};

type ReadState = {
  plate: string | null;
  confidence?: number;
  notes?: string;
  model?: string;
  error?: string;
};

export function PlateReader({ context, disabled, onPlate }: Props) {
  const [preview, setPreview] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ReadState | null>(null);
  const [manual, setManual] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(f: File | null) {
    setFile(f);
    setState(null);
    setPreview(f ? await fileToDataUrl(f) : '');
  }

  async function readWithVlm() {
    if (!file) return;
    setBusy(true);
    setState(null);
    try {
      const dataUrl = preview || (await fileToDataUrl(file));
      const res = await readPlateFromDataUrl(dataUrl, context);
      if (!res.ok) {
        setState({ plate: null, error: res.error || 'VLM gagal membaca plat.' });
        return;
      }
      const r = res.result;
      setState({
        plate: r?.plate ?? null,
        confidence: r?.confidence,
        notes: r?.notes,
        model: res.model,
        error: r?.plate ? undefined : 'Plat tidak terbaca. Coba foto lebih jelas atau isi manual.',
      });
      if (r?.plate) onPlate(r.plate, r.confidence);
    } catch (e) {
      setState({ plate: null, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="plate-reader">
      <label className="field">
        <span>Foto plat / kendaraan</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled || busy}
          onChange={(e) => void pick(e.target.files?.[0] || null)}
        />
      </label>

      {preview && <img className="preview" src={preview} alt="Pratinjau plat" />}

      <div className="row">
        <button type="button" onClick={() => void readWithVlm()} disabled={!file || busy || disabled}>
          {busy ? 'Membaca plat…' : 'Baca plat (VLM) & buka palang'}
        </button>
        {preview && (
          <button type="button" className="secondary" disabled={busy || disabled}
            onClick={() => { setFile(null); setPreview(''); setState(null); if (inputRef.current) inputRef.current.value = ''; }}>
            Hapus foto
          </button>
        )}
      </div>

      {state && (
        <div className={state.error && !state.plate ? 'callout err' : 'callout ok'}>
          {state.plate ? (
            <>
              <strong>Plat terbaca: {state.plate}</strong>
              {typeof state.confidence === 'number' && <small>Confidence {Math.round(state.confidence * 100)}%</small>}
              {state.notes && <small>{state.notes}</small>}
            </>
          ) : (
            <strong>{state.error}</strong>
          )}
        </div>
      )}

      <details className="manual">
        <summary>VLM gagal / tanpa kamera? Isi plat manual</summary>
        <div className="row">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value.toUpperCase())}
            placeholder="Contoh: B 1234 XYZ"
            disabled={disabled || busy}
          />
          <button type="button" className="secondary" disabled={manual.trim().length < 3 || disabled || busy}
            onClick={() => onPlate(manual.trim(), undefined)}>
            Pakai plat manual
          </button>
        </div>
        <small>Mode manual hanya untuk uji coba/petugas.</small>
      </details>
    </div>
  );
}
