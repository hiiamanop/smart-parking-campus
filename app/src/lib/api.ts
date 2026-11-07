import type { Faculty, Zone, ParkingSession, LiveEvent } from '../types';

export async function fetchZones(): Promise<{ faculties: Faculty[]; zones: Zone[] }> {
  const res = await fetch('/api/zones');
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to fetch zones');
  return { faculties: data.faculties, zones: data.zones };
}

export async function createBooking(payload: {
  facultyId: string;
  zoneId: string;
  userName: string;
  vehicleType: 'car' | 'motorcycle';
  eta: string;
  etd: string;
}): Promise<ParkingSession> {
  const res = await fetch('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Booking failed');
  return data.session;
}

export async function fetchSession(sessionCode: string): Promise<ParkingSession> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionCode)}`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Session not found');
  return data.session;
}

export async function gateInEntry(payload: {
  sessionCode: string;
  platePhotoBase64?: string;
  mimeType?: string;
  manualPlateOverride?: string;
}): Promise<{ session: ParkingSession; gateOpened: boolean }> {
  const res = await fetch('/api/gates/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Entry gate failed');
  return { session: data.session, gateOpened: data.gateOpened };
}

export async function zoneScan(payload: {
  sessionCode: string;
  scannedZoneId: string;
  action: 'confirm_park' | 'checkout';
}): Promise<ParkingSession> {
  const res = await fetch('/api/zones/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Zone scan failed');
  return data.session;
}

export async function payBill(payload: {
  sessionCode: string;
  paymentMethod?: string;
}): Promise<ParkingSession> {
  const res = await fetch('/api/payments/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Payment failed');
  return data.session;
}

export async function gateOutExit(payload: {
  exitCode: string;
  platePhotoBase64?: string;
  mimeType?: string;
  manualPlateOverride?: string;
}): Promise<{ session: ParkingSession; gateOpened: boolean }> {
  const res = await fetch('/api/gates/exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Exit gate failed');
  return { session: data.session, gateOpened: data.gateOpened };
}

// Admin API calls
export async function createZoneApi(payload: {
  name: string;
  facultyId: string;
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
    facultyId?: string;
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

export async function fetchAdminSessions(): Promise<ParkingSession[]> {
  const res = await fetch('/api/admin/sessions');
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal memuat sesi');
  return data.sessions;
}

export async function emergencyGateOverride(payload: {
  gateType: string;
  zoneId?: string;
  action?: string;
  reason?: string;
}): Promise<any> {
  const res = await fetch('/api/admin/override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal override gate');
  return data;
}

// Subscribe to real-time events via Server-Sent Events (Redis Pub/Sub bridge)
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
      const data = JSON.parse(e.data);
      onEvent(data);
    } catch {
      // Ignore ping or non-json keepalive comments
    }
  };

  source.onerror = () => {
    onStatusChange?.(false);
  };

  return () => {
    source.close();
  };
}
