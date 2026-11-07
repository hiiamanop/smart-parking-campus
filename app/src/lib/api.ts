import type { Domain, Zone, ParkingSession, LiveEvent, Analytics } from '../types';

const TOKEN_KEY = 'smart_parking_admin_token';

export function getAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export class AuthError extends Error {}

async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 || res.status === 403) {
    throw new AuthError('Token admin tidak valid atau belum diisi');
  }
  return res;
}

export async function fetchAuthStatus(): Promise<{ adminTokenRequired: boolean; gateTokenRequired: boolean }> {
  const res = await fetch('/api/auth/status');
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memeriksa status autentikasi');
  return data;
}

export async function fetchZones(): Promise<{ domains: Domain[]; zones: Zone[] }> {
  const res = await adminFetch('/api/zones');
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memuat data zona');
  return { domains: data.domains || [], zones: data.zones || [] };
}

/* ------------------------------ Domains ------------------------------ */

export async function createDomainApi(payload: {
  name: string;
  description?: string;
}): Promise<Domain> {
  const res = await adminFetch('/api/domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal membuat domain');
  return data.domain;
}

export async function updateDomainApi(
  id: string,
  payload: { name?: string; description?: string }
): Promise<Domain> {
  const res = await adminFetch(`/api/domains/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal mengubah domain');
  return data.domain;
}

export async function deleteDomainApi(id: string): Promise<Domain> {
  const res = await adminFetch(`/api/domains/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menghapus domain');
  return data.domain;
}

/* ------------------------------- Zones ------------------------------- */

export async function createZoneApi(payload: {
  name: string;
  domainId: string;
  vehicleType: 'car' | 'motorcycle';
  capacity: number;
  gateIn?: string;
  gateOut?: string;
}): Promise<Zone> {
  const res = await adminFetch('/api/zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal membuat zona');
  return data.zone;
}

export async function updateZoneApi(
  id: string,
  payload: {
    name?: string;
    domainId?: string;
    vehicleType?: 'car' | 'motorcycle';
    capacity?: number;
    gateIn?: string;
    gateOut?: string;
  }
): Promise<Zone> {
  const res = await adminFetch(`/api/zones/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal mengubah zona');
  return data.zone;
}

export async function deleteZoneApi(id: string): Promise<Zone> {
  const res = await adminFetch(`/api/zones/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menghapus zona');
  return data.zone;
}

/* ------------------------------- Admin ------------------------------- */

export async function fetchAdminSessions(): Promise<ParkingSession[]> {
  const res = await adminFetch('/api/admin/sessions');
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memuat sesi');
  return data.sessions;
}

export async function fetchAnalytics(range?: { from?: string; to?: string }): Promise<Analytics> {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const query = params.toString();
  const res = await adminFetch(`/api/admin/analytics${query ? `?${query}` : ''}`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memuat analitik');
  return data as Analytics;
}

export async function fetchEventHistory(range?: { from?: string; to?: string }): Promise<LiveEvent[]> {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const query = params.toString();
  const res = await adminFetch(`/api/admin/events${query ? `?${query}` : ''}`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memuat log');
  return data.events as LiveEvent[];
}

/* --------------------------- Live (SSE) ------------------------------ */

export function subscribeToLiveEvents(
  onEvent: (event: LiveEvent) => void,
  onStatusChange?: (connected: boolean) => void
): () => void {
  const source = new EventSource('/api/events');

  source.onopen = () => {
    onStatusChange?.(true);
  };

  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      // keepalive / non-JSON comments
    }
  };

  source.onerror = () => {
    onStatusChange?.(false);
  };

  return () => {
    source.close();
  };
}
