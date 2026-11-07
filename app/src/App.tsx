import { useMemo, useState } from 'react';
import { fileToDataUrl, readPlateFromDataUrl, type VlmPlateResponse } from './lib/vlm';

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function App() {
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [context, setContext] = useState<'entry' | 'exit'>('entry');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<VlmPlateResponse | null>(null);

  useMemo(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function install() {
    if (!installEvt) return;
    await installEvt.prompt();
    await installEvt.userChoice.catch(() => null);
    setInstallEvt(null);
  }

  async function onPick(f: File | null) {
    setFile(f); setResp(null);
    setPreview(f ? await fileToDataUrl(f) : '');
  }

  async function run() {
    if (!file) return;
    setLoading(true); setResp(null);
    try {
      const dataUrl = preview || await fileToDataUrl(file);
      setResp(await readPlateFromDataUrl(dataUrl, context));
    } catch (e) {
      setResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setLoading(false); }
  }

  const r = resp?.result;
  return (
    <main>
      <header>
        <div>
          <h1>Smart Parking Kampus</h1>
          <small>Web-based (PWA) — MVP fondasi + tes VLM (OpenRouter)</small>
        </div>
        <div className="row">
          <span className="badge">PWA / Shortcut</span>
          {installEvt ? <button className="secondary" onClick={install}>Tambah shortcut</button> : <small>Shortcut: menu browser “Add to Home Screen”</small>}
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <h2>Alur MVP (ringkas)</h2>
          <ol className="flow">
            <li>Booking dari rumah (fakultas, zona, ETA/ETD) → QR/barcode sesi.</li>
            <li>Gate masuk: scan QR sesi + <strong>VLM baca plat</strong> → sesi terkunci ke plat, palang terbuka.</li>
            <li>Zona: scan QR zona (konfirmasi parkir).</li>
            <li>Zona: scan QR zona (mulai checkout) → bill.</li>
            <li>Bayar di app (QRIS, bukan di gate). Rp2.000 / overstay: violation + Rp2.000+Rp1.000.</li>
            <li>Gate keluar: <strong>VLM verifikasi plat</strong> + QR/barcode keluar → palang terbuka.</li>
          </ol>
          <p><small>Dokumen lengkap: <code>docs/user-story.md</code>, <code>docs/backlog.md</code>, <code>docs/brd.md</code>.</small></p>
        </section>

        <section className="card">
          <h2>Tes VLM Plat Nomor (OpenRouter)</h2>
          <p>Upload foto kendaraan/plat. Proxy lokal memanggil OpenRouter dengan model dari <code>.env</code> (API key tidak dikirim ke browser).</p>
          <div className="row" style={{ marginBottom: 8 }}>
            <label><small>Konteks: </small>
              <select value={context} onChange={(e) => setContext(e.target.value as 'entry'|'exit')}>
                <option value="entry">Gate masuk (kunci sesi)</option>
                <option value="exit">Gate keluar (verifikasi)</option>
              </select>
            </label>
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <input type="file" accept="image/*" onChange={(e) => onPick(e.target.files?.[0] || null)} />
            <button onClick={run} disabled={!file || loading}>{loading ? 'Memproses...' : 'Baca plat (VLM)'}</button>
          </div>
          {preview && <img className="preview" src={preview} alt="Preview" />}
          {resp && (
            <div style={{ marginTop: 10 }}>
              <p className={resp.ok ? 'ok' : 'err'}><strong>{resp.ok ? 'OK' : 'Gagal'}</strong>{resp.model ? ` — model: ${resp.model}` : ''}{resp.error ? `: ${resp.error}` : ''}</p>
              {r && (
                <dl className="kv">
                  <dt>Plat</dt><dd>{r.plate ?? '(tidak terbaca)'}</dd>
                  <dt>Confidence</dt><dd>{typeof r.confidence === 'number' ? r.confidence : '-'}</dd>
                  <dt>Jenis</dt><dd>{r.vehicle_type || '-'}</dd>
                  <dt>Catatan</dt><dd>{r.notes || '-'}</dd>
                </dl>
              )}
              <details style={{ marginTop: 8 }}><summary>Respons mentah</summary><pre>{JSON.stringify(resp, null, 2)}</pre></details>
            </div>
          )}
          <p style={{ marginTop: 10 }}><small>Jalankan proxy: <code>cd server && node --env-file=../.env server.mjs</code> (Node 20+) atau <code>node server.mjs</code> (loader .env bawaan). Isi <code>OPENROUTER_API_KEY</code> di <code>.env</code>.</small></p>
        </section>
      </div>
    </main>
  );
}
