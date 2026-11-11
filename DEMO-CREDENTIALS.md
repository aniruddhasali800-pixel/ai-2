# The seeded demo tenant

What `npm run seed` puts on a machine, who the fake staff are, and how to get a password on them.
These are fake people at a fake restaurant in Koregaon Park, Pune — no real money, no real guest data
and no real kitchen.

Live: <https://smart.restaurant.aniruddhasali.in> — one address for the app and its `/api`.
The old client host <https://ai-ecru-kappa-14.vercel.app> still opens, and the API behind both is
<https://ai-1-hsus.onrender.com>.
Local: <http://localhost:5173> · API: <http://localhost:4000>

## There are no committed credentials

This file used to carry a password per job, and the repository carried it to every machine that
cloned it. That is the whole reason it no longer does: a credential in a public repo is a public
door, and this app holds till drawers and guest phone numbers.

What the seed still writes is the restaurant itself — Saffron & Smoke, 35 dishes across 8 categories,
14 tables, about 74 orders over the last fourteen days, bookings, stock and the audit trail — plus the
seven staff rows that history is attributed to. Those rows get a name, a role and a phone number, and
**no email and no password**. On a fresh checkout, every one of them refuses a sign-in.

## The staff

| Job | Name | Phone | Opens |
| --- | --- | --- | --- |
| Owner | Aarav Mehta | `+91 98200 11001` | Back office, reports, settings, staff approvals |
| Manager | Neha Kulkarni | `+91 98200 11002` | Back office without settings or integrations, the hire queue |
| Cashier | Rohit Deshmukh | `+91 98200 11003` | `/pos` — bills, payments, cash drawer |
| Kitchen | Vikram Rathore | `+91 98200 11004` | `/kds` — the cook's line and the veg / non-veg rails |
| Waiter | Sneha Patil | `+91 98200 11005` | `/floor` — table seating, order-taking, bill requests |
| Waiter | Imran Sheikh | `+91 98200 11006` | `/floor` |
| Waiter | Kavya Reddy | `+91 98200 11007` | `/floor` |

## Signing in

Two ways, and neither of them is a password printed in a repository.

**Onboard your own restaurant.** Open `/register`, use **Create a restaurant**, and you are the owner
of a new tenant with your own email and the password you typed. This is the path a real restaurant
takes, and it is the one to use on a hosted instance.

**Sign into the seeded tenant, locally.** Put a password of your choosing in `backend/.env` — that
file is gitignored, which is the point — and reseed so it lands on those seven rows:

```
DEMO_STAFF_PASSWORD=<something only you know>
```

```
cd backend && npm run seed:fresh
```

Sign in with the phone number from the table above and that password. Because the accounts have no
email, the phone number is the identifier.

**The master door.** `DEMO_MASTER_PASSWORD` opens any active account of the demo tenant whether or
not that account holds a password. It defaults to blank — unset in the code, unset on the hosted
demo — and it also answers to nothing when the API runs with `NODE_ENV=production`. Set it only on a
machine you are demonstrating from, and only for as long as the walk-through takes.

## One-time codes

The floor jobs — waiter, cashier, kitchen — can log in from the sign-in screen by tapping **No
password yet — take a code sent to my phone**, typing the phone number above and the six digits that
come back. There is no SMS gateway wired up, so only a machine that is not a deployed host puts the
code on the screen; on a hosted server the form says that no code can arrive and sends the person back
to the password door. That is exactly why the owner and the manager are excluded: a code you can read
off the page should not open the settings or the staff registry.

- Codes last five minutes, work once, and burn after five wrong guesses.
- Maximum three codes per account per fifteen minutes.
- An unknown number, a suspended account and a number belonging to the owner get the same reply as a
  code that was sent, so the form cannot be used to enumerate staff.
- Country code optional — `98200 11005` finds `+91 98200 11005`.
- The owner and the manager have no code path at all, and on a host where `DEMO_STAFF_PASSWORD` is
  unset nobody has a password to type.

## Applying for a job

<https://smart.restaurant.aniruddhasali.in/apply/saffron-and-smoke> — no login. A stranger picks a floor
job, leaves a name and a phone number, and the manager (or the owner) approves or rejects it from
Back office → Staff → *Applications*. An approved applicant becomes an active staff member with that
phone number and can immediately sign in with a one-time code. Only the owner can grant **Manager**; a
manager's approve box will not offer it.

## Guest links — nothing to sign in

| Link | What it is |
| --- | --- |
| `/t/<tableToken>` | The table's QR menu — dine-in ordering, seats itself |
| `/eat/saffron-and-smoke` | The storefront app: delivery and takeaway, installable |
| `/s/<sessionToken>` | One live table: order status and the running bill |
| `/bill/<billToken>` | A printed receipt with its UPI QR |
| `/track/<token>` | A delivery order's progress |
| `/book/saffron-and-smoke` | Reservations |
| `/staff.html` | The one code that installs the staff app for any role |

Tokens change whenever the archive reseeds, so copy the current ones from Back office → Tables, or
just tap a card on the hub at `/` — it opens the screen for whoever is already signed in. Every code
on screen has **Download PNG** beside it, so a sticker can be saved and printed without the print
dialog.

## Resetting

`cd backend && npm run seed:fresh` wipes the demo tenant and rebuilds it. Plain `npm run seed` leaves
an existing tenant alone. Deleting `backend/.data/archive` has the same effect on next boot, since a
virgin archive auto-seeds. A Render redeploy reseeds too, which is why the live tokens never match
localhost's — and why the live tenant picks up whatever `DEMO_STAFF_PASSWORD` that host has, or no
logins at all if it has none. Set `AUTO_SEED=false` for a clean install.
