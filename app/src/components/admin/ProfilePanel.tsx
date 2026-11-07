import { useState } from 'react';
import { getAdminToken } from '../../lib/api';

interface ProfilePanelProps {
  onLogout: () => void;
}

const NAME_KEY = 'smart_parking_admin_name';

export function ProfilePanel({ onLogout }: ProfilePanelProps) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) || 'Admin Kampus';
    } catch {
      return 'Admin Kampus';
    }
  });
  const [saved, setSaved] = useState(false);

  const token = getAdminToken();
  const masked = token ? `${token.slice(0, 4)}••••${token.slice(-4)}` : 'Tidak ada token (mode dev)';

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(NAME_KEY, name.trim() || 'Admin Kampus');
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="profile-grid">
      <section className="card">
        <h3>Profil pengelola</h3>
        <p className="hint-text">Nama ini hanya tersimpan di browser ini dan dipakai untuk sapaan di dashboard.</p>

        <form onSubmit={save}>
          <div className="form-group">
            <label>
              Nama tampilan
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <div className="form-group">
            <label>
              Peran
              <input type="text" value="Administrator parkir kampus" readOnly />
            </label>
          </div>
          <div className="form-group">
            <label>
              Token akses
              <input type="text" value={masked} readOnly />
            </label>
          </div>

          {saved && <div className="alert alert-ok">Nama tersimpan.</div>}

          <div className="row">
            <button type="submit" className="btn btn-primary">Simpan</button>
            <button type="button" className="secondary" onClick={onLogout}>
              Keluar dari dashboard
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h3>Tautan</h3>
        <div className="profile-links">
          <a href="https://parkir.hiiamanop.my.id" target="_blank" rel="noreferrer">
            Aplikasi driver ↗
          </a>
          <a href="https://parkir.hiiamanop.my.id" target="_blank" rel="noreferrer">
            Panduan operasional ↗
          </a>
          <a href="/health" target="_blank" rel="noreferrer">
            Status server (/health) ↗
          </a>
        </div>

        <h3 style={{ marginTop: 20 }}>Keamanan</h3>
        <ul className="profile-list">
          <li>Token admin disimpan di localStorage browser ini.</li>
          <li>Keluar akan menghapus token dan meminta login ulang.</li>
          <li>Gunakan token berbeda untuk setiap petugas.</li>
        </ul>
      </section>
    </div>
  );
}
