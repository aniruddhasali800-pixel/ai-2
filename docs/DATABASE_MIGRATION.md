# MongoDB migration plan

Status: **planned and specified, not implemented, and blocked on two things only the operator can supply** —
an Atlas connection string and approval to create a cluster. Nothing in this document has been run against
a database. The reason it is written before the code is that the current storage layer is the one finding
in `docs/ARCHITECTURE.md` that makes every other scaling statement false, so the migration is the gate the
rest of the program waits behind.

## 1. What is being replaced and what is being kept

Today `mongoose` is a dependency used only to *declare* shape. `backend/src/store/index.ts:51`
`defineModel(name, schema)` does two things:

```ts
const real = (mongoose.models[name] ?? mongoose.model(name, schema)) as mongoose.Model<unknown>;
const descriptor = new Descriptor(schema);
const collection = new Collection(real, descriptor, layout, …);
return collection as unknown as FileModel<T>;
```

It registers a **real Mongoose model** — and then returns its own file-backed `Collection` instead of it.
Every schema in `backend/src/models/` is therefore already a valid Mongoose schema, validated at import
time, and the driver is the only thing missing. That is the cheapest migration there is, and it should be
done that way: give the registered models a connection and stop returning the stand-in.

Keep: the 20 schemas, `requireAuth`'s habit of re-reading the account, the IST partition rule (as a stored
field, not a folder name), the service layer, the routers, the webhook ledger.

Replace: `backend/src/store/` entirely — `collection.ts`, `io.ts`, `index.ts`, `pipeline.ts`, `descriptor.ts`,
`layout.ts` — plus `config/db.ts`, which currently loads a folder into RAM rather than connecting.

Delete with it: `releaseEmptyFolders` (`store/index.ts:138`), the boot path that removes any restaurant
folder holding no recognised records. It has no meaning once records are documents, and it is destructive.

## 2. The surface the code actually uses

Measured across `backend/src` so the compatibility work is bounded rather than guessed:

| Model method | Call sites | File store implements it? |
| --- | --- | --- |
| `findOne` | 90 | yes |
| `find` | 73 | yes |
| `findById` | 53 | yes |
| `create` | 33 | yes |
| `countDocuments` | 28 | yes |
| `aggregate` | 20 | yes, via `pipeline.ts` |
| `findOneAndUpdate` | 15 | yes |
| `updateOne` / `updateMany` | 9 / 8 | yes |
| `insertMany` | 8 | yes |
| `findByIdAndUpdate` | 7 | yes |
| `deleteOne` | 3 | yes |
| `findOneAndDelete` | 1 | yes |
| `estimatedDocumentCount` | 1 | yes |
| `distinct` / `bulkWrite` | 1 each | yes |

Chainable query methods: `lean` (205), `select` (61), `sort` (51), `limit` (17), `skip` (8), `exec` (1).
**`populate` is never used** — joins are done with `$lookup` inside aggregations, which `pipeline.ts`
emulates by name (`store/index.ts:70`). All of the above is native Mongoose, so no call site needs
rewriting. 352 call sites in total.

The three places real Mongoose will behave differently, each of which needs a test rather than an opinion:

1. **`_id` becomes an `ObjectId`.** The file store keyed documents with `String(_id)`
   (`collection.ts:202`), and code like `String(user.restaurantId)` is everywhere. Mongoose casts a
   24-character hex string on `findById` and in filters, so most of it survives, but a hand-written
   filter on `{ _id: someString }` inside an aggregation `$match` will **not** be cast. Every `$lookup`
   and `$match` on an id has to be checked against a real driver.
2. **Schema validation becomes strict again.** The store ran its own validators through the registered
   model; a real driver rejects a document Mongoose cannot cast, and `strict: 'throw'` differences will
   surface as 500s on paths that "worked" on files.
3. **`estimatedDocumentCount` is no longer a length.** `server.ts:29` uses it to decide whether to seed,
   and on a fresh-but-warm Atlas collection it can return a stale estimate. Use `countDocuments({})` for
   the seed decision.

## 3. Target

A persistent MongoDB, not an embedded one and not a file folder:

- **Atlas M10 or larger for production**, on a replica set. Multi-document transactions are what make
  order placement correct across instances, and a replica set is what guarantees them; confirm the
  transaction support of whatever plan is chosen before relying on it, and do not pick a tier by price
  alone.
- **A separate Atlas project or a separate database for staging**, so a load run cannot write into
  production data. This is not optional housekeeping: the existing load harness signs in as real seeded
  accounts and places real orders.
- **M0/free tier is for the migration rehearsal only**, never for the records of a restaurant that trades.

Credentials are operator-supplied and never committed. `MONGO_URI` (or `DATABASE_URL`) joins the boot
guard: a production process must refuse to start without it, the same way it refuses a published webhook
secret (`env.ts:215`). Nothing in `env.ts` has any Mongo connection string today — verified by grep.

## 4. Index design

Twenty collections, five global, fifteen per restaurant. Nearly every filter starts with `restaurantId`,
and the read-heavy paths are date-ranged, so the rule is: an index per query shape, tenant first, then the
narrowing field, then the sort.

| Collection | Indexes |
| --- | --- |
| `restaurants` | `_id` implicit; `slug` unique |
| `users` | `{ restaurantId: 1, phone: 1 }` unique; `{ restaurantId: 1, role: 1, status: 1 }` |
| `counters` | `{ key: 1 }` unique — the one index the order-number race depends on (§6) |
| `orders` | `{ restaurantId: 1, placedAt: -1 }`; `{ restaurantId: 1, status: 1 }`; `{ publicToken: 1 }` unique; `{ restaurantId: 1, orderNumber: 1, day: 1 }` unique |
| `bills` | `{ restaurantId: 1, createdAt: -1 }`; `{ restaurantId: 1, status: 1 }`; `{ number: 1 }` unique per tenant |
| `payments` | `{ restaurantId: 1, createdAt: -1 }`; `{ providerOrderId: 1 }` unique; `{ eventId: 1 }` sparse unique |
| `webhookevents` | `{ provider: 1, eventId: 1 }` unique; `{ createdAt: 1 }` with `expireAfterSeconds` for retention |
| `tablesessions` | `{ publicToken: 1 }` unique; `{ restaurantId: 1, status: 1, createdAt: -1 }` |
| `bookings` | `{ restaurantId: 1, startAt: 1 }`; `{ restaurantId: 1, tableId: 1, startAt: 1 }` |
| `products` / `categories` / `addons` | `{ restaurantId: 1, isActive: 1, sortOrder: 1 }` |
| `notifications` | `{ restaurantId: 1, readAt: 1, createdAt: -1 }`; TTL on read older than 30 days |
| `auditlogs` | `{ restaurantId: 1, createdAt: -1 }`; TTL by retention policy |
| `inventoryitems` / `inventorytransactions` | `{ restaurantId: 1, item: 1, createdAt: -1 }` |
| `customerrequests` | `{ restaurantId: 1, status: 1, createdAt: -1 }` |
| `loginCodes` | TTL index on `expiresAt` — these are single-use and must not accumulate |
| `staffapplications` | `{ restaurantId: 1, status: 1, createdAt: -1 }` |

Two of these are not performance indexes. `counters.{key:1}` unique and
`webhookevents.{provider:1,eventId:1}` unique are **correctness** indexes: they are what make an atomic
counter and a duplicate webhook impossible rather than merely unlikely, and the migration has to create
them before any traffic arrives, not after.

Every index is declared in the schema and created on boot with `autoIndex` off in production, so a missing
index is a deploy-time fact rather than a slow query discovered by a customer.

## 5. The data itself

The archive on this laptop holds **1,049 records across 172 files** (measured 2026-11-03; the breakdown is
in `docs/STORAGE_DATA_PROTECTION.md`), and they are not one tenant's data:

| Folder | Records | What it is |
| --- | --- | --- |
| `Saffron & Smoke/` | 946 | the seeded demo tenant and its order history |
| `XSDDSF/` | 32 | a tenant that onboarded itself |
| `food/` | 27 | a tenant that onboarded itself |
| `bgj/` | 17 | a tenant that onboarded itself |
| `_index/` | 27 | 4 `restaurants`, 19 `counters`, 4 `login-codes` |

