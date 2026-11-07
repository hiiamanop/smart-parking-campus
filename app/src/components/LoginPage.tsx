import { useState } from 'react';
import { setAdminToken } from '../lib/api';

interface LoginPageProps {
  onSuccess: () => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const value = token.trim();
    setAdminToken(value);

    try {
      const res = await fetch('/api/admin/sessions', {
        headers: { Authorization: `Bearer ${value}` },
      });
      if (res.status === 401 || res.status === 403) {
        setAdminToken('');
        throw new Error('Token tidak valid.');
      }
      if (!res.ok) throw new Error('Server tidak merespons dengan benar.');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src="/lencana-parkir-pintar.png" alt="Parkir Pintar ITB" />
        <h1>Masuk dashboard</h1>
        <p className="hint-text">
          Smart Parking Kampus · konsol admin. Masukkan token admin yang dikonfigurasi di server.
        </p>

        {error && <div className="alert alert-err">{error}</div>}

        <label className="login-field">
          <span>Token admin</span>
          <input
            type="password"
            placeholder="ADMIN_API_TOKEN"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoFocus
            required
          />
        </label>

        <button type="submit" className="btn btn-primary" disabled={loading || !token.trim()}>
          {loading ? 'Memeriksa…' : 'Masuk'}
        </button>

        <p className="login-foot">
          Belum punya token? Minta pengelola sistem. Token disimpan hanya di browser ini.
        </p>
      </form>
    </div>
  );
}
