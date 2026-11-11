import 'dotenv/config';
import { z } from 'zod';

// Render tells a service its own public address through these variables. Reading them
// means the socket handshake allowlist and every QR/guest link point at the host the
// browser is actually on, with nothing to remember to set in the dashboard.
const hosted =
  process.env.RENDER_EXTERNAL_URL?.replace(/\/+$/, '') ||
  (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : undefined);

const localDev = 'http://localhost:5173';

/**
 * The demo client is deployed on its own host, so the API has to be able to read that
 * origin. A dashboard variable nobody remembers to update is the usual way a deployment
 * silently loses realtime, so these are always allowed, not only the default.
 *
 * The custom domain serves the site and proxies /api here, so it is same-origin and needs
 * no entry for its own traffic; it is listed because QR codes and bill links are printed
 * with it. The old Vercel address stays second: stickers already printed and shortcuts
 * already saved point at it, and a deployed client must keep opening.
 */
const demoClients = ['https://smart.restaurant.aniruddhasali.in', 'https://ai-ecru-kappa-14.vercel.app'];

/**
 * Links a person opens — the table sticker, the guest's bill, the pay page, the booking
 * confirmation — belong on the host that serves pages, not on the API host: this service only
 * answers /api and a Render sleep between requests turns a printed code into an error page.
 * The proxied custom domain serves both the site and /api, so it is the address customers reach.
 */
const publicBase = hosted ? demoClients[0] : localDev;

const builtInOrigins = [hosted, ...demoClients, localDev].filter(Boolean) as string[];

/** A laptop address can never be opened from a customer's phone. */
export function isPrivateAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return true;
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  // The records live here as folders and JSON lines on this machine — see src/store/layout.ts.
  // A relative path is taken against the directory the server was started from.
  ARCHIVE_DIR: z.string().trim().default('.data/archive'),
  MONGODB_URI: z.string().trim().optional(),

  ACCESS_TOKEN_SECRET: z.string().min(16).default('dev-access-secret-0000000000'),
  REFRESH_TOKEN_SECRET: z.string().min(16).default('dev-refresh-secret-0000000000'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),

  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  CORS_ORIGIN: z.string().default(builtInOrigins.join(',')),
  PUBLIC_BASE_URL: z.string().default(publicBase),
  PAYMENT_WEBHOOK_SECRET: z.string().default('dev-webhook-secret'),
  SWIGGY_WEBHOOK_SECRET: z.string().default('dev-swiggy-secret'),
  ZOMATO_WEBHOOK_SECRET: z.string().default('dev-zomato-secret'),
  WEBSITE_WEBHOOK_SECRET: z.string().default('dev-website-secret'),
  SWIGGY_API_BASE: z.string().optional(),
  SWIGGY_API_KEY: z.string().optional(),
  ZOMATO_API_BASE: z.string().optional(),
  ZOMATO_API_KEY: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // The bill service (the `bill/` app) holds the payee UPI ID, the verification queue and the
  // income figures. Both are optional: with no base URL Sizzle keeps its own in-house UPI QR and
  // the sandbox gateway, so a checkout of this repo runs with nothing beside it.
  BILL_SERVICE_BASE_URL: z.string().trim().optional(),
  BILL_SERVICE_SHARED_SECRET: z.string().trim().optional(),
  BILL_SERVICE_KEY: z.string().trim().default('sizzle-pay'),
  UPLOAD_DIR: z.string().default('uploads'),
  STATIC_DIR: z.string().trim().optional(),
  // One password that opens any staff account of the demo tenant, so a walk-through needs a list
  // of one rather than seven. It ships switched off: a host that wants it has to name the password
  // itself, because a value baked into the repository is a public door on every deployment of it.
  DEMO_MASTER_PASSWORD: z.string().default(''),
  /**
   * The password every seeded staff account gets, so a demo tenant can be signed into. Left unset,
   * the seed still writes the restaurant, its menu, its tables and its order history, but hands out
   * no logins at all — those accounts then have no hash to compare, and only the master above could
   * open them, which is itself off. A restaurant that onboarded itself is a different tenant and is
   * never touched by either value.
   */
  DEMO_STAFF_PASSWORD: z.string().default(''),
  // A virgin database gets the demo tenant loaded into it, which is the only way a
  // hosted instance has anything to show. Set AUTO_SEED=false for a clean install.
  AUTO_SEED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production') {
  // The development defaults, the values the committed template ships with, and anything obviously
  // written to be replaced. A production process must not start on a secret somebody could copy out
  // of this repository, which is the one way a token secret fails silently: everything works, and
  // anyone who can guess the string can mint a session.
  const placeholderSecrets = ['dev-access-secret-0000000000', 'dev-refresh-secret-0000000000'];
  const looksUnset = (value: string) => placeholderSecrets.includes(value) || value.startsWith('change-me');
  const problems: string[] = [];
  if (looksUnset(parsed.data.ACCESS_TOKEN_SECRET ?? '')) {
    problems.push('ACCESS_TOKEN_SECRET is still a template value');
  }
  if (looksUnset(parsed.data.REFRESH_TOKEN_SECRET ?? '')) {
    problems.push('REFRESH_TOKEN_SECRET is still a template value');
  }
  if (problems.length) {
    console.error(
      `Refusing to start in production:\n- ${problems.join('\n- ')}\n` +
        'Set these on the host (for Render: Dashboard → Environment). Generate secrets with e.g. `openssl rand -hex 32`.',
    );
    process.exit(1);
  }
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
};

