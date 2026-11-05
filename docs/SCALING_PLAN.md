# Scaling plan

The stated goal is a restaurant SaaS that can serve 50 million users for years. This document turns that
into numbers that can be tested, and then into an order of work with gates, because the honest answer is
that the current build cannot serve **one** restaurant's second day of trading — its records are reset by
every deployment. Any plan that starts with instances and Redis instead of that fact is a plan for a system
that does not exist.

## 1. Four different numbers, and why they are not one

"Do you mean 50 million users?" No. The spec says so, and it is worth repeating, because the four are
three orders of magnitude apart and each one gets a different fix:

| Target | Meaning | Planning value | What it actually stresses |
| --- | --- | --- | --- |
| **Registered accounts** | total staff + customer accounts ever created | 50,000,000 | collection size, index size, storage cost, backup time, query selectivity |
| **Daily active users** | accounts that do something on a typical day | 4,000,000 (8% of registered) | read/write mix, session issuance, notification fan-out |
| **Concurrent users** | sessions doing something in the same second | 40,000 (1% of DAU) | socket connections, instance count, memory per connection |
| **Sustained requests/sec** | API calls across the fleet at peak | 2,000 rps average, 8,000 rps peak | rps per instance, database ops per request, cache hit rate |

The derivations, stated so they can be argued with:

- 50 M registered at a plausible 8% daily return rate is 4 M DAU. For a restaurant product, staff return
  every trading day and guests rarely, so the mix matters more than the total: **a working assumption of
  300,000 staff accounts and 49.7 M guest/customer accounts** gives a DAU dominated by staff, who are the
  write-heavy users.
- 4 M DAU spread over ~14 trading hours is ~80 requests per active user per day for staff and a handful for
  guests. In the dinner peak — one hour carrying a third of the day's traffic — that is roughly 1,100 rps
  averaged across the peak, with a 3× burst factor for a Saturday at 20:00, hence 2,000 sustained /
  8,000 peak.
- 40,000 concurrent sockets is the number that decides instance count once there is a socket adapter: at a
  target 5,000 connections per Node process, that is 8 realtime-capable instances minimum, and the number
  is a memory limit long before it is a CPU limit.
- Tenancy is the multiplier nobody counts. 50 M accounts implies hundreds of thousands of restaurants, each
  with its own orders, bills and day-close. The current build's worst case is a single tenant's history
  scanned in RAM to answer one report (`docs/ARCHITECTURE.md` A-12) — at 100,000 tenants that is not slow,
  it is impossible.

**What none of these mean:** 50 M simultaneous users. Nothing in this plan sizes for that, and a claim to
have done so would be false.

## 2. Where the build is today, measured

Not estimated — the load harness output at `load-test/load-test-report.json` from 2026-11-01, run against
`http://127.0.0.1:4000` on a laptop, single process, whole archive in RAM:

| Scenario | Concurrency | Result |
| --- | --- | --- |
| 100 parallel reads across 10 endpoints | 100 | 100 passed, avg 265.6 ms, p95 433 ms |
| 50 concurrent order writes by two waiters | 50 | 50 passed, avg 33.1 ms, max 65.9 ms |
| 100 mixed peak-hour requests | 100 | 100 passed, avg 267.7 ms, p95 499.7 ms |
| 5 waves × 20 sustained | 20 | 100 passed, avg 5.7 ms |
| 50 rapid bad logins | 50 | 50 rate-limited — the limit working, not a failure |

464 requests in 6.8 s, 50 of them throttled by design. The file's own verdict line says the system
"handles heavy concurrent load with flying colors". That verdict is **rejected**: 100 parallel requests on a
laptop with 1,049 records in RAM measures nothing about 2,000 rps, and the report's own 410/464 pass count
is the honest number to quote. `docs/LOAD_TESTING.md` has the full critique and the staged rerun.

What is safe to conclude: **write paths are fast and read paths are already the bottleneck at 100
concurrent requests** (~265 ms average on a warm laptop with a 1 MB dataset), which is exactly what an
in-memory whole-set scan predicts. The scaling problem is reads and indexes, not writes, until the storage
engine is replaced.

## 3. What has to be true before a second instance

`render.yaml:16` says `plan: free`. One instance, no persistent disk, and the platform sleeps the service
between requests — `config/env.ts:36` records that a slept instance turns a printed QR into an error page.
That is the production topology today.

Two rules follow from the audit and are not negotiable in this plan:

1. **Never run two backend instances while the whole-tree-in-RAM adapter is active.** A second process
   against the same folder silently erased five counters in a controlled test. A load balancer in front of
   two instances does not spread load; it alternates between two snapshots and each overwrites the other.
2. **Code changes alone do not give a second free instance.** Upgrading the plan is a purchase, and
   purchases are not authorized in this program. Multi-instance readiness is something this plan *proves
   possible*, then waits for the operator to buy.

The minimal honest topology for the next milestone is: one Atlas cluster (persistent, backed up), one API
instance on a paid plan with a health-check path that means something, one worker process, and object
storage for uploads. That is not a scaling architecture, it is a *durable* one, and durability comes first.

## 4. Architecture target: modular monolith plus workers

Stated preference, and it is the right one here: do not microservice this. The domain is one database with
heavy foreign-key-like coupling (order → bill → payment → day-close), a team of effectively one, and a
deployment target that sleeps. Microservices would add network partitions to a system whose real problem is
persistence.

