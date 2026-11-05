# Architecture audit

This is the audit that had to happen before any scaling change. Every statement here was checked against
the files on this machine on 2026-11-03, not against what an earlier pass assumed. Where the previous
understanding of this repository was wrong, the correction is written down.

Two claims that had to be retired first:

- **There is no MongoDB in this build.** `mongoose` is a dependency and every model is declared with a
  Mongoose `Schema`, but `grep -rn "mongoose.connect" backend/src` returns nothing and there is no
  `MONGO_URI` in `backend/src/config/env.ts`. `backend/src/config/db.ts` does not open a database
  connection; it loads a folder of JSON-lines files into memory. Calling this "the Mongo store" in an
  earlier note was wrong, and planning a replica set around it would have been worse.
- **The live Render service does not keep its records between deployments.** The free instance has no
  attached disk, so on each deploy the archive folder starts empty and `backend/src/server.ts:29` seeds
  the demo tenant into it again. The 1,049 records measured in `docs/STORAGE_DATA_PROTECTION.md` are the
  records on this laptop, not the records in production.

## 1. What the repository contains

| Package | Path | What it is | Measured size |
| --- | --- | --- | --- |
| API | `backend/` | Express 4 + TypeScript, 97 `.ts` files, 14,711 lines | 20 test files, 181 tests, all passing |
| Client | `frontend/` | Vite + React 19 + Zustand SPA, 70 `.ts`/`.tsx` files, 12 page modules | **no test script at all** |
| Bill service | `bill/` | Separate Next.js + Prisma app with its own SQLite file | single-tenant, see §5 |
| Load harness | `load-test/load-test.js` | 711-line Node script, 8 named scenarios | last run against `127.0.0.1:4000` |
| Launcher | `tools/sizzle-launcher/` | Windows wrapper and its installer scripts | untracked |
| Scratch | `python_solution/`, `New folder` | Loose directories with no reference from either app | untracked |

Also untracked and worth naming before somebody ships it by accident: `Sizzle-Operations-OS.exe` at the
repository root **and** a second copy inside `frontend/public/`, plus three copies of `install.ps1`. A
`.exe` under `frontend/public/` is served to any browser that asks for it.

## 2. The request path, end to end

```
browser
  └─ https://smart.restaurant.aniruddhasali.in          (static client, Render)
       ├─ /api/*  ── proxied same-origin
       │    └─ Express app  backend/src/app.ts:29
       │         ├─ helmet, CORS allowlist, morgan        (app.ts:33-43)
       │         ├─ Cache-Control: no-store on /api       (app.ts:49)
       │         ├─ raw body parser for webhooks          (app.ts:57-58)  ← before express.json
       │         ├─ express.json({ limit: '2mb' })        (app.ts:60)
       │         ├─ /uploads  unauthenticated static      (app.ts:65-77)
       │         └─ /api      apiRouter                    (backend/src/routes.ts:36-54)
       │              └─ router → middleware/auth.ts → rbac.ts → service → *Model → store adapter
       └─ /socket.io ── same origin, default in-memory adapter (backend/src/realtime/socket.ts:25)
```

The one thing to notice about this path is where the data actually lands: `*Model` calls look like
Mongoose and are not. `backend/src/store/index.ts:51` `defineModel(name, schema)` returns an object with
Mongoose's method names, backed by `backend/src/store/collection.ts`, which reads and writes a `Map` of
records held in the process and re-emits whole files on each write.

**Does every feature use the adapter, or does some reach Mongoose directly?** Every model in
`backend/src/models/index.ts` is created by `defineModel`, and there is no second path to a database, so
the answer is the adapter, uniformly. That cuts both ways: there is no hidden ORM that could be repointed
at Atlas, and there is no query that could be pushed down to a database engine. Filters, sorts and the
aggregation pipeline in `store/pipeline.ts` are all evaluated in Node over the whole in-memory tree.

### The realtime path

`initSocket` (`backend/src/realtime/socket.ts:25`) accepts a JWT in the handshake auth payload or no token
at all. A staff socket joins `restaurant:<rid>` plus one role room; a guest joins `session:<token>` only
after the token is looked up in `TableSessionModel` (`socket.ts:66`). Rooms are therefore tenant-scoped by
construction and the guest room is scoped by a capability it cannot guess. What is missing is not
authorization but reach: with the default adapter, an emit only lands on sockets attached to this process.

### The webhook path

Two routers are mounted ahead of the JSON parser so the bytes that were signed are the bytes that are
verified: `/api/payments/webhook` (`backend/src/modules/payments/webhook.routes.ts`) and
`/api/integrations/webhook` (`backend/src/modules/integrations/integrations.routes.ts:183`). Both apply
`webhookLimiter` (120/minute) and both answer `503` on a deployed host until every published default has
been replaced. Handling is idempotent through a persistent `(provider, eventId)` ledger in
`backend/src/models/WebhookEvent.ts`, claimed before the business action and released if the action throws.
The full account, including which parts of it are assumed rather than specified by the provider, is
`docs/SECURITY_INCIDENT_WEBHOOKS.md`.

