import { useEffect, useState } from 'react';
import type { LiveEvent } from '../../types';
import { fetchEventHistory } from '../../lib/api';

interface LiveEventLogProps {
  events: LiveEvent[];
  onClear: () => void;
}

export function LiveEventLog({ events, onClear }: LiveEventLogProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [history, setHistory] = useState<LiveEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  const filtering = Boolean(from || to);

  useEffect(() => {
    if (!filtering) {
      setHistory(null);
      return;
    }
    setLoading(true);
    fetchEventHistory({ from: from || undefined, to: to || undefined })
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [from, to, filtering]);

  const shown = filtering ? history ?? [] : events;

  return (
    <div className="admin-live-log">
      <div className="page-toolbar">
        <div className="row" style={{ gap: 8 }}>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            style={{ width: 'auto' }}
            title="Dari tanggal"
          />
          <span className="hint-text" style={{ margin: 0 }}>sampai</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            style={{ width: 'auto' }}
            title="Sampai tanggal"
          />
          {filtering && (
            <button
              type="button"
              className="secondary btn-sm"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Semua / live
            </button>
          )}
          {!filtering && (
            <button type="button" className="secondary btn-sm" onClick={onClear}>
              Bersihkan log
            </button>
          )}
        </div>
      </div>

      <section className="card">
        {loading ? (
          <p className="hint-text" style={{ textAlign: 'center', padding: 20 }}>
            Memuat riwayat…
          </p>
        ) : shown.length === 0 ? (
          <p className="hint-text" style={{ textAlign: 'center', padding: 20 }}>
            {filtering ? 'Tidak ada event pada rentang tanggal ini.' : 'Menunggu event baru dari Redis Pub/Sub…'}
          </p>
        ) : (
          <div className="log-stream-list">
            {shown.map((evt, idx) => (
              <div key={idx} className="log-stream-item">
                <span className="log-time">
                  {new Date(evt.timestamp || Date.now()).toLocaleString('id-ID')}
                </span>
                <span className={`log-badge log-${evt.type?.toLowerCase() || 'default'}`}>
                  {evt.type}
                </span>
                <code className="log-payload">{JSON.stringify(evt.payload)}</code>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
