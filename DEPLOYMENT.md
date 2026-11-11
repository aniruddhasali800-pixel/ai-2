# Deployment

The steps to put this repository on a host. Nothing here is a secret: every variable is named, never
valued. Read [`README.md`](README.md) for what the product does, [`AUTH.md`](AUTH.md) for how a screen
is reached, and [`DEMO-CREDENTIALS.md`](DEMO-CREDENTIALS.md) for what a seeded tenant contains.

## What ships

One service runs the whole product. `npm run build` in `backend/` bundles the API to `backend/dist`
and then builds the client to `frontend/dist` (`scripts/build-client.mjs` runs the frontend install and
build for you), which Express serves on `/` with an SPA fallback for deep links like `/app/orders`.
On that single origin `/api`, `/uploads` and `/socket.io` need no proxy, no absolute API base and no
CORS allowance.

## 1. Prove the build before you push it

```bash
cd backend  && npm install && npm run typecheck && npm test && npm run build
cd frontend && npm run typecheck
```

`npm run build` is the command the host runs, so it is the one that has to pass locally. It also
builds the client, so `frontend/` needs no separate build step. Then boot the bundle the way the host
will and check it answers:

```bash
cd backend && node dist/server.js        # then: curl localhost:4000/api/health
```

`/api/health` reports the environment it booted in and the archive folder it is writing to — the two
things most likely to be wrong on a deployment.

## 2. Render, from the Blueprint

`render.yaml` is a Blueprint: **New → Blueprint**, point it at this repository. It declares the
service name, Node runtime, `plan: free`, region, `rootDir: backend`, the build and start commands,
the health-check path, `NODE_ENV=production` and `NODE_VERSION=22`.

## 3. Render, on a service created by hand

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Build command | `npm install && npm run build` |
| Start command | `node dist/server.js` |
| Health check path | `/api/health` |
| Node version | 22 (`NODE_VERSION`) |

**Set the token secrets before you set `NODE_ENV=production`.** A production process refuses to start
when `ACCESS_TOKEN_SECRET` or `REFRESH_TOKEN_SECRET` is still the development default or a
`change-me` template value — the deploy then fails at boot rather than running on a key anybody who
has read this repository can forge sessions with.

## 4. Environment variables

Generate each secret fresh on the host (`openssl rand -hex 32`), put it in the dashboard, and never
commit it. `backend/.env.example` is the annotated template for a local `.env`.

### Required for a production service

| Name | What it governs |
| --- | --- |
| `NODE_ENV` | `production` turns on the boot guard below and closes the demo master password. A host that has given the service a public address already refuses to print one-time codes into its own response, whatever this says, but a public server should not be relying on that. |
| `ACCESS_TOKEN_SECRET` | Signs the 15-minute session token. |
| `REFRESH_TOKEN_SECRET` | Signs the rotating refresh token. |
| `ACCESS_TOKEN_TTL` | How long a session token lasts on its own. Default `15m`; the client refreshes it transparently. |
| `REFRESH_TOKEN_TTL_DAYS` | How many days a device stays signed in without typing anything. Default `7`. |
| `PORT` | Assigned by the host; defaults to 4000 and Render sets it itself. |
| `NODE_VERSION` | The runtime the host builds and runs on. |

### Where the records live

| Name | What it governs |
| --- | --- |
| `ARCHIVE_DIR` | The folder every record is written to as JSON lines. Default `.data/archive`, relative to the directory the server starts in. On Render that is inside the container's own disk — see step 5. |
| `AUTO_SEED` | A boot against an empty archive loads the demo tenant unless this is `false`. Leave it on for a demo; set it to `false` for a real restaurant's install. |
| `UPLOAD_DIR` | Where uploaded photos are written. Default `uploads` inside `backend/`. |
| `STATIC_DIR` | Only needed when the built client is not at `../frontend/dist`. |
| `MONGODB_URI` | Not read by anything under `src/` — the files are the database. It is named in `render.yaml` only so an existing deployment's variable is visibly retired. |

### Addresses the app publishes

| Name | What it governs |
| --- | --- |
| `RENDER_EXTERNAL_URL` / `RENDER_EXTERNAL_HOSTNAME` | Set by Render, not by you. The config reads the service's own address for the socket and CORS allowlist. |
| `PUBLIC_BASE_URL` | The host baked into table QR codes, guest bill links, pay pages and booking links. Left unset on a deployed service it becomes the demo client's domain, because those are pages and the API host serves none. It is refused if it is a laptop address, which no customer's phone can open. |
| `CORS_ORIGIN` | Comma-separated extra origins for HTTP CORS and the Socket.IO handshake. The deployed host and the demo client addresses are always allowed; this only adds to them. |
| `VITE_API_URL` | A client build variable, not a server one. Leave it empty when one origin serves both halves or a proxy rewrites `/api`; set it to the API's origin only when the client is deployed apart from the API and cannot reach it same-origin. |

### Demo logins

