import 'dotenv/config';
import { z } from 'zod';

// Render tells a service its own public address through these variables. Reading them
// means the socket handshake allowlist and every QR/guest link point at the host the
// browser is actually on, with nothing to remember to set in the dashboard.
const hosted =
  process.env.RENDER_EXTERNAL_URL?.replace(/\/+$/, '') ||
  (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : undefined);

/**
 * Whether this process is answering strangers on the public internet. A host that hands a service
 * its own address has put it in front of customers, so anything the build only does to let a
 * walk-through happen on a laptop has to switch itself off here — a forgotten `NODE_ENV` must not be
 * able to turn a developer convenience into a published hole.
 */
export const isDeployedHost = Boolean(hosted);

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
  // The key a provider is being moved off, kept valid only while the rotation is in progress. See
  // `webhookSigningKeys` for why a route needs two of them and why a published value never qualifies.
  PAYMENT_WEBHOOK_SECRET_PREVIOUS: z.string().trim().optional(),
  SWIGGY_WEBHOOK_SECRET_PREVIOUS: z.string().trim().optional(),
  ZOMATO_WEBHOOK_SECRET_PREVIOUS: z.string().trim().optional(),
  WEBSITE_WEBHOOK_SECRET_PREVIOUS: z.string().trim().optional(),
  RAZORPAY_WEBHOOK_SECRET_PREVIOUS: z.string().trim().optional(),
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
  // The only credential that lets a request past the sign-in rate limit, so that a staged load run can
  // measure the service instead of its own throttling. Empty by default, which means no request is ever
  // skipped, and a production host refuses to start with one set — see the boot guard.
    CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  LOAD_TEST_TOKEN: z.string().trim().default(''),
});

/** The four secrets a webhook route verifies with, and what each one is trusted to decide. */
export const WEBHOOK_SECRET_VARIABLES = {
  PAYMENT_WEBHOOK_SECRET: 'the payment gateway, whose `captured` event settles a bill',
  SWIGGY_WEBHOOK_SECRET: 'Swiggy, which pushes a paid order into a kitchen',
  ZOMATO_WEBHOOK_SECRET: 'Zomato, which pushes a paid order into a kitchen',
  WEBSITE_WEBHOOK_SECRET: 'a restaurant website, which pushes its own checkout in as an order',
} as const;

const webhookSecretNames = Object.keys(WEBHOOK_SECRET_VARIABLES) as (keyof typeof WEBHOOK_SECRET_VARIABLES)[];

/**
 * The variable that holds the key each provider is being moved off.
 *
 * A provider signs with whatever it has, and the instant its endpoint is re-pointed it may still be
 * retrying deliveries queued under the old key — Razorpay retries for a day. A route that knows only
 * the new secret answers those legitimate retries with 401, and the partner gives up or the restaurant
 * never sees the order. So a rotation is a window rather than a cut, and this is the variable that
 * holds the expiring half of it.
 */
export const RETIRED_WEBHOOK_VARIABLES = {
  PAYMENT_WEBHOOK_SECRET: 'PAYMENT_WEBHOOK_SECRET_PREVIOUS',
  SWIGGY_WEBHOOK_SECRET: 'SWIGGY_WEBHOOK_SECRET_PREVIOUS',
  ZOMATO_WEBHOOK_SECRET: 'ZOMATO_WEBHOOK_SECRET_PREVIOUS',
  WEBSITE_WEBHOOK_SECRET: 'WEBSITE_WEBHOOK_SECRET_PREVIOUS',
  RAZORPAY_WEBHOOK_SECRET: 'RAZORPAY_WEBHOOK_SECRET_PREVIOUS',
} as const;

export type WebhookSecretName = keyof typeof RETIRED_WEBHOOK_VARIABLES;

/** Every webhook variable, live and retiring, that a value can be compared across. */
const allWebhookVariableNames = [
  ...webhookSecretNames,
  ...Object.values(RETIRED_WEBHOOK_VARIABLES),
] as string[];

/** Which provider a variable belongs to, whether it holds the live key or the one being retired. */
function webhookSlot(name: string): string {
  return name.replace(/_PREVIOUS$/, '');
}

/**
 * Whether two variables describe one sender rather than two tenants.
 *
 * The same variable twice (a live key and its own retiring copy) is a rotation that has not changed the
 * value, which is dull but not a hole. Razorpay and the sandbox payment route are the pairing the
 * incident checklist tells the operator to set equal, because one Razorpay endpoint signs for both, so
 * that one cross-provider collision is allowed and every other is not.
 */
function sharesOneSender(a: string, b: string): boolean {
  const [first, second] = [webhookSlot(a), webhookSlot(b)];
  if (first === second) return true;
  const pair = new Set([first, second]);
  return pair.size === 2 && pair.has('RAZORPAY_WEBHOOK_SECRET') && pair.has('PAYMENT_WEBHOOK_SECRET');
}

/** Every credential value this repository has ever published, so not one of them is a secret. */
const publishedDefaults = new Set([
  'dev-access-secret-0000000000',
  'dev-refresh-secret-0000000000',
  'dev-webhook-secret',
  'dev-swiggy-secret',
  'dev-zomato-secret',
  'dev-website-secret',
  'sizzle-pay',
  'sizzle',
]);

