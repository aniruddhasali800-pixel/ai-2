export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' | 'WAITER';
export type OrderStatus = 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED' | 'COMPLETED' | 'CANCELLED';
export type OrderSource =
  | 'DINE_IN_QR'
  | 'DINE_IN_WAITER'
  | 'CASHIER'
  | 'SWIGGY'
  | 'ZOMATO'
  | 'WEBSITE'
  | 'PHONE'
  | 'OTHER'
  | 'CUSTOMER_APP';
export type Fulfilment = 'DINE_IN' | 'PICKUP' | 'DELIVERY';
export type OrderPaymentMode = '' | 'UPI' | 'CARD' | 'CASH_ON_DELIVERY';
export type TableStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'OCCUPIED'
  | 'ORDERING'
  | 'FOOD_READY'
  | 'BILL_REQUESTED'
  | 'PAYMENT_PENDING'
  | 'CLEANING';
export type SessionStatus = 'OPEN' | 'BILL_REQUESTED' | 'PAYMENT_PENDING' | 'CLOSED';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'ARRIVED' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type PaymentMethod = 'CASH' | 'CARD' | 'UPI' | 'ONLINE';
export type PaymentStatus = 'PENDING' | 'VERIFICATION_PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type BillStatus = 'ISSUED' | 'PAID' | 'VOID' | 'REFUNDED';
export type RequestType = 'CALL_WAITER' | 'WATER' | 'PLATE' | 'CUTLERY' | 'NAPKIN' | 'BILL' | 'CASH_PAYMENT' | 'TABLE_CLEAR' | 'OTHER';
export type Station = 'MAIN' | 'GRILL' | 'FRY' | 'TANDOOR' | 'BAR' | 'DESSERT';
export type InventoryUnit = 'KG' | 'G' | 'L' | 'ML' | 'PCS' | 'PACKET';
export type InventoryTxType = 'DEDUCTION' | 'RECEIPT' | 'ADJUSTMENT' | 'WASTE' | 'RETURN';
export type NotificationType =
  | 'ORDER_CREATED'
  | 'ORDER_READY'
  | 'BILL_REQUESTED'
  | 'CUSTOMER_REQUEST'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_CLAIMED'
  | 'PAYMENT_FAILED'
  | 'BOOKING_CREATED'
  | 'BOOKING_REMINDER'
  | 'LOW_STOCK'
  | 'DELIVERY_ORDER'
  | 'DAY_CLOSE'
  | 'SYSTEM';

