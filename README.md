# Sizzle — Restaurant OS

A working restaurant platform for one floor: guests scan a table code and order, the kitchen
board fires tickets, waiters see who called, the counter raises the bill and takes payment, and
the owner watches it all in reports. Every screen is wired to one Node API over Socket.IO, so a
click on a till repaints the kitchen display on the other side of the room.

Single tenant per install (`Saffron & Smoke`, Pune, INR). Staff roles are OWNER, MANAGER,
WAITER, KITCHEN and CASHIER; permissions are enforced on the server for every request, and the
frontend only hides what the server would refuse anyway.

## Layout

```
backend/    Express 4 + Mongoose + Socket.IO, TypeScript, Zod validation, Vitest
frontend/   Vite + React 19 + Tailwind v4, hand-rolled SVG charts, Zustand stores
```

## Run it

Two terminals. Node 20+.

```bash
cd backend && npm install && npm run dev     # API on :4000
cd frontend && npm install && npm run dev    # app on :5173
```

Open http://localhost:5173 — that is the **hub**: every screen in the build on one page, staff and
guest, each with the sign-in it needs. Press a card and you are inside that screen, as whoever you
signed in as; nothing on this page hands out a login.

**Data.** Every record is a file. The backend writes its collections as JSON lines under
`backend/.data/archive`, one folder per restaurant — no database server to install, run, or point a
URL at. Deleting that folder and booting again gives you a virgin install, which auto-seeds the demo
tenant.

**Seeding.** `npm run seed` rewrites the demo floor; `npm run seed:fresh` wipes and rebuilds it. Stop
`npm run dev` in `backend/` first, so the running server is not writing records into the same folders
the seed is replacing.

```bash
cp backend/.env.example backend/.env   # only needed the first time
```

## Open it on a phone

One port serves everything — staff and guests — over the local network. Vite binds every interface,
so the same `:5173` the laptop uses is reachable from a phone on the **same Wi-Fi**:

```
http://192.168.31.213:5173        <- this machine's current LAN address
```

`npm run dev` in `frontend/` prints that address as `Network:` on startup; it changes with the
router, so re-read it rather than hard-coding it. That single link is the hub, and from it a guest
can book a table (`/book/saffron-and-smoke`), scan into a table menu and order, watch the ticket,
and pay the bill by UPI — no app install, no login.

For the codes to be scannable, `backend/.env` has to name the address the phone will dial:

```
PUBLIC_BASE_URL=http://192.168.31.213:5173
CORS_ORIGIN=http://localhost:5173,http://192.168.31.213:5173
```

`PUBLIC_BASE_URL` is what gets baked into the printed table QR (Back office → Tables → each card's
QR, or `GET /api/tables/:id/qr`), into guest bill links and into the mock checkout redirect.
`CORS_ORIGIN` is a comma-separated list and is checked by both HTTP CORS and the Socket.IO
handshake — leave the LAN origin out and the phone loads the page but never gets live updates.
Restart `npm run dev` in `backend/` after editing either one; no reseed needed, the links are built
per request.

Windows already allows inbound `node.exe` on the current profile, so nothing to configure there. If
the phone spins but never connects, check the router for AP/client isolation — that blocks
device-to-device traffic on the Wi-Fi and no setting in this repo will fix it.

## Demo sign-in

Nothing in this repository is a password. The seed builds the demo restaurant — 35 dishes, 14 tables,
fourteen days of orders — and the seven staff who appear in that history, but it writes no email and
no password onto them, so a fresh checkout has no login to try and a deployed copy holds nothing an
outsider can guess at.

The straightforward way to get a back office is **Create a restaurant** at `/register`: it onboards a
tenant with you as its owner, branding and all. To walk the *seeded* restaurant's own screens, name
the password yourself in `backend/.env` and reseed:

```
DEMO_STAFF_PASSWORD=<a password only you know>
```

```
cd backend && npm run seed:fresh
```

Those accounts then sign in with the phone number they were seeded with (`+91 98200 11001` is the
owner) and that password. The floor jobs — cashier, kitchen, waiter — can take a one-time code
instead; there is no SMS gateway, so only a machine that is not a deployed host echoes the code on
screen, and a hosted one says that nothing can arrive. Owner and manager never receive a code, so they
keep passwords.

`DEMO_MASTER_PASSWORD` is a separate door: it opens any active account of the demo tenant without
that account holding a password of its own. It defaults to blank, which is how it should stay
anywhere but a machine you are demonstrating from.

[DEMO-CREDENTIALS.md](DEMO-CREDENTIALS.md) lists the seeded staff, their phone numbers and every
guest link. [AUTH.md](AUTH.md) is the short version for whoever is testing.

Guest links need no login: `/t/<tableToken>` is the QR menu, `/s/<sessionToken>` is a live table,
`/bill/<billToken>` is a receipt, `/book/saffron-and-smoke` is reservations. Table codes are listed
under Tables in the back office, and `GET /api/tables` returns each `qrUrl` ready to print. The hub
picks up the current tokens for you — no copy-pasting needed.