`staff-applications` and `webhook-events` have no file at all yet, so the idempotency ledger this
migration must carry over is currently empty on this machine. Production on Render holds only what the
seed put there at the last deploy, which is not a subset of this archive and is not the same data.

That is the first thing the migration has to say honestly: **there is no single "current data" to migrate.**
There is the development archive, and there is whatever a given deployment seeded. A migration plan that
does not name which one it means will move the wrong records.

Migration input is the JSON-lines tree exactly as it stands, plus two things that are not in it:

- **Restaurant folder names are not records.** `layout.ts:49` `slugFor()` turned a name into a directory.
  The mapping back to a `restaurantId` already exists — `store/index.ts` keeps `idsByFolder` — and the
  migration must read that mapping from the `_index/restaurants.jsonl` records rather than re-deriving a
  slug, because two restaurants can normalise to the same folder name (that is why the "appears in two
  folders" warning exists, `store/index.ts:43`).
- **14 abandoned `.tmp` files.** These are in-flight writes that were never renamed. The migration script
  must skip them the way the backup does (`scripts/archive.ts`), and report how many it skipped rather
  than silently dropping them.

Records that cannot be migrated and must be reported instead:

| Case | Why | What the script does |
| --- | --- | --- |
| Malformed lines | `io.ts:81` skipped them at load, so they are on disk but were never in memory | Count per file, write to a `migration-rejects/` report, do not guess |
| `_unassigned` folder | Documents whose `restaurantId` had no restaurant yet (`layout.ts:75`) | Refuse unless `--allow-unassigned`, because an ownerless record in a shared database is a tenant leak |
| Day-close `.json` / `.csv` | Generated artefacts, reproducible from the records | Do not migrate; regenerate after the switch |
| `logincodes` | Single-use, time-boxed | Do not migrate — a live code in a new database is still a live code |
| `webhookevents` | Migrate **all** of them, deliberately | These are the idempotency ledger; dropping them re-permits a replayed event to settle a bill twice |

## 6. Order and bill numbering

`nextSeq` (`backend/src/models/Counter.ts:15`) guards a module-level promise chain and then does a
`findOneAndUpdate` with `$inc` and `upsert`. Inside one process that is genuinely atomic. Across two
processes on the file store each one holds its own counter in its own RAM, which is how A-02 happens.

On MongoDB the same call becomes database-atomic provided the unique index on `counters.key` exists, so the
migration is: create the index, keep the call, and then prove it with a **multi-process** test rather than
a multi-promise one. The existing suite is single-process; the new test has to spawn two Node processes
that both call `nextSeq` on the same key and assert the union of returned values is a gapless-looking set
with no duplicates.

One promise not to make: **order numbers will not be gapless.** A `$inc` counter is atomic, but an order
that increments the counter and then fails validation burns the number. That is the correct trade — no
duplicate number, sometimes a skipped one — and it should be written in the docs before a restaurant owner
reads a missing number as a lost order.

## 7. The migration script

`backend/src/scripts/migrate-archive-to-mongo.ts`, new, run through `npm run migrate:to-mongo`. Written to
these requirements, because a migration that can be run twice is the only kind worth trusting:

1. **Dry run by default.** `--apply` is what writes. Without it the script prints per-collection counts,
   rejects, and the id mapping it *would* insert, and touches nothing.
2. **Read-only against the archive.** `open` for reading, never a rename, never `releaseEmptyFolders`, and
   it refuses to run if the archive is also mounted by a live server — checked by a lock file the store
   writes, because A-02 says two writers destroy data.
3. **Idempotent and resumable.** A progress file records `(collection, last _id migrated)`. Re-running
   skips documents already present by `_id` — the ids are preserved from the JSON lines, so
   `insertMany(..., { ordered: false })` plus a duplicate-key catch is enough. A crash mid-collection
   resumes where it stopped rather than starting over.
4. **Preserves `_id`, `createdAt` and `updatedAt` exactly.** Timestamps are the partition key of every
   report; a migrated order that lands on a new date changes a past day-close.
5. **Never deletes.** It inserts into an empty target. If the target collection is non-empty, it stops and
   says so, because the only safe assumption about a database that already has records is that somebody
   put them there.
6. **Creates indexes after the data**, with `background: true` semantics, then verifies each index exists.
7. **Emits a machine-readable report** at `.data/backups/<timestamp>-migration.json`: per collection
   source count, inserted count, skipped-duplicate count, rejects with reasons, elapsed time. No secret
   values, no document bodies.

```powershell
Set-Location "D:\New folder (2)\backend"
$env:MONGO_URI = Read-Host "Atlas connection string"   # typed, never pasted from a file into a commit
npm run migrate:to-mongo                               # dry run: counts and rejects only
npm run migrate:to-mongo -- --apply                    # writes into an empty target
npm run migrate:to-mongo -- --verify                   # compares both sides, exits 1 on any mismatch
```

## 8. Verification, which is the deliverable

Counting rows is not verification. These are the checks that have to pass, per collection, before anything
is called migrated:

| Check | How it fails |
| --- | --- |
| `countDocuments` equal on both sides, rejects accounted for separately | a line silently dropped |
| Sum of `totalAmount` across every `bill` equal on both sides | a number field lost its precision through JSON |
| Every `order`'s `restaurantId` resolves to an existing `restaurant` | a tenant's history attached to nobody |
| Order numbers unique per `(restaurantId, day)` | the counter and the data disagree |
| Every `payment` still references its `providerOrderId` uniquely | a webhook could now match two payments |
| The full webhook ledger present with its unique index | a replayed event would settle a bill again |
| `nextSeq` for every existing key returns strictly above the highest number in the data | the next order collides with a past one |
| All 181 existing tests pass against the real database, unchanged | the adapter was doing something the tests relied on |
| A second server process started against the same database sees the first's writes | the whole point |

The last two are the ones that decide whether the multi-instance ban lifts. The existing suite runs with
`NODE_ENV=test` against a scratch archive; it has to be pointed at a scratch database with the same
assertions, and a test that was weakened to pass is worse than no test.

## 9. Cutover

1. Announce a write freeze. The product has a natural window — after day-close, before the first booking —
   and the scheduler must be stopped during the freeze (`scheduler.service.ts:111`), or it will write
   reminders into whichever store it is holding.
2. Take a final `npm run archive:backup` and record its path and timestamp. The archive stays on disk
   afterwards, unchanged, for at least the length of the rollback window.
3. Migrate with `--apply`, then `--verify`. Stop here on any mismatch.
4. Deploy the build that connects to Atlas, with `MONGO_URI` set and `AUTO_SEED=false`. **`AUTO_SEED=false`
   is not a detail** — with the default left on, a database that failed to migrate looks like an empty one,
   and the seed will happily add a demo tenant to it (`server.ts:27`).
5. Prove the five things in §8's last rows, on the deployed instance, before traffic.
6. Only then is a second instance discussable, and only after `docs/SCALING_PLAN.md`'s P4 gate.

Rollback is in `docs/ROLLBACK.md` and is short because the archive is never deleted: point the service back
at a build that uses the file store, with the folder it came from still on disk. Any write made during the
live window exists only in MongoDB, so rollback after traffic costs those writes — which is the reason the
freeze and the verification come before the switch rather than after it.

## 10. What is blocked, and on whom

| Item | Blocker |
| --- | --- |
| Creating the Atlas cluster and choosing a plan | **requires operator approval** — it is a paid resource and a purchase is not authorized here |
| The connection string and its credentials | **requires the operator** — must not appear in a commit, a log, or this repository |
| Running `--apply` against any target | **requires approval** — it is the first irreversible step of the migration |
| Deploying the connecting build | **requires approval** — a production deployment is not authorized here |
| Writing `config/db.ts` against a real connection, the index declarations, `nextSeq` tests, the script | **can be done now**, and must be tested against a local `mongod` before any of the above |

The honest status of §1–§9 as of this writing: **specified, not implemented.** No migration code exists
yet, no Atlas database has been reached, and no record has been moved.