The shape that fits:

- **One API process** — Express, the 18 routers, stateless after the migration. Anything it holds in RAM is
  a cache, never the record.
- **One or more worker processes** — the same codebase, a different entry point, started by the same
  Blueprint with a `ROLE=worker` environment variable. They own the scheduler's jobs, notification fan-out,
  day-close report generation, partner feed pulls, and any webhook follow-up work that should not run inside
  a request's latency budget.
- **Redis** for four jobs and four documented outage behaviours: cache with a read-through fallback,
  shared rate limits that degrade to per-instance counters, coordination/locks with lease expiry so a dead
  worker's lock is taken over, and the Socket.IO adapter, where a Redis outage means events stop flowing
  cross-instance and clients fall back to their polling refresh rather than showing stale state as truth.
- **MongoDB Atlas** as the only source of truth.
- **Object storage** for uploads, with signed URLs (§10 of `docs/SECURITY.md`).

Workers are separate processes, not a queue library bolted onto the API, because the scheduler today is a
`setInterval` inside the web process (`services/scheduler.service.ts:111`) with no leader election — the
first multi-instance deploy would run day-close N times. Job design rules for the worker stage: idempotent
handlers keyed by a job id, bounded retries with exponential backoff and jitter, a dead-letter collection
that records the payload and the failure reason rather than dropping it, and no job that assumes the
instance that enqueued it is the instance that runs it.

## 5. The stages, with gates

Order set by the operator and not rearranged. Nothing moves to a stage until the previous stage's exit gate
is *demonstrated*, not asserted.

### P0 — Security incident, then data protection · **code complete, closure pending the operator**

Exit gate: a consistent backup exists, is digest-verified, loads through the application's own reader, and
restores into a throwaway folder with the record count proven — **all four done**, see
`docs/STORAGE_DATA_PROTECTION.md` §4–§5. The incident's own exit gate is not met yet: it requires the four
keys rotated on the host and in each provider dashboard, which is operator-only work
(`docs/SECURITY_INCIDENT_WEBHOOKS.md` §4).

### P1 — Replace the file-backed persistence

Start `config/db.ts` on a real connection; make `defineModel` return the Mongoose model it already
registers; delete `store/` and `releaseEmptyFolders`; add `/health/live` and `/health/ready` (the latter
reporting a database ping) and request/socket timeouts, of which there are currently none —
`grep -rn "server.timeout|keepAliveTimeout" backend/src` returns nothing.

Gate: the existing 181 tests pass against a real database, unchanged, **and** a second process pointed at
the same database sees the first's writes.

### P2 — Migrate and verify the records

The script, the idempotency, the rejects report and the eight verification checks in
`docs/DATABASE_MIGRATION.md` §8.

Gate: every check passes; a rehearsal on a copy proves the rollback path; no `--apply` against anything
real without operator approval.

### P3 — Business correctness

Database-atomic counters behind a unique index, idempotency keys on order creation and payment
settlement, and the concurrency tests run **multi-process**, not just multi-promise.

Gate: two spawned processes racing one counter key produce no duplicate number; a replayed webhook
delivery cannot settle a bill twice under that race; invalid order state transitions are refused from both
paths.

### P4 — Tenant isolation and authorization

Convert the `restaurantId` convention into indexes that make an unscoped query visibly wrong, per-tenant
query auditing, and the five cross-tenant tests extended to every router that reads by id alone.

Gate: a cross-tenant read attempt is refused on all 18 routers, and RBAC's 26 permissions are each asserted
allow-and-deny somewhere.

### P5 — Distributed infrastructure

Redis (cache, shared rate limits, coordination, Socket.IO adapter), workers split out, job queues with
retry/backoff/dead-letter, and documented behaviour when Redis is down.

Gate: **with ≥2 instances**, a socket event raised on one reaches a client connected to another; a
rate-limit burst is shared, not per-instance; killing a worker mid-job does not lose the job or run it
twice; a Redis outage degrades instead of erroring.

### P6 — Multi-instance deployment and capacity testing

Paid plan, load balancer, autoscaling policy, staged load runs at 10/50/100/500/1000 concurrent against
the deployed topology, with honest metrics and a written read-out.

Gate: p95 latency and error rate at 1,000 concurrent are recorded, not extrapolated; the run is repeated
after a forced instance restart and the data survives it.

## 6. What each stage costs, and who approves it

P1 and P2 need an Atlas cluster. P5 needs a Redis instance. P6 needs at least two paid API instances and
object storage. Every one of those is a purchase, purchases are not authorized in this program, and
`plan: free` in `render.yaml` will not be upgraded by an agent. Each stage that needs money ends with a
written recommendation — instance class, monthly cost, what breaks if it is the cheaper option — and stops.

## 7. What this plan deliberately does not claim

- It does not claim 50 M users are supported. It claims a path that does not have to be re-architected
  before the first 10,000.
- It does not claim the current deployment is safe for a paying restaurant. It is not: A-01 resets its
  records at every deploy.
- It does not claim gapless order numbering. An atomic counter guarantees uniqueness, not continuity — a
  failed insert after an increment burns a number, and that trade is the correct one (§6 of
  `docs/DATABASE_MIGRATION.md`).
- It does not claim the load numbers above came from production-shaped infrastructure. They came from a
  laptop.
