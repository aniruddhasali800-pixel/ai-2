# Security incident: the webhook signing keys shipped in this repository

**Opened:** 2026-11-03 · **Code containment:** complete and tested · **Production containment:** not complete
**Severity:** high — an unauthenticated request could mark a bill paid, and could push an order into a kitchen

Read the last section first if you only have a minute: it says exactly what is fixed, what is waiting on
the hosting dashboard, and what nobody has verified yet. Nothing in this file claims the incident is
closed, because the live credentials have not been rotated.

Per the containment rules for this incident, no credential value appears anywhere in it — not in the
tables, not in the tests' expected output, not in the commands. The values are identifiable by the
environment variable they belong to and by the commit that published them.

---

## 1. What was exposed, and to whom

Seven places in this service decide whether a webhook body is genuine. Each one computes an
HMAC-SHA256 digest of the raw body and compares it, in constant time, to the signature header the
sender provided. Four of those seven keys had a value baked into the source as the schema default, and
that same value was also written into the committed environment template:

| Environment variable | Trusted to decide | Default published? |
| --- | --- | --- |
| `PAYMENT_WEBHOOK_SECRET` | whether a bill is paid | yes — since the initial commit |
| `SWIGGY_WEBHOOK_SECRET` | whether a paid Swiggy order enters the kitchen | yes |
| `ZOMATO_WEBHOOK_SECRET` | whether a paid Zomato order enters the kitchen | yes |
| `WEBSITE_WEBHOOK_SECRET` | whether a restaurant's own website checkout enters the kitchen | yes |
| `RAZORPAY_WEBHOOK_SECRET` | whether a real gateway settled a bill | no value published; unset rejects every delivery |
| `BILL_SERVICE_SHARED_SECRET` | the callbacks from the `bill/` UPI service | no value published; unset rejects every delivery |
| `ACCESS_TOKEN_SECRET` | the signed table-QR link a guest scans | guarded separately, and never defaulted on a deployed host |

The exposure window for the four published ones runs from commit `3a919be` (2026-09-27, the initial
commit of this repository) to today. They are still present at `HEAD` in two files — `backend/.env.example`
and the schema defaults in `backend/src/config/env.ts` — and the guard added in this work keeps naming
them in `publishedDefaults`, so they will stay in the source as things to reject.

**Deleting them from the working tree does not retire them.** They are in the history: `git log
-S<value> -- .` finds the commit that introduced each one, and the full history is 51 commits deep and
pushed to `github.com/aniruddhasali800-pixel/ai`. Anyone with read access to that repository — the
account owner, every collaborator, and every visitor if the repository is public — can compute a valid
signature for any body, for any tenant, forever. Whether the repository is public was **not verified**,
because checking it needed an outbound request nobody asked for; verify it yourself and assume it is
public until you have.

That is why rotation is mandatory even if the repository turns out to be private: the secret is the
thing being protected, and a secret that has been written into a version-controlled file has been told
to everyone who can read the file.

## 2. What an attacker could do with them, before today's code

Both routes are mounted ahead of the authentication middleware, deliberately — a gateway has no login,
so the signature *is* the authentication.

```
POST /api/payments/webhook/:provider      headers: x-razorpay-signature | x-signature | x-payment-signature
POST /api/integrations/webhook/:provider?rid=<restaurantId>
                                          headers: x-swiggy-signature | x-zomato-signature | x-website-signature
```

With `PAYMENT_WEBHOOK_SECRET`, a single request carrying a `payment.captured` event for any
`providerOrderId` reached `markPaymentSucceeded`, which marks the payment `SUCCEEDED`, sets the bill to
`PAID`, completes its orders and closes the table session. Guessing an order id is not much of an
obstacle: ids are minted by this service and appear in guest-visible places.

With a delivery secret, a request signed for Swiggy, Zomato or the website created a real order in any
restaurant whose id the sender knew, because `?rid=` is taken from the URL the partner was given. That
is kitchen spam at minimum, and inventory deduction through the recipe lines at worst.