/**
 * Whether this process is answering strangers on the public internet. A host that hands a service
 * its own address has put it in front of customers, so anything the build only does to let a
 * walk-through happen on a laptop has to switch itself off here — a forgotten `NODE_ENV` must not be
 * able to turn a developer convenience into a published hole.
 */
export const isDeployedHost = Boolean(hosted);

/** The tenant `npm run seed` loads, and the only one the demo master password opens. */
export const DEMO_TENANT_SLUG = 'saffron-and-smoke';

/**
 * One password that opens every active account in the demo tenant, so the walkthrough can run from
 * the owner's reports to the pass without a list kept beside the keyboard. It is a deliberate hole
 * in a build that has no real money or guest data behind it, so it closes by itself the moment the
 * API runs in production, closes on any host that sets the variable to blank, and reaches no
 * restaurant that onboarded itself for real.
 */
export const DEMO_MASTER_PASSWORD = env.isProd ? '' : env.DEMO_MASTER_PASSWORD;

/**
 * Origins allowed on the HTTP and socket handshakes: whatever the host lists plus this
 * app's own addresses. A deployed service is never a cross-origin risk against its own
 * browser, and a stale CORS_ORIGIN must not be able to lock the known clients out.
 */
export const allowedOrigins = [
  ...new Set([...builtInOrigins, ...env.CORS_ORIGIN.split(',').map((o) => o.trim())].filter(Boolean) as string[]),
];

if (hosted && isPrivateAddress(env.PUBLIC_BASE_URL)) {
  console.warn(
    `[config] PUBLIC_BASE_URL is ${env.PUBLIC_BASE_URL}, which no browser outside this machine can open. ` +
      `Using ${publicBase} for table QR codes, guest bills and booking links instead — clear the variable, ` +
      'or set it to the address your customers reach.',
  );
  env.PUBLIC_BASE_URL = publicBase;
} else if (hosted && env.PUBLIC_BASE_URL !== hosted && !allowedOrigins.includes(env.PUBLIC_BASE_URL)) {
  console.warn(
    `[config] PUBLIC_BASE_URL is ${env.PUBLIC_BASE_URL} while this host serves ${hosted}. ` +
      'Table QR codes, guest bills and booking links will point at the first address — set it to ' +
      'the host your customers can actually reach, or clear the variable to use the deployed client.',
  );
}
