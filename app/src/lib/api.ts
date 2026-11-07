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

/* --------------------------- Operator assistant --------------------------- */

export interface AssistantAction {
  type: string;
  params: Record<string, unknown>;
}

export interface AssistantReply {
  reply: string;
  action: AssistantAction | null;
}

export async function askAssistant(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<AssistantReply> {
  const res = await adminFetch('/api/admin/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Asisten tidak merespons');
  return { reply: data.reply, action: data.action || null };
}

export function describeAssistantAction(action: AssistantAction): string {
  const p = action.params as Record<string, any>;
  const label: Record<string, string> = {
    create_domain: `Buat domain "${p.name ?? ''}"`,
    update_domain: `Ubah domain ${p.id ?? ''}`,
    delete_domain: `Hapus domain ${p.id ?? ''}`,
    create_zone: `Buat zona "${p.name ?? ''}" di domain ${p.domainId ?? ''} (${p.capacity ?? '?'} slot)`,
    update_zone: `Ubah zona ${p.id ?? ''}`,
    delete_zone: `Hapus zona ${p.id ?? ''}`,
    cancel_booking: `Batalkan booking ${p.sessionCode ?? ''}`,
    reissue_exit: `Terbitkan ulang QR keluar untuk ${p.sessionCode ?? ''}`,
  };
  return label[action.type] || action.type;
}

export async function applyAssistantAction(action: AssistantAction): Promise<string> {
  const p = action.params as Record<string, any>;
  switch (action.type) {
    case 'create_domain': {
      const d = await createDomainApi({ name: p.name, description: p.description });
      return `Domain "${d.name}" dibuat.`;
    }
    case 'update_domain': {
      const d = await updateDomainApi(p.id, { name: p.name, description: p.description });
      return `Domain "${d.name}" diperbarui.`;
    }
    case 'delete_domain': {
      const d = await deleteDomainApi(p.id);
      return `Domain "${d.name}" dihapus.`;
    }
    case 'create_zone': {
      const z = await createZoneApi({
        name: p.name,
        domainId: p.domainId,
        vehicleType: p.vehicleType,
        capacity: Number(p.capacity),
        gateIn: p.gateIn,
        gateOut: p.gateOut,
      });
      return `Zona "${z.name}" dibuat.`;
    }
    case 'update_zone': {
      const z = await updateZoneApi(p.id, {
        name: p.name,
        domainId: p.domainId,
        vehicleType: p.vehicleType,
        capacity: p.capacity !== undefined ? Number(p.capacity) : undefined,
        gateIn: p.gateIn,
        gateOut: p.gateOut,
      });
      return `Zona "${z.name}" diperbarui.`;
    }
    case 'delete_zone': {
      const z = await deleteZoneApi(p.id);
      return `Zona "${z.name}" dihapus.`;
    }
    case 'cancel_booking': {
      const res = await adminFetch('/api/bookings/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: p.sessionCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal membatalkan booking');
      return `Booking ${p.sessionCode} dibatalkan.`;
    }
    case 'reissue_exit': {
      const res = await adminFetch('/api/payments/reissue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: p.sessionCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menerbitkan ulang QR keluar');
      return data.charged
        ? `QR keluar baru diterbitkan; denda Rp${Number(data.penalty).toLocaleString('id-ID')} dibayar.`
        : 'QR keluar baru diterbitkan tanpa denda.';
    }
    default:
      throw new Error(`Aksi ${action.type} tidak didukung`);
  }
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
