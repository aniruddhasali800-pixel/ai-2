# Load testing

This records what the existing harness actually proved, what it could not prove, and the staged runs the
scaling plan needs. The important part is the first section: the repository contains a report whose own
verdict line says the system "handles heavy concurrent load with flying colors", and that claim is not
supported by what was run.

## 1. What the existing report proves, and what it does not

`load-test/load-test-report.json` and the rendered `load-test/report.html` were produced on **2026-11-01**
against `http://127.0.0.1:4000` — a local `tsx watch` dev server on the operator's laptop, one process, the
whole archive in RAM, 464 requests in 6.8 s.

| | Value | Why it matters |
| --- | --- | --- |
| Target | `127.0.0.1:4000` | not the deployed service, not a paid instance, no network hop, no proxy |
| Data | 1,049 records, ~1 MB | a real tenant's year of orders is orders of magnitude larger, and this store scans the whole set in RAM |
| Max concurrency | 100 parallel requests | the plan asks for 1,000; 500 and 1,000 were never run |
| Duration | 6.8 s total | a burst, not sustained load; nothing about memory growth or GC was observable |
| `totalFailed` | 50 | all 50 are the deliberate rate-limit probe, and are counted as failures in one field and as the intended protection in another |
| Verdict | "✅ PASS — flying colors" | an over-claim. The run measured a laptop. |

What it does legitimately show, and it is worth having:

- **Reads are already the bottleneck at 100 concurrent**: 100 parallel reads across 10 endpoints averaged
  265.6 ms with p95 at 433 ms, and the mixed peak-hour run averaged 267.7 ms with p95 499.7 ms. Writes were
  far faster (50 concurrent orders: avg 33.1 ms, max 65.9 ms). That asymmetry is exactly what an
  in-memory whole-set scan for reads predicts, and it is the strongest evidence in this audit that the
  scaling problem is indexes and read paths, not write throughput.
- **The rate limiter works.** 50 rapid bad logins produced 50 × `429` in 17.6 ms average — the limiter
  rejected them cheaply, before they reached bcrypt or the store. That is the correct behaviour and the only
  "failure" count in the file.
- **Sustained light load is fine**: 5 waves of 20 requests, avg 5.7 ms. This says nothing about 2,000 rps.

Conclusion: the harness is a useful smoke instrument. It is not a capacity test, and no number in its
report may be quoted as a production figure.

## 2. Two things that make the harness unrunnable against a deployed host today

These are blockers to fix **before** a staged run, not during one:

1. **It signs in with an OTP and reads the code out of the response.** `load-test.js:133` uses
   `otpReq.data?.demoCode`. A host that declares itself public refuses to return one-time codes in the
   response (`config/env.ts:17` `isDeployedHost`), so against any real deployment every login returns no
   code, no token, and the whole suite silently degrades to unauthenticated requests. The harness needs an
   explicit staging credential path — a password login against a staging tenant, or a test-only token
   endpoint that exists only when `LOAD_TEST_TOKEN` is configured.
2. **It writes real records.** It places 50 orders, raises customer requests and reads billing, using
   hardcoded seeded staff phones (`+91 98200 11005`, `11006`, `11003`, `11004`). Run against a host with
   real data, a load test is a data-corruption exercise. It must point at a disposable staging instance with
   its own database.

Both are why `LOAD_TEST_TOKEN` now exists and why it is refused on a production boot (`env.ts:231`). Before
this session's change, the harness bypassed the sign-in limits with a header anyone could type —
`x-load-test-auth: 1` — which meant the rate-limit result in the report was measuring a bypassed limiter
for the login paths that carried the header, while the `loginRateLimit` scenario itself sent 50 requests
*without* the header to show the limit working. Any load figure taken from a run that skips the throttling
under test is not a load figure.

## 3. Prerequisites for a run that means something

| Requirement | Status |
| --- | --- |
| A staging instance, separate database, separate Redis | **missing** — needs a paid plan, which is an operator decision |
| `LOAD_TEST_TOKEN` set on staging, never on production | implemented; unset everywhere today |
| A staging tenant with known logins that the harness does not have to guess | **missing** — `DEMO_STAFF_PASSWORD` is unset by default, so the seeded floor has no logins |
| The dataset sized to what a real tenant accumulates, not 1,049 records | **missing** — needs a data generator: ~50,000 orders across 18 months for one tenant, and 50 tenants of varying size |
| `NODE_ENV` and health path correct on the target | partially: the live service answers `"env": "development"` (`DEPLOYMENT.md` §6) |
| Server timeouts configured, so a slow request fails rather than hangs | **missing** — no `server.timeout`, `keepAliveTimeout` or `headersTimeout` anywhere in `backend/src` |
| `/health/ready` reporting a dependency check, so a run can tell "slow" from "broken" | **missing** — only `/api/health` (`routes.ts:25`) |
| Request IDs, so a 500 in the report can be found in the log | **missing** |