/** The shapes of a value somebody typed before they had a real credential to paste in. */
const placeholderPattern = /^(?:dev|test|example|sample|dummy|placeholder|changeme|change-me|your[-_])[a-z0-9_-]*$/i;

/**
 * Whether a value can be trusted to be a secret. Blank, a string that appears in this repository, and
 * anything that begins like a template all fail, because a signature computed from them can be
 * forged by whoever read the file — which is the whole point of an HMAC webhook.
 */
export function isPublishableSecret(value: string | undefined): boolean {
  const v = String(value ?? '').trim();
  return v === '' || publishedDefaults.has(v) || placeholderPattern.test(v);
}

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const values = parsed.data as unknown as Record<string, string | undefined>;

/** The webhook secrets on this host that a stranger could still guess out of this repository. */
export const unsafeWebhookSecrets = webhookSecretNames.filter((name) => isPublishableSecret(values[name]));

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
  // A token that switches the rate limits off is a door, and production is exactly where a door like
  // that must not exist. Load runs belong to a staging instance that holds its own token.
  if ((values.LOAD_TEST_TOKEN ?? '') !== '') {
    problems.push('LOAD_TEST_TOKEN is set, which would leave the sign-in rate limits switchable off in production');
  }
  // A webhook secret that survives in a template is worse than a session one: it lets a stranger
  // mark a bill paid or book a table that no customer asked for, and the ledger never asks who said so.
  for (const name of unsafeWebhookSecrets) {
    problems.push(`${name} is unset, or is still the value this repository publishes`);
  }
  // Two providers handed the same secret is one secret: a message signed for Swiggy verifies as a
  // Zomato order, so the per-tenant routing between them is only as real as their separate keys.
  // One pairing is deliberate and listed below — Razorpay signs for two of our variables at once.
  const holder = new Map<string, string>();
  for (const name of allWebhookVariableNames) {
    const value = values[name]?.trim();
    if (!value || isPublishableSecret(value)) continue;
    const already = holder.get(value);
    if (already === undefined) holder.set(value, name);
    else if (!sharesOneSender(already, name)) {
      problems.push(`webhook secrets ${already} and ${name} are the same value, so any one provider can forge another`);
    }
  }
  // A grace period for a leaked key is not a grace period, it is the hole left open under a new name.
  for (const name of Object.values(RETIRED_WEBHOOK_VARIABLES)) {
    const value = values[name]?.trim();
    if (value && isPublishableSecret(value)) {
      problems.push(`${name} holds a value this repository publishes, which is a leaked key rather than one being retired`);
    }
  }
  if (problems.length) {
    console.error(
      `Refusing to start in production:\n- ${problems.join('\n- ')}\n` +
        'Set these on the host (for Render: Dashboard → Environment). Generate one independent secret per ' +
        'provider with e.g. `openssl rand -hex 32`, and never commit the values.',
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
 * The keys a delivery from this provider may legitimately have been signed with, live key first.
 *
 * A rotation is a window, not a cut: a gateway that re-points its endpoint keeps retrying the
 * deliveries it queued under the previous key, and a route that knows only the new secret answers that
 * genuine traffic with 401 until the partner gives up. So the retiring key is accepted beside the live
 * one for as long as the host says it is retiring, and not one moment after the variable is cleared.
 *
 * A published value never joins the list under any name. The reason this repository is rotating at all
 * is that these strings leaked into it, and filing one again as `_PREVIOUS` would hand the forgery back
 * its signing key with a straighter face.
 */
export function webhookSigningKeys(name: WebhookSecretName): string[] {
  const held = env as unknown as Record<string, string | undefined>;
  const live = String(held[name] ?? '').trim();
  const retiring = String(held[RETIRED_WEBHOOK_VARIABLES[name]] ?? '').trim();
  return [live, retiring].filter((key) => key !== '' && (key === live || !isPublishableSecret(key)));
}

/**
 * Whether an incoming webhook may be believed at all.
 *
 * A laptop keeps the door open on its defaults, because the walk-through has to run with nothing in
 * the environment. A deployed host does not: there, a published default is a stranger holding the
 * signing key, so the routes answer 503 instead of settling money. It closes the endpoint rather than
 * refusing to boot, because the alternative takes the whole product offline for one unset variable —
 * and it does not wait for `NODE_ENV`, which is the setting a deployment is most likely to have
 * forgotten.
 */
export const webhooksAreAccepted = unsafeWebhookSecrets.length === 0 || !isDeployedHost;

if (!webhooksAreAccepted) {
  console.warn(
    `[security] Webhook routes are CLOSED, because ${unsafeWebhookSecrets.join(', ')} ` +
      `${unsafeWebhookSecrets.length === 1 ? 'is' : 'are'} still a published default. No payment can be ` +
      'settled and no partner order can be pushed in until each one is given its own secret on the host. ' +
      'This repository prints only the names, never the values.',
  );
}

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
