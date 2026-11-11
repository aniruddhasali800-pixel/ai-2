# UPI QR ordering system

Order collection with **direct UPI payments** — the customer pays the merchant's own UPI ID
through Google Pay / PhonePe / Paytm. No payment gateway, no API keys, no mid-way hold of funds.

Built with Next.js 16 (App Router, Server Actions), Prisma 7 + SQLite, Tailwind 4.

---

## Run it

```bash
npm install
npm run setup:env      # writes .env (DATABASE_URL + a random APP_SECRET)
npm run db:push        # creates dev.db from prisma/schema.prisma
npm run db:seed        # menu, staff logins, demo UPI payee
npm run dev            # http://localhost:3100
```

Sizzle's backend is configured to call this service on **3100** (`BILL_SERVICE_BASE_URL`), so keep
that port. Pairing needs the same secret on both sides — `BILL_SERVICE_SHARED_SECRET` in
`backend/.env` and `SIZZLE_SHARED_SECRET` here — plus `SIZZLE_API_BASE_URL` and `PUBLIC_URL`
(the address a guest's QR points at). With those set, finalising a bill in Sizzle raises the
payment request here by itself; without them Sizzle keeps its own UPI flow and nothing breaks.

| Role | Login | Password |
| --- | --- | --- |
| Owner | `SEED_OWNER_EMAIL` | `SEED_OWNER_PASSWORD` |
| Manager | `SEED_MANAGER_EMAIL` | `SEED_MANAGER_PASSWORD` |
| Cashier | `SEED_CASHIER_EMAIL` | `SEED_CASHIER_PASSWORD` |

No password is published for this service. `npm run setup:env` writes a generated one per role into
the gitignored `.env`, `npm run db:seed` puts those accounts in with those passwords, and a role whose
variable is left unset is skipped rather than created on a guess. Only an **owner** can edit Payment
Settings; a manager reads the queue, a cashier verifies payments.

The live smoke of the whole money path, `npm run test:e2e`, signs into *Sizzle's* floor rather than
this service's, so it wants `SIZZLE_SMOKE_OWNER`, `SIZZLE_SMOKE_CASHIER` and `SIZZLE_SMOKE_MANAGER` as
`email:password` for accounts that exist there. See `AUTH.md` in the repository root.

Production: `npm run build && npm start`. Set `APP_SECRET` to a stable value — losing it makes
the stored UPI ID and all sessions unreadable.

---

## The payment rule this app is built around

A QR code, an opened UPI app, a clicked button, or the browser returning to the site are all
**claims** of payment. None of them is proof, because direct UPI transfers give this site nothing
to verify against. So:

> **No customer action can ever produce `PAID`.** Only staff verification (or, later, a provider
> webhook) can settle an order.

Enforced in one place — the transition table in `src/lib/payments/status.ts`:

| From | → PENDING | → VERIFICATION_PENDING | → PAID | → FAILED | → CANCELLED |
| --- | --- | --- | --- | --- | --- |
| `PENDING` | — | customer, staff | staff, provider | staff, provider | customer, staff |
| `PAYMENT_VERIFICATION_PENDING` | — | — | staff, provider | staff, provider | staff |
| `PAID` / `FAILED` / `CANCELLED` | terminal in every direction ||||

`PAID` additionally requires a **bank reference (UTR)** — the UI and the action both refuse without
one — and the row is written with compare-and-swap on the previous status, so two staff members
verifying the same order at once cannot both win.

### Statuses

Payment: `PENDING` → `PAYMENT_VERIFICATION_PENDING` → `PAID` | `FAILED` | `CANCELLED`

Order lifecycle (separate axis): `AWAITING_PAYMENT` → `IN_KITCHEN` → `READY` → `COMPLETED`,
plus `CANCELLED`. A `PAID` payment is what moves an order into `IN_KITCHEN`; the kitchen board
queries lifecycle status, so unpaid, failed and cancelled orders can't appear there.

---

## Flow

1. **Customer** picks items (`/`) → `createOrderAction` → order row + frozen payee + total.
   Prices are read from the menu table, never from the request, so a tampered cart can't lower
   the amount. Money is integer **paise** end to end.
2. **`/pay/<token>`** (unguessable 22-char token; the numeric order code is never a credential)
   renders the QR plus an `upi://pay?...` deep link. The QR PNG is generated server-side and
   passed as a data URL.
3. Customer scans / taps **Open UPI App**, then **I've Completed Payment** → status becomes
   `PAYMENT_VERIFICATION_PENDING`, with the copy *"Payment submitted. Payment verification pending."*
   The page polls `/api/pay/<token>/status` every 5s, so confirmation appears without a refresh.
4. **Staff** (`/admin`) sees the claim with amount, items, customer and payee VPA, checks their
   own UPI/bank statement, enters the UTR and clicks **Mark Paid** / **Mark Failed** / **Cancel**.
5. Marking paid pushes the order to **`/admin/kitchen`**.

### UPI URI

```
upi://pay?pa=<vpa>&pn=<payee name>&am=<rupees>&cu=INR&tn=Order%20%23<code>&tr=<code>
```

`tr` is the order code, so a bank statement line can be matched to an order by searching the
admin board. Built only by `src/lib/payments/upi.ts` (validated VPA, exact 2-decimal amount,
length caps, percent-encoding) so the QR and the deep link can never disagree.

---

## Layout

```
prisma/schema.prisma        Order, OrderItem, Customer, MenuItem, User,
                            PaymentSetting (encrypted VPA), PaymentEvent (audit)
src/lib/payments/
  status.ts                 payment + order state machines, customer copy
  upi.ts                    upi://pay URI builder and parser
  types.ts                  PaymentProviderAdapter interface
  upi-direct.ts             UPI adapter (canSettle = false)
  registry.ts               provider lookup by id
  service.ts                transitionPayment(), intent rebuild, queues, kitchen ladder
src/lib/{money,db,crypto,settings,orders}.ts
src/lib/auth/session.ts     signed cookie + requireStaff/requireAdmin
src/lib/actions/            customer.ts, staff.ts, auth.ts (all 'use server')
src/components/             UpiPayment, UpiQrCode, PaymentStatus, PaymentVerification,
                            PaymentSettings, Cart, LoginForm
src/app/                    / (menu) · /pay/[token] · /login · /admin{,/kitchen,/settings}
                            /api/pay/[token]/status
tests/                      32 tests, incl. decoding the QR image back to text
```

**Security notes**

* Payee VPA is AES-256-GCM encrypted at rest; the settings UI only ever shows `dem••••@okhdfcbank`,
  and saving requires re-typing it — a payee change is never a side effect.
* Sessions are HMAC-signed, `httpOnly`, `SameSite=Lax`, and re-checked against the user row on
  every staff action, so a deleted or demoted account loses access immediately.
* Every status change appends a `PaymentEvent` (actor, from, to, reference).
* The status API returns only two status strings — no VPA, UTR or customer data.

---

## Adding a gateway or webhook later

The order flow only knows the `PaymentProviderAdapter` interface. To add Razorpay/Cashfree-style
API confirmation:

1. Write `src/lib/payments/<provider>.ts` implementing the interface, with **`canSettle = true`**
   and a real `queryStatus()`.
2. `registerPaymentProvider(adapter)` in `registry.ts`.
3. Add a route handler for the provider's webhook that verifies its signature, then calls
   `transitionPayment({ actor: 'PROVIDER', to: 'PAID', reference: <provider txn id> })`.

Nothing else changes: `transitionPayment` already rejects a `PROVIDER` actor whose adapter has
`canSettle = false`, and `PaymentEvent.actorType = 'PROVIDER'` already exists for the audit trail.
Stored orders keep the `paymentMethod` they were created with, so old and new providers coexist.

---

## Tests

```bash
npm test        # 32 unit tests (status machine, UPI URI, money, crypto, QR image decode)
npm run lint
```

`tests/qr-code.test.ts` renders a real payment QR, then decodes the PNG with `jsqr` and asserts
the scanned text equals the intended `upi://pay` URI — it checks what a phone would read, not
what we meant to draw.

The ten flow checks below were each run by hand in a browser against `npm start` — add them as a
regression suite when the app grows enough to deserve one:

1. Place an order from the menu → order row and `/pay/<token>` link are created.
2. The QR amount equals the menu prices summed in paise (`am=119.00`, never `11,900`).
3. The QR image decodes to the exact `upi://pay` URI the page also offers as a link.
4. Scanning it with a UPI app opens a pre-filled request for the right payee and amount.
5. "Pay with UPI App" opens the same request on a phone.
6. "I've Completed Payment" moves the order to `PAYMENT_VERIFICATION_PENDING` and the page says
   the payment will be verified — it never says successful.
7. The order appears in the staff verification queue with its amount and frozen payee.
8. "Mark paid" without a UTR is refused; with one it sets `PAID`.
9. The order appears on the kitchen board immediately afterwards.
10. `FAILED` and `CANCELLED` orders stay out of the kitchen board and out of `PAID` counts.