## 3. The storage layer as it actually behaves

Measured in detail in `docs/STORAGE_DATA_PROTECTION.md`; the consequences for scaling are:

1. The whole tree is loaded at boot and lives in RAM. Startup time and memory both grow with the archive,
   and the first deploy after any data exists pays that cost in full.
2. Writes are serialised **per file, per process**. There is no cross-file atomicity: an order touches
   `orders`, `counters`, sometimes `bills` and `notifications`, each rewritten on its own.
3. There is no `fsync`, so a host that loses power can lose the newest write without an error.
4. **Two processes against one archive directory destroy records.** This was demonstrated rather than
   reasoned about: a second process holding an older snapshot rewrote a whole file and erased five
   counters that the first process had created. See the transcript in
   `docs/STORAGE_DATA_PROTECTION.md` §2.
5. `releaseEmptyFolders` (`backend/src/store/index.ts:138`) deletes a restaurant folder that the loader
   could not read any recognised records from, on every startup.

Point 4 is the reason the standing rule in this plan is "never run two backend instances while this
adapter is active". It is not a performance concern. A load balancer in front of two instances does not
spread load, it alternates between two snapshots and each one overwrites the other's work.

## 4. Data model and tenancy

Twenty collections are declared in `backend/src/store/layout.ts`; eighteen hold records today.

| Scope | Collections |
| --- | --- |
| Global (`_index/`) | `Restaurant`, `Counter`, `StaffApplication`, `LoginCode`, `WebhookEvent` |
| Per restaurant | `User`, `Category`, `Product`, `Addon`, `Table`, `TableSession`, `Order`, `Bill`, `Payment`, `Booking`, `CustomerRequest`, `InventoryItem`, `InventoryTransaction`, `Notification`, `AuditLog` |

Day-partitioned files (`Order` by `placedAt`, `Bill`, `Payment`, `Booking`, `TableSession`,
`CustomerRequest`, `InventoryTransaction`, `Notification`, `AuditLog`, `WebhookEvent`) are split by
**Asia/Kolkata wall-clock date**, not UTC (`layout.ts:62`), so a 23:30 IST bill does not land in yesterday's
file. Any migration that recomputes partition names has to reproduce that choice or the day-close reports
move under it.

Tenancy is enforced by convention rather than by a single scoped-query layer: each query repeats
`restaurantId: auth.restaurantId` in its filter (`order.service.ts` 41 occurrences, `billing.service.ts`
60, `booking.service.ts` 19), and nothing stops a future query from filtering on `_id` alone. The file
layout separates tenants physically, but the in-memory tree does not. This is covered by five
cross-tenant tests — `tests/orders.test.ts:71`, `tests/bookings.test.ts:129`,
`tests/customerApp.test.ts:181`, `tests/pipeline.test.ts:230`, `tests/webhookHardening.test.ts:158` —
which is the right instinct, but a convention checked by tests is weaker than a convention the code cannot
break.

`requireAuth` (`backend/src/middleware/auth.ts:21`) verifies the JWT and then re-reads the account from the
store, taking `restaurantId` and `role` from the record rather than the token. A suspended account or a
moved staff member stops working on the next request even with an unexpired token, which is the behaviour
most systems get wrong. Keep this in the migration.

## 5. The second service, and why it does not scale with the first

`bill/` is a Next.js app with its own Prisma schema and its own SQLite file (`bill/dev.db`). It holds the
payee UPI handle, the verification queue and the income figures, and Sizzle talks to it over HMAC-signed
requests (`BILL_SERVICE_BASE_URL`, `BILL_SERVICE_SHARED_SECRET`).

`bill/prisma/schema.prisma` has **no `restaurantId` on any model**. It is a single-tenant service. Two
restaurants pointed at one deployment of it would share a payee handle and a ledger. Anything that claims
this pair scales multi-tenant has to solve that first, and it is a schema change plus a migration, not a
config change.

## 6. Finding register

Severity is what it costs if nothing changes. Status is honest: `OPEN` means the code still does this.

