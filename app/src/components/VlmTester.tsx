import { useState } from 'react';
import { fileToDataUrl, readPlateFromDataUrl, type VlmPlateResponse } from '../lib/vlm';

export function VlmTester() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
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
    <section className="card">
      <h2>Tes VLM plat nomor</h2>
      <p>Foto plat dikirim ke proxy server (OpenRouter). API key tetap di server, tidak masuk browser.</p>

      <label className="field">
        <span>Konteks</span>
        <select value={context} onChange={(e) => setContext(e.target.value as 'entry' | 'exit')}>
          <option value="entry">Gate masuk — kunci sesi ke plat</option>
          <option value="exit">Gate keluar — verifikasi plat</option>
        </select>
      </label>

      <label className="field">
        <span>Foto kendaraan / plat</span>
        <input type="file" accept="image/*" capture="environment" onChange={(e) => void onPick(e.target.files?.[0] || null)} />
      </label>

      <div className="row">
        <button type="button" onClick={() => void run()} disabled={!file || loading}>
          {loading ? 'Memproses…' : 'Baca plat (VLM)'}
        </button>
      </div>

      {preview && <img className="preview" src={preview} alt="Pratinjau" />}

      {resp && (
        <div style={{ marginTop: 12 }}>
          <p className={resp.ok ? 'ok' : 'err'}>
            <strong>{resp.ok ? 'Berhasil' : 'Gagal'}</strong>
            {resp.model ? ` — model: ${resp.model}` : ''}
            {resp.error ? `: ${resp.error}` : ''}
          </p>
          {r && (
            <dl className="kv">
              <dt>Plat</dt><dd>{r.plate ?? '(tidak terbaca)'}</dd>
              <dt>Confidence</dt><dd>{typeof r.confidence === 'number' ? Math.round(r.confidence * 100) + '%' : '-'}</dd>
              <dt>Jenis</dt><dd>{r.vehicle_type || '-'}</dd>
              <dt>Catatan</dt><dd>{r.notes || '-'}</dd>
            </dl>
          )}
          <details>
            <summary>Respons mentah</summary>
            <pre>{JSON.stringify(resp, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
