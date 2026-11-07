import { useState } from 'react';
import { fileToDataUrl, readPlateFromDataUrl, type VlmPlateResponse } from '../lib/vlm';

export function VlmTestView() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [context, setContext] = useState<'entry' | 'exit'>('entry');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<VlmPlateResponse | null>(null);

  async function onPick(f: File | null) {
    setFile(f);
    setResp(null);
    setPreview(f ? await fileToDataUrl(f) : '');
  }

  async function run() {
    if (!file) return;
    setLoading(true);
    setResp(null);
    try {
      const dataUrl = preview || (await fileToDataUrl(file));
      setResp(await readPlateFromDataUrl(dataUrl, context));
    } catch (e) {
      setResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  const r = resp?.result;

  return (
    <div className="vlm-test-container">
      <section className="card">
        <div className="row mb-3">
          <label>
            <small>Konteks: </small>
            <select value={context} onChange={(e) => setContext(e.target.value as 'entry' | 'exit')}>
              <option value="entry">Gate masuk (kunci sesi)</option>
              <option value="exit">Gate keluar (verifikasi)</option>
            </select>
          </label>
        </div>

        <div className="row mb-3">
          <input type="file" accept="image/*" onChange={(e) => onPick(e.target.files?.[0] || null)} />
          <button type="button" onClick={run} disabled={!file || loading}>
            {loading ? 'AI Memproses...' : 'Baca plat (VLM)'}
          </button>
        </div>

        {preview && <img className="preview" src={preview} alt="Preview" />}

        {resp && (
          <div style={{ marginTop: 14 }}>
            <p className={resp.ok ? 'ok' : 'err'}>
              <strong>{resp.ok ? 'OK' : 'Gagal'}</strong>
              {resp.model ? ` — model: ${resp.model}` : ''}
              {resp.error ? `: ${resp.error}` : ''}
            </p>
            {r && (
              <dl className="kv">
                <dt>Plat Terbaca</dt>
                <dd>{r.plate ?? '(tidak terbaca)'}</dd>
                <dt>Confidence</dt>
                <dd>{typeof r.confidence === 'number' ? `${(r.confidence * 100).toFixed(0)}%` : '-'}</dd>
                <dt>Jenis</dt>
                <dd>{r.vehicle_type || '-'}</dd>
                <dt>Catatan AI</dt>
                <dd>{r.notes || '-'}</dd>
              </dl>
            )}
            <details style={{ marginTop: 10 }}>
              <summary>Respons mentah JSON</summary>
              <pre>{JSON.stringify(resp, null, 2)}</pre>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}
