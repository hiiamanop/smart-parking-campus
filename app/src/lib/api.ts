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

function stringList(value: unknown, limit = 150): string[] {
  return Array.isArray(value)
    ? value.map(String).map((s) => s.trim()).filter(Boolean).slice(0, limit)
    : [];
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  destructive?: boolean;
}

export interface AssistantReply {
  reply: string;
  action: AssistantAction | null;
  actions: AssistantAction[];
  requiresConfirmation: boolean;
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
  const actions: AssistantAction[] = Array.isArray(data.actions)
    ? data.actions
    : data.action
      ? [data.action]
      : [];
  return {
    reply: data.reply,
    action: data.action || actions[0] || null,
    actions,
    requiresConfirmation: Boolean(data.requiresConfirmation),
  };
}

export interface VoiceSession {
  voiceSessionId: string;
  maxSeconds: number;
  expiresAt: number;
  sttModel?: string;
  ttsModel?: string;
}

export async function startVoiceSession(): Promise<VoiceSession> {
  const res = await adminFetch('/api/admin/voice/session', { method: 'POST' });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memulai sesi suara');
  return data as VoiceSession;
}

export interface VoiceTurnResult {
  transcript: string;
  reply: string;
  action: AssistantAction | null;
  actions: AssistantAction[];
  requiresConfirmation: boolean;
  audioBase64: string | null;
  audioMimeType: string | null;
  audioError?: string | null;
}

