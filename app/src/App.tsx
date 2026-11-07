import { useEffect, useState, useCallback } from 'react';
import type { Domain, Zone, LiveEvent } from './types';
import { fetchZones, subscribeToLiveEvents, AuthError, getAdminToken, fetchAuthStatus } from './lib/api';
import { LoginPage } from './components/LoginPage';
import { OverviewPanel } from './components/admin/OverviewPanel';
import { ProfilePanel } from './components/admin/ProfilePanel';
import { ZoneManager } from './components/admin/ZoneManager';
import { DomainManager } from './components/admin/DomainManager';
import { ZoneQRGenerator } from './components/admin/ZoneQRGenerator';
import { SessionMonitor } from './components/admin/SessionMonitor';
import { AnalyticsPanel } from './components/admin/AnalyticsPanel';
import { LiveEventLog } from './components/admin/LiveEventLog';
import { VlmTestView } from './components/VlmTestView';
import { OperatorAssistant } from './components/admin/OperatorAssistant';

type AdminTab = 'overview' | 'domains' | 'zones' | 'qr-signs' | 'analytics' | 'sessions' | 'logs' | 'vlm' | 'profile';

const TABS: Array<{ id: AdminTab; label: string; group: string; title: string; sub: string }> = [
  {
    id: 'overview',
    label: 'Ringkasan',
    group: 'Ringkasan',
    title: 'Ringkasan operasional',
    sub: 'Kondisi parkir hari ini: hunian, pendapatan, dan kesehatan kamera gate.',
  },
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
  {
    id: 'profile',
    label: 'Profil',
    group: 'Akun',
    title: 'Profil pengelola',
    sub: 'Identitas tampilan, status token, dan sesi dashboard.',
  },
];


// Minimal stroke icons for the sidebar (no emoji)
const SIDEBAR_ICONS = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  domains: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  zones: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  'qr-signs': (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 20h1M20 14h1" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
  sessions: (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </>
  ),
  logs: (
    <>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </>
  ),
  vlm: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
};

function SidebarIcon({ name }: { name: string }) {
  const icon = SIDEBAR_ICONS[name as keyof typeof SIDEBAR_ICONS] ?? SIDEBAR_ICONS.overview;
  return (
    <svg
      className="side-nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon}
    </svg>
  );
}

const TAB_STORAGE_KEY = 'smart_parking_admin_tab';

function tabFromHash(): AdminTab | null {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return TABS.some((t) => t.id === raw) ? (raw as AdminTab) : null;
}

function readInitialTab(): AdminTab {
  const fromHash = tabFromHash();
  if (fromHash) return fromHash;
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY) as AdminTab | null;
    if (saved && TABS.some((t) => t.id === saved)) return saved;
  } catch {}
  return 'overview';
}

export function App() {
  const [activeTab, setActiveTabState] = useState<AdminTab>(readInitialTab);

  const setActiveTab = (tab: AdminTab) => {
    setActiveTabState(tab);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {}
  };

  // Sync the active tab with the URL hash so browser back/forward and deep links work.
  useEffect(() => {
    const target = `#/${activeTab}`;
    if (window.location.hash !== target) window.location.hash = target;
  }, [activeTab]);

  useEffect(() => {
    const onHashChange = () => {
      const tab = tabFromHash();
      if (tab && tab !== activeTab) setActiveTabState(tab);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [activeTab]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [redisConnected, setRedisConnected] = useState<boolean>(false);
  const [eventLogs, setEventLogs] = useState<LiveEvent[]>([]);
  const [latestEventTimestamp, setLatestEventTimestamp] = useState<string>('');
  const [authState, setAuthState] = useState<'checking' | 'required' | 'ok'>('checking');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('smart_parking_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('smart_parking_sidebar_collapsed', next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  const loadData = useCallback(() => {
    fetchZones()
      .then((data) => {
        setDomains(data.domains);
        setZones(data.zones);
      })
      .catch((err) => {
        if (err instanceof AuthError) setAuthState('required');
        else console.error('Failed to load zones', err);
      });
  }, []);

  useEffect(() => {
    fetchAuthStatus()
      .then((status) => {
        if (status.adminTokenRequired && !getAdminToken()) setAuthState('required');
        else setAuthState('ok');
      })
      .catch(() => setAuthState('ok'));
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

  if (authState === 'checking') {
    return <div className="login-shell"><p className="hint-text">Memeriksa sesi…</p></div>;
  }

  if (authState === 'required') {
    return (
      <LoginPage
        onSuccess={() => {
          setAuthState('ok');
          loadData();
        }}
      />
    );
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar no-print">
        <div className="brand">
          <img className="brand-logo" src="/lencana-parkir-pintar.png" alt="Parkir Pintar ITB" />
          <div className="brand-text">
            <div className="brand-name">Smart Parking</div>
            <div className="brand-sub">Konsol admin kampus</div>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            title={sidebarCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {sidebarCollapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
            </svg>
          </button>
        </div>

        <nav className="side-nav">
          {['Ringkasan', 'Kelola', 'Pantau', 'Akun', 'Sistem'].map((group) => (
            <div key={group} className="side-nav-group">
              <div className="side-nav-label">{group}</div>
              {TABS.filter((t) => t.group === group).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`side-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                >
                  <SidebarIcon name={tab.id} />
                  <span className="side-nav-text">{tab.label}</span>
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
          <div className={`sidebar-status ${redisConnected ? 'on' : ''}`}>
            <span className="live-dot" />
            <div>
              <span className="sidebar-status-title">{redisConnected ? 'Terhubung' : 'Terputus'}</span>
              <span className="sidebar-status-sub">Redis realtime</span>
            </div>
          </div>

          <a
            className="sidebar-link"
            href="https://parkir.hiiamanop.my.id"
            target="_blank"
            rel="noreferrer"
          >
            <span>Aplikasi driver</span>
            <span aria-hidden="true">↗</span>
          </a>

          {getAdminToken() && (
            <button
              type="button"
              className="sidebar-link danger"
              onClick={() => {
                try {
                  localStorage.removeItem('smart_parking_admin_token');
                } catch {}
                setAuthState('required');
              }}
            >
              <span>Keluar</span>
            </button>
          )}
        </div>
      </aside>

      <div className="workspace">
        <header className="workspace-header">
          <div>
            <div className="workspace-eyebrow">{current.group}</div>
            <h1 className="workspace-title">{current.title}</h1>
            {current.sub && <p className="workspace-sub">{current.sub}</p>}
          </div>
          <div className="header-actions">
            <div className="header-metrics">
              <div className="metric-inline">
                <span className="metric-inline-value">{zones.length}</span>
                <span className="metric-inline-label">zona</span>
              </div>
              <div className="metric-inline">
                <span className="metric-inline-value">{occupied}</span>
                <span className="metric-inline-label">terisi</span>
              </div>
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
          {activeTab === 'overview' && (
            <OverviewPanel
              onNavigate={(tab) => setActiveTab(tab as AdminTab)}
            />
          )}
          {activeTab === 'profile' && (
            <ProfilePanel
              onLogout={() => {
                try {
                  localStorage.removeItem('smart_parking_admin_token');
                } catch {}
                setAuthState('required');
              }}
            />
          )}
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

      <OperatorAssistant onApplied={loadData} />
    </div>
  );
}