**Confirmed on the live host while writing this file.** An unsigned probe to both routes answered
`401 Signature verification failed` from `https://ai-1-hsus.onrender.com` and from
`https://smart.restaurant.aniruddhasali.in` — so the routes are reachable from the internet and were
being asked to verify against the published key. A probe signed with the published key was *not* sent:
it would have changed live data, and reachability plus a known key already establishes the finding.

## 3. Containment now in the code

Each of these is in the tree and covered by a test; none of them needs a dashboard change.

1. **A production process refuses to boot on a published key.** `backend/src/config/env.ts` checks all
   four webhook secrets, plus the token secrets, and exits with a message that names the variables and
   never prints a value. It also refuses two providers sharing one secret, which would otherwise let a
   message signed for Swiggy verify as a Zomato order. The one pairing it allows is
   `RAZORPAY_WEBHOOK_SECRET` equal to `PAYMENT_WEBHOOK_SECRET`, because one Razorpay endpoint signs for
   both and §4 tells the operator to set them together.
2. **A deployed host with published keys closes the webhook routes instead of crashing.** Render hands a
   service its own public address, so `isDeployedHost` needs no `NODE_ENV` — and the live service runs
   with `NODE_ENV=development`, which is precisely the case a `NODE_ENV`-only guard would have missed.
   Both routers answer `503` before the body parser, so nothing untrusted reaches a payment or an order.
   It answers 503 rather than crashing because taking the whole product offline would itself be an
   unapproved outage.
3. **Every verification path compares in constant time and against the exact raw bytes.** The three
   delivery adapters and the sandbox payment gateway now all go through `safeEqual`; bodies are read
   from a `raw` buffer and never re-serialised, so a real signature always covers the bytes that were
   actually sent.
4. **A blank secret can never verify anything.** The sandbox gateway now returns `false` when
   `PAYMENT_WEBHOOK_SECRET` is empty, matching the delivery adapters, which already did. An HMAC under
   an empty key is a value anybody can compute.
5. **Deliveries are idempotent against a persistent ledger.** `WebhookEventModel` keys on
   `(provider, eventId)`, where `eventId` is the sender's own event id when it names one and otherwise
   the SHA-256 digest of the exact bytes. The claim is taken after the signature and the tenant
   resolution but **before** any business action; a second claim answers `200 Duplicate delivery
   ignored` without touching a record, which is the only response that makes a gateway stop retrying.
6. **A delivery that was not acted on gives its claim back.** A rejected reference or an exception
   releases the reservation, so the provider's retry of a genuine event is still believed. Without this,
   idempotency would become a way to lose a real payment permanently.
7. **Both webhook routers are rate limited** — 120 requests per minute per IP, with the standard
   `RateLimit-*` headers, so brute-force signature guessing is bounded and logged.
8. **Owners can read their own delivery history.** `GET /api/audit/webhooks` returns, newest first, the
   events that named one of that tenant's payments or that restaurant: provider, event, reference,
   outcome and time. It selects those five fields only, so a signature, a body and a secret are not in
   it, and it is behind `requireAuth` + `audit:read`.
9. **A rotation has a window instead of a cliff.** `webhookSigningKeys` accepts the live secret and, only
   while `*_WEBHOOK_SECRET_PREVIOUS` holds it, the key being retired. A gateway that re-points its
   endpoint keeps retrying deliveries queued under the old key — Razorpay does so for a day — and a route
   that knows only the new secret answers that genuine traffic with `401` until the partner stops trying.
   The retiring value is held to the same test as the live one and a published default is refused under
   either name, so the window cannot be used to keep the leaked keys valid.

## 4. Rotation checklist — the operator's part, which nobody else can do

Do this in one sitting. Roughly twenty minutes, and no code change is needed for any of it.

**Before you start:** the live service is on Render's free plan, so a redeploy wipes its record archive
and reloads the demo tenant. Rotation does not need a redeploy — environment variables can be applied by
Restart, which keeps the filesystem — so use **Restart**, not **Deploy**, unless you mean to ship code.

For each of the four variables, generate one independent key. Four separate commands, four different
outputs:

```
openssl rand -hex 32
```

