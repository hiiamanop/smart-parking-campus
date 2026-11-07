export interface Domain {
  id: string;
  name: string;
  description?: string;
}

export interface Zone {
  id: string;
  name: string;
  domainId: string;
  vehicleType: 'car' | 'motorcycle';
  capacity: number;
  occupied: number;
  available: number;
  isFull: boolean;
  gateIn: string;
  gateOut: string;
}

export type SessionStatus =
  | 'BOOKED'
  | 'EXPIRED'
  | 'ENTERED'
  | 'PARKED_CONFIRMED'
  | 'CHECKOUT_REQUESTED'
  | 'PAID'
  | 'COMPLETED';

export interface ParkingBill {
  baseFee: number;
  penaltyFee: number;
  total: number;
  isOverstay: boolean;
  notes: string;
}

export interface ParkingPayment {
  method: string;
  paidAt: string;
  transactionId: string;
  amount: number;
}

export interface ParkingSession {
  id: string;
  sessionCode: string;
  facultyId: string;
  zoneId: string;
  userName: string;
  vehicleType: 'car' | 'motorcycle';
  eta: string;
  etd: string;
  etaTime: number;
  etdTime: number;
  status: SessionStatus;
  createdAt: string;
  plate: string | null;
  displayPlate?: string;
  plateVlmResult?: {
    plate: string | null;
    confidence?: number;
    vehicle_type?: string;
    notes?: string;
  };
  entryTime?: string;
  parkedTime?: string;
  checkoutTime?: string;
  exitTime?: string;
  exitCode?: string;
  exitCodeExpiry?: number;
  bill?: ParkingBill;
  payment?: ParkingPayment;
  expiredReason?: string;
}

export interface LiveEvent {
  type: string;
  payload: any;
  timestamp: string;
}

export interface ZoneAnalytics {
  zoneId: string;
  zoneName: string;
  domainId: string;
  capacity: number;
  occupied: number;
  available: number;
  occupancyRate: number;
  bookings: number;
  entries: number;
  exits: number;
  manualOverrides: number;
  mismatches: number;
  zoneViolations: number;
  revenue: number;
  payments: number;
  revenueMotorcycle: number;
  revenueCar: number;
  activity: number;
  lastActivity: string | null;
  maintenanceScore: number;
  priority: 'tinggi' | 'sedang' | 'rendah';
  checkIntervalDays: number;
}

export interface DomainAnalytics {
  domainId: string;
  domainName: string;
  zones: number;
  capacity: number;
  occupied: number;
  occupancyRate: number;
  activity: number;
  manualOverrides: number;
  mismatches: number;
  zoneViolations: number;
  topScore: number;
}

export interface Analytics {
  generatedAt: string;
  totals: {
    activity: number;
    entries: number;
    exits: number;
    manualOverrides: number;
    mismatches: number;
    zoneViolations: number;
    revenue: number;
    payments: number;
    highPriorityZones: number;
  };
  zones: ZoneAnalytics[];
  domains: DomainAnalytics[];
  hours: Array<{ hour: string; activity: number }>;
  peakHours: Array<{ hour: string; activity: number }>;
  finance: {
    totalRevenue: number;
    totalPayments: number;
    byVehicle: { motorcycle: number; car: number };
    byZone: Array<{
      zoneId: string;
      zoneName: string;
      domainId: string;
      revenue: number;
      payments: number;
      average: number;
    }>;
    byDomain: Array<{
      domainId: string;
      domainName: string;
      revenue: number;
      payments: number;
      average: number;
    }>;
    daily: Array<{ date: string; revenue: number }>;
  };
}