export async function askVoice(payload: {
  voiceSessionId: string;
  audioBase64: string;
  format?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<VoiceTurnResult> {
  const res = await adminFetch('/api/admin/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'wav', ...payload }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Sesi suara gagal');
  return {
    transcript: data.transcript,
    reply: data.reply,
    action: data.action || null,
    actions: Array.isArray(data.actions) ? data.actions : data.action ? [data.action] : [],
    requiresConfirmation: Boolean(data.requiresConfirmation),
    audioBase64: data.audioBase64 || null,
    audioMimeType: data.audioMimeType || null,
    audioError: data.audioError || null,
  };
}

export function describeAssistantAction(action: AssistantAction): string {
  const p = action.params as Record<string, any>;
  const label: Record<string, string> = {
    create_domain: `Buat domain "${p.name ?? ''}"`,
    update_domain: `Ubah domain ${p.id ?? ''}`,
    delete_domain: `Hapus domain ${p.id ?? ''}`,
    delete_domains: `Hapus ${Array.isArray(p.ids) ? p.ids.length : 0} domain sekaligus`,
    create_zone: `Buat zona "${p.name ?? ''}" di domain ${p.domainId ?? ''} (${p.capacity ?? '?'} slot)`,
    update_zone: `Ubah zona ${p.id ?? ''}`,
    bulk_update_zones: `Ubah ${Array.isArray(p.ids) ? p.ids.length : 0} zona sekaligus`,
    delete_zone: `Hapus zona ${p.id ?? ''}`,
    delete_zones: `Hapus ${Array.isArray(p.ids) ? p.ids.length : 0} zona sekaligus`,
    cancel_booking: `Batalkan booking ${p.sessionCode ?? ''}`,
    cancel_bookings: `Batalkan ${Array.isArray(p.sessionCodes) ? p.sessionCodes.length : 0} booking sekaligus`,
    reissue_exit: `Terbitkan ulang QR keluar untuk ${p.sessionCode ?? ''}`,
    reissue_exits: `Terbitkan ulang ${Array.isArray(p.sessionCodes) ? p.sessionCodes.length : 0} QR keluar sekaligus`,
    change_zone: `Pindahkan sesi ${p.sessionCode ?? ''} ke zona ${p.zoneId ?? ''}`,
    change_zones: `Pindahkan ${Array.isArray(p.sessionCodes) ? p.sessionCodes.length : 0} sesi ke zona ${p.zoneId ?? ''}`,
    checkout_session: `Mulai checkout sesi ${p.sessionCode ?? ''}`,
    checkout_sessions: `Mulai checkout ${Array.isArray(p.sessionCodes) ? p.sessionCodes.length : 0} sesi`,
    pay_session: `Lunasi sesi ${p.sessionCode ?? ''}`,
    pay_sessions: `Lunasi ${Array.isArray(p.sessionCodes) ? p.sessionCodes.length : 0} sesi`,
    open_gate: `Buka gate ${p.gateType ?? ''} darurat${p.zoneId ? ` untuk zona ${p.zoneId}` : ''}`,
  };
  return label[action.type] || action.type;
}

export function isDestructiveAction(action: AssistantAction): boolean {
  return Boolean(action.destructive) || action.type.startsWith('delete_') || action.type === 'delete_domains' || action.type === 'delete_zones' || action.type === 'cancel_booking' || action.type === 'cancel_bookings' || action.type === 'pay_session' || action.type === 'pay_sessions' || action.type === 'open_gate';
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
    case 'cancel_bookings': {
      const codes = Array.isArray(p.sessionCodes)
        ? p.sessionCodes.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 100)
        : [];
      if (!codes.length) throw new Error('Daftar sesi untuk pembatalan kosong');
      const okCodes: string[] = [];
      const failed: string[] = [];
      for (const sessionCode of codes) {
        try {
          const res = await adminFetch('/api/bookings/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCode }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal membatalkan');
          okCodes.push(sessionCode);
        } catch (err) {
          failed.push(`${sessionCode}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return `${okCodes.length}/${codes.length} booking dibatalkan.${
        failed.length ? ` Gagal: ${failed.join('; ')}` : ''
      }`;
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
    case 'reissue_exits': {
      const codes = Array.isArray(p.sessionCodes)
        ? p.sessionCodes.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 100)
        : [];
      if (!codes.length) throw new Error('Daftar sesi untuk QR keluar kosong');
      let okCount = 0;
      let penalty = 0;
      const failed: string[] = [];
      for (const sessionCode of codes) {
        try {
          const res = await adminFetch('/api/payments/reissue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCode }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menerbitkan ulang');
          okCount += 1;
          penalty += Number(data.penalty) || 0;
        } catch (err) {
          failed.push(`${sessionCode}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return `${okCount}/${codes.length} QR keluar diterbitkan ulang. Total denda Rp${penalty.toLocaleString(
        'id-ID'
      )}.${failed.length ? ` Gagal: ${failed.join('; ')}` : ''}`;
    }
    case 'delete_domains': {
      const ids = stringList(p.ids);
      if (!ids.length) throw new Error('Daftar domain untuk dihapus kosong');
      const ok: string[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        try {
          const d = await deleteDomainApi(id);
          ok.push(d.name);
        } catch (err) {
          failed.push(`${id}: ${errorText(err)}`);
        }
      }
      return `${ok.length}/${ids.length} domain dihapus${ok.length ? `: ${ok.join(', ')}` : ''}.${
        failed.length ? ` Gagal: ${failed.join('; ')}` : ''
      }`;
    }
    case 'delete_zones': {
      const ids = stringList(p.ids);
      if (!ids.length) throw new Error('Daftar zona untuk dihapus kosong');
      const ok: string[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        try {
          const z = await deleteZoneApi(id);
          ok.push(z.name);
        } catch (err) {
          failed.push(`${id}: ${errorText(err)}`);
        }
      }
      return `${ok.length}/${ids.length} zona dihapus${ok.length ? `: ${ok.join(', ')}` : ''}.${
        failed.length ? ` Gagal: ${failed.join('; ')}` : ''
      }`;
    }
    case 'bulk_update_zones': {
      const ids = stringList(p.ids);
      if (!ids.length) throw new Error('Daftar zona kosong');
      const patch = p.patch && typeof p.patch === 'object' ? (p.patch as Record<string, unknown>) : {};
      if (!Object.keys(patch).length) throw new Error('Tidak ada perubahan zona yang diminta');
      const payload: {
        name?: string;
        domainId?: string;
        vehicleType?: 'car' | 'motorcycle';
        capacity?: number;
        gateIn?: string;
        gateOut?: string;
      } = {};
      if (patch.name !== undefined) payload.name = String(patch.name);
      if (patch.domainId !== undefined) payload.domainId = String(patch.domainId);
      if (patch.vehicleType === 'car' || patch.vehicleType === 'motorcycle') payload.vehicleType = patch.vehicleType;
      if (patch.capacity !== undefined) payload.capacity = Number(patch.capacity);
      if (patch.gateIn !== undefined) payload.gateIn = String(patch.gateIn);
      if (patch.gateOut !== undefined) payload.gateOut = String(patch.gateOut);
      const ok: string[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        try {
          const z = await updateZoneApi(id, payload);
          ok.push(z.name);
        } catch (err) {
          failed.push(`${id}: ${errorText(err)}`);
        }
      }
      return `${ok.length}/${ids.length} zona diperbarui${ok.length ? `: ${ok.join(', ')}` : ''}.${
        failed.length ? ` Gagal: ${failed.join('; ')}` : ''
      }`;
    }
    case 'change_zone': {
      const res = await adminFetch('/api/bookings/change-zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: p.sessionCode, zoneId: p.zoneId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memindahkan sesi');
      return `Sesi ${p.sessionCode} dipindahkan ke zona ${p.zoneId}.`;
    }
    case 'change_zones': {
      const codes = stringList(p.sessionCodes);
      if (!codes.length) throw new Error('Daftar sesi kosong');
      const ok: string[] = [];
      const failed: string[] = [];
      for (const sessionCode of codes) {
        try {
          const res = await adminFetch('/api/bookings/change-zone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCode, zoneId: p.zoneId }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memindahkan');
          ok.push(sessionCode);
        } catch (err) {
          failed.push(`${sessionCode}: ${errorText(err)}`);
        }
      }
      return `${ok.length}/${codes.length} sesi dipindahkan ke zona ${p.zoneId}.${
        failed.length ? ` Gagal: ${failed.join('; ')}` : ''
      }`;
    }
    case 'checkout_session': {
      const res = await adminFetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: p.sessionCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memulai checkout');
      const total = Number(data.session?.bill?.total || 0);
      return `Checkout ${p.sessionCode} dimulai. Tagihan Rp${total.toLocaleString('id-ID')}.`;
    }
    case 'checkout_sessions': {
      const codes = stringList(p.sessionCodes);
      if (!codes.length) throw new Error('Daftar sesi kosong');
      let okCount = 0;
      let total = 0;
      const failed: string[] = [];
      for (const sessionCode of codes) {
        try {
          const res = await adminFetch('/api/payments/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCode }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal checkout');
          okCount += 1;
          total += Number(data.session?.bill?.total || 0);
        } catch (err) {
          failed.push(`${sessionCode}: ${errorText(err)}`);
        }
      }
      return `${okCount}/${codes.length} sesi checkout. Total tagihan Rp${total.toLocaleString('id-ID')}.${
        failed.length ? ` Gagal: ${failed.join('; ')}` : ''
      }`;
    }
    case 'pay_session': {
      const res = await adminFetch('/api/payments/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: p.sessionCode, paymentMethod: p.paymentMethod || 'QRIS' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal melunasi sesi');
      return `Sesi ${p.sessionCode} lunas via ${p.paymentMethod || 'QRIS'}.`;
    }
    case 'pay_sessions': {
      const codes = stringList(p.sessionCodes);
      if (!codes.length) throw new Error('Daftar sesi kosong');
      const ok: string[] = [];
      const failed: string[] = [];
      for (const sessionCode of codes) {
        try {
          const res = await adminFetch('/api/payments/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCode, paymentMethod: p.paymentMethod || 'QRIS' }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal melunasi');
          ok.push(sessionCode);
        } catch (err) {
          failed.push(`${sessionCode}: ${errorText(err)}`);
        }
      }
      return `${ok.length}/${codes.length} sesi lunas via ${p.paymentMethod || 'QRIS'}.${
        failed.length ? ` Gagal: ${failed.join('; ')}` : ''
      }`;
    }
    case 'open_gate': {
      const res = await adminFetch('/api/admin/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateType: p.gateType,
          zoneId: p.zoneId,
          action: 'open',
          reason: p.reason || 'Override darurat dari asisten operator',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal membuka gate');
      return `Gate ${p.gateType} dibuka darurat${p.zoneId ? ` untuk zona ${p.zoneId}` : ''}.`;
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
