export interface Faculty {
  id: string;
  name: string;
  defaultZoneId: string;
}

export interface Zone {
  id: string;
  name: string;
  facultyId: string;
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
