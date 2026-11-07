import { useEffect, useState, useCallback } from 'react';
import type { Faculty, Zone, LiveEvent } from './types';
import { fetchZones, subscribeToLiveEvents } from './lib/api';
import { ZoneManager } from './components/admin/ZoneManager';
import { ZoneQRGenerator } from './components/admin/ZoneQRGenerator';
import { SessionMonitor } from './components/admin/SessionMonitor';
import { GateControl } from './components/admin/GateControl';
import { LiveEventLog } from './components/admin/LiveEventLog';
import { VlmTestView } from './components/VlmTestView';

type AdminTab = 'zones' | 'qr-signs' | 'sessions' | 'gates' | 'logs' | 'vlm';

export function App() {
  const [activeTab, setActiveTab] = useState<AdminTab>('zones');
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [redisConnected, setRedisConnected] = useState<boolean>(false);
  const [eventLogs, setEventLogs] = useState<LiveEvent[]>([]);
  const [latestEventTimestamp, setLatestEventTimestamp] = useState<string>('');

  const loadData = useCallback(() => {
    fetchZones()
      .then((data) => {
        setFaculties(data.faculties);
        setZones(data.zones);
      })
      .catch((err) => console.error('Failed to load zones', err));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Hook up Redis Pub/Sub Live Events via SSE
  useEffect(() => {
    const unsubscribe = subscribeToLiveEvents(
      (event: LiveEvent) => {
        setEventLogs((prev) => [event, ...prev.slice(0, 99)]);
        setLatestEventTimestamp(event.timestamp || new Date().toISOString());

        if (event.type === 'ZONE_SNAPSHOT' && event.payload) {
          if (event.payload.faculties) setFaculties(event.payload.faculties);
          if (event.payload.zones) setZones(event.payload.zones);
        } else if (event.type === 'ZONE_UPDATED' && event.payload) {
          if (event.payload.zones) setZones(event.payload.zones);
        }
      },
      (connected: boolean) => {
        setRedisConnected(connected);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <main>
      <header className="no-print">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <h1>Dashboard Admin — Smart Parking Kampus</h1>
            <span className="badge" style={{ background: '#0f172a', color: '#fff' }}>Port 5173</span>
          </div>
          <p className="hint-text" style={{ margin: 0 }}>
            Pusat Kendali Master Data Zona, Generate QR Tiang, Monitoring Kendaraan &amp; Audit Log Redis
          </p>
        </div>
        <div className="row">
          <span className={`badge badge-redis ${redisConnected ? 'connected' : ''}`}>
            {redisConnected ? '● Redis Pub/Sub Live' : '○ Redis Reconnecting...'}
          </span>
          <a
            href="http://localhost:5174"
            target="_blank"
            rel="noreferrer"
            className="btn secondary btn-sm"
            style={{ textDecoration: 'none' }}
          >
            🚗 Buka App Driver / Check-in &rarr;
          </a>
        </div>
      </header>

      {/* Live Redis Ticker */}
      {eventLogs[0] && (
        <div className="live-ticker no-print">
          <span className="live-ticker-dot" />
          <span className="live-ticker-text">
            [Redis Live] {eventLogs[0].type}: {JSON.stringify(eventLogs[0].payload).slice(0, 90)}...
          </span>
        </div>
      )}

      {/* Admin Tab Navigation */}
      <nav className="nav-tabs no-print">
        <button
          className={`tab-btn ${activeTab === 'zones' ? 'active' : ''}`}
          onClick={() => setActiveTab('zones')}
        >
          🏢 Master Zona (CRUD)
        </button>
        <button
          className={`tab-btn ${activeTab === 'qr-signs' ? 'active' : ''}`}
          onClick={() => setActiveTab('qr-signs')}
        >
          🖨️ Cetak QR Tiang Zona
        </button>
        <button
          className={`tab-btn ${activeTab === 'sessions' ? 'active' : ''}`}
          onClick={() => setActiveTab('sessions')}
        >
          🚗 Monitoring Sesi &amp; Kendaraan ({zones.reduce((acc, z) => acc + z.occupied, 0)})
        </button>
        <button
          className={`tab-btn ${activeTab === 'gates' ? 'active' : ''}`}
          onClick={() => setActiveTab('gates')}
        >
          🚨 Override Palang Gate
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          📡 Audit Log Redis ({eventLogs.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'vlm' ? 'active' : ''}`}
          onClick={() => setActiveTab('vlm')}
        >
          👁️ Uji AI Plat (VLM)
        </button>
      </nav>

      {/* Admin Panels */}
      {activeTab === 'zones' && (
        <ZoneManager
          faculties={faculties}
          zones={zones}
          onRefresh={loadData}
        />
      )}

      {activeTab === 'qr-signs' && (
        <ZoneQRGenerator
          faculties={faculties}
          zones={zones}
        />
      )}

      {activeTab === 'sessions' && (
        <SessionMonitor
          zones={zones}
          lastUpdateTimestamp={latestEventTimestamp}
        />
      )}

      {activeTab === 'gates' && (
        <GateControl zones={zones} />
      )}

      {activeTab === 'logs' && (
        <LiveEventLog
          events={eventLogs}
          onClear={() => setEventLogs([])}
        />
      )}

      {activeTab === 'vlm' && <VlmTestView />}
    </main>
  );
}