| ID | Severity | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| A-01 | **Critical** | Records live on an ephemeral instance filesystem; a deploy resets production to the demo tenant | `backend/src/server.ts:27-31`, Render free plan has no disk | OPEN — blocks everything |
| A-02 | **Critical** | Two processes on one archive silently erase each other's writes | demonstrated, `docs/STORAGE_DATA_PROTECTION.md` §2 | OPEN — two instances are forbidden |
| A-03 | **Critical** | Webhook signing keys were published in the repository | `docs/SECURITY_INCIDENT_WEBHOOKS.md` | code controls CLOSED, rotation REQUIRES EXTERNAL ACTION |
| A-04 | High | No liveness/readiness split. `/api/health` (`routes.ts:25`) answers from the in-memory tree, reports no dependencies, and is the only probe available; there is no `/health/live` or `/health/ready` | verified by grep across `backend/src` | OPEN |
| A-05 | High | The scheduler runs on a plain `setInterval` with no leader election (`services/scheduler.service.ts:111`), so N instances would run day-close, booking reminders and table reservation N times | read of the file | OPEN |
| A-06 | High | No Socket.IO adapter, so emits reach one instance only (`realtime/socket.ts:25`) | no `adapter` option is passed | OPEN |
| A-07 | High | The load harness bypassed the sign-in rate limit with a header anyone could type | `middleware/rateLimit.ts:17` now requires `LOAD_TEST_TOKEN` | CLOSED, `tests/rateLimitBypass.test.ts` |
| A-08 | High | Ten of the authenticated routers apply no limit at all: `billing`, `bookings`, `kitchen`, `menu`, `orders`, `reports`, `restaurants`, `staff`, `tables`, `uploads`. Limits exist only on `auth` (login), `public`, and the two webhook routers | `grep -c 'rateLimit\|Limiter'` returns 0 for each of the ten | OPEN |
| A-09 | High | `/uploads` is unauthenticated static with `maxAge: '7d', immutable: true` (`app.ts:65`). Any file whose name is known is readable forever, and a stale immutable header survives a tenant change | read of `app.ts` | OPEN |
| A-10 | Medium | No request IDs, no structured logs, no metrics endpoint. `morgan('combined')` is the only logging, and nothing correlates a client complaint to a server line | `app.ts:41`, no pino/opentelemetry in `package.json` | OPEN |
| A-11 | Medium | No compression middleware anywhere | `backend/package.json` dependency list | OPEN |
| A-12 | Medium | Offset pagination exists and is used properly on seven list paths (`orders`, `billing`, `bookings`, `payments`, `inventory`, `notifications`, `audit`, via `.skip().limit()` at `order.service.ts:409`, `billing.service.ts:391`, `booking.service.ts:180`), but under this adapter it is not free: `store/collection.ts` filters and sorts the whole in-memory record set for the file and then discards all but the page, so page 1 and page 40 cost the same and both cost the tenant's entire history. Report aggregations read a whole date range with no bound on record count | read of `collection.ts` and the routers above | OPEN — resolved by pushing filter/sort/limit into database indexes |
| A-13 | Medium | The frontend has no tests, so every "verified in the browser" claim about the client is unverifiable by a gate | no `test` script in `frontend/package.json` | OPEN |
| A-14 | Medium | Order and bill numbers are unique per process only. `nextSeq` (`models/Counter.ts:15`) chains on a module-level promise, which is a real mutex inside one process and nothing outside it | read of `Counter.ts` | OPEN — needs a database-atomic counter |
| A-15 | Medium | No indexes of any kind. Every find is a scan of the in-memory records for that file | `store/collection.ts` | OPEN — resolves with the migration |
| A-16 | Low | 333 MB of unused `.data/mongo` and 327 MB of `.data/mongo-test` sit in the tree, left over from the embedded database that no longer exists | `docs/STORAGE_DATA_PROTECTION.md` §2 | left in place, deliberately |
| A-17 | Low | A Windows executable is committed-adjacent in `frontend/public/`, which is the served directory | untracked artifacts listed in §1 | OPEN |
| A-18 | Low | The malformed-line loader skips bad records silently (`store/io.ts:81`), so a corrupted file loses records without a word. Backup manifests now count them into `__malformed_*` buckets | `scripts/archive.ts` | PARTIAL — visible only in a backup |

## 7. What this means for the plan

The audit does not produce a list of improvements to interleave with feature work. It produces one
blocking fact: **A-01 and A-02 together mean this system cannot grow by adding instances, restarts, or a
load balancer, and cannot survive its own deployment process.** Everything else in the register is either
made irrelevant or made possible by fixing those two.

So the order is forced, and it matches the order set for this program: protect the data that exists,
replace the file-backed persistence, migrate and verify every record, then make the business-critical
counters and payments atomic, then tenancy and authorization, then the distributed pieces (Redis, socket
adapter, workers), then multi-instance deployment and capacity testing. The staged plan with its gate
criteria is `docs/SCALING_PLAN.md`; the migration itself is `docs/DATABASE_MIGRATION.md`.

One thing the plan cannot deliver, and should not pretend to: the current Render free plan supports one
instance and no disk. No amount of code change makes a second free instance possible, and a capacity
number measured on a laptop with the archive in RAM is not a production number. `docs/LOAD_TESTING.md`
records what the existing harness proved and what it did not.