On Windows, where `openssl` usually is not installed, this prints the same shape of value:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Do not paste a generated key into a chat, an issue, a commit message, or this file. Type it into the
provider's form and the hosting environment only.

| # | Provider | Where the key is set on their side | Where it is set on ours |
| --- | --- | --- | --- |
| 1 | Payment gateway (Razorpay) | Razorpay dashboard → Settings → API keys → Webhooks → the secret of the existing endpoint | `RAZORPAY_WEBHOOK_SECRET` **and** `PAYMENT_WEBHOOK_SECRET` |
| 2 | Swiggy | the partner webhook configuration for the store | `SWIGGY_WEBHOOK_SECRET` |
| 3 | Zomato | the partner API/integrations page for the store | `ZOMATO_WEBHOOK_SECRET` |
| 4 | Restaurant website checkout | wherever that checkout's webhook is configured — today it is this project's own client, so both sides read the one variable | `WEBSITE_WEBHOOK_SECRET` |

`PAYMENT_WEBHOOK_SECRET` signs the sandbox gateway, which is what the counter's *simulate* button and the
mock pay page use, so give it a real value even if no live gateway is connected yet. `RAZORPAY_WEBHOOK_SECRET`
is the key Razorpay actually signs with; if the two differ, Razorpay deliveries fail closed, which is
correct but silent — set both to the same value you register in Razorpay's dashboard, since they are the
same sender. Note this is the one place where two variables deliberately share a value; the production
guard compares only the four it enforces, so it will not object.

Then, in order:

1. Set all four in **Render → your service → Environment**.
2. While you are there, set `NODE_ENV=production`. It is currently unset, which is why `/api/health`
   answers `"env": "development"` on a host the whole internet can reach. Production makes the API
   refuse to start on a published key at all, forces the demo master password blank, and stops an
   unhandled error being printed with its internals. Request logging does not stop: it switches to the
   combined format, which also records the caller's address, so this is the setting that gives you the
   evidence in §6.
3. **Restart** the service (not Deploy).
4. Re-issue the key inside each provider's dashboard, so the old one stops working there too. Rotating
   only on our side leaves the sender holding a key that still proves nothing to anyone else but is
   still in *their* records.
5. Send one test delivery per provider and confirm a `2xx`, not a `503` and not a `401`.

**Why the order above loses nothing this time.** Between steps 3 and 4 a sender still holding the old
key would sign deliveries the new key cannot verify, which is normally the moment traffic is dropped.
Here it costs nothing, because the key being replaced is the one printed in this repository and no real
sender is delivering at all: the aggregator channels are unset, so those routes stay off until a partner
is actually connected, Razorpay is not configured, and the only signer left is the sandbox gateway that
the counter's *simulate* button drives — a staff click, retried by a person, not a queue. Rotate in the
order above and then, when a genuine sender is connected, use the window below instead.

### The window, for every rotation after this one

A live provider does not stop mid-retry when you change its endpoint. Razorpay keeps retrying what it
queued for a day at increasing spacing, and a route that knows only the new secret answers all of that
genuine traffic with `401` until the partner gives up. So the sequence for a sender that is really
delivering is:

1. Generate the new key. Type it into `PAYMENT_WEBHOOK_SECRET` (or `SWIGGY_`, `ZOMATO_`, `WEBSITE_`), and
   move the key it is replacing into the same name plus `_PREVIOUS`.
2. **Restart**. From this moment both signatures are believed, so nothing in flight is refused.
3. Re-point the endpoint in the provider's dashboard to the new key. Verify from their delivery log that
   the recent entries now say the new one.
4. Watch `GET /api/audit/webhooks` until the last retry queued under the old key has arrived.
5. Clear the `_PREVIOUS` variable, restart again, and confirm a delivery signed with the old key is now
   refused with `401`. That refusal is the proof the window closed.

Two rules the code enforces, so a mistake here fails loudly rather than quietly: a `_PREVIOUS` value that
appears in this repository stops a production process from starting at all, and a `_PREVIOUS` value that
duplicates a different provider's live key does the same. A leaked key never gets a grace period, and a
second signing key is never a retired one.

### What each provider actually specifies, and what is assumed

