/**
 * Seeds the "Saffron & Smoke" demo restaurant: staff accounts, a full Indian
 * menu with recipes, inventory, tables, live floor activity, two weeks of sales
 * history and bookings. Run with `npm run seed` (idempotent) or
 * `npm run seed:fresh` to wipe and rebuild.
 */
import { Types } from 'mongoose';
import { connectDb, disconnectDb } from './config/db';
import { env, DEMO_MASTER_PASSWORD, DEMO_TENANT_SLUG } from './config/env';
import {
  AddonModel,
  AuditLogModel,
  BillModel,
  BookingModel,
  CategoryModel,
  CounterModel,
  CustomerRequestModel,
  InventoryItemModel,
  InventoryTransactionModel,
  NotificationModel,
  OrderModel,
  PaymentModel,
  ProductModel,
  RestaurantModel,
  TableModel,
  TableSessionModel,
  UserModel,
  nextSeq,
} from './models';
import { hashPassword } from './modules/auth/auth.service';
import { clearCollections } from './store';
import { priceOrderItems, computeTotals, type IncomingItem } from './services/pricing.service';
import { recordAudit } from './services/audit.service';
import { notify } from './services/notification.service';
import { adjustStock } from './services/inventory.service';
import { createOrder, transitionOrder } from './services/order.service';
import { createBill } from './services/billing.service';
import { openSession, setTableStatus } from './services/table.service';
import { round2, roundToRupee } from './utils/money';
import { dateKey, randomToken } from './utils/tokens';
import type { InventoryUnit, OrderSource, OrderStatus, Station } from './types/constants';

/**
 * The demo people below hold jobs at a fake restaurant in Koregaon Park, and the order history they
 * are given attributes tickets to their names, so they are seeded whether or not anyone can sign in
 * as them. What they are *not* seeded with is a password from this file: a credential committed here
 * is a credential published, on every host that runs this code. `DEMO_STAFF_PASSWORD` names the
 * password the whole tenant gets, and without it these accounts carry no hash at all, so the sign-in
 * form has nothing to compare against and the only way into a back office is to onboard a restaurant.
 */

