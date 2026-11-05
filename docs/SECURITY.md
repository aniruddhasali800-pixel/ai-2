# Security

This describes the protections the code actually implements, with the file and line where each one lives,
and then the list of things it does not protect. It is written for whoever operates or audits this service,
including under time pressure, so the gaps come with the command that demonstrates them.

The live incident — four webhook signing keys published in this repository — is documented separately in
`docs/SECURITY_INCIDENT_WEBHOOKS.md`, because it has its own timeline, rotation procedure and closure
conditions. This document covers the rest of the surface and points back at that one where it overlaps.

## 1. Threat model, in one paragraph

The system is a restaurant SaaS with four kinds of caller: staff on a floor (owner, manager, cashier,
kitchen, waiter), paying guests who hold nothing but a QR code, partner platforms that post orders and
payment events with a signature instead of a session, and the bill service, which is a separate process
holding payee details. Each can be reached at a public URL. The things worth stealing or forging are a
settled bill, an order that was never placed, another tenant's menu and revenue, and a staff session.
Nothing here holds card data — the payment instrument stays with the gateway — so the highest-value target
is the webhook signature path and the second is the session token.

## 2. Authentication

**Passwords.** bcrypt at 10 rounds (`modules/auth/auth.service.ts:13`), compared with the library's own
check. There is no path that logs a hash, and `publicUser()` (`auth.service.ts:32`) never returns one.

**Session tokens.** Custom JWT, no third-party identity provider — one was tried, integration costs were
higher than the control it gave, and it was removed. Sign-in therefore has exactly two paths: a password,
or creating a restaurant. An access token carries `sub`, `rid`, `role`, `name` and expires per
`ACCESS_TOKEN_TTL` (15 minutes).

**Refresh tokens.** `mintRefresh` (`auth.service.ts:64`) signs `{ sub, v }` where `v` is a random version
from `crypto.randomBytes` (`utils/tokens.ts:3`), and stores **only the bcrypt hash of `v`** in the user
record. `refreshSession`
(`auth.service.ts:181`) finds the matching slot and replaces exactly that slot, so refreshing on a phone
does not sign out the counter screen. A token whose version matches no stored slot is refused. Five
devices max, oldest evicted (`$slice: -LIVE_SESSIONS`, `auth.service.ts:58`). A database dump therefore
leaks hashes, not usable tokens.

**Sign-in by code.** `modules/auth/otp.service.ts` stores a bcrypt hash of the code with an expiry, caps
attempts (`MAX_ATTEMPTS`), consumes the code on success, and consumes it on exhausting attempts. On a host
the platform declares public, one-time codes are never returned in the API response — the check is
`isDeployedHost` (`config/env.ts:17`), not `NODE_ENV`, because a forgotten environment variable is how a
development convenience becomes a published hole.

**The demo master password.** `DEMO_MASTER_PASSWORD` (`env.ts:325`) is forced to empty in production and
empty by default, so a host must name it deliberately to have it. The seeded staff password
(`DEMO_STAFF_PASSWORD`) is also empty by default: with it unset the demo tenant has a menu, tables and
order history and **no logins at all**. Both values were removed from tracked files during this audit.

### What this does not protect

Access and refresh tokens are persisted by zustand's `persist` middleware (`frontend/src/store/auth.ts:46`),
which writes to **localStorage**. `cookie-parser` is installed but no route sets a cookie, so there is no
`HttpOnly` option in play. Any XSS in the client is therefore a session theft that survives a reload, and a
shared floor tablet is a stored session on disk for the last signed-in account. The fix is an `HttpOnly`,
`Secure`, `SameSite=Lax` refresh cookie plus an in-memory access token; it changes the client's boot and
refresh paths, so it is scheduled in `docs/SCALING_PLAN.md` rather than done mid-incident.

## 3. Authorization

