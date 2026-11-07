import type { Domain, Zone, ParkingSession, LiveEvent, Analytics } from '../types';

export async function fetchZones(): Promise<{ domains: Domain[]; zones: Zone[] }> {
  const res = await fetch('/api/zones');
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memuat data zona');
  return { domains: data.domains || [], zones: data.zones || [] };
}

/* ------------------------------ Domains ------------------------------ */

export async function createDomainApi(payload: {
  name: string;
  description?: string;
}): Promise<Domain> {
  const res = await fetch('/api/domains', {
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
  const res = await fetch(`/api/domains/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal mengubah domain');
  return data.domain;
}

export async function deleteDomainApi(id: string): Promise<Domain> {
  const res = await fetch(`/api/domains/${encodeURIComponent(id)}`, {
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
  const res = await fetch('/api/zones', {
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
  const res = await fetch(`/api/zones/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal mengubah zona');
  return data.zone;
}

export async function deleteZoneApi(id: string): Promise<Zone> {
  const res = await fetch(`/api/zones/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menghapus zona');
  return data.zone;
}

/* ------------------------------- Admin ------------------------------- */

export async function fetchAdminSessions(): Promise<ParkingSession[]> {
  const res = await fetch('/api/admin/sessions');
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memuat sesi');
  return data.sessions;
}

export async function fetchAnalytics(): Promise<Analytics> {
  const res = await fetch('/api/admin/analytics');
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memuat analitik');
  return data as Analytics;
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