| Name | What it governs |
| --- | --- |
| `DEMO_STAFF_PASSWORD` | The password the seed puts on the seven demo staff accounts. Unset — which is the default — the seed still writes the restaurant, its menu, its tables and its order history, and hands out no login at all. Set it on a host you control if you want the seeded floor to be signable; leave it unset for anything public. |
| `DEMO_MASTER_PASSWORD` | One password that opens any active account of the demo tenant. Ships blank and is forced blank whenever `NODE_ENV=production`. It exists for a walk-through on a laptop, not for a deployment. |

A restaurant that onboarded itself through `/register` is a different tenant and is never touched by
either variable.

### Integrations, all optional

| Name | What it governs |
| --- | --- |
| `PAYMENT_WEBHOOK_SECRET` | HMAC key the mock gateway signs its callback with. Every webhook body is compared against its signature before it is trusted. |
| `SWIGGY_WEBHOOK_SECRET`, `ZOMATO_WEBHOOK_SECRET`, `WEBSITE_WEBHOOK_SECRET` | The same check on the delivery and website partner callbacks. |
| `SWIGGY_API_BASE`, `SWIGGY_API_KEY`, `ZOMATO_API_BASE`, `ZOMATO_API_KEY` | Aggregator push endpoints. Unset, those channels stay off. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | A real card/UPI gateway. Unset, checkout runs the in-house provider, and a settlement still needs an explicit confirmation from staff — see [`README.md`](README.md), *What is deliberately mocked*. |
| `BILL_SERVICE_BASE_URL`, `BILL_SERVICE_SHARED_SECRET`, `BILL_SERVICE_KEY` | The separate bill service that holds the payee UPI ID, the verification queue and the income figures. With no base URL Sizzle keeps its own in-house UPI QR and the sandbox gateway, so this repo deploys with nothing beside it. |

## 5. Decide what survives a deploy

The archive is the only real decision.

- **Nothing attached** and records live on the container's own disk, which the free plan recreates
  empty at every deploy. Orders taken between two pushes are gone, and the next boot reseeds the demo
  tenant because the archive it finds is empty.
- **A persistent disk** mounted at `ARCHIVE_DIR` is what makes hosted records survive. On Render that
  means a paid instance type with a disk path. It is also what lets a Render shell read the same
  records the service is serving, because the shell is a separate container.
- **Uploads** go to `UPLOAD_DIR` on the same disk, so menu photos vanish on redeploy without one. For
  a real install put uploads on object storage and keep `ARCHIVE_DIR` on a volume.

## 6. What this repository's push does to the live demo

The live API is `https://ai-1-hsus.onrender.com` behind
`https://smart.restaurant.aniruddhasali.in`, which serves the client and rewrites `/api`, `/uploads`
and `/socket.io` to it (`frontend/vercel.json`, ordered before the SPA fallback so `/app`,
`/t/<token>` and `/bill/<token>` still open the app).

Pushing to `main` redeploys that service, and because no disk is attached the redeploy wipes the
archive and reseedes. Since `DEMO_STAFF_PASSWORD` is unset there, the reseeded floor comes back with
**no staff logins at all** — that is the point of this change, and it means the live site is tested by
onboarding a restaurant at `/register`, not by signing into the demo one. The old Vercel origin stays
in the allowlist, so stickers printed before the domain swap keep opening.

One thing to fix on that service by hand: its `/api/health` answers `"env": "development"`, so its
dashboard never set `NODE_ENV`. The token secrets there are already real — a session signed with the
development default this repository publishes is refused — which is the only reason leaving it is
tolerable. Set `NODE_ENV=production` when convenient and what is left of the development behavior goes
with it: request logging, error detail, and the demo master password on any host that had named one.

## 7. After it starts

```bash
curl -s https://<host>/api/health
```

- `"ok": true`, `"env": "production"`, and a `dataFolder` that is where you expect it.
- Open `https://<client>/` — the hub lists every screen, and a card that cannot open for the person
  signed in says so instead of signing somebody in.
- Onboard at `/register` and confirm the branding you typed is on the tenant's own screens.
- Back office → add a menu item with a photo, and confirm the picture renders on the guest menu at
  `/t/<token>` on a phone.
- Place a guest order and watch the kitchen board repaint without a refresh; the connection badge
  should read **Live** on load, with no manual refresh at any point.
- `npm run seed` in a Render shell only makes sense against an attached disk; without one, seeding
  happens at boot and the shell cannot see the service's archive.

## 8. Rollback

`git revert` the offending commit and push — Render builds the reverted tree. Records are files, so a
rollback never strands data behind a schema; what a rollback cannot undo is an archive wiped by the
deploy that happened in between, which is why step 5 matters before step 6.

## 9. Anywhere that is not Render

Build with `npm run build` in `backend/`, run `node dist/server.js`, and put `NODE_ENV=production`
beside freshly generated `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` in the real environment. Serve
`frontend/dist` from the same process. To host the client apart instead, put that host in
`CORS_ORIGIN`, set `VITE_API_URL` to the API's origin, and make sure the host carries WebSocket
upgrades — where it cannot, Socket.IO falls back to long polling and realtime still arrives. Put the
archive folder and the uploads folder on storage that outlives a deploy.
