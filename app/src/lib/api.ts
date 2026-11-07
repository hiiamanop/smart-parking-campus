export type Zone = {
  id: string;
  code: string;
  name: string;
  faculty: string;
  capacity: number;
  occupied: number;
  available: number;
};

export type BookingStatus =
  | 'booked'
  | 'active'
  | 'parked'
  | 'checkout'
  | 'paid'
  | 'closed'
  | 'expired'
  | 'cancelled';

export type Booking = {
  id: string;
  device_id: string;
  plate: string;
  plate_locked: string | null;
  vehicle_type: string;
  zone_id: string;
  eta: string;
  etd: string;
  phone: string | null;
  status: BookingStatus;
  session_code: string;
  exit_code: string | null;
  entry_at: string | null;
  entry_confidence: number | null;
  parked_at: string | null;
  checkout_at: string | null;
  paid_at: string | null;
  exit_at: string | null;
  base_fee: number;
  violation_fee: number;
  total_fee: number;
  payment_method: string | null;
  created_at: string;
  updated_at: string;
  zone_name: string;
  zone_faculty: string;
  zone_public_code: string;
  loyalty_points: number;
  overstay: boolean;
};

export type ApiResponse = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

const ERROR_TEXT: Record<string, string> = {
  zone_full: 'Zona sudah penuh. Pilih zona lain.',
  has_open_booking: 'Masih ada booking/sesi aktif. Selesaikan dulu sesi tersebut.',
  plate_mismatch: 'Plat tidak cocok dengan sesi. Periksa foto/plat lalu coba lagi.',
  expired_late: 'Telat lebih dari 10 menit dari ETA. Booking hangus dan slot dibuka kembali.',
  invalid_status: 'Aksi tidak sesuai dengan status sesi saat ini.',
  not_found: 'Kode sesi tidak ditemukan. Periksa kembali QR/kodenya.',
  zone_mismatch: 'QR zona tidak cocok dengan zona booking.',
  device_invalid: 'Identitas perangkat tidak valid. Muat ulang halaman.',
  plate_required: 'Plat nomor wajib diisi.',
  time_invalid: 'Waktu ETA/ETD tidak valid. ETD harus setelah ETA.',
  zone_not_found: 'Zona tidak ditemukan atau sedang nonaktif.',
  code_required: 'Kode sesi wajib diisi.',
};

export function errorText(code?: string): string {
  if (!code) return 'Terjadi kesalahan. Coba lagi.';
  return ERROR_TEXT[code] || code;
}

async function rpc<T extends ApiResponse>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/db/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    return { ok: false, error: 'Tidak dapat menghubungi server.' } as T;
  }
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    return { ok: false, error: `Respons server tidak valid (HTTP ${res.status}).` } as T;
  }
  if (!res.ok && !data.error) data.error = `HTTP ${res.status}`;
  return data;
}

export function getDeviceId(): string {
  const KEY = 'sp_device_id';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && existing.length >= 8) return existing;
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export function getActiveCode(): string | null {
  try { return localStorage.getItem('sp_active_code'); } catch { return null; }
}

export function setActiveCode(code: string | null): void {
  try {
    if (code) localStorage.setItem('sp_active_code', code);
    else localStorage.removeItem('sp_active_code');
  } catch { /* storage bisa diblokir */ }
}

export async function listZones(): Promise<{ ok: boolean; zones?: Zone[]; error?: string }> {
  return rpc('parking_zones_list');
}

export async function createBooking(input: {
  deviceId: string;
  plate: string;
  zoneId: string;
  eta: string;
  etd: string;
  phone?: string;
  vehicleType?: string;
}): Promise<{ ok: boolean; booking?: Booking; error?: string }> {
  return rpc('parking_booking_create', {
    p_device: input.deviceId,
    p_plate: input.plate,
    p_zone: input.zoneId,
    p_eta: input.eta,
    p_etd: input.etd,
    p_phone: input.phone || null,
    p_vehicle_type: input.vehicleType || 'unknown',
  });
}

export async function getBooking(code: string): Promise<{ ok: boolean; booking?: Booking; error?: string }> {
  return rpc('parking_booking_get', { p_code: code });
}

export async function listBookings(deviceId: string): Promise<{ ok: boolean; items?: Booking[]; error?: string }> {
  return rpc('parking_booking_list', { p_device: deviceId });
}

export async function gateEntry(code: string, plate: string, confidence?: number): Promise<{
  ok: boolean; booking?: Booking; gate?: string; error?: string; expected?: string; detected?: string;
}> {
  return rpc('parking_gate_entry', { p_code: code, p_plate: plate, p_confidence: confidence ?? null });
}

export async function zoneConfirm(code: string, zoneCode: string): Promise<{ ok: boolean; booking?: Booking; error?: string; expected?: string }> {
  return rpc('parking_zone_confirm', { p_code: code, p_zone_code: zoneCode });
}

export async function checkoutStart(code: string): Promise<{ ok: boolean; booking?: Booking; error?: string }> {
  return rpc('parking_checkout_start', { p_code: code });
}

export async function payBooking(code: string): Promise<{ ok: boolean; booking?: Booking; error?: string }> {
  return rpc('parking_pay', { p_code: code, p_method: 'qris' });
}

export async function gateExit(code: string, plate: string, confidence?: number): Promise<{
  ok: boolean; booking?: Booking; gate?: string; error?: string; expected?: string; detected?: string;
}> {
  return rpc('parking_gate_exit', { p_code: code, p_plate: plate, p_confidence: confidence ?? null });
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  booked: 'Terbooking',
  active: 'Masuk gate',
  parked: 'Terparkir',
  checkout: 'Menunggu bayar',
  paid: 'Lunas — siap keluar',
  closed: 'Selesai',
  expired: 'Hangus',
  cancelled: 'Dibatalkan',
};

export const STATUS_STEP: Record<BookingStatus, number> = {
  booked: 1,
  active: 2,
  parked: 3,
  checkout: 4,
  paid: 5,
  closed: 6,
  expired: 0,
  cancelled: 0,
};