Razorpay is documented and our verification follows it: HMAC-SHA256 over the exact request body,
compared against `x-razorpay-signature`, with the secret belonging to the individual webhook endpoint
rather than the account. That last detail is why the checklist says to paste the same value into
`RAZORPAY_WEBHOOK_SECRET` and the Razorpay form, and why re-creating an endpoint mints a key that the old
variable cannot verify.

Swiggy and Zomato are not. Their order-feed webhook signature schemes are behind partner portals this
repository cannot read, and what is publicly visible describes pull-based polling with per-restaurant
tokens rather than signed pushes. The three delivery adapters here therefore implement an **assumed
contract** — HMAC-SHA256 of the raw body against `x-swiggy-signature` / `x-zomato-signature`, headers and
algorithm chosen by us. Until the person connecting a partner reads that partner's own webhook
documentation and confirms the header name, the signed string and the encoding, a `2xx` from those routes
means only that our two ends agree with each other. It does not mean the partner's specification was met,
and no delivery should be trusted for money movement until it does.

Where a provider does not let you rotate without re-registering the endpoint, re-register it: delete the
webhook, create it again with the new secret, and point it at the same URL. Expect a gap of a minute or
two; check their delivery log afterwards and replay anything that failed during the gap — the ledger
makes that replay harmless, because a delivery already acted on is answered `200` and changes nothing.

**Retire the old defaults everywhere else:** if any of the four published values is in a password
manager, a CI secret, a notebook, a screenshot or a chat message, mark it used and delete it. The
repository history keeps them whether or not you do; the point is that they must never again be the
thing a working system trusts.

## 5. After rotation: proving the old keys are dead

Run these three checks once the service has restarted. The first two are safe to run from anywhere.

Read the retired default out of history into a shell variable rather than typing it onto the command
line, where it would sit in your shell history:

```bash
retired=$(git show 3a919be:backend/.env.example | sed -n 's/^PAYMENT_WEBHOOK_SECRET=//p')
```

```bash
# 1. A body signed with the retired default must now be refused. Expect 401, not 200.
body='{"event":"payment.captured","payload":{"payment":{"entity":{"order_id":"rotation-check"}}}}'
sig=$(node -e "console.log(require('crypto').createHmac('sha256', process.argv[1]).update(process.argv[2]).digest('hex'))" "$retired" "$body")
curl -i -X POST https://smart.restaurant.aniruddhasali.in/api/payments/webhook/mock \
  -H 'content-type: application/json' -H "x-razorpay-signature: $sig" -d "$body"
```

A `401` proves the retired value no longer opens the route. A `503` instead means the new key was not
picked up at all, which the startup log reports by variable name. Either way nothing was settled: the
`order_id` in that body belongs to no payment, and a delivery the app cannot act on releases its claim
and leaves no ledger row.

```bash
# 2. The health endpoint must stop advertising development.
curl -s https://smart.restaurant.aniruddhasali.in/api/health
```

```bash
# 3. One delivery signed with the NEW key must reach the ledger. Ask as an owner.
curl -s -H "Authorization: Bearer <access token>" \
  'https://smart.restaurant.aniruddhasali.in/api/audit/webhooks?limit=10'
```

## 6. Forensic review: what to look for, and what can still be found

The exposure window is from 2026-09-27 to the day the key is rotated. Everything below is the procedure;
the honest summary of what it can reach is at the end of the section, so read that before spending an
afternoon on it.

**On the sender's side** (the only place with a complete record): Razorpay's dashboard lists every
webhook it sent, with the event, the target URL, the response code and the timestamp. Swiggy and Zomato
partner portals keep the same for their pushes. Look for:
- deliveries to our webhook URLs that we never triggered — a real event follows an intent we created;
- response codes `200` on events that do not correspond to a payment we asked for;
- bursts: a script trying signatures answers a stream of `401`s, so the count of failures is itself a signal;
- the same event id delivered from two different source IPs in quick succession.

**On our side**, in order of how much survives:
- `GET /api/audit/webhooks` — the ledger written from this change forward: provider, event, reference,
  outcome, time, scoped to the asking tenant.