Five roles, one permission grid, defined once: `types/constants.ts:147` `ROLE_PERMISSIONS`. Owners hold
all 26 permissions; managers everything operational but not `settings:write` or `integrations:write`;
cashiers own the counter; kitchen sees `menu:read`, `orders:read`, `kitchen:operate` and nothing else;
waiters can write bills and read payments but **not mark one paid** — `payments:write` is deliberately
absent from the waiter row, with the reason written beside it in the source.

Two middlewares, `middleware/auth.ts:21` `requireAuth` and `middleware/rbac.ts:5` `requirePermission`.
The order matters and is not accidental: `requireAuth` verifies the JWT signature, then **re-reads the
account** and overwrites `req.auth` with `role` and `restaurantId` from the record, and refuses a
non-`ACTIVE` user. A token minted before a demotion or a suspension stops working on the next request. A
role in a token is information, never authority.

**Order state is server-enforced.** `services/order.service.ts:451` rejects any transition not listed in
`ORDER_TRANSITIONS` (`constants.ts:174`), so a client cannot post a completed order straight from placed or
resurrect a cancelled one. Settlement closes have their own flag, because day-close is allowed to do what
a waiter is not.

**Guests are capability-based.** A table session or an order-tracking token is the whole credential, and
`socket.ts:66` checks it against `TableSessionModel` before joining the room. A guest socket gets no
tenant room and no staff events.

**Hiring cannot grant authority.** `FLOOR_ROLES` (`constants.ts:5`) are the jobs a stranger may ask for on
the sticker, and `OWNER_GRANT_ROLES` (`constants.ts:7`) lists only `MANAGER` — a manager approving a hire
cannot hand out manager.

## 4. Tenant isolation

The file layout separates tenants physically — one folder per restaurant (`store/layout.ts:24`) — and every
per-restaurant query repeats `restaurantId: auth.restaurantId` in its filter. There is no scoped-query
layer that would make an unscoped query impossible, which means isolation is a convention, and conventions
break. Five tests exist specifically to break it on purpose and fail if it moves:

| Test | What it attempts |
| --- | --- |
| `backend/tests/orders.test.ts:71` "serves another tenant nothing" | read a second restaurant's orders with the first's session |
| `backend/tests/bookings.test.ts:129` "never leaks another tenant table" | book against another tenant's table id |
| `backend/tests/customerApp.test.ts:181` | seat a guest at another restaurant using its own seat code |
| `backend/tests/pipeline.test.ts:230` | one restaurant's orders appearing in another's report aggregation |
| `backend/tests/webhookHardening.test.ts:158` | one tenant reading another tenant, on the webhook path |

The migration in `docs/DATABASE_MIGRATION.md` §4 is the moment to convert the convention into a compound
index with `restaurantId` leading, because a query that forgets it then costs visibly more than one that
includes it — and to keep these five tests running against the real database, unchanged.

## 5. Request validation

`middleware/validate.ts` parses `params`, `query` and `body` through zod schemas at the router boundary and
replaces the request with the parsed value, so downstream code reads coerced types rather than strings. A
failure becomes `400 VALIDATION_ERROR` with field errors and nothing else. Bodies are capped at 2 MB
(`app.ts:60`); uploads at 5 MB per file with an explicit extension and MIME check
(`middleware/upload.ts:30`).

## 6. Webhooks

Two routers, mounted **before** `express.json` so the bytes that were signed are the bytes that are
verified (`app.ts:57-58`). HMAC-SHA256 over the raw body, compared with `safeEqual`, a length-checked
`timingSafeEqual`. Duplicate deliveries cannot run twice: a `(provider, eventId)` ledger in
`models/WebhookEvent.ts` claims the event before the business action and releases the claim if the action
throws, so a retry after a crash is processed rather than lost. Blank, published-default and placeholder
shaped secrets fail closed. On a host that declares itself public, both routers answer `503` until all four
keys hold a value of their own.

A rotation has a window rather than a cliff: `webhookSigningKeys` (`env.ts:287`) accepts the retiring key
beside the live one while `*_WEBHOOK_SECRET_PREVIOUS` holds it, and refuses a published value under either
name. The three delivery adapters implement an **assumed** signing contract, because Swiggy and Zomato do
not publish one for an order feed; that gap is stated in
`docs/SECURITY_INCIDENT_WEBHOOKS.md` §8 and is the single largest unknown in this document.

