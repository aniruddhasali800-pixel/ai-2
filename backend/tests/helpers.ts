import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db';
import { clearArchive } from '../src/store';
import {
  CategoryModel,
  InventoryItemModel,
  ProductModel,
  RestaurantModel,
  TableModel,
  UserModel,
} from '../src/models';
import { randomToken } from '../src/utils/tokens';
import type { Role, Station } from '../src/types/constants';

export async function connectTestDb() {
  await connectDb();
}

export async function disconnectTestDb() {
  await disconnectDb();
}

/** Empties the archive and opens a fresh one, so a case never inherits another case's records. */
export async function resetDb() {
  await clearArchive();
  await connectDb();
}

function uid(prefix: string): string {
  return `${prefix}-${randomToken(4)}`;
}

/** What every user these helpers create signs in with. */
export const TEST_PASSWORD = 'a-password-only-tests-know';

function hashPassword(): Promise<string> {
  return bcrypt.hash(TEST_PASSWORD, 4);
}

export async function makeRestaurant(
  opts: { taxPercent?: number; serviceChargePercent?: number; autoAcceptOrders?: boolean } = {},
) {
  const restaurantId = new Types.ObjectId();
  const owner = await UserModel.create({
    restaurantId,
    role: 'OWNER',
    name: 'Asha Rao',
    email: `${uid('owner')}@test.local`,
    passwordHash: await hashPassword(),
  });
  const restaurant = await RestaurantModel.create({
    _id: restaurantId,
    ownerId: owner._id,
    name: 'Test Bistro',
    slug: uid('test-bistro'),
    taxPercent: opts.taxPercent ?? 5,
    serviceChargePercent: opts.serviceChargePercent ?? 5,
    settings: { autoAcceptOrders: opts.autoAcceptOrders ?? false },
  });
  return { restaurant, owner };
}

export async function makeUser(restaurantId: Types.ObjectId | string, role: Role, name: string) {
  return UserModel.create({
    restaurantId,
    role,
    name,
    email: `${uid(role.toLowerCase())}@test.local`,
    passwordHash: await hashPassword(),
  });
}

export async function makeCategory(restaurantId: Types.ObjectId | string, name = 'Mains') {
  return CategoryModel.create({ restaurantId, name });
}

export async function makeProduct(
  restaurantId: Types.ObjectId | string,
  categoryId: Types.ObjectId | string,
  input: {
    name: string;
    price: number;
    taxPercent?: number | null;
    station?: Station;
    isVeg?: boolean;
    recipe?: { inventoryItemId: Types.ObjectId; qty: number }[];
  },
) {
  return ProductModel.create({
    restaurantId,
    categoryId,
    name: input.name,
    price: input.price,
    taxPercent: input.taxPercent ?? null,
    station: input.station ?? 'MAIN',
    isVeg: input.isVeg ?? true,
    recipe: input.recipe ?? [],
  });
}

export async function makeTable(
  restaurantId: Types.ObjectId | string,
  number: string,
  capacity = 4,
  assignedWaiterId?: Types.ObjectId | string,
) {
  return TableModel.create({
    restaurantId,
    number,
    capacity,
    section: 'Main',
    qrToken: randomToken(16),
    assignedWaiterId: assignedWaiterId ?? null,
  });
}

export async function makeInventoryItem(
  restaurantId: Types.ObjectId | string,
  name: string,
  unit: 'KG' | 'G' | 'L' | 'ML' | 'PCS' | 'PACKET' = 'KG',
  stock = 20,
) {
  return InventoryItemModel.create({
    restaurantId,
    name,
    unit,
    stock,
    lowStockThreshold: 2,
    costPerUnit: 250,
  });
}

export interface Diner {
  restaurantId: string;
  ownerId: string;
  managerId: string;
  cashierId: string;
  kitchenId: string;
  waiterId: string;
  categoryId: string;
  mainsProductId: string;
  colaProductId: string;
  smallTableId: string;
  largeTableId: string;
  flourItemId: string;
}

export const actor = (userId: string, role: Role, name = `${role} test`) => ({ userId, role, name });

/** One-call fixture: restaurant with staff, menu, tables and a stocked pantry. */
export async function makeDiner(): Promise<Diner> {
  const { restaurant, owner } = await makeRestaurant();
  const restaurantId = restaurant._id;
  const [manager, cashier, kitchen, waiter] = await Promise.all([
    makeUser(restaurantId, 'MANAGER', 'Neha Test'),
    makeUser(restaurantId, 'CASHIER', 'Rohit Test'),
    makeUser(restaurantId, 'KITCHEN', 'Vikram Test'),
    makeUser(restaurantId, 'WAITER', 'Sneha Test'),
  ]);
  const category = await makeCategory(restaurantId);
  const flour = await makeInventoryItem(restaurantId, 'Flour', 'KG', 20);
  const [mains, cola] = await Promise.all([
    makeProduct(restaurantId, category._id, {
      name: 'Butter Chicken',
      price: 320,
      isVeg: false,
      recipe: [{ inventoryItemId: flour._id, qty: 0.25 }],
    }),
    makeProduct(restaurantId, category._id, { name: 'Cola', price: 90, taxPercent: 12, station: 'BAR' }),
  ]);
  const [small, large] = await Promise.all([
    makeTable(restaurantId, 'S1', 2, waiter._id),
    makeTable(restaurantId, 'L1', 6, waiter._id),
  ]);

  return {
    restaurantId: String(restaurantId),
    ownerId: String(owner._id),
    managerId: String(manager._id),
    cashierId: String(cashier._id),
    kitchenId: String(kitchen._id),
    waiterId: String(waiter._id),
    categoryId: String(category._id),
    mainsProductId: String(mains._id),
    colaProductId: String(cola._id),
    smallTableId: String(small._id),
    largeTableId: String(large._id),
    flourItemId: String(flour._id),
  };
}
