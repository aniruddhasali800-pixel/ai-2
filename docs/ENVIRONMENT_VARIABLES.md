# Environment variables

Every variable the API reads is declared once, in `backend/src/config/env.ts`, parsed with zod, and then
either used or guarded. Nothing else in the codebase reads `process.env` for configuration, which means
this table and that file are the same thing — if a variable appears here and not there, this document is
wrong and should be corrected.

The template is `backend/.env.example`. Copy it and edit the copy:

```powershell
Copy-Item "backend\.env.example" "backend\.env"
notepad "backend\.env"
```

`.env` is gitignored. **Never commit a real credential into it, into `.env.example`, or into a document.**
This repository's incident (`docs/SECURITY_INCIDENT_WEBHOOKS.md`) happened precisely because signing keys
were committed as defaults.

## How a value is judged

Three rules from `env.ts` decide what the process will accept, and they are worth understanding before
the table:

- **`isDeployedHost`** (`env.ts:17`) is true when the host publishes the service's own address —
  `RENDER_EXTERNAL_URL` or `RENDER_EXTERNAL_HOSTNAME`. It is deliberately not `NODE_ENV`, because a
  forgotten `NODE_ENV` is how a developer convenience becomes a published hole.
- **`isPublishableSecret(value)`** (`env.ts:199`) returns true for blank, for any string this repository
  has ever published, and for anything shaped like a template (`dev-`, `test-`, `example-`, `sample-`,
  `dummy-`, `placeholder-`, `changeme`, `change-me`, `your-`). A signature computed with such a value can
  be forged by whoever read the file, so it is not treated as a secret anywhere.
- **The production boot guard** (`env.ts:215-267`) runs only when `NODE_ENV=production`. It collects every
  problem it finds and prints the **variable names and the reasons, never the values**, then exits 1.
  A production process cannot start on a guessable credential.

## The variables

### Runtime and identity

| Variable | Default | Required | What it does |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | no | `production` turns on the boot guard and closes `DEMO_MASTER_PASSWORD` (`env.ts:325`). It does **not** decide whether webhooks are accepted — `isDeployedHost` does. |
| `PORT` | `4000` | no | The port the HTTP server binds to. Render sets this itself. |
| `ARCHIVE_DIR` | `.data/archive` | no | Where the JSON-lines tree lives, resolved against the process working directory (`config/db.ts:13`). This is the whole database today, and it is the reason a backup exists (`docs/STORAGE_DATA_PROTECTION.md`). |
| `UPLOAD_DIR` | `uploads` | no | Directory multer writes into and `/uploads` serves from. Not covered by the archive backup; see §"What the backup does not copy". |
| `STATIC_DIR` | unset | no | If set and it contains `index.html`, this process serves the built client too (`app.ts:16-26`). |

### Session credentials

| Variable | Default | Required | What it does |
| --- | --- | --- | --- |
| `ACCESS_TOKEN_SECRET` | a `dev-…` value in the schema | **yes in production** | Signs the short-lived session token. A production host that still holds the shipped default refuses to start. |
| `REFRESH_TOKEN_SECRET` | a `dev-…` value in the schema | **yes in production** | Signs the rotating refresh token. Same guard. |
| `ACCESS_TOKEN_TTL` | `15m` | no | How long a session token lasts unattended. The client refreshes it transparently. |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | no | How many days a device stays signed in without typing anything. |

Both signing secrets need at least 16 characters (`env.ts:67-68`). Generate one independently:

```powershell
-join ((1..64) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

### Webhook signing keys

Five variables, four of which are the ones the incident was about. `WEBHOOK_SECRET_VARIABLES`
(`env.ts:125`) names what each one is trusted to decide:

| Variable | Governs | Required |
| --- | --- | --- |
| `PAYMENT_WEBHOOK_SECRET` | the sandbox gateway, whose `captured` event settles a bill | **yes on a deployed host** |
| `SWIGGY_WEBHOOK_SECRET` | Swiggy, which pushes a paid order into a kitchen | **yes on a deployed host** |
| `ZOMATO_WEBHOOK_SECRET` | Zomato, which pushes a paid order into a kitchen | **yes on a deployed host** |
| `WEBSITE_WEBHOOK_SECRET` | a restaurant website, which pushes its own checkout in as an order | **yes on a deployed host** |
| `RAZORPAY_WEBHOOK_SECRET` | the real Razorpay endpoint, when one is configured | optional until Razorpay is live |

Rules enforced at boot and at request time:

- All four must hold a value of their own on a deployed host, or the two webhook routers answer `503`
  rather than settle money on a guessable key (`env.ts:304`).
- **Two providers with the same value is one value.** The guard names both variables and refuses to start,
  because a message signed for Swiggy would then verify as a Zomato order. One pairing is allowed:
  `RAZORPAY_WEBHOOK_SECRET` with `PAYMENT_WEBHOOK_SECRET`, because a single Razorpay endpoint signs for
  both routes (see `env.ts:172`).
- Each key must be **independent** — generate one per provider, do not reuse one across four variables.

### Rotation window

| Variable | Default | Required |
| --- | --- | --- |
| `PAYMENT_WEBHOOK_SECRET_PREVIOUS` | unset | no |
| `SWIGGY_WEBHOOK_SECRET_PREVIOUS` | unset | no |
| `ZOMATO_WEBHOOK_SECRET_PREVIOUS` | unset | no |
| `WEBSITE_WEBHOOK_SECRET_PREVIOUS` | unset | no |
| `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` | unset | no |

A rotation is a window, not a cut. `webhookSigningKeys` (`env.ts:287`) accepts the retiring key beside the
live one for as long as the variable holds it, because a gateway that has been re-pointed keeps retrying
deliveries it queued under the old key — Razorpay retries for about a day. Clearing the variable closes the
window immediately.

**A published value is never accepted under this name.** The guard refuses to start if a `_PREVIOUS`
variable holds something this repository has published: that is not a key being retired, it is the leaked
key reopened under a straighter name (`env.ts:253`).

### Partner and gateway credentials

| Variable | Default | Notes |
| --- | --- | --- |
| `SWIGGY_API_BASE`, `SWIGGY_API_KEY` | unset | Outbound partner API. Unset means the integration is simulated, not live. |
| `ZOMATO_API_BASE`, `ZOMATO_API_KEY` | unset | Same. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | unset | Live gateway keys. Without them the sandbox gateway is used. |
| `BILL_SERVICE_BASE_URL` | unset | The `bill/` app. Unset means Sizzle keeps its own in-house UPI QR and sandbox, so a checkout of this repo runs with nothing beside it. |
| `BILL_SERVICE_SHARED_SECRET` | unset | The HMAC key both services sign with. It is not one of the four webhook keys but it settles money the same way, and it was published in this repository too. Treat it as part of the rotation. |
| `BILL_SERVICE_KEY` | `sizzle-pay` | A tenant identifier for the bill service, not a secret. |

### Demo and seeding behaviour

| Variable | Default | Notes |
| --- | --- | --- |
| `DEMO_MASTER_PASSWORD` | `''` | One password that opens any active account of the seeded tenant. Forced to empty in production (`env.ts:325`), empty by default, so a host must name it deliberately. |
| `DEMO_STAFF_PASSWORD` | `''` | The password the seed gives staff accounts. Unset means the demo tenant has menu, tables and history but **no logins at all**. |
| `AUTO_SEED` | on | Loads the demo tenant when no restaurant exists. `AUTO_SEED=false` for a clean install. This is what repopulates production after each deploy, because the archive folder starts empty on Render free. |
| `CORS_ORIGIN` | the built-in list | Comma-separated origins added to the allowlist. The known client hosts are always allowed so a stale dashboard value cannot silently kill realtime (`env.ts:332`). |
| `PUBLIC_BASE_URL` | the deployed client, or `http://localhost:5173` | The address printed into QR codes, guest bills and pay links. A hosted process that is given a private address is overridden with a warning (`env.ts:336`). |

### Load testing

| Variable | Default | Notes |
| --- | --- | --- |
| `LOAD_TEST_TOKEN` | `''` | The only credential that lets a request past the sign-in rate limit. Empty means nothing is ever skipped. **A production host refuses to start with one set** (`env.ts:231`), because a switchable-off throttle is the one hole a load harness can leave behind. |

The header the harness sends is `x-load-test-auth`, and it is compared in constant time
(`middleware/rateLimit.ts:17`). It used to be believed on presence alone, which meant the bypass was
public documentation for how to skip every login limit in the service. Use this variable on a **staging**
instance only; see `docs/LOAD_TESTING.md`.

## What the backup does not copy

`npm run archive:backup` (`backend/package.json`) snapshots `ARCHIVE_DIR` and nothing else. Two other
places hold state:

```powershell
# Uploads — photos of dishes, currently 17 MB and growing
Copy-Item "backend\uploads" "backups\uploads-$(Get-Date -Format yyyyMMdd-HHmmss)" -Recurse

# The bill service database, if BILL_SERVICE_BASE_URL points at a local instance
Copy-Item "bill\dev.db" "backups\bill-dev-$(Get-Date -Format yyyyMMdd-HHmmss).db"
Copy-Item "bill\test.db" "backups\bill-test-$(Get-Date -Format yyyyMMdd-HHmmss).db" -ErrorAction SilentlyContinue
```

Neither directory is in git. `backend/uploads` is ignored by the root `.gitignore` and `bill/*.db` by
`bill/.gitignore`, so a fresh clone has no uploads and no bill ledger.

## Setting these on Render

Dashboard → the service → Environment. Add or edit each variable, then **Restart**, not Deploy — a Deploy
on the free plan rebuilds the image and the archive folder comes up empty. Never put a real credential in
a variable that is exposed to the browser, and never paste one into a commit message, a log, or a
document. The full deploy sequence, including the order the webhook keys have to go in so no legitimate
event is lost, is `DEPLOYMENT.md` and §4 of `docs/SECURITY_INCIDENT_WEBHOOKS.md`.