## 7. Rate limiting

`middleware/rateLimit.ts`, four limiters, `draft-7` standard headers, no legacy headers:

| Limiter | Window | Limit | Applied to |
| --- | --- | --- | --- |
| `loginLimiter` | 15 min | 30 | the four routes that can mint or request a session: register, password login, code request, code verify (`modules/auth/auth.routes.ts` 16, 45, 64, 75) |
| `publicLimiter` | 1 min | 240 | all of `/api/public` (`public.routes.ts:39`) |
| `publicWriteLimiter` | 1 min | 40 | nine guest-facing write endpoints |
| `webhookLimiter` | 1 min | 120 | both webhook routers |

**Ten authenticated routers apply no limit of any kind**: `billing`, `bookings`, `kitchen`, `menu`,
`orders`, `reports`, `restaurants`, `staff`, `tables`, `uploads` — `grep -c 'rateLimit\|Limiter'` returns 0
for each. A signed-in waiter token can therefore loop `/api/reports` until the process runs out of memory,
which today it can, because reports aggregate the whole in-tree history. Per-user and per-tenant limits
belong to the Redis stage (`docs/SCALING_PLAN.md` P5): a file-backed in-process counter is per-instance and
would be the third thing this service gets wrong about its own state.

The one bypass is `x-load-test-auth`, and it now requires a token: `isTrustedLoadRun`
(`rateLimit.ts:17`) compares the header against `LOAD_TEST_TOKEN` in constant time, returns false when no
token is configured, and **a production host refuses to start with a token set** (`env.ts:231`). Before
this audit the header was believed on presence alone, which made every sign-in limit in the service
skippable by anyone who read the file. Covered by `backend/tests/rateLimitBypass.test.ts`.

## 8. Secrets and the boot guard

`config/env.ts:215-267`, active when `NODE_ENV=production`:

- Refuses a token secret that is still a template value, naming the variable and never the value.
- Refuses any of the four webhook keys that is unset, blank, published in this repository, or shaped like a
  placeholder (`dev-`, `test-`, `example-`, `sample-`, `dummy-`, `placeholder-`, `changeme`, `change-me`,
  `your-`).
- Refuses two providers holding the same value, naming both variables. One pairing is allowed:
  `RAZORPAY_WEBHOOK_SECRET` with `PAYMENT_WEBHOOK_SECRET`, because a single Razorpay endpoint signs for
  both routes.
- Refuses a `*_PREVIOUS` variable that holds a published value — that is a leaked key reopened, not one
  being retired.
- Refuses a set `LOAD_TEST_TOKEN`.

`webhooksAreAccepted` (`env.ts:304`) is computed from `isDeployedHost`, **not** from `NODE_ENV`, so the
endpoint closes even on a deployment that forgot to set the environment.

The guard's limits are worth naming too: it fires only when `NODE_ENV=production`, so a developer host with
published defaults still starts — that is deliberate, and it is why `webhooksAreAccepted` exists separately.
Git history still contains the old values; `docs/SECURITY_INCIDENT_WEBHOOKS.md` §2 handles that.

## 9. HTTP surface

`app.ts:33` helmet with `contentSecurityPolicy: false` and
`crossOriginResourcePolicy: { policy: 'cross-origin' }`. **There is no CSP**, which is the reason the
localStorage token finding matters: an XSS on the client has room to execute. CORS is an explicit allowlist
that always includes the deployed host, the demo client hosts and localhost in development (`env.ts:332`),
so a stale dashboard variable cannot lock a known client out. `x-powered-by` is off. `/api` is
`Cache-Control: no-store` (`app.ts:49`), because a staff screen that re-reads the same URL must not replay
yesterday's tables from browser cache — a stale read looks exactly like a lost order. `trust proxy` is set
to 1 so rate limits key on the real client behind the platform's proxy rather than on the proxy's address.