The honest statement: **a capacity test at 500 and 1,000 concurrent is not possible today**, on this
topology, with this data. Running it would produce a number that means nothing, which is worse than no
number.

## 4. The staged runs

Concurrency is measured in **virtual users doing something at the same time**, not requests. Each stage runs
the same scenario mix, holds for 10 minutes, and reports the same metric set. A stage does not advance
until the previous one's read-out is written down.

| Stage | Concurrent users | Target throughput | Pass condition |
| --- | --- | --- | --- |
| 1 | 10 | ~15 rps | baseline; the current harness's own smoke level |
| 2 | 50 | ~75 rps | p95 under 400 ms, zero 5xx |
| 3 | 100 | ~150 rps | p95 under 600 ms, no memory growth across the 10 minutes |
| 4 | 500 | ~750 rps | p95 under 1.2 s, error rate under 0.1 %, no rate-limit leakage into real users |
| 5 | 1,000 | ~1,500 rps | p95 under 2 s, error rate under 0.1 %, autoscaling observed and stable |

Stages 1–3 are runnable on a single staging instance today. Stages 4–5 need the P5/P6 topology: a database
that is not a folder in RAM, and more than one instance, which the current storage layer forbids
(`docs/ARCHITECTURE.md` A-02).

### Scenario mix, per stage

Derived from how a floor actually behaves, so the write/read ratio is defensible:

- 55 % read: menu, live orders, table map, notifications, one report
- 20 % order write: place → accept → ready → served
- 10 % billing: open bill, add item, finalise
- 8 % guest actions: seat scan, add to session, place
- 5 % realtime: socket connect, join session, receive one event, disconnect
- 2 % webhook deliveries, replayed and duplicated deliberately, to assert idempotency under load

That last line is not optional. Idempotency is only worth anything if it survives the retry storm a gateway
produces when it is slow, and it can only be tested under load.

### Metrics to record every stage

p50 / p90 / p95 / p99 and max latency per endpoint group; requests per second achieved; error rate split
into `4xx` and `5xx` and `429`; socket connect time and event delivery latency (emit → client, measured
end to end); process RSS over time, so a leak is visible as a slope rather than a guess; event-loop lag,
which is where a Node service tells you it is dying; database operations per request and the number of
documents each scanned; instance restarts during the run; the target's CPU throttle percentage.

**Never report only the average.** The existing report leads with `avgLatency`; a 265 ms average with a
6 s p99 is a different system than one with a 400 ms p95.

## 5. Running the harness as it exists

```powershell
# Start the API locally first: in another window,
Set-Location "D:\New folder (2)\backend"; npm run dev

Set-Location "D:\New folder (2)\load-test"
$env:SIZZLE_API_URL = "http://127.0.0.1:4000"
$env:REPORT_PATH    = "load-test-report.json"
node load-test.js
```

Against staging, add the token so the sign-in limits are not what the run measures:

```powershell
$env:SIZZLE_API_URL    = "https://staging.<your-host>"
$env:LOAD_TEST_TOKEN   = Read-Host "Staging load token"   # typed, never committed
node load-test.js
```

`generate-report.mjs` renders `report.html` from the JSON at the end of a run (`load-test.js:680`). It is a
presentation of the numbers, not a second source of truth — and it currently renders the "flying colors"
verdict line, which should be replaced with the recorded pass/fail/rate-limited counts and the target's
identity, so a reader can never mistake a laptop run for a capacity result.

## 6. What "done" looks like for this stage

P6's exit gate is: the five stages run against the deployed topology, each with its numbers written into
this file, including the ones that failed; one run repeated after a forced instance restart, with the data
intact afterwards; and no claim anywhere in the read-out that is not supported by a row in the report. A
load test that cannot be re-run is not evidence, so the exact command, the target URL, the dataset size and
the commit under test go in the same table as the latency percentiles.