Every code on screen — a table's QR, the guest ordering card, the staff install card, a bill's UPI
QR — has **Download PNG** beside it, so a sticker can be saved and printed from anywhere without
going through the browser's print dialog. The file is named for what it points at
(`saffron-and-smoke-table-G1.png`), and it is the same image the card shows, so the printed code and
the one on screen can never disagree.

## Taking payment

Every unpaid bill carries a **scan-to-pay UPI QR** built from its own total: the amount, the payee
handle and the bill number go into the `upi://pay?...` link on the server, so nobody types a figure
into a payment app. Owner → Settings → *Scan-to-pay UPI* holds the handle (demo:
`saffronandsmoke@icici`); leave it blank and the QRs disappear from bills and the counter drawer.
The same QR is on the guest's `/bill/...` page and in the printed slip. Confirming payment stays a
server action — the QR only moves money, the counter records it.

Takeaway and delivery tickets carry the guest's **address and city** from the moment they are
created: they show on the order card in the back office, in the ticket header on the kitchen board
(so the packer knows where it is going), and on the bill. Waiters fill them in on `/floor/order`
when the destination is *Takeaway / counter*; delivery orders get them from the partner payload.

### When a guest presses *Bill please*

The tap does not ask a human for a favour — the server totals **every open order on that table into
one bill** and pushes it straight back into the guest's browser, which lands on `/bill/...` with the
UPI QR already cut for that figure. Cashier, owner and manager all get the notification at the same
moment, and the session room keeps the page live, so the phone shows *Paid — thank you* the second
the counter confirms it.

If the guest would rather hand over notes, the same bill page has **Pay with cash at the table**.
That tap rings the waiter on that patch and the counter. The waiter presses *Take ₹…*, confirms the
notes with the change previewed, and the round moves to the counter as *At the till*; the cashier
presses **Payment done**, which records the cash, marks the orders complete, closes the session and
sends the table to *Cleaning* — all on the server, all audited. A waiter can issue a bill and carry
cash, but `payments:write` is not in the waiter role, so a waiter can never mark money as received.

Waiters can bill a table themselves too: the receipt button on *My tables* at `/floor` issues the
same combined bill and opens it.

The kitchen ticket for a table carries the **table number** in the header and splits the lines into
a **veg side and a non-veg side**, so nothing on the pass can be plated for the wrong guest; the
bill that closes the table combines both sides again. Bill headers pair the Sizzle mark with the
restaurant's own logo (Owner → Settings → *Logo*, falling back to the restaurant's initials).

## The five-minute tour

Needs a staff account first — one you onboarded at `/register`, or the seeded floor after setting
`DEMO_STAFF_PASSWORD` as [AUTH.md](AUTH.md) describes. Then:

1. Sign in as **Kitchen** in one window and leave the board up.
2. In another window open a table code — the hub's *Table QR menu* card has one ready, or go to
   Back office → Tables → QR for a printable code. The tokens change whenever you reseed; on the
   current seed table G1 is http://localhost:5173/t/5wNfQUcStkAzeA2eazRBEg. Add a couple of items
   with an add-on and place the order. The ticket lands on the board without a refresh.
3. Press *Start*, then *Fire*, then *Ready* on the board. The guest's phone flips to "Ready" and
   the waiter's floor map turns green on its own.
4. Press *Bill please* on the guest screen — the phone jumps straight to the total and the counter
   already has the notification. Either settle it at the till, or press *Pay with cash at the table*
   on the bill page, then sign in as **Waiter** to take the notes and as **Cashier** to press
   *Payment done*. Change is calculated on the server and the table goes to *Cleaning* by itself.
5. Sign in as **Owner** and look at Reports — the order, the discount and the payment are already
   in the numbers.

## Scripts

Backend: `npm run dev`, `npm run build`, `npm start`, `npm run seed`, `npm run seed:fresh`,
`npm run typecheck`, `npm test`. `build` bundles the API and then builds the client, since it serves
the client; `seed` is idempotent and `seed:fresh` wipes first.

Frontend: `npm run dev`, `npm run build`, `npm run preview`, `npm run typecheck`.

The test suites cover pricing and GST rounding, order creation and the state machine, booking
availability and lifecycle, one combined bill per table and the cash handoff (including that a
waiter cannot confirm a payment), the UPI link built from a bill total, and the signature checks on
both payment and delivery webhooks. `cd backend && npm test` — 129 tests across 14 files.

## Configuration

Everything the backend reads lives in `backend/.env`; see `.env.example` for the annotated list.
The important ones:

- `ARCHIVE_DIR` — the folder the records live in. Default `.data/archive`, relative to where the
  server was started.
- `AUTO_SEED` — set to `false` to boot an untouched archive clean instead of loading the demo
  tenant into it.
- `STATIC_DIR` — only needed if the built client is not at `../frontend/dist`; when that folder
  exists the API serves the whole app itself.