## 10. Static files and uploads

`/uploads` is `express.static` with `maxAge: '7d', immutable: true` and **no authentication** (`app.ts:65`).
Writing an upload requires a session and `menu:write`; reading one requires nothing but the file name, and
`immutable` means a browser that once saw it will not ask again. Today's uploads are menu photographs,
which are published to customers anyway, so the practical exposure is a dish photo somebody expected to
delete. It becomes a real leak the first time anything else is accepted there — a bill PDF, an ID from a
hiring application, a tenant's own document. The fix is a signed, short-lived URL or an authenticated
read route, and it must land **before** any non-menu file type is allowed.

`backend/uploads` (17 MB at the time of writing) is gitignored and is **not** inside `ARCHIVE_DIR`, so the
backup script does not copy it. `docs/ENVIRONMENT_VARIABLES.md` has the PowerShell that does.

## 11. Errors, logs and audit

`middleware/error.ts` maps every known failure to a code (`VALIDATION_ERROR`, `BAD_ID`, `DUPLICATE`,
`UPLOAD_ERROR`, `RATE_LIMITED`, `UNAUTHORIZED`, `FORBIDDEN`) and answers `500 INTERNAL` with a fixed
message for everything else — the stack is printed only when not in production, and never to the client.
Duplicate-key responses include `keyValue`, which can echo a searched field; that is a deliberate trade for
staff-facing forms and worth knowing.

There are **no request IDs, no structured logs and no metrics endpoint.** `morgan('combined')` is the whole
observability stack (`app.ts:41`), so a customer complaint cannot be tied to a server line. That is a
scaling problem as much as a security one: an incident with no correlation id is an incident you cannot
reconstruct.

The application's own record of who did what is the audit trail — `services/audit.service.ts`
`recordAudit`, called from 13 modules and services — written to `AuditLog` documents partitioned per day
under each restaurant folder. It is tenant-scoped by construction, and it does not record secrets or
full request bodies.

## 12. Known gaps, ordered by what they cost

| Priority | Gap | What closes it |
| --- | --- | --- |
| 1 | Swiggy/Zomato/website order-feed signing is **assumed**, not specified by the provider | get each partner's documented scheme and re-implement per provider; until then do not enable the real feeds |
| 2 | Production records live on an ephemeral filesystem and are reset by a deploy | `docs/DATABASE_MIGRATION.md` |
| 3 | Two instances destroy each other's writes | same — and no load balancer until its gates pass |
| 4 | Refresh/session tokens in localStorage, no CSP | HttpOnly refresh cookie + a real CSP |
| 5 | Ten authenticated routers unthrottled | per-user and per-tenant limits with shared state |
| 6 | `/uploads` unauthenticated and `immutable` | signed short-lived URLs, before any private file type is accepted |
| 7 | No request IDs, structured logs or metrics | pino + a request-id middleware, before multi-instance |
| 8 | Order/bill counters are process-local | database-atomic counters (`DATABASE_MIGRATION.md` §6) |
| 9 | `releaseEmptyFolders` deletes a folder the loader could not parse (`store/index.ts:138`) | remove it with the file adapter; back up first, always |
| 10 | No frontend tests, so no client-side gate can fail | a vitest baseline for `lib/api.ts` and the auth store |

## 13. Reproducing the checks

```powershell
Set-Location "D:\New folder (2)\backend"
npm run typecheck
npm test                                  # 20 files, 181 tests
npx vitest run tests/webhookHardening.test.ts
npx vitest run tests/webhookSecrets.test.ts
npx vitest run tests/rateLimitBypass.test.ts
npx vitest run tests/webhookRouteGate.test.ts
npx vitest run tests/webhooks.test.ts
```

The boot-guard tests assert the guard's *decisions* — refusing, which variable it names, and that no value
appears in the message — rather than a rendered page. The webhook tests cover valid, invalid, missing,
replayed, duplicate, concurrent-duplicate, modified-raw-body and blank/default-secret deliveries, and the
state transitions a payment may not take.