- The archive files behind it: `backend/.data/archive/_index/<year>/<month>/<day>/webhook-events.jsonl`.
  One line per delivery that cleared its signature and named a restaurant. Nothing else is stored — no
  body, no signature, no key.
- The HTTP access log for `POST /api/payments/webhook/*` and `POST /api/integrations/webhook/*`. This
  runs in both modes — `dev` format outside production, `combined` inside it — and on Render it goes only
  to the log stream, which keeps a short window and is discarded when the service redeploys. If this
  review matters, copy the stream out **before** the restart rather than assuming it will still be there.

**Data anomalies worth querying** — each one is a shape a forged delivery would leave:
- a payment whose `status` is `SUCCEEDED` with no matching intent in the gateway's own order list;
- a payment that settled without a `verifiedAt`, or two payments on one bill that both settled;
- a bill marked `PAID` whose table session was never reopened, i.e. money in with no service behind it;
- orders with `source` `SWIGGY`/`ZOMATO`/`WEBSITE` whose `externalOrderId` never appears in the partner's
  dashboard — that is a kitchen order nobody placed;
- a `DINE_IN_QR` or takeaway order created seconds before a bill's payment settled, out of sequence with
  the kitchen's own timestamps.

With this build's models, the quickest read is the JSONL rather than any query language. Each tenant has
a folder of its own, and inside it one dated file per collection:

```
<dataFolder>/<restaurant name>/payments/<day>/payments.jsonl
<dataFolder>/<restaurant name>/orders/<day>/orders.jsonl        # partitioned on placedAt
<dataFolder>/<restaurant name>/bills/<day>/bills.jsonl
```

`GET /api/health` returns `dataFolder`, so the live host will tell you where it keeps its own records.
One record per line, filtered with `grep`.

**What the review can actually reach today:** the live service runs on Render's free plan, whose
filesystem is **erased and reseeded on every deploy**. The archive that holds the payments, bills and
orders therefore contains only what has happened since the last deploy, and there is no copy of the
previous one — no export tooling exists yet. The webhook ledger goes further: it is created by this
change, so there are no ledger rows from the exposure window at all. **The conclusion is that the
forgery history cannot be reconstructed from this repository's own data**, and the provider delivery
logs are the only surviving evidence. That is a P0 finding in its own right and is the reason the
scaling plan's first phase is persistent storage with backup, not throughput.

## 7. Tests added with this change

| File | Covers |
| --- | --- |
| `backend/tests/webhookSecrets.test.ts` | the published-value judgement (blank, template, repository-shipped); a real production process booting on defaults exits `1` naming all four; an unset secret exits `1`; two providers sharing a secret exits `1` and names both variables; the Razorpay/sandbox pairing is allowed because it is one sender; four independent keys boot; a `_PREVIOUS` holding a published value exits `1`, a genuinely private retiring key boots, and a retiring key that duplicates another provider's live key exits `1`; a deployed host with defaults keeps serving and reports the routes closed; the refusal output never contains a credential value |
| `backend/tests/webhookRouteGate.test.ts` | the 503 gate lets a delivery through when the host holds real keys, stops the chain without it, and does not name a value while explaining why |
| `backend/tests/webhookHardening.test.ts` | a blank secret refuses forgeries signed under `''` for the sandbox, Swiggy and Razorpay paths, and the same body settles once the key returns; two captures arriving together settle one bill with one ledger row; three concurrent partner deliveries create one order; a tenant cannot read another's delivery history; a replayed success cannot move `verifiedAt`; a failure cannot overwrite a settled payment; a capture after a failure does settle; an unknown reference acts on nothing and reserves nothing; the rotation window still believes the old key, stops believing it when cleared, and never believes a key this repository published |
| `backend/tests/webhooks.test.ts` | valid signature settles; a forged signature leaves the payment `PENDING` and files nothing; a body altered after signing is refused with no order and no ledger row; the same `event_id` in two different bodies acts once; a replay is answered `200 Duplicate delivery ignored` with `verifiedAt` unchanged and one ledger row; an accepted delivery is recorded with its outcome; a delivery naming a payment that does not exist releases its claim so the retry works; a failure with no reference is refused |
| `backend/tests/billService.test.ts` | the UPI claim → capture → replay path against the ledger-backed duplicate answer instead of the old "already settled" wording |
| `backend/tests/archiveCommands.test.ts` | the backup, verify and restore commands run as real processes against a throwaway archive: a write in flight is left out of a snapshot, a snapshot is loaded back through the application's own reader, a changed byte fails verification, a restore without `--force` and a restore of a folder with no manifest are both refused, a snapshot restores onto an empty folder and the records read back, and whatever is live is snapshotted and parked before being replaced |

