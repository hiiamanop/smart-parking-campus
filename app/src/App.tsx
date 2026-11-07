import { useEffect, useState, useCallback } from 'react';
import type { Domain, Zone, LiveEvent } from './types';
import { fetchZones, subscribeToLiveEvents } from './lib/api';
import { ZoneManager } from './components/admin/ZoneManager';
import { DomainManager } from './components/admin/DomainManager';
import { ZoneQRGenerator } from './components/admin/ZoneQRGenerator';
import { SessionMonitor } from './components/admin/SessionMonitor';
import { AnalyticsPanel } from './components/admin/AnalyticsPanel';
import { LiveEventLog } from './components/admin/LiveEventLog';
import { VlmTestView } from './components/VlmTestView';

type AdminTab = 'domains' | 'zones' | 'qr-signs' | 'analytics' | 'sessions' | 'logs' | 'vlm';

const TABS: Array<{ id: AdminTab; label: string; group: string; title: string; sub: string }> = [
  {
    id: 'domains',
    label: 'Domain',
    group: 'Kelola',
    title: 'Domain parkir',
    sub: 'Kelompok area parkir yang menjadi acuan zona.',
  },
  {
    id: 'zones',
    label: 'Zona parkir',
    group: 'Kelola',
    title: 'Zona parkir',
    sub: 'Kapasitas, domain terkait, dan titik gate tiap area.',
  },
  {
    id: 'qr-signs',
    label: 'QR zona',
    group: 'Kelola',
    title: 'QR zona',
    sub: '',
  },
  {
    id: 'analytics',
    label: 'Analitik',
    group: 'Pantau',
    title: 'Analitik & perawatan preventif',
    sub: 'Titik paling aktif dan prioritas pemeriksaan kamera gate.',
  },
  {
    id: 'sessions',
    label: 'Sesi & kendaraan',
    group: 'Pantau',
    title: 'Sesi & kendaraan',
    sub: 'Kendaraan yang sedang berada di area parkir kampus.',
  },
  {
    id: 'logs',
    label: 'Audit log',
    group: 'Sistem',
    title: 'Audit log',
    sub: 'Aliran event Redis Pub/Sub yang tercatat terminal gate.',
  },
  {
    id: 'vlm',
    label: 'Uji VLM',
    group: 'Sistem',
    title: 'Uji VLM plat nomor',
    sub: 'Uji pembacaan plat langsung ke model vision OpenRouter.',
  },
];

const TAB_STORAGE_KEY = 'smart_parking_admin_tab';

function readInitialTab(): AdminTab {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY) as AdminTab | null;
    if (saved && TABS.some((t) => t.id === saved)) return saved;
  } catch {}
  return 'zones';
}

export function App() {
  const [activeTab, setActiveTabState] = useState<AdminTab>(readInitialTab);

  const setActiveTab = (tab: AdminTab) => {
    setActiveTabState(tab);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {}
  };
  const [domains, setDomains] = useState<Domain[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [redisConnected, setRedisConnected] = useState<boolean>(false);
  const [eventLogs, setEventLogs] = useState<LiveEvent[]>([]);
  const [latestEventTimestamp, setLatestEventTimestamp] = useState<string>('');

  const loadData = useCallback(() => {
    fetchZones()
      .then((data) => {
        setDomains(data.domains);
        setZones(data.zones);
      })
      .catch((err) => console.error('Failed to load zones', err));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = subscribeToLiveEvents(
      (event: LiveEvent) => {
        const isSnapshot = event.type === 'ZONE_SNAPSHOT';

        if (!isSnapshot) {
          setEventLogs((prev) => [event, ...prev.slice(0, 99)]);
          setLatestEventTimestamp(event.timestamp || new Date().toISOString());
        }

        if (event.payload?.domains) setDomains(event.payload.domains);
        if (event.payload?.zones) setZones(event.payload.zones);
      },
      (connected: boolean) => setRedisConnected(connected)
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const current = TABS.find((t) => t.id === activeTab) || TABS[0];
  const occupied = zones.reduce((acc, z) => acc + z.occupied, 0);

  return (
    <div className="app-shell">
      <aside className="sidebar no-print">
        <div className="brand">
          <img className="brand-logo" src="/logo-itb.png" alt="Logo ITB" />
          <div>
            <div className="brand-name">Smart Parking</div>
            <div className="brand-sub">Admin kampus</div>
          </div>
        </div>

        <nav className="side-nav">
          {['Kelola', 'Pantau', 'Sistem'].map((group) => (
            <div key={group} className="side-nav-group">
              <div className="side-nav-label">{group}</div>
              {TABS.filter((t) => t.group === group).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`side-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span>{tab.label}</span>
                  {tab.id === 'sessions' && occupied > 0 && (
                    <span className="side-nav-count">{occupied}</span>
                  )}
                  {tab.id === 'logs' && eventLogs.length > 0 && (
                    <span className="side-nav-count">{eventLogs.length}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className={`live-state ${redisConnected ? 'on' : ''}`}>
            <span className="live-dot" />
            <span>{redisConnected ? 'Redis terhubung' : 'Redis terputus'}</span>
          </div>
          <a
            className="link-muted"
            href="https://parkir.hiiamanop.my.id"
            target="_blank"
            rel="noreferrer"
          >
            Buka aplikasi driver ↗
          </a>
        </div>
      </aside>

      <div className="workspace">
        <header className="workspace-header">
          <div>
            <h1 className="workspace-title">{current.title}</h1>
            {current.sub && <p className="workspace-sub">{current.sub}</p>}
          </div>
          <div className="header-actions">
            <div className="metric-inline">
              <span className="metric-inline-value">{zones.length}</span>
              <span className="metric-inline-label">zona</span>
            </div>
            <div className="metric-inline">
              <span className="metric-inline-value">{occupied}</span>
              <span className="metric-inline-label">terisi</span>
            </div>
            <span className={`status-chip ${redisConnected ? 'ok' : 'off'}`}>
              {redisConnected ? 'Live' : 'Offline'}
            </span>
            <a
              className="header-link"
              href="https://parkir.hiiamanop.my.id"
              target="_blank"
              rel="noreferrer"
            >
              App driver ↗
            </a>
          </div>
        </header>

        {/* Mobile nav (hidden on desktop) */}
        <nav className="mobile-nav no-print">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`mobile-nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="workspace-body">
          {activeTab === 'domains' && (
            <DomainManager domains={domains} zones={zones} onRefresh={loadData} />
          )}
          {activeTab === 'zones' && (
            <ZoneManager domains={domains} zones={zones} onRefresh={loadData} />
          )}
          {activeTab === 'qr-signs' && (
            <ZoneQRGenerator domains={domains} zones={zones} />
          )}
          {activeTab === 'analytics' && <AnalyticsPanel />}
          {activeTab === 'sessions' && (
            <SessionMonitor zones={zones} lastUpdateTimestamp={latestEventTimestamp} />
          )}
          {activeTab === 'logs' && (
            <LiveEventLog events={eventLogs} onClear={() => setEventLogs([])} />
          )}
          {activeTab === 'vlm' && <VlmTestView />}
        </div>
      </div>
    </div>
  );
}
