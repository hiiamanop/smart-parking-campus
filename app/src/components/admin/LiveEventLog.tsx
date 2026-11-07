import type { LiveEvent } from '../../types';

interface LiveEventLogProps {
  events: LiveEvent[];
  onClear: () => void;
}

export function LiveEventLog({ events, onClear }: LiveEventLogProps) {
  return (
    <div className="admin-live-log">
      <div className="section-header row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2>Audit &amp; Log Real-time (Redis Pub/Sub Stream)</h2>
          <p className="hint-text" style={{ margin: 0 }}>
            Seluruh event yang dipublish oleh microservice parkir tertangkap di channel <code>parking:events</code>.
          </p>
        </div>
        <button type="button" className="secondary btn-sm" onClick={onClear}>
          Bersihkan Log
        </button>
      </div>

      <section className="card">
        {events.length === 0 ? (
          <p className="hint-text" style={{ textAlign: 'center', padding: 20 }}>
            Menunggu event baru dari Redis Pub/Sub...
          </p>
        ) : (
          <div className="log-stream-list">
            {events.map((evt, idx) => (
              <div key={idx} className="log-stream-item">
                <span className="log-time">
                  {new Date(evt.timestamp || Date.now()).toLocaleTimeString()}
                </span>
                <span className={`log-badge log-${evt.type?.toLowerCase() || 'default'}`}>
                  {evt.type}
                </span>
                <code className="log-payload">
                  {JSON.stringify(evt.payload)}
                </code>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