Four of the guard tests spawn a real child process, because *refusing to start* is something a module
does to the process it lives in and cannot be observed from inside a test. They name the published values
in their own source, which is deliberate: those strings are already public in history and are being
retired, so re-listing them where they are asserted to be rejected adds no exposure. No test ever prints one.

```
cd backend && npm run typecheck && npm test     # 20 files, 181 tests, all passing
```

## 8. Known gaps this change does not close

- **Two of the delivery adapters verify a scheme we invented.** Razorpay's is documented and matched;
  Swiggy's and Zomato's order-feed signing is not publicly specified, so the header names, the signed
  string and the algorithm in `src/integrations/delivery.ts` are our own contract. A `2xx` on those
  routes proves our two ends agree, not that a partner's real payload would be accepted. Nobody should
  treat a delivery from either channel as evidence of money until their current partner documentation is
  read and the adapter is matched to it — see §4.
- **One partner secret covers every tenant.** `?rid=` in the delivery webhook URL is chosen by whoever
  holds the secret, so a key leaked for one restaurant can push orders into another's kitchen. The fix
  is a per-tenant secret per provider, which changes the partner-facing onboarding and needs a decision,
  not code alone.
- **The ledger is only as durable as the archive it lives in.** It survives a restart, and a Render
  deploy wipes it along with everything else, so deduplication memory resets at each deploy. A second
  backend instance would hold its own ledger and settle the same payment twice.
- **Failed signature checks are not stored.** An attacker can force a 401 without knowing anything, so
  recording those would let anybody grow the archive at will. They appear in the HTTP access log instead,
  which on Render means a short window rather than a history — see §6 for getting it out.
- **The route-level 503 is tested as a middleware, not as a listening socket.** Its flag
  (`webhooksAreAccepted`) is tested end to end in a real child process; the two routes are covered by
  reading them, because this project has no HTTP test harness.
- **The `bill/` service is not tenant-scoped**, which is a separate finding tracked in the audit report,
  not a webhook problem: its verification secret fails closed and is not published anywhere.

## 9. Status

**Fixed in code, and tested:** production startup refusal on published and duplicated webhook keys; the
deployed-host closure of both webhook routers; constant-time comparison on all seven paths; raw-body
verification; blank-secret fail-closed on the sandbox gateway; persistent idempotency with claim release
on failure; rate limiting on both webhook routers; a tenant-scoped delivery ledger with a read route
behind `audit:read`; a rotation window that honours a retiring key and refuses a published one; the
startup guard that names both variables when two providers share a value, while allowing the one pairing
that is a single sender; the environment template now states the four-key rule and the window variables.

**Waiting on the hosting dashboard — only the account owner can do this, and the incident stays open
until it is done:** generate and set the four independent keys; re-issue each key inside the four
provider dashboards; set `NODE_ENV=production`; restart; then run the three checks in §5. The live
service still holds published keys, so **the exposure is ongoing right now**, and this file does not
describe it as closed.

**Not verified:** whether `github.com/aniruddhasali800-pixel/ai` is public; whether any forged delivery
actually occurred during the window (see §6 — the data to answer that was not retained); the Razorpay
webhook's real delivery history, which needs the dashboard; whether the per-provider signature headers
each partner sends match what this service reads (`x-swiggy-signature`, `x-zomato-signature`,
`x-website-signature`, `x-razorpay-signature`), because no live partner traffic has been observed here —
the sandbox path is exercised, the RAZORPAY path fails closed and is therefore never reached without a
real key.
