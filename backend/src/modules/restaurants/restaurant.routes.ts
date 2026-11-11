import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { RestaurantModel } from '../../models';
import { env, allowedOrigins, isPrivateAddress } from '../../config/env';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { ApiError } from '../../utils/httpError';
import { emit, Events } from '../../realtime/emit';
import { recordAudit } from '../../services/audit.service';
import { FLOOR_ROLES } from '../../types/constants';

export const restaurantRouter = Router();

restaurantRouter.use(requireAuth);

/**
 * A printed code has to open on a phone, so it encodes the host the owner is looking at.
 * Under split hosting the client lives on its own host and only reaches this API for data,
 * so PUBLIC_BASE_URL alone would print a code for the service behind it — the one that
 * sleeps between requests. Only a public Origin qualifies: a laptop address is exactly what
 * PUBLIC_BASE_URL was set to, so a local print must keep using it.
 */
function clientBase(origin: string | string[] | undefined): string {
  const single = Array.isArray(origin) ? origin[0] : origin;
  const clean = String(single ?? '').replace(/\/+$/, '');
  const usable = !!clean && allowedOrigins.includes(clean) && !isPrivateAddress(clean);
  return usable ? clean : String(env.PUBLIC_BASE_URL).replace(/\/+$/, '');
}

restaurantRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const restaurant = await RestaurantModel.findById(req.auth!.restaurantId).lean();
    if (!restaurant) throw ApiError.notFound('Restaurant not found');
    res.json(restaurant);
  }),
);

/** The sticker for the counter, the bag and the delivery box. */
restaurantRouter.get(
  '/app-qr',
  requirePermission('settings:write'),
  asyncHandler(async (req, res) => {
    const restaurant = await RestaurantModel.findById(req.auth!.restaurantId).lean();
    if (!restaurant) throw ApiError.notFound('Restaurant not found');
    const url = `${clientBase(req.headers.origin)}/eat/${restaurant.slug}`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 420, errorCorrectionLevel: 'M' });
    res.json({ url, dataUrl });
  }),
);

/**
 * The one code the whole team scans. It installs a single app and signs in from there:
 * which of the five screens opens is decided by the account, never by the code — so the
 * owner, the manager, the waiter, the cook and the cashier all carry the same sticker.
 * The slug rides along so a person with no account lands on this restaurant's job form.
 */
restaurantRouter.get(
  '/staff-qr',
  requirePermission('settings:read'),
  asyncHandler(async (req, res) => {
    const restaurant = await RestaurantModel.findById(req.auth!.restaurantId).lean();
    if (!restaurant) throw ApiError.notFound('Restaurant not found');
    const url = `${clientBase(req.headers.origin)}/staff.html?r=${encodeURIComponent(restaurant.slug)}`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 420, errorCorrectionLevel: 'M' });
    res.json({ url, dataUrl });
  }),
);

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  address: z
    .object({
      line1: z.string().max(120).optional(),
      city: z.string().max(60).optional(),
      state: z.string().max(60).optional(),
      pincode: z.string().max(10).optional(),
    })
    .optional(),
  taxPercent: z.number().min(0).max(28).optional(),
  serviceChargePercent: z.number().min(0).max(20).optional(),
  hours: z.object({ open: z.string().max(5), close: z.string().max(5) }).optional(),
  branding: z
    .object({
      logoUrl: z.string().max(500).optional(),
      coverUrl: z.string().max(500).optional(),
      tagline: z.string().max(160).optional(),
    })
    .optional(),
  payment: z
    .object({
      upiId: z.string().max(80).optional(),
      upiName: z.string().max(80).optional(),
    })
    .optional(),
  settings: z
    .object({
      acceptingOrders: z.boolean().optional(),
      autoAcceptOrders: z.boolean().optional(),
      billFooterNote: z.string().max(200).optional(),
      bookingEnabled: z.boolean().optional(),
      bookingSlotMinutes: z.number().min(5).max(180).optional(),
      bookingDurationMinutes: z.number().min(15).max(300).optional(),
      bookingReminderMinutes: z.number().min(5).max(240).optional(),
      allowWaiterCash: z.boolean().optional(),
      deliveryEnabled: z.boolean().optional(),
      openRoles: z.array(z.enum(FLOOR_ROLES)).max(FLOOR_ROLES.length).optional(),
    })
    .optional(),
});

restaurantRouter.patch(
  '/',
  requirePermission('settings:write'),
  validate({ body: patchSchema }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const previous = await RestaurantModel.findById(restaurantId).lean();
    if (!previous) throw ApiError.notFound('Restaurant not found');

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (value === undefined) continue;
      if (key === 'address' || key === 'branding' || key === 'settings' || key === 'hours' || key === 'payment') {
        update[key] = { ...(previous as Record<string, any>)[key], ...(value as object) };
      } else {
        update[key] = value;
      }
    }

    const restaurant = await RestaurantModel.findByIdAndUpdate(restaurantId, update, { new: true }).lean();
    // Its own event: a settings change moves the branding, the hours and the QR targets, and every
    // screen that shows one of those has to repaint, not just the menu.
    emit.toRestaurant(restaurantId, Events.SETTINGS_UPDATED, {});

    const changed = Object.keys(req.body);
    await recordAudit({
      restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'settings.updated',
      entityType: 'Restaurant',
      entityId: restaurantId,
      metadata: {
        fields: changed,
        taxPercent: req.body.taxPercent,
        serviceChargePercent: req.body.serviceChargePercent,
      },
    });
    res.json(restaurant);
  }),
);