export interface Address {
  line1?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface RestaurantSettings {
  acceptingOrders: boolean;
  autoAcceptOrders: boolean;
  billFooterNote: string;
  bookingEnabled: boolean;
  bookingSlotMinutes: number;
  bookingDurationMinutes: number;
  bookingReminderMinutes: number;
  allowWaiterCash: boolean;
  deliveryEnabled: boolean;
  /** Jobs the sticker's "ask to work here" form is offering. */
  openRoles?: Role[];
}

export interface Restaurant {
  _id: string;
  ownerId?: string;
  name: string;
  slug: string;
  phone?: string;
  email?: string;
  address?: Address;
  payment?: { upiId?: string; upiName?: string };
  currency: string;
  taxPercent: number;
  serviceChargePercent: number;
  hours: { open: string; close: string };
  branding: { logoUrl?: string; coverUrl?: string; tagline?: string };
  settings?: RestaurantSettings;
  createdAt?: string;
}

export interface User {
  _id: string;
  restaurantId: string;
  role: Role;
  name: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  lastLoginAt: string | null;
  createdAt: string;
}

/** A walk-in's ask from the sticker, exactly as it lands in the manager's queue. */
export interface StaffApplication {
  _id: string;
  name: string;
  phone: string;
  role: Role;
  note: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  decidedByName: string;
  decidedAt: string | null;
  userId: string | null;
}

export interface AuthResult {
  user: User;
  restaurant?: Restaurant;
  accessToken: string;
  refreshToken: string;
  expiresInDays?: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface OrderAddon {
  addonId: string;
  name: string;
  price: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  taxPercent: number;
  station: Station;
  isVeg?: boolean;
  /** Joined from the live menu on read — the owner can upload a photo after the ticket exists. */
  imageUrl?: string;
  addons: OrderAddon[];
  notes: string;
  lineTotal: number;
}

export interface OrderEvent {
  status: OrderStatus;
  at: string;
  byUserId: string | null;
}

export interface Order {
  _id: string;
  restaurantId: string;
  orderNumber: string;
  source: OrderSource;
  fulfilment?: Fulfilment;
  paymentMode?: OrderPaymentMode;
  riderName?: string;
  tableId: string | null;
  /** Carried on kitchen tickets so the pass calls the right table, not just an order code. */
  tableNumber?: string;
  tableSessionId: string | null;
  waiterId: string | null;
  cashierId: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerCity?: string;
  externalOrderId: string | null;
  items: OrderItem[];
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountAmount: number;
  discountNote?: string;
  roundOff: number;
  grandTotal: number;
  status: OrderStatus;
  cancelReason?: string;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  billId: string | null;
  notes: string;
  placedAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  completedAt: string | null;
  statusHistory: OrderEvent[];
  createdAt: string;
}

export interface Category {
  _id: string;
  restaurantId: string;
  name: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Addon {
  _id: string;
  restaurantId: string;
  name: string;
  price: number;
  isActive: boolean;
}

export interface RecipeLine {
  inventoryItemId: string;
  qty: number;
}

export interface Product {
  _id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  taxPercent: number | null;
  isVeg: boolean;
  isActive: boolean;
  station: Station;
  sortOrder: number;
  prepMinutes: number;
  addonIds: string[];
  recipe: RecipeLine[];
  tags: string[];
}

export interface MenuBundle {
  categories: Category[];
  products: Product[];
  addons: Addon[];
}

export interface TableSessionRef {
  _id: string;
  publicToken: string;
  status: SessionStatus;
  guestCount: number;
  customerName: string;
  openedAt: string;
}

export interface Table {
  _id: string;
  restaurantId: string;
  number: string;
  capacity: number;
  section: string;
  description: string;
  status: TableStatus;
  qrToken: string;
  activeSessionId: string | null;
  assignedWaiterId: string | null;
  lastCleanedAt?: string;
  qrUrl?: string;
  session?: TableSessionRef | null;
}

export interface WaiterTable extends Table {
  assignedWaiterName: string | null;
  mine: boolean;
  session: TableSessionRef | null;
  activeOrders: { _id: string; orderNumber: string; status: OrderStatus; grandTotal: number; itemCount: number }[];
  openRequests: {
    _id: string;
    type: RequestType;
    note: string;
    status: string;
    createdAt: string;
    billNumber: string | null;
    billGrandTotal: number | null;
    billPublicToken: string | null;
  }[];
  runningTotal: number;
}

export interface CustomerRequest {
  _id: string;
  restaurantId: string;
  tableId: string;
  tableSessionId: string;
  type: RequestType;
  note: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'DONE';
  raisedByUserId?: string | null;
  handledByUserId: string | null;
  handledAt: string | null;
  billId: string | null;
  tendered: number | null;
  collectedByUserId: string | null;
  collectedAt: string | null;
  createdAt: string;
  tableNumber?: string;
  mine?: boolean;
  billNumber?: string | null;
  billGrandTotal?: number | null;
  /** Opens the digital bill — this is what the waiter shows the guest to scan. */
  billPublicToken?: string | null;
}

export interface TaxLine {
  label: string;
  percent: number;
  amount: number;
}

export interface Bill {
  _id: string;
  restaurantId: string;
  billNumber: string;
  orderIds: string[];
  tableSessionId: string | null;
  tableId: string | null;
  tableNumber: string;
  customerName: string;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountAmount: number;
  roundOff: number;
  grandTotal: number;
  taxBreakup: TaxLine[];
  status: BillStatus;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  publicToken: string;
  issuedByUserId: string;
  issuedAt: string;
  paidAt: string | null;
  printCount: number;
  lastPrintedAt: string | null;
  notes: string;
  createdAt: string;
}

export interface Payment {
  _id: string;
  restaurantId: string;
  billId: string;
  orderIds: string[];
  method: PaymentMethod;
  provider: string;
  amount: number;
  tendered: number | null;
  change: number | null;
  transactionId: string | null;
  providerOrderId: string | null;
  checkoutUrl: string | null;
  status: PaymentStatus;
  failureReason: string;
  collectedByUserId: string | null;
  collectedByName?: string | null;
  verifiedAt: string | null;
  refunds: { amount: number; reason: string; at: string }[];
  createdAt: string;
}

export interface Booking {
  _id: string;
  restaurantId: string;
  tableId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  notes: string;
  startAt: string;
  durationMinutes: number;
  guests: number;
  status: BookingStatus;
  source: 'CUSTOMER' | 'STAFF';
  assignedWaiterId: string | null;
  tableNumber?: string;
  tableSection?: string;
  assignedWaiterName?: string | null;
  createdAt: string;
}

export interface InventoryItem {
  _id: string;
  restaurantId: string;
  name: string;
  unit: InventoryUnit;
  stock: number;
  lowStockThreshold: number;
  costPerUnit: number;
  supplier: string;
  isActive: boolean;
  isLow?: boolean;
}

export interface InventoryTx {
  _id: string;
  itemId: string;
  itemName: string;
  unit: string;
  type: InventoryTxType;
  qty: number;
  balanceAfter: number;
  note: string;
  byUserId: string | null;
  orderId: string | null;
  createdAt: string;
}

export interface AppNotification {
  _id: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  _id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DashboardData {
  today: { revenue: number; orders: number; avgOrderValue: number; trendPct: number };
  yesterday: { revenue: number; orders: number };
  live: { activeOrders: number; unpaidBills: number; unpaidAmount: number; openSessions: number };
  tables: { status: TableStatus; count: number }[];
  lowStock: { count: number; items: { _id: string; name: string; stock: number; unit: string }[] };
  upcomingBookings: number;
  week: { label: string; revenue: number; orders: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
  recentOrders: {
    _id: string;
    orderNumber: string;
    source: OrderSource;
    status: OrderStatus;
    paymentStatus: string;
    grandTotal: number;
    customerName: string;
    createdAt: string;
  }[];
}

export interface SalesReport {
  range: { from: string; to: string; granularity: 'day' | 'week' | 'month' | 'year' };
  totals: { revenue: number; orders: number; avgOrderValue: number; tax: number; discount: number; serviceCharge: number };
  series: { label: string; revenue: number; orders: number }[];
  channels: { channel: 'DINE_IN' | 'DELIVERY' | 'TAKEAWAY'; revenue: number; orders: number }[];
  sources: { source: OrderSource; revenue: number; orders: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
}

export interface ProductReport {
  range: { from: string; to: string };
  topProducts: { name: string; qty: number; revenue: number }[];
  slowMovers: { name: string; qty: number; revenue: number }[];
  categories: { category: string; qty: number; revenue: number }[];
}

export interface PaymentReport {
  range: { from: string; to: string };
  totals: { collected: number; refunded: number; net: number; count: number };
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
  byProvider: { provider: string; amount: number; count: number }[];
  cashierPerformance: { userId: string; name: string; collected: number; count: number }[];
}

export interface OperationsReport {
  range: { from: string; to: string };
  waiters: { userId: string; name: string; orders: number; revenue: number }[];
  occupancy: { date: string; sessions: number; guests: number; avgMinutes: number }[];
  tableStatus: { status: TableStatus; count: number }[];
  bookings: { status: BookingStatus; count: number }[];
  taxBreakup: { label: string; percent: number; amount: number }[];
}

export interface DeliveryAdapter {
  provider: 'SWIGGY' | 'ZOMATO' | 'WEBSITE';
  label: string;
  configured: boolean;
  webhookUrl: string;
  signatureHeader: string;
  docsHint: string;
}

export interface PublicRestaurantBlock {
  _id: string;
  name: string;
  slug: string;
  phone: string;
  address: Address;
  currency: string;
  hours: { open: string; close: string };
  branding: { logoUrl?: string; coverUrl?: string; tagline?: string };
  acceptingOrders: boolean;
  bookingEnabled: boolean;
  taxPercent: number;
  serviceChargePercent: number;
}

export interface PublicMenuItem {
  _id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  isVeg: boolean;
  taxPercent: number | null;
  prepMinutes: number;
  tags: string[];
  addonIds: string[];
}

export interface PublicAddon {
  _id: string;
  name: string;
  price: number;
}

export interface GuestMenu {
  restaurant: PublicRestaurantBlock;
  table: { _id: string; number: string; section: string; status: TableStatus };
  categories: { _id: string; name: string; description: string }[];
  products: PublicMenuItem[];
  addons: PublicAddon[];
  session: { publicToken: string; status: SessionStatus; guestCount: number; customerName: string } | null;
}

/** The same menu served to the installed app, before any table exists. */
export interface AppMenu {
  restaurant: PublicRestaurantBlock & { deliveryEnabled: boolean };
  categories: { _id: string; name: string; description: string }[];
  products: PublicMenuItem[];
  addons: PublicAddon[];
}

/** Everything the guest's tracking screen is allowed to know about its own order. */
export interface AppTicket {
  orderNumber: string;
  status: OrderStatus;
  fulfilment: Fulfilment;
  paymentMode: OrderPaymentMode;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  riderName: string;
  customerName: string;
  customerAddress: string;
  customerCity: string;
  items: OrderItem[];
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  grandTotal: number;
  placedAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  completedAt: string | null;
  statusHistory: OrderEvent[];
  bill: { publicToken: string; billNumber: string; grandTotal: number } | null;
  restaurant: { name: string; currency: string } | null;
}

/** One kitchen the installed app can open. */
export interface AppRestaurant {
  name: string;
  slug: string;
  city: string;
  line1: string;
  tagline: string;
  logoUrl: string;
  currency: string;
  acceptingOrders: boolean;
}

export interface AppOrderResult {
  order: {
    _id: string;
    orderNumber: string;
    status: OrderStatus;
    fulfilment: Fulfilment;
    paymentMode: OrderPaymentMode;
    grandTotal: number;
    trackingToken: string;
  };
  bill: { billNumber: string; grandTotal: number; publicToken: string } | null;
}

export interface GuestSession {
  session: { _id: string; publicToken: string; status: SessionStatus; guestCount: number; customerName: string; openedAt: string };
  table: { _id: string; number: string; section: string } | null;
  orders: {
    _id: string;
    orderNumber: string;
    status: OrderStatus;
    items: OrderItem[];
    subtotal: number;
    taxTotal: number;
    serviceCharge: number;
    grandTotal: number;
    notes: string;
    placedAt: string;
  }[];
  requests: {
    _id: string;
    type: RequestType;
    note: string;
    status: string;
    tendered: number | null;
    collectedAt: string | null;
    createdAt: string;
  }[];
  bill: { _id: string; billNumber: string; grandTotal: number; publicToken: string } | null;
  runningTotal: number;
}

export interface PublicBill {
  billNumber: string;
  tableNumber: string;
  customerName: string;
  status: BillStatus;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  subtotal: number;
  discountAmount: number;
  serviceCharge: number;
  taxTotal: number;
  roundOff: number;
  grandTotal: number;
  taxBreakup: TaxLine[];
  issuedAt: string;
  paidAt: string | null;
  /** The restaurant's own mark, printed beside the Sizzle one. */
  merchant: { name: string; logoUrl: string } | null;
  /** Lets the guest phone join its table's realtime room and watch the bill settle. */
  sessionToken: string | null;
  items: {
    name: string;
    qty: number;
    price: number;
    isVeg: boolean;
    addons: { name: string; price: number }[];
    lineTotal: number;
  }[];
  pay: UpiCharge | null;
}

/** A scannable UPI intent built server-side from the exact bill total. */
export interface UpiCharge {
  link: string;
  qrDataUrl: string;
  upiId: string;
  payeeName: string;
  amount: number;
  note: string;
  /** Present when the bill service owns this payment: its own page, and the truth about the money. */
  payUrl?: string;
  intentId?: string;
  paymentStatus?: string;
  utr?: string | null;
}

/** One payment request as the bill service holds it. */
export interface ServiceIntent {
  id: string;
  code: string;
  token: string;
  payUrl: string;
  status: string;
  paymentStatus: string;
  amountPaise: number;
  amountRupees: number;
  upiUri: string;
  qrDataUrl: string;
  payeeVpaMasked: string;
  payeeName: string;
  note: string;
  customerLabel: string;
  source?: string;
  externalBillId: string | null;
  externalBillNumber?: string | null;
  tableNumber: string | null;
  utr: string | null;
  paidAt: string | null;
  verifiedByName: string | null;
  updatedAt?: string;
}

export interface ServiceOverview {
  enabled: boolean;
  reason?: string;
  days?: number;
  queue?: { awaitingVerification: ServiceIntent[]; open: ServiceIntent[] };
  income?: ServiceIncome;
  payee?: ServicePayee;
}

export interface ServiceIncome {
  collectedPaise: number;
  count: number;
  awaitingVerification: { amountPaise: number; count: number };
  openRequests: { amountPaise: number; count: number };
  failedOrCancelled: { amountPaise: number; count: number };
  days: { day: string; amountPaise: number; count: number }[];
  bySource: { source: string; amountPaise: number; count: number }[];
  byVerifier: { name: string; amountPaise: number; count: number }[];
}

export interface ServicePayee {
  businessName: string;
  payeeName: string;
  payeeMasked: string;
  currency: string;
  notesPrefix: string;
  enabled: boolean;
}

/** What the API decided a scanned code means *for this role* — never chosen in the browser. */
/** A free table offered to the app, carrying a ten-minute seat code instead of the sticker token. */
export interface AppSeat {
  id: string;
  number: string;
  section: string;
  capacity: number;
  seatCode: string;
}

export interface AppSitResult {
  session: { _id: string; publicToken: string; status: SessionStatus; guestCount: number; customerName: string };
  table: { id: string; number: string; section: string };
  restaurantId: string;
}

/** One bill as the end-of-day file remembers it. */
export interface DayCloseBill {
  billId: string;
  billNumber: string;
  issuedAt: string;
  tableNumber: string;
  customerName: string;
  orders: number;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountAmount: number;
  roundOff: number;
  grandTotal: number;
  status: string;
  paymentStatus: string;
  methods: string[];
  collected: number;
  paidAt: string | null;
  issuedBy: string;
}

export interface DayCloseOrder {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  completedAt: string | null;
  source: string;
  status: string;
  paymentStatus: string;
  channel: 'DINE_IN' | 'DELIVERY' | 'TAKEAWAY';
  tableNumber: string;
  waiter: string;
  items: number;
  quantity: number;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountAmount: number;
  grandTotal: number;
}

/** The day's close, exactly as it was written to the drive. */
export interface DayCloseReport {
  kind: 'day-close';
  restaurant: { id: string; name: string; slug: string };
  date: string;
  window: { from: string; to: string };
  generatedAt: string;
  /** False while the day is still running, so the screen can say the numbers are not signed off yet. */
  stored: boolean;
  totals: {
    revenue: number;
    orders: number;
    avgOrderValue: number;
    covers: number;
    tax: number;
    serviceCharge: number;
    discount: number;
    collected: number;
    refunded: number;
    net: number;
    bills: number;
    unpaidBills: number;
    unpaidAmount: number;
    cancelledOrders: number;
  };
  versus: {
    date: string;
    revenue: number;
    orders: number;
    revenueDelta: number;
    revenueDeltaPct: number;
    ordersDelta: number;
    avgOrderValueDelta: number;
  };
  hourly: { hour: number; orders: number; revenue: number }[];
  channels: { channel: string; revenue: number; orders: number }[];
  sources: { source: string; revenue: number; orders: number }[];
  methods: { method: string; amount: number; count: number }[];
  providers: { provider: string; amount: number; count: number }[];
  awaitingVerification: { amount: number; count: number };
  cashierPerformance: { userId: string; name: string; collected: number; count: number }[];
  topProducts: { productId: string | null; name: string; category: string; qty: number; revenue: number }[];
  categories: { category: string; qty: number; revenue: number }[];
  slowMovers: { productId: string | null; name: string; qty: number; revenue: number }[];
  waiters: { userId: string; name: string; orders: number; revenue: number }[];
  occupancy: { date: string; sessions: number; guests: number; avgMinutes: number }[];
  taxBreakup: { label: string; percent: number; amount: number }[];
  bookings: { status: string; count: number }[];
  stock: {
    movements: { item: string; type: string; qty: number; unit: string; balanceAfter: number; at: string }[];
    used: { item: string; unit: string; qty: number }[];
    totals: { type: string; qty: number }[];
    low: { item: string; stock: number; unit: string; threshold: number }[];
  };
  bills: DayCloseBill[];
  orders: DayCloseOrder[];
}

export interface DayCloseSummary {
  date: string;
  revenue: number;
  orders: number;
  bills: number;
  generatedAt: string;
}