let seedState = 20260927;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3600_000);
}
function atHour(date: Date, hour: number, minute = 0): Date {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const SOURCE_PREFIX: Record<OrderSource, string> = {
  DINE_IN_QR: 'D',
  DINE_IN_WAITER: 'D',
  CASHIER: 'D',
  SWIGGY: 'S',
  ZOMATO: 'Z',
  WEBSITE: 'W',
  PHONE: 'P',
  OTHER: 'O',
  CUSTOMER_APP: 'A',
};

const ADDRESS_LINES = [
  'Flat 402, Aishwaryam Residency, Kalyani Nagar',
  'B-1103, Pashan Hills, Baner Road',
  '12 Lane 3, Sadashiv Peth, near Deccan Gymkhana',
  'Sunbeam Apartments, Koregaon Park',
  '9/62 A, Nandan Grove, Viman Nagar',
  'C-702, Kolte Patil Wakroad, Hinjawadi Phase 2',
];

/** Rewrites audit timestamps after a Mongoose create() so history lands on the right days. */
async function stampCreatedAt(
  model: { updateOne: (filter: object, update: object, opts?: object) => Promise<unknown> },
  id: unknown,
  createdAt: Date,
  extra: Record<string, unknown> = {},
) {
  await model.updateOne({ _id: id }, { $set: { createdAt, ...extra } }, { timestamps: false });
}

/** Fills the connected database with the demo tenant. Safe to call from the server. */
export async function seedDemoData(fresh = false): Promise<void> {
  if (fresh) {
    const cleared = await clearCollections();
    console.log(`[seed] cleared ${cleared} documents`);
  }

  const already = await RestaurantModel.findOne({ slug: DEMO_TENANT_SLUG }).lean();
  if (already) {
    console.log('[seed] Saffron & Smoke already exists — nothing to do. Use --fresh to rebuild.');
    return;
  }

  // ── Restaurant ────────────────────────────────────────────────────────────
  const restaurantId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const restaurant = await RestaurantModel.create({
    _id: restaurantId,
    ownerId,
    name: 'Saffron & Smoke',
    slug: DEMO_TENANT_SLUG,
    phone: '+91 20 4123 8890',
    email: 'hello@saffronandsmoke.in',
    address: {
      line1: '14, Lane 5, Koregaon Park',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    },
    currency: 'INR',
    taxPercent: 5,
    serviceChargePercent: 5,
    hours: { open: '11:30', close: '23:30' },
    payment: {
      upiId: 'saffronandsmoke@icici',
      upiName: 'Saffron & Smoke',
    },
    branding: {
      tagline: 'Tandoor, tiffin & everything in between — since 2014',
      logoUrl: '',
      coverUrl: '',
    },
    settings: {
      acceptingOrders: true,
      autoAcceptOrders: false,
      billFooterNote: 'GST included in bill · Thank you for dining with us!',
      bookingEnabled: true,
      bookingSlotMinutes: 30,
      bookingDurationMinutes: 90,
      bookingReminderMinutes: 60,
      allowWaiterCash: true,
      deliveryEnabled: true,
    },
  });
  const rid = String(restaurant._id);

  // ── Staff ─────────────────────────────────────────────────────────────────
  // These are the fake floor and fake counter the demo history is written by. They carry a phone
  // and no email on purpose: a job account with no email cannot be signed into by guessing a name
  // at a domain, and the floor already signs in by phone through the code door.
  const staffSpec: {
    role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' | 'WAITER';
    name: string;
    phone: string;
  }[] = [
    { role: 'OWNER', name: 'Aarav Mehta', phone: '+91 98200 11001' },
    { role: 'MANAGER', name: 'Neha Kulkarni', phone: '+91 98200 11002' },
    { role: 'CASHIER', name: 'Rohit Deshmukh', phone: '+91 98200 11003' },
    { role: 'KITCHEN', name: 'Vikram Rathore', phone: '+91 98200 11004' },
    { role: 'WAITER', name: 'Sneha Patil', phone: '+91 98200 11005' },
    { role: 'WAITER', name: 'Imran Sheikh', phone: '+91 98200 11006' },
    { role: 'WAITER', name: 'Kavya Reddy', phone: '+91 98200 11007' },
  ];
  const staffPassword = env.DEMO_STAFF_PASSWORD;
  const staff = await UserModel.insertMany(
    await Promise.all(
      staffSpec.map(async (s) => ({
        _id: s.role === 'OWNER' ? ownerId : new Types.ObjectId(),
        restaurantId: restaurant._id,
        role: s.role,
        name: s.name,
        phone: s.phone,
        // Absent, not blank: a document with no hash has no password to compare, which is what
        // "this host never asked for a demo login" looks like in the sign-in path.
        passwordHash: staffPassword ? await hashPassword(staffPassword) : undefined,
      })),
    ),
  );
  const userByRole = (role: string, index = 0) => staff.filter((u) => u.role === role)[index];
  const owner = userByRole('OWNER');
  const manager = userByRole('MANAGER');
  const cashier = userByRole('CASHIER');
  const chef = userByRole('KITCHEN');
  const waiters = staff.filter((u) => u.role === 'WAITER');

  const ownerActor = { userId: String(owner._id), role: 'OWNER' as const, name: owner.name };
  const managerActor = { userId: String(manager._id), role: 'MANAGER' as const, name: manager.name };
  const kitchenActor = { userId: String(chef._id), role: 'KITCHEN' as const, name: chef.name };
  const cashierActor = { userId: String(cashier._id), role: 'CASHIER' as const, name: cashier.name };

  // ── Menu categories ───────────────────────────────────────────────────────
  const categoryNames: [string, string][] = [
    ['Starters', 'Small plates to wake up your palate'],
    ['Tandoor & Kebabs', 'Straight from the clay oven'],
    ['Vegetarian Mains', 'Slow-cooked, ghee-rich classics'],
    ['Non-Veg Mains', 'Curries worth the mess'],
    ['Biryani & Rice', 'Dum-cooked, layered by hand'],
    ['Breads', 'Fresh off the tandoor'],
    ['Desserts', 'House-made, chilled or warm'],
    ['Beverages', 'Coolers, chai and coffee'],
  ];
  const categories = await CategoryModel.insertMany(
    categoryNames.map(([name, description], i) => ({ restaurantId: restaurant._id, name, description, sortOrder: i + 1 })),
  );
  const cat = (name: string) => categories.find((c) => c.name === name)!._id;

  // ── Add-ons ───────────────────────────────────────────────────────────────
  const addonSpec: [string, number][] = [
    ['Extra Gravy', 90],
    ['Extra Butter', 30],
    ['Extra Raita', 70],
    ['Cheese Slice', 40],
    ['Green Salad', 80],
    ['Mint Chutney', 25],
  ];
  const addons = await AddonModel.insertMany(
    addonSpec.map(([name, price]) => ({ restaurantId: restaurant._id, name, price })),
  );
  const addon = (name: string) => addons.find((a) => a.name === name)!._id;

  // ── Inventory ─────────────────────────────────────────────────────────────
  const invSpec: { name: string; unit: InventoryUnit; stock: number; threshold: number; cost: number; supplier: string }[] = [
    { name: 'Chicken', unit: 'KG', stock: 18, threshold: 8, cost: 280, supplier: 'FreshCut Meats, Pune' },
    { name: 'Mutton', unit: 'KG', stock: 6, threshold: 4, cost: 620, supplier: 'FreshCut Meats, Pune' },
    { name: 'Fish Fillet (Basa)', unit: 'KG', stock: 4, threshold: 3, cost: 380, supplier: 'Pune Fish Mart' },
    { name: 'Paneer', unit: 'KG', stock: 3.5, threshold: 4, cost: 420, supplier: 'Gokul Dairy' },
    { name: 'Butter', unit: 'KG', stock: 6, threshold: 3, cost: 520, supplier: 'Gokul Dairy' },
    { name: 'Cream', unit: 'L', stock: 4, threshold: 2, cost: 210, supplier: 'Gokul Dairy' },
    { name: 'Milk', unit: 'L', stock: 15, threshold: 6, cost: 62, supplier: 'Gokul Dairy' },
    { name: 'Basmati Rice', unit: 'KG', stock: 25, threshold: 10, cost: 120, supplier: 'Kohinoor Traders' },
    { name: 'Wheat Flour (Maida)', unit: 'KG', stock: 20, threshold: 8, cost: 55, supplier: 'Kohinoor Traders' },
    { name: 'Tomatoes', unit: 'KG', stock: 12, threshold: 6, cost: 40, supplier: 'Mahatma Phule Mandai' },
    { name: 'Onions', unit: 'KG', stock: 15, threshold: 8, cost: 35, supplier: 'Mahatma Phule Mandai' },
    { name: 'Ginger-Garlic Paste', unit: 'KG', stock: 4, threshold: 2, cost: 180, supplier: 'Mahatma Phule Mandai' },
    { name: 'Cooking Oil', unit: 'L', stock: 20, threshold: 8, cost: 130, supplier: 'Kohinoor Traders' },
    { name: 'Sugar', unit: 'KG', stock: 10, threshold: 4, cost: 45, supplier: 'Kohinoor Traders' },
    { name: 'Cashew Nuts', unit: 'KG', stock: 5, threshold: 2, cost: 950, supplier: 'Kohinoor Traders' },
    { name: 'Mint & Coriander', unit: 'KG', stock: 1.5, threshold: 1, cost: 160, supplier: 'Mahatma Phule Mandai' },
    { name: 'Coffee Beans', unit: 'KG', stock: 2, threshold: 1, cost: 900, supplier: 'Blue Tokai Roasters' },
    { name: 'Tea Leaves', unit: 'KG', stock: 2, threshold: 1, cost: 450, supplier: 'Sancha Tea Boutique' },
    { name: 'Ice Cream Tub', unit: 'PCS', stock: 6, threshold: 4, cost: 260, supplier: 'Gokul Dairy' },
    { name: 'Soft Drink Bottles', unit: 'PCS', stock: 48, threshold: 24, cost: 20, supplier: 'Metro Wholesale' },
  ];
  const inventory = await InventoryItemModel.insertMany(
    invSpec.map((i) => ({ restaurantId: restaurant._id, name: i.name, unit: i.unit, stock: 0, lowStockThreshold: 0 })),
  );
  const inv = (name: string) => inventory.find((i) => i.name === name)!._id;

  for (const spec of invSpec) {
    const item = inventory.find((i) => i.name === spec.name)!;
    await adjustStock({
      restaurantId: rid,
      itemId: String(item._id),
      type: 'RECEIPT',
      qty: spec.stock,
      note: 'Opening stock',
      actor: ownerActor,
    });
    await InventoryItemModel.updateOne(
      { _id: item._id },
      { lowStockThreshold: spec.threshold, costPerUnit: spec.cost, supplier: spec.supplier },
    );
  }
  await adjustStock({
    restaurantId: rid,
    itemId: String(inventory.find((i) => i.name === 'Tomatoes')!._id),
    type: 'WASTE',
    qty: 1.5,
    note: 'Overripe, discarded at prep',
    actor: kitchenActor,
  });

  // ── Products ──────────────────────────────────────────────────────────────
  interface ProductSpec {
    name: string;
    category: string;
    price: number;
    veg: boolean;
    station: Station;
    prep: number;
    tax?: number;
    tags?: string[];
    addons?: string[];
    recipe?: [string, number][];
  }
  const productSpec: ProductSpec[] = [
    { name: 'Paneer Tikka', category: 'Starters', price: 320, veg: true, station: 'TANDOOR', prep: 18, tags: ['Bestseller'], addons: ['Mint Chutney', 'Green Salad'], recipe: [['Paneer', 0.18], ['Cream', 0.03], ['Mint & Coriander', 0.02]] },
    { name: 'Veg Manchurian (Dry)', category: 'Starters', price: 260, veg: true, station: 'FRY', prep: 15, recipe: [['Onions', 0.08], ['Ginger-Garlic Paste', 0.02], ['Cooking Oil', 0.05]] },
    { name: 'Chicken 65', category: 'Starters', price: 330, veg: false, station: 'FRY', prep: 16, tags: ['Spicy'], recipe: [['Chicken', 0.25], ['Cooking Oil', 0.06]] },
    { name: 'Amritsari Fish Fry', category: 'Starters', price: 380, veg: false, station: 'FRY', prep: 18, recipe: [['Fish Fillet (Basa)', 0.22], ['Cooking Oil', 0.06]] },
    { name: 'Mushroom Galouti', category: 'Starters', price: 310, veg: true, station: 'TANDOOR', prep: 16, recipe: [['Butter', 0.02], ['Onions', 0.06]] },

    { name: 'Murgh Malai Kebab', category: 'Tandoor & Kebabs', price: 390, veg: false, station: 'TANDOOR', prep: 20, tags: ['Chef special'], recipe: [['Chicken', 0.28], ['Cream', 0.04], ['Butter', 0.02]] },
    { name: 'Mutton Seekh Kebab', category: 'Tandoor & Kebabs', price: 430, veg: false, station: 'TANDOOR', prep: 22, tags: ['Bestseller'], addons: ['Mint Chutney', 'Extra Raita'], recipe: [['Mutton', 0.26], ['Onions', 0.05]] },
    { name: 'Tandoori Chicken (Half)', category: 'Tandoor & Kebabs', price: 420, veg: false, station: 'TANDOOR', prep: 25, recipe: [['Chicken', 0.45], ['Cream', 0.03], ['Butter', 0.02]] },
    { name: 'Achari Paneer Tikka', category: 'Tandoor & Kebabs', price: 340, veg: true, station: 'TANDOOR', prep: 18, addons: ['Mint Chutney'], recipe: [['Paneer', 0.2], ['Cooking Oil', 0.03]] },

    { name: 'Dal Makhani', category: 'Vegetarian Mains', price: 290, veg: true, station: 'MAIN', prep: 15, tags: ['Bestseller'], addons: ['Extra Butter', 'Extra Gravy'], recipe: [['Butter', 0.04], ['Cream', 0.06], ['Tomatoes', 0.1]] },
    { name: 'Paneer Butter Masala', category: 'Vegetarian Mains', price: 340, veg: true, station: 'MAIN', prep: 14, addons: ['Extra Gravy', 'Extra Butter'], recipe: [['Paneer', 0.2], ['Butter', 0.03], ['Cream', 0.05], ['Tomatoes', 0.15]] },
    { name: 'Kadhai Paneer', category: 'Vegetarian Mains', price: 330, veg: true, station: 'MAIN', prep: 15, tags: ['Spicy'], addons: ['Extra Gravy'], recipe: [['Paneer', 0.2], ['Onions', 0.1], ['Tomatoes', 0.12]] },
    { name: 'Malai Kofta', category: 'Vegetarian Mains', price: 320, veg: true, station: 'MAIN', prep: 16, recipe: [['Paneer', 0.15], ['Cream', 0.06], ['Cashew Nuts', 0.03]] },

    { name: 'Butter Chicken', category: 'Non-Veg Mains', price: 380, veg: false, station: 'MAIN', prep: 16, tags: ['Bestseller'], addons: ['Extra Gravy', 'Extra Butter'], recipe: [['Chicken', 0.25], ['Butter', 0.03], ['Cream', 0.05], ['Tomatoes', 0.15]] },
    { name: 'Laal Maas', category: 'Non-Veg Mains', price: 460, veg: false, station: 'MAIN', prep: 20, tags: ['Spicy', 'Chef special'], recipe: [['Mutton', 0.28], ['Onions', 0.1], ['Cooking Oil', 0.04]] },
    { name: 'Chicken Chettinad', category: 'Non-Veg Mains', price: 390, veg: false, station: 'MAIN', prep: 18, recipe: [['Chicken', 0.26], ['Onions', 0.08], ['Cooking Oil', 0.03]] },
    { name: 'Egg Curry', category: 'Non-Veg Mains', price: 250, veg: false, station: 'MAIN', prep: 12, recipe: [['Onions', 0.08], ['Tomatoes', 0.1]] },

    { name: 'Hyderabadi Chicken Biryani', category: 'Biryani & Rice', price: 360, veg: false, station: 'MAIN', prep: 25, tags: ['Bestseller'], addons: ['Extra Raita', 'Green Salad'], recipe: [['Chicken', 0.22], ['Basmati Rice', 0.15], ['Butter', 0.02]] },
    { name: 'Lucknowi Mutton Biryani', category: 'Biryani & Rice', price: 470, veg: false, station: 'MAIN', prep: 28, recipe: [['Mutton', 0.24], ['Basmati Rice', 0.15], ['Butter', 0.02]] },
    { name: 'Veg Dum Biryani', category: 'Biryani & Rice', price: 300, veg: true, station: 'MAIN', prep: 22, addons: ['Extra Raita'], recipe: [['Basmati Rice', 0.16], ['Paneer', 0.06], ['Butter', 0.02]] },
    { name: 'Jeera Rice', category: 'Biryani & Rice', price: 180, veg: true, station: 'MAIN', prep: 10, recipe: [['Basmati Rice', 0.12], ['Butter', 0.01]] },
    { name: 'Steamed Rice', category: 'Biryani & Rice', price: 140, veg: true, station: 'MAIN', prep: 8, recipe: [['Basmati Rice', 0.12]] },

    { name: 'Butter Naan', category: 'Breads', price: 65, veg: true, station: 'TANDOOR', prep: 6, addons: ['Extra Butter'], recipe: [['Wheat Flour (Maida)', 0.09], ['Butter', 0.01]] },
    { name: 'Garlic Naan', category: 'Breads', price: 80, veg: true, station: 'TANDOOR', prep: 6, addons: ['Extra Butter'], recipe: [['Wheat Flour (Maida)', 0.09], ['Butter', 0.01]] },
    { name: 'Laccha Paratha', category: 'Breads', price: 70, veg: true, station: 'TANDOOR', prep: 7, recipe: [['Wheat Flour (Maida)', 0.1], ['Butter', 0.02]] },
    { name: 'Tandoori Roti', category: 'Breads', price: 45, veg: true, station: 'TANDOOR', prep: 5, recipe: [['Wheat Flour (Maida)', 0.08]] },

    { name: 'Gulab Jamun (2 pc)', category: 'Desserts', price: 150, veg: true, station: 'DESSERT', prep: 5, recipe: [['Milk', 0.15], ['Sugar', 0.08]] },
    { name: 'Rasmalai (2 pc)', category: 'Desserts', price: 170, veg: true, station: 'DESSERT', prep: 5, recipe: [['Milk', 0.2], ['Sugar', 0.07], ['Cashew Nuts', 0.01]] },
    { name: 'Kesar Pista Kulfi', category: 'Desserts', price: 160, veg: true, station: 'DESSERT', prep: 4, recipe: [['Milk', 0.18], ['Sugar', 0.06], ['Ice Cream Tub', 0.05]] },

    { name: 'Sweet Lassi', category: 'Beverages', price: 120, veg: true, station: 'BAR', prep: 5, recipe: [['Milk', 0.2], ['Sugar', 0.03]] },
    { name: 'Masala Chaas', category: 'Beverages', price: 90, veg: true, station: 'BAR', prep: 4, recipe: [['Milk', 0.15], ['Mint & Coriander', 0.01]] },
    { name: 'Fresh Lime Soda', category: 'Beverages', price: 110, veg: true, station: 'BAR', prep: 4, recipe: [['Sugar', 0.02]] },
    { name: 'Cutting Chai', category: 'Beverages', price: 40, veg: true, station: 'BAR', prep: 4, recipe: [['Tea Leaves', 0.01], ['Milk', 0.05], ['Sugar', 0.01]] },
    { name: 'Filter Coffee', category: 'Beverages', price: 60, veg: true, station: 'BAR', prep: 5, recipe: [['Coffee Beans', 0.012], ['Milk', 0.08]] },
    { name: 'Cola (300 ml)', category: 'Beverages', price: 90, veg: true, station: 'BAR', prep: 2, tax: 12, recipe: [['Soft Drink Bottles', 1]] },
  ];

  const products = await ProductModel.insertMany(
    productSpec.map((p, i) => ({
      restaurantId: restaurant._id,
      categoryId: cat(p.category),
      name: p.name,
      description: '',
      price: p.price,
      taxPercent: p.tax ?? 5,
      isVeg: p.veg,
      station: p.station,
      sortOrder: i + 1,
      prepMinutes: p.prep,
      addonIds: (p.addons ?? []).map((a) => addon(a)),
      recipe: (p.recipe ?? []).map(([name, qty]) => ({ inventoryItemId: inv(name), qty })),
      tags: p.tags ?? [],
    })),
  );
  const prod = (name: string) => products.find((p) => p.name === name)!;

  // ── Tables ────────────────────────────────────────────────────────────────
  const tableSpec: [string, number, string, string][] = [
    ['G1', 4, 'Garden', 'Under the neem tree'],
    ['G2', 4, 'Garden', 'Beside the fountain'],
    ['G3', 2, 'Garden', 'Cosy two-seater'],
    ['G4', 6, 'Garden', 'Long table, good for families'],
    ['M1', 2, 'Main Hall', 'Window bar seating'],
    ['M2', 4, 'Main Hall', 'Facing the open kitchen'],
    ['M3', 4, 'Main Hall', 'Near the live tandoor'],
    ['M4', 6, 'Main Hall', 'Central round table'],
    ['M5', 4, 'Main Hall', 'Corner booth'],
    ['M6', 2, 'Main Hall', 'Quick-lunch table'],
    ['T1', 4, 'Terrace', 'Overlooking the courtyard'],
    ['T2', 4, 'Terrace', 'Sunset side'],
    ['T3', 6, 'Terrace', 'Shaded pergola'],
    ['T4', 4, 'Terrace', 'Second row, quieter'],
  ];
  const tables = await TableModel.insertMany(
    tableSpec.map(([number, capacity, section, description], i) => ({
      restaurantId: restaurant._id,
      number,
      capacity,
      section,
      description,
      qrToken: randomToken(16),
      assignedWaiterId: waiters[i % waiters.length]._id,
    })),
  );
  const table = (number: string) => tables.find((t) => t.number === number)!;

  // ── Two weeks of sales history ────────────────────────────────────────────
  const historySets: Record<string, string[]> = {
    starter: ['Paneer Tikka', 'Chicken 65', 'Mutton Seekh Kebab', 'Amritsari Fish Fry', 'Veg Manchurian (Dry)', 'Mushroom Galouti'],
    vegMain: ['Dal Makhani', 'Paneer Butter Masala', 'Kadhai Paneer', 'Malai Kofta'],
    nonVegMain: ['Butter Chicken', 'Laal Maas', 'Chicken Chettinad', 'Egg Curry'],
    rice: ['Hyderabadi Chicken Biryani', 'Lucknowi Mutton Biryani', 'Veg Dum Biryani', 'Jeera Rice'],
    bread: ['Butter Naan', 'Garlic Naan', 'Laccha Paratha', 'Tandoori Roti'],
    dessert: ['Gulab Jamun (2 pc)', 'Rasmalai (2 pc)', 'Kesar Pista Kulfi'],
    drink: ['Sweet Lassi', 'Masala Chaas', 'Fresh Lime Soda', 'Cutting Chai', 'Filter Coffee', 'Cola (300 ml)'],
  };

  const historySourcePool: OrderSource[] = [
    'DINE_IN_QR', 'DINE_IN_QR', 'DINE_IN_QR', 'DINE_IN_WAITER', 'DINE_IN_WAITER',
    'SWIGGY', 'SWIGGY', 'ZOMATO', 'ZOMATO', 'WEBSITE', 'PHONE', 'CASHIER',
  ];
  const onlineMethods: ('UPI' | 'CARD')[] = ['UPI', 'UPI', 'CARD'];

  const today = new Date();
  // Today's history stays half an hour behind the live floor seeded later, so ticket
  // numbers and timestamps both read oldest-to-newest.
  const todayOpenedAt = atHour(today, 12, 0).getTime();
  const todayHistoryWindow = Math.max(0, Math.floor((Date.now() - 30 * 60_000 - todayOpenedAt) / 60_000));
  let historyCount = 0;
  let cancelledCount = 0;

  for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
    const day = addDays(today, -dayOffset);
    const weekday = day.getDay();
    const buzz = weekday === 5 || weekday === 6 ? 1 : 0;
    const ordersToday = randInt(3 + buzz * 2, 6 + buzz * 3);

    for (let n = 0; n < ordersToday; n++) {
      const source = pick(historySourcePool);
      const isDelivery = source === 'SWIGGY' || source === 'ZOMATO' || source === 'WEBSITE';
      const isCancelled = dayOffset > 0 && rnd() < 0.06;

      const picks: IncomingItem[] = [];
      const push = (name: string, qty = 1) => {
        if (picks.some((p) => p.productId === String(prod(name)._id))) return;
        const line: IncomingItem = { productId: String(prod(name)._id), qty };
        if (['Butter Chicken', 'Dal Makhani', 'Paneer Butter Masala', 'Hyderabadi Chicken Biryani', 'Lucknowi Mutton Biryani'].includes(name) && rnd() < 0.35) {
          line.addonIds = [String(addon(rnd() < 0.6 ? 'Extra Gravy' : 'Extra Raita'))];
        }
        picks.push(line);
      };

      if (isDelivery) {
        push(pick(historySets.rice));
        push(pick(historySets.nonVegMain));
        push(pick(historySets.bread), randInt(2, 3));
        if (rnd() < 0.5) push(pick(historySets.dessert));
      } else {
        if (rnd() < 0.7) push(pick(historySets.starter));
        push(rnd() < 0.55 ? pick(historySets.nonVegMain) : pick(historySets.vegMain));
        push(pick(historySets.bread), randInt(2, 4));
        if (rnd() < 0.45) push(pick(historySets.rice));
        if (rnd() < 0.6) push(pick(historySets.drink), rnd() < 0.3 ? 2 : 1);
        if (rnd() < 0.25) push(pick(historySets.dessert));
      }

      const serviceChargePercent = isDelivery ? 0 : 5;
      const priced = await priceOrderItems({
        restaurantId: rid,
        items: picks,
        serviceChargePercent,
        defaultTaxPercent: 5,
      });
      const useDiscount = !isDelivery && rnd() < 0.15;
      const discount = useDiscount ? { type: 'PERCENT' as const, value: 10, note: 'Happy hour 10% off' } : undefined;
      const totals = computeTotals({ lines: priced.items, discount, serviceChargePercent });

      const placedAt =
        dayOffset === 0
          ? new Date(todayOpenedAt + randInt(0, todayHistoryWindow) * 60_000)
          : atHour(day, randInt(12, 21), randInt(0, 59));
      const dateK = dateKey(placedAt);
      const seq = await nextSeq(`order:${rid}`);
      const orderNumber = `${SOURCE_PREFIX[source]}-${String(seq).padStart(3, '0')}`;

      const status: OrderStatus = isCancelled ? 'CANCELLED' : 'COMPLETED';
      const timeline = [placedAt, new Date(placedAt.getTime() + 3 * 60_000), new Date(placedAt.getTime() + 8 * 60_000), new Date(placedAt.getTime() + 22 * 60_000), new Date(placedAt.getTime() + 26 * 60_000), new Date(placedAt.getTime() + 55 * 60_000)];
      const historySteps: OrderStatus[] = isCancelled
        ? ['PLACED', 'ACCEPTED', 'CANCELLED']
        : ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'];

      const dineTable = !isDelivery && !isCancelled ? table(pick(tableSpec.map((t) => t[0]))) : null;
      const toPay = isDelivery || source === 'PHONE';
      const order = await OrderModel.create({
        restaurantId: restaurant._id,
        orderNumber,
        source,
        tableId: dineTable?._id ?? null,
        waiterId: dineTable ? dineTable.assignedWaiterId : null,
        cashierId: source === 'CASHIER' ? cashier._id : null,
        customerName: toPay ? pick(['Ritika Sharma', 'Aditya Nair', 'Priya Menon', 'Sameer Khan', 'Divya Iyer']) : '',
        customerPhone: toPay ? `98${randInt(100000, 999999)}` : '',
        customerAddress: toPay ? pick(ADDRESS_LINES) : '',
        customerCity: toPay ? 'Pune' : '',
        externalOrderId: isDelivery ? `${source.slice(0, 2)}-${dateK}-${randInt(1000, 9999)}` : null,
        items: priced.items,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        serviceCharge: totals.serviceCharge,
        discountAmount: totals.discountAmount,
        discountNote: discount?.note ?? '',
        roundOff: 0,
        grandTotal: totals.grandTotal,
        status,
        cancelReason: isCancelled ? pick(['Customer left before serving', 'Item out of stock', 'Duplicate order']) : '',
        paymentStatus: status === 'COMPLETED' ? 'PAID' : 'UNPAID',
        placedAt,
        acceptedAt: timeline[1],
        readyAt: timeline[3],
        servedAt: timeline[4],
        completedAt: status === 'COMPLETED' ? timeline[5] : null,
        statusHistory: historySteps.map((s, i) => ({ status: s, at: timeline[i] })),
      });
      await stampCreatedAt(OrderModel, order._id, placedAt);
      historyCount++;
      if (isCancelled) {
        cancelledCount++;
        continue;
      }

      // Bill + payment for every completed order.
      const { total, roundOff } = roundToRupee(round2(totals.subtotal - totals.discountAmount + totals.serviceCharge + totals.taxTotal));
      const billSeq = await nextSeq(`bill:${rid}:${dateK}`);
      const method = isDelivery ? 'ONLINE' : pick(['CASH', 'CASH', 'UPI', 'UPI', 'CARD']);
      const paymentMethod = isDelivery ? 'UPI' : (method as 'CASH' | 'UPI' | 'CARD');
      const paidAt = new Date(timeline[5].getTime() + randInt(1, 9) * 60_000);

      const taxBucket = new Map<number, number>();
      for (const line of priced.items) taxBucket.set(line.taxPercent, round2((taxBucket.get(line.taxPercent) ?? 0) + line.lineTotal));
      const netRatio = priced.items.reduce((s, l) => s + l.lineTotal, 0) > 0 ? (totals.subtotal - totals.discountAmount) / totals.subtotal : 0;
      const taxBreakup = [...taxBucket.entries()].flatMap(([percent, bucket]) => {
        const tax = round2(round2(bucket * netRatio) * (percent / 100));
        const half = round2(tax / 2);
        return tax > 0 ? [{ label: 'CGST', percent: percent / 2, amount: half }, { label: 'SGST', percent: percent / 2, amount: round2(tax - half) }] : [];
      });

      const bill = await BillModel.create({
        restaurantId: restaurant._id,
        billNumber: `INV-${dateK}-${String(billSeq).padStart(4, '0')}`,
        orderIds: [order._id],
        tableId: dineTable?._id ?? null,
        tableNumber: dineTable?.number ?? '',
        customerName: order.customerName,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        serviceCharge: totals.serviceCharge,
        discountAmount: totals.discountAmount,
        roundOff,
        grandTotal: total,
        taxBreakup,
        status: 'PAID',
        paymentStatus: 'PAID',
        publicToken: randomToken(16),
        issuedByUserId: cashier._id,
        issuedAt: timeline[5],
        paidAt,
      });
      await stampCreatedAt(BillModel, bill._id, timeline[5], { issuedAt: timeline[5], paidAt });

      const payment = await PaymentModel.create({
        restaurantId: restaurant._id,
        billId: bill._id,
        orderIds: [order._id],
        method: paymentMethod,
        provider: paymentMethod === 'CASH' ? 'CASH' : isDelivery ? 'RAZORPAY' : 'MOCK',
        amount: total,
        tendered: paymentMethod === 'CASH' ? round2(Math.ceil(total / 100) * 100) : null,
        change: paymentMethod === 'CASH' ? round2(Math.ceil(total / 100) * 100 - total) : null,
        transactionId: paymentMethod === 'CASH' ? null : `txn_${randomToken(8)}`,
        providerPaymentId: paymentMethod === 'CASH' ? null : `pay_${randomToken(8)}`,
        status: 'SUCCEEDED',
        collectedByUserId: paymentMethod === 'CASH' ? cashier._id : null,
        verifiedAt: paidAt,
        meta: isDelivery ? { channel: source.toLowerCase() } : { note: '' },
      });
      await stampCreatedAt(PaymentModel, payment._id, paidAt, { verifiedAt: paidAt });

      await OrderModel.updateOne({ _id: order._id }, { $set: { billId: bill._id } }, { timestamps: false });
    }
  }

  // ── Live floor: four tables mid-service ───────────────────────────────────
  // Deliberately after the history above: the running order numbers must read
  // oldest-to-newest across the demo timeline.
  const meeraSession = await openSession({ restaurantId: rid, tableId: String(table('G1')._id), guestCount: 2, customerName: 'Meera Joshi', via: 'QR' });
  await createOrder({
    restaurantId: rid,
    source: 'DINE_IN_QR',
    tableId: String(table('G1')._id),
    tableSessionId: String(meeraSession._id),
    customerName: 'Meera Joshi',
    items: [
      { productId: String(prod('Butter Chicken')._id), qty: 1, addonIds: [String(addon('Extra Butter'))] },
      { productId: String(prod('Garlic Naan')._id), qty: 2 },
      { productId: String(prod('Jeera Rice')._id), qty: 1 },
    ],
    notes: 'Less spicy, please',
  });

  const devSession = await openSession({ restaurantId: rid, tableId: String(table('G2')._id), guestCount: 3, customerName: 'Dev Patel', via: 'QR' });
  const devOrder = await createOrder({
    restaurantId: rid,
    source: 'DINE_IN_QR',
    tableId: String(table('G2')._id),
    tableSessionId: String(devSession._id),
    customerName: 'Dev Patel',
    items: [
      { productId: String(prod('Paneer Tikka')._id), qty: 1 },
      { productId: String(prod('Dal Makhani')._id), qty: 1 },
      { productId: String(prod('Butter Naan')._id), qty: 3 },
      { productId: String(prod('Sweet Lassi')._id), qty: 2 },
    ],
  });
  await transitionOrder(rid, String(devOrder._id), 'ACCEPTED', kitchenActor, { system: true });
  await transitionOrder(rid, String(devOrder._id), 'PREPARING', kitchenActor, { system: true });

  const ishanSession = await openSession({ restaurantId: rid, tableId: String(table('M3')._id), guestCount: 2, customerName: 'Ishan Rao', via: 'STAFF' });
  const ishanOrder = await createOrder({
    restaurantId: rid,
    source: 'DINE_IN_WAITER',
    tableId: String(table('M3')._id),
    tableSessionId: String(ishanSession._id),
    waiterId: String(waiters[0]._id),
    customerName: 'Ishan Rao',
    items: [
      { productId: String(prod('Hyderabadi Chicken Biryani')._id), qty: 2, addonIds: [String(addon('Extra Raita'))] },
      { productId: String(prod('Fresh Lime Soda')._id), qty: 2 },
    ],
  });
  await transitionOrder(rid, String(ishanOrder._id), 'ACCEPTED', kitchenActor, { system: true });
  await transitionOrder(rid, String(ishanOrder._id), 'PREPARING', kitchenActor, { system: true });
  await transitionOrder(rid, String(ishanOrder._id), 'READY', kitchenActor, { system: true });

  const nainaSession = await openSession({ restaurantId: rid, tableId: String(table('M5')._id), guestCount: 4, customerName: 'Naina & friends', via: 'STAFF' });
  const nainaOrderA = await createOrder({
    restaurantId: rid,
    source: 'DINE_IN_WAITER',
    tableId: String(table('M5')._id),
    tableSessionId: String(nainaSession._id),
    waiterId: String(waiters[1]._id),
    customerName: 'Naina Bhatia',
    items: [
      { productId: String(prod('Chicken 65')._id), qty: 1 },
      { productId: String(prod('Paneer Butter Masala')._id), qty: 1 },
      { productId: String(prod('Laccha Paratha')._id), qty: 4 },
    ],
  });
  const nainaOrderB = await createOrder({
    restaurantId: rid,
    source: 'DINE_IN_WAITER',
    tableId: String(table('M5')._id),
    tableSessionId: String(nainaSession._id),
    waiterId: String(waiters[1]._id),
    customerName: 'Naina Bhatia',
    items: [
      { productId: String(prod('Gulab Jamun (2 pc)')._id), qty: 2 },
      { productId: String(prod('Masala Chaas')._id), qty: 2 },
    ],
    discount: { type: 'PERCENT', value: 10, note: 'Zomato Gold match — dine-in offer' },
  });
  for (const order of [nainaOrderA, nainaOrderB]) {
    await transitionOrder(rid, String(order._id), 'ACCEPTED', kitchenActor, { system: true });
    await transitionOrder(rid, String(order._id), 'PREPARING', kitchenActor, { system: true });
    await transitionOrder(rid, String(order._id), 'READY', kitchenActor, { system: true });
    await transitionOrder(rid, String(order._id), 'SERVED', { userId: String(waiters[1]._id), role: 'WAITER', name: waiters[1].name }, { system: true });
  }
  await setTableStatus(table('M5')._id, 'BILL_REQUESTED');
  const nainaBill = await createBill({ restaurantId: rid, actor: cashierActor, sessionId: String(nainaSession._id) });
  await CustomerRequestModel.create({
    restaurantId: restaurant._id,
    tableId: table('M5')._id,
    tableSessionId: nainaSession._id,
    type: 'BILL',
    note: 'Card machine please',
    status: 'ACKNOWLEDGED',
    handledByUserId: cashier._id,
    handledAt: new Date(),
  });

  await CustomerRequestModel.create([
    {
      restaurantId: restaurant._id,
      tableId: table('M3')._id,
      tableSessionId: ishanSession._id,
      type: 'WATER',
      note: 'Two glasses',
      status: 'OPEN',
    },
    {
      restaurantId: restaurant._id,
      tableId: table('G2')._id,
      tableSessionId: devSession._id,
      type: 'CALL_WAITER',
      note: '',
      status: 'DONE',
      handledByUserId: waiters[2]._id,
      handledAt: hoursAgo(0.4),
    },
  ]);

  await setTableStatus(table('T2')._id, 'CLEANING', { lastCleanedAt: hoursAgo(0.2) });

  // Two channels that need a doorstep: the kitchen ticket and the bill both
  // have to carry where the food is going.
  const swiggyLive = await createOrder({
    restaurantId: rid,
    source: 'SWIGGY',
    externalOrderId: `SW-${dateKey(new Date())}-LIVE`,
    customerName: 'Ritika Sharma',
    customerPhone: '9812345670',
    customerAddress: 'Sunbeam Apartments, Koregaon Park',
    customerCity: 'Pune',
    items: [
      { productId: String(prod('Paneer Tikka')._id), qty: 1 },
      { productId: String(prod('Butter Naan')._id), qty: 2 },
    ],
    notes: 'Ring the bell twice',
  });
  await transitionOrder(rid, String(swiggyLive._id), 'ACCEPTED', kitchenActor, { system: true });
  await transitionOrder(rid, String(swiggyLive._id), 'PREPARING', kitchenActor, { system: true });

  await createOrder({
    restaurantId: rid,
    source: 'CASHIER',
    customerName: 'Farhan Qureshi',
    customerPhone: '9876543210',
    customerAddress: 'C-702, Kolte Patil Wakroad, Hinjawadi Phase 2',
    customerCity: 'Pune',
    items: [
      { productId: String(prod('Veg Dum Biryani')._id), qty: 2 },
      { productId: String(prod('Gulab Jamun (2 pc)')._id), qty: 4 },
    ],
  });

  // ── Bookings ──────────────────────────────────────────────────────────────
  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
  await BookingModel.create([
    {
      restaurantId: restaurant._id,
      tableId: table('T1')._id,
      customerName: 'Rohan Kapoor',
      customerPhone: '+91 98220 44110',
      customerEmail: 'rohan.kapoor@gmail.com',
      notes: 'Anniversary dinner — please keep a candle ready',
      startAt: inMinutes(45),
      durationMinutes: 90,
      guests: 4,
      status: 'CONFIRMED',
      source: 'CUSTOMER',
      assignedWaiterId: waiters[0]._id,
      statusHistory: [
        { status: 'PENDING', at: hoursAgo(26) },
        { status: 'CONFIRMED', at: hoursAgo(25.5), byUserId: manager._id },
      ],
    },
    {
      restaurantId: restaurant._id,
      tableId: table('T4')._id,
      customerName: 'Ananya Ghosh',
      customerPhone: '+91 99300 71234',
      notes: 'One high chair needed',
      startAt: inMinutes(200),
      durationMinutes: 90,
      guests: 6,
      status: 'PENDING',
      source: 'CUSTOMER',
      statusHistory: [{ status: 'PENDING', at: hoursAgo(3) }],
    },
    {
      restaurantId: restaurant._id,
      tableId: table('G4')._id,
      customerName: 'Sunil Menon',
      customerPhone: '+91 90040 88221',
      customerEmail: 'sunil.menon@outlook.com',
      notes: 'Corporate dinner, separate bills for 2 groups',
      startAt: addDays(atHour(today, 20, 30), 1),
      durationMinutes: 120,
      guests: 5,
      status: 'CONFIRMED',
      source: 'STAFF',
      createdByUserId: manager._id,
      assignedWaiterId: waiters[1]._id,
      statusHistory: [
        { status: 'PENDING', at: hoursAgo(8) },
        { status: 'CONFIRMED', at: hoursAgo(7.5), byUserId: manager._id },
      ],
    },
    {
      restaurantId: restaurant._id,
      tableId: table('G3')._id,
      customerName: 'Farhan Ali',
      customerPhone: '+91 97400 33012',
      startAt: atHour(addDays(today, -1), 13, 30),
      durationMinutes: 75,
      guests: 2,
      status: 'COMPLETED',
      source: 'CUSTOMER',
      statusHistory: [
        { status: 'CONFIRMED', at: addDays(today, -2) },
        { status: 'ARRIVED', at: atHour(addDays(today, -1), 13, 25) },
        { status: 'SEATED', at: atHour(addDays(today, -1), 13, 30) },
        { status: 'COMPLETED', at: atHour(addDays(today, -1), 14, 50) },
      ],
    },
    {
      restaurantId: restaurant._id,
      tableId: table('M6')._id,
      customerName: 'Tanya Bhatt',
      customerPhone: '+91 91680 55443',
      notes: 'Cancelled — stuck in traffic',
      startAt: atHour(addDays(today, -1), 20, 0),
      durationMinutes: 90,
      guests: 2,
      status: 'CANCELLED',
      source: 'CUSTOMER',
      statusHistory: [
        { status: 'PENDING', at: addDays(today, -2) },
        { status: 'CANCELLED', at: atHour(addDays(today, -1), 19, 20) },
      ],
    },
  ]);
  await setTableStatus(table('T1')._id, 'RESERVED');

  // ── Notifications & audit trail ───────────────────────────────────────────
  await notify({
    restaurantId: rid,
    recipientId: String(owner._id),
    type: 'LOW_STOCK',
    title: 'Low stock · Paneer',
    body: 'Only 3.5 kg left (threshold 4 kg) — order from Gokul Dairy',
    entityType: 'InventoryItem',
    entityId: String(inventory.find((i) => i.name === 'Paneer')!._id),
  });
  await notify({
    restaurantId: rid,
    recipientId: String(manager._id),
    type: 'SYSTEM',
    title: 'Weekend prep list is ready',
    body: 'Fri–Sun covers are trending 12% higher than last week',
  });
  await notify({
    restaurantId: rid,
    recipientId: String(owner._id),
    type: 'PAYMENT_SUCCEEDED',
    title: `Payment received · ₹${nainaBill.grandTotal.toFixed(2)}`,
    body: `${nainaBill.billNumber} · Table ${nainaBill.tableNumber} · awaiting settlement`,
    entityType: 'Bill',
    entityId: String(nainaBill._id),
  });

  await recordAudit({
    restaurantId: rid,
    actorId: String(manager._id),
    actorName: manager.name,
    action: 'menu.price_changed',
    entityType: 'Product',
    entityId: String(prod('Butter Chicken')._id),
    metadata: { name: 'Butter Chicken', from: 360, to: 380 },
  });
  await recordAudit({
    restaurantId: rid,
    actorId: String(owner._id),
    actorName: owner.name,
    action: 'staff.role_changed',
    entityType: 'User',
    entityId: String(chef._id),
    metadata: { name: chef.name, from: 'WAITER', to: 'KITCHEN' },
  });
  await recordAudit({
    restaurantId: rid,
    actorId: String(manager._id),
    actorName: manager.name,
    action: 'table.qr_regenerated',
    entityType: 'Table',
    entityId: String(table('T3')._id),
    metadata: { number: 'T3' },
  });

  // ── Wrap-up ───────────────────────────────────────────────────────────────
  // History above attributes orders to a named waiter, but a demo floor with a waiter
  // printed on every free seat makes "take this table" unreachable — a guest who seats
  // themself looks owned by whoever is off shift. Only a seated party holds a waiter.
  await TableModel.updateMany({ restaurantId: rid, status: 'AVAILABLE' }, { assignedWaiterId: null });

  const liveTables = await TableModel.find({ restaurantId: restaurant._id }).select('number status').lean();
  console.log(`
  Sizzle demo data ready — Saffron & Smoke (${rid})

  Sign in: ${staffPassword
    ? `with a phone number below and the DEMO_STAFF_PASSWORD this host set`
    : 'not possible — DEMO_STAFF_PASSWORD is unset, so these accounts hold no password. Onboard a restaurant at /register to get a back office.'}
${staffSpec.map((s) => `    ${s.phone.padEnd(16)} ${s.name.padEnd(14)} ${s.role}`).join('\n')}${
    staffPassword && DEMO_MASTER_PASSWORD
      ? `\n  A master password is also set on this host: any active account of ${DEMO_TENANT_SLUG} answers to it.`
      : ''
  }

  Floor right now: ${liveTables.map((t) => `${t.number}:${t.status}`).join('  ')}
  Menu: ${products.length} dishes · ${categories.length} categories
  History: ${historyCount} orders in the last 14 days (${cancelledCount} cancelled)
  Bookings: 5 (1 today within the hour, 1 pending)

  Customer QR — table G1:
    ${env.PUBLIC_BASE_URL}/t/${table('G1').qrToken}
  Public branding API:
    ${env.PUBLIC_BASE_URL}/api/public/restaurant/${DEMO_TENANT_SLUG}
`);
}

/**
 * Only the CLI owns the connection; the server calls seedDemoData() with one
 * already open. Matched on argv because tsup folds this module into server.js.
 */
if (/seed\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) {
  connectDb()
    .then(() => seedDemoData(process.argv.includes('--fresh')))
    .then(() => disconnectDb())
    .catch(async (err) => {
      console.error('[seed] failed', err);
      await disconnectDb().catch(() => {});
      process.exit(1);
    });
}