- `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` — change both before deploying anywhere.
- `PUBLIC_BASE_URL` — the host printed into QR codes and guest bill links. On a deployed
  instance it is never allowed to be a laptop address, since no customer's phone can open one;
  left unset it becomes the demo client's own domain, because those links are pages and the API
  host serves none.
- `PAYMENT_WEBHOOK_SECRET`, `SWIGGY_WEBHOOK_SECRET`, `ZOMATO_WEBHOOK_SECRET` — HMAC keys the
  gateway and partners sign with; every webhook body is compared against the signature before it
  is trusted.

## Deploying

One service runs the whole product. `npm run build` in `backend/` bundles the API to `backend/dist`
and builds the client to `frontend/dist`, which Express then serves on `/` with an SPA fallback for
deep links like `/app/orders`. Because the browser talks to a single origin, `/api`, `/uploads` and
`/socket.io` need no proxy, no absolute API base and no CORS allowance.

**Render.** `render.yaml` is a Blueprint (**New → Blueprint**, point it at this repo); on a service
you created by hand, set root directory `backend`, build `npm install && npm run build`, start
`node dist/server.js`, health check `/api/health`. The host tells the app its own public URL through
`RENDER_EXTERNAL_URL`, and the config reads it for the socket allowlist. The host printed into QR
codes, guest bill links and booking links is the demo client's domain rather than the service's own,
because those are pages and the address a customer reaches for them is the one in front — set
`PUBLIC_BASE_URL` to point them somewhere else.

The archive is the one real decision:

- **Leave it where it falls** and the records are folders of JSON lines under `ARCHIVE_DIR`
  (`.data/archive`) on the container's own disk. Booting an empty archive loads the demo tenant
  automatically (`AUTO_SEED`), so the site is usable the moment it starts — and everything the
  previous container recorded is gone after a redeploy, because the free plan recreates that folder
  empty.
- **Attach a persistent disk** mounted at that path if the hosted archive has to survive a deploy.
  It is also what lets a Render shell see the same records the service is serving, since the shell is
  a separate container.
- **Set `NODE_ENV=production`**: the process then refuses to boot on a token secret that is still the
  development default or this template's `change-me` value, and the demo master password answers to
  nothing. Pair it with generated secrets (`openssl rand -hex 32`).
- `MONGODB_URI` is not read by anything under `src/` any more — the files are the database.

The free tier sleeps after inactivity, so the first request after a quiet period takes ~30 seconds;
`/api/health` warms it. Uploaded menu images go to `backend/uploads` on that container's disk, so
they disappear on redeploy — object storage is the fix for a real install.

**One domain in front of two services.** This repo's live demo is `https://smart.restaurant.aniruddhasali.in`
serving the client, with `/api`, `/uploads` and `/socket.io` rewritten to the Render API at
`https://ai-1-hsus.onrender.com`. Because the browser now reaches both halves from the address it is
standing on, `frontend/.env.production` leaves `VITE_API_URL` empty — the client calls same-origin
`/api`, exactly like the Vite dev proxy, and no CORS allowance is needed for its own traffic. The
rewrites live in `frontend/vercel.json` and are ordered before the SPA fallback, so a deep link
(`/app`, `/t/<token>`, `/bill/<token>`) still opens the app while `/api` keeps reaching the service.
Vercel cannot carry a WebSocket upgrade through a rewrite, so realtime arrives at the API as Socket.IO
long polling; the old `https://ai-ecru-kappa-14.vercel.app` origin is still allowed, so stickers
printed before the swap keep opening.

The API's own config carries both client addresses (`demoClients` in `backend/src/config/env.ts`), so
the socket allowlist, the printed QR codes and the guest bill links come out right without a dashboard
variable. To move the demo to another domain, edit that list, point the rewrites at the new pair, and
only set `PUBLIC_BASE_URL` if the pages should open somewhere else than the first entry. Anywhere
other than Render: serve `frontend/dist` from any static host, put that host in `CORS_ORIGIN`, and set
`VITE_API_URL` to the API's origin if the host cannot proxy `/api` itself.

The ordered version of all of this — the build to prove first, every environment variable by name with
what each one governs, the persistent-disk decision, what a push does to the live demo, and the
checklist to run once it answers — is [`DEPLOYMENT.md`](DEPLOYMENT.md).

## What is deliberately mocked

- **Payments** run through a mock provider. A card/UPI settlement needs the explicit
  `POST /payments/:id/simulate` call the counter makes, because a payment is only ever marked
  paid by the server — never by the browser.
- **Delivery partners** expose real webhook receivers with signature checks and a "receive a test
  order" button, but no live Swiggy or Zomato credentials. Consumer sites are not scraped; only
  official partner APIs would be wired here.
- **Uploads** write to `backend/uploads` and are served from `/uploads`. Move to object storage for
  production.
- The payment gateway keys are read from the environment; the RAZORPAY_* variables are placeholders
  until a real account exists.
