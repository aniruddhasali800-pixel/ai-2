# Tester sign-in

There is no tester password in this repository, and that is deliberate: a credential committed here
travels to every clone and every deployment, and this app holds bills, payments and guest phone
numbers. So the way in is one of the two below, both of which you type yourself.

## 1. Onboard a restaurant — works anywhere

Open `/register`, choose **Create a restaurant**, and fill in your own name, email or phone, and a
password. You become that tenant's owner, which is the only role holding every permission. This is
the path a real restaurant takes, and the only one available on the hosted demo.

- Live: <https://smart.restaurant.aniruddhasali.in/register>
- Local: <http://localhost:5173/register>

A tenant you create this way starts empty — no dishes, no tables — because that is what a new
restaurant looks like. Fill it from Back office → Menu and Tables.

## 2. Sign into the seeded demo tenant — local, by choice

The seed builds Saffron & Smoke with 35 dishes, 14 tables and fourteen days of order history, and
writes **no email and no password** onto its seven staff rows. To sign into it, name a password of
your own in `backend/.env` (that file is gitignored) and reseed so it reaches those rows:

```
DEMO_STAFF_PASSWORD=<something only you know>
```

```
cd backend && npm run seed:fresh
```

Then sign in with the phone number and that password:

| Job | Phone | Opens |
| --- | --- | --- |
| Owner | `+91 98200 11001` | Back office, reports, settings, staff |
| Manager | `+91 98200 11002` | Back office without settings or integrations |
| Cashier | `+91 98200 11003` | `/pos` — bills, payments, cash drawer |
| Kitchen | `+91 98200 11004` | `/kds` — the pass |
| Waiter | `+91 98200 11005` | `/floor` — tables, ordering, bill requests |

Three more waiters are seeded at `…11006` and `…11007`. The floor jobs can take a one-time code
instead of a password — tap **No password yet — take a code sent to my phone** under the form. There is
no SMS gateway in this build, so only a machine that is not a deployed host shows the code on screen; a
hosted server says plainly that nothing can arrive and points at the password door. The owner and the
manager have no code path at all.

`DEMO_MASTER_PASSWORD` is a separate door that opens any of these accounts without a password of its
own. It defaults to blank on purpose. Set it only while demonstrating, never on a hosted box.

## What an owner reaches

`/app` — dashboard, orders, requests, tables, menu, bookings, inventory, staff, reports, payments,
delivery, audit and settings. The floor screens are at their own addresses and an owner is accepted on
all of them: `/pos` for the till, `/kds` for the pass, `/floor` for the waiter's view. The sidebar
does not list those three, so open the address directly; each carries an **Office** button back.

## If the sign-in is refused

- **"Those credentials do not match our records"** — either the tenant has not been seeded, or it was
  seeded while `DEMO_STAFF_PASSWORD` was unset, so those accounts hold no hash to compare. Set the
  variable and reseed, or use path 1.
- A suspended account is refused before any password is compared. Reseeding clears a suspension.
- A phone number typed without the `+91` still works for the code door (`98200 11005`), but the
  password door matches the number exactly as seeded.
- On the hosted demo, path 2 is not available unless whoever runs that host sets the variable there.

## Before real guests

This is a demo tenant with fake staff, fake tables and mock payments. Before the app holds a real
restaurant's data: keep `DEMO_MASTER_PASSWORD` unset, keep `DEMO_STAFF_PASSWORD` out of any committed
file, and make sure the seeded staff rows in that environment are either deleted from Back office →
Staff or wiped by a reseed. See [DEPLOYMENT.md](DEPLOYMENT.md).
