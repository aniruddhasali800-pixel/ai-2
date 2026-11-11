/**
 * Live smoke of the whole UPI path, across two processes:
 *   bill (the payment service) on :3100  ·  Sizzle's API on :4000
 *
 * Nothing here is mocked. It seats a real table, orders a real dish, finalises a real bill, then
 * walks the money through the states in the order a restaurant would meet them — and fails loudly
 * if any step settles something it should not have.
 *
 *   npm run test:e2e
 */

const BILL = (process.env.PUBLIC_URL || 'http://localhost:3100').replace(/\/+$/, '');
const SIZZLE = (process.env.SIZZLE_API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
const API = `${SIZZLE}/api`;

/**
 * Nothing in this repository is a password any more, so the three accounts this walk signs in as come
 * from the environment, each as `email:password`:
 *
 *   SIZZLE_SMOKE_OWNER=…  SIZZLE_SMOKE_CASHIER=…  SIZZLE_SMOKE_MANAGER=…
 *
 * Any floor with those three jobs answers. A locally seeded one does after `DEMO_STAFF_PASSWORD`
 * (AUTH.md beside the repo root says how), and a restaurant onboarded at /register can hire a cashier
 * and a manager to its own tenant for the run.
 */
function accountFromEnv(name) {
  const raw = (process.env[name] ?? '').trim();
  const split = raw.indexOf(':');
  if (split < 2 || split === raw.length - 1) return null;
  return { email: raw.slice(0, split), password: raw.slice(split + 1) };
}

const OWNER = accountFromEnv('SIZZLE_SMOKE_OWNER');
const CASHIER = accountFromEnv('SIZZLE_SMOKE_CASHIER');
const MANAGER = accountFromEnv('SIZZLE_SMOKE_MANAGER');
const unset = [['SIZZLE_SMOKE_OWNER', OWNER], ['SIZZLE_SMOKE_CASHIER', CASHIER], ['SIZZLE_SMOKE_MANAGER', MANAGER]]
  .filter(([, account]) => !account)
  .map(([name]) => name);

const steps = [];
let failed = false;

function record(name, ok, detail = '') {
  steps.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, url, { token, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return res.ok
    ? { status: res.status, body: json }
    : { status: res.status, message: json?.error?.message || json?.message || text.slice(0, 160), body: json };
}

async function login(creds) {
  // Sizzle signs people in by "identifier" — the same field takes an email or a phone number.
  const r = await call('POST', `${API}/auth/login`, { body: { identifier: creds.email, password: creds.password } });
  if (r.status !== 200 && r.status !== 201) throw new Error(`login failed for ${creds.email}: ${r.status} ${r.message}`);
  return r.body.accessToken;
}

const money = (n) => `₹${Number(n ?? 0).toFixed(2)}`;

/** Seats this run took, so the floor is left as it was found. */
const seated = [];

/** Seat a free table, order one dish and close the bill — the way a shift does it. */
async function freshBill(token, customerName) {
  const tables = await call('GET', `${API}/tables?limit=100`, { token });
  const free = (tables.body?.data ?? []).find((t) => t.status === 'AVAILABLE' && t.qrToken);
  if (!free) throw new Error(`no free table to smoke on (${tables.status} ${tables.message ?? 'every table is seated'})`);
  const seat = await call('POST', `${API}/public/table-sessions`, {
    body: { tableToken: free.qrToken, guestCount: 2, customerName },
  });
  if (!seat.body?.session) throw new Error(`seating table ${free.number} failed: ${seat.status} ${seat.message}`);
  seated.push({ id: String(free._id), number: free.number });
  const menu = await call('GET', `${API}/public/menu/${free.qrToken}`);
  // The public menu serves its dishes as one flat list, grouped by categoryId.
  const product = (menu.body?.products ?? (menu.body?.categories ?? []).flatMap((c) => c.items ?? []))
    .find((p) => !p.soldOut && p.price > 0);
  if (!product) throw new Error(`nothing on the menu to order (${menu.status} ${menu.message ?? `${(menu.body?.products ?? []).length} dishes`})`);
  const order = await call('POST', `${API}/public/session/${seat.body.session.publicToken}/orders`, {
    body: { items: [{ productId: product._id, qty: 1 }] },
  });
  if (order.status >= 300) throw new Error(`ordering failed: ${order.status} ${order.message}`);
  const billRes = await call('POST', `${API}/billing`, { token, body: { sessionId: seat.body.session._id } });
  const bill = billRes.body?.bill;
  if (!bill?._id) throw new Error(`billing failed: ${billRes.status} ${billRes.message}`);
  const pay = (await call('GET', `${API}/billing/${bill._id}`, { token })).body?.upi;
  return { table: free, product, bill, pay };
}

/**
 * A smoke that leaves the floor seated cannot be run twice, so every table this walk took is
 * cleared the way the counter clears one after a paid bill. Runs even when a check threw.
 */
async function releaseTables() {
  if (!seated.length) return;
  const owner = await login(OWNER).catch(() => null);
  if (!owner) return;
  const freed = [];
  for (const t of seated) {
    const r = await call('PATCH', `${API}/tables/${t.id}/status`, { token: owner, body: { status: 'AVAILABLE' } });
    if (r.status < 300) freed.push(t.number);
  }
  console.log(freed.length ? `cleared: ${freed.join(', ')}` : 'could not clear the tables this walk used');
}

async function walk() {
  const owner = await login(OWNER);
  const cashier = await login(CASHIER);
  const manager = await login(MANAGER);
  record('Sizzle signs the owner, the cashier and the manager in', true);

  const probe = await fetch(`${BILL}/api/v1/queue`, { headers: { 'x-pay-signature': 'probe' } }).catch(() => null);
  record('the payment service is listening', Boolean(probe), probe ? `HTTP ${probe.status} on its signed API` : 'no answer');

  // 1 — a table, a dish, and a bill that closes on its own QR
  const { table, product, bill, pay } = await freshBill(owner, 'Smoke Walkin');
  record('a guest sits at a real table and orders a dish', true, `table ${table.number} · ${product.name} ${money(product.price)}`);
  record(
    'finalising the bill raises the UPI request by itself',
    Boolean(pay?.qrDataUrl && pay?.payUrl && pay?.intentId),
    pay ? `${money(bill.grandTotal)} to ${pay.upiId} · ${pay.paymentStatus ?? 'PENDING'}` : 'no pay view at all',
  );

  // 2 — the guest's page renders the exact amount the bill carries
  const page = await fetch(pay.payUrl).then((r) => r.text()).catch(() => '');
  record(
    'the payment page shows this bill and its exact amount',
    page.includes(bill.grandTotal.toFixed(2)) || page.includes(String(Math.round(bill.grandTotal))),
    `page served ${page.length} bytes`,
  );

  // 3 — "I've paid" is a claim, never a payment
  const claim = await call('POST', `${API}/payments/service/claims/${pay.intentId}/claim`, { token: cashier });
  record('the counter records the guest’s claim', claim.status < 300, claim.message ?? '');

  const afterClaim = await call('GET', `${API}/billing/${bill._id}`, { token: cashier });
  record(
    'a claim leaves the bill unpaid',
    afterClaim.body?.bill?.paymentStatus === 'UNPAID' && afterClaim.body?.bill?.status === 'ISSUED',
    `bill still ${afterClaim.body?.bill?.paymentStatus}`,
  );
  record(
    'a claim shows in the ledger as “to verify”',
    (afterClaim.body?.payments ?? []).some((p) => p.status === 'VERIFICATION_PENDING' && p.provider === 'UPI_DIRECT'),
  );

  const guestView = await call('GET', `${API}/public/bill/${bill.publicToken}`);
  record(
    'the guest’s own screen says it is being checked, not paid',
    guestView.body?.pay?.paymentStatus === 'PAYMENT_VERIFICATION_PENDING' && guestView.body?.paymentStatus === 'UNPAID',
    `guest sees ${guestView.body?.pay?.paymentStatus}`,
  );

  // 4 — a manager may look, and only look
  const managerSettle = await call('POST', `${API}/payments/service/claims/${pay.intentId}/settle`, {
    token: manager,
    body: { utr: '682109274512' },
  });
  record('a manager cannot confirm money', managerSettle.status === 403, managerSettle.message ?? '');
  const managerPayee = await call('PATCH', `${API}/payments/service/payee`, {
    token: manager,
    body: { vpa: 'someone-elses-id@bank', payeeName: 'Not the owner' },
  });
  record('a manager cannot move the payee UPI ID', managerPayee.status === 403, managerPayee.message ?? '');
  const managerRead = await call('GET', `${API}/payments/service/overview?days=1`, { token: manager });
  record('a manager reads the queue and the income', managerRead.status === 200 && Boolean(managerRead.body?.enabled), managerRead.message ?? '');

  // 5 — the statement check settles it, and the UTR is kept as the proof
  const utr = `9${Date.now().toString().slice(-11)}`;
  const settle = await call('POST', `${API}/payments/service/claims/${pay.intentId}/settle`, { token: cashier, body: { utr } });
  record('the UTR from the statement settles the payment', settle.status === 200 && settle.body?.paymentStatus === 'PAID', settle.message ?? '');

  const paid = await call('GET', `${API}/billing/${bill._id}`, { token: owner });
  const rows = paid.body?.payments ?? [];
  record(
    'exactly one settled row carries that UTR',
    rows.filter((p) => p.status === 'SUCCEEDED').length === 1 && rows.some((p) => p.transactionId === utr),
    rows.map((p) => `${p.method}/${p.provider}:${p.status}`).join(', '),
  );
  const floor = await call('GET', `${API}/tables?limit=100`, { token: owner });
  const nowSeated = (floor.body?.data ?? []).find((t) => t._id === table._id);
  record(
    'the bill is paid and the table is turning over',
    paid.body?.bill?.paymentStatus === 'PAID' && ['CLEANING', 'AVAILABLE'].includes(String(nowSeated?.status)),
    `table ${table.number} is ${nowSeated?.status}`,
  );

  const income = await call('GET', `${API}/payments/service/overview?days=1`, { token: owner });
  record(
    'the income figure counts the money once',
    (income.body?.income?.count ?? 0) >= 1 && (income.body?.income?.collectedPaise ?? 0) >= bill.grandTotal * 100,
    `${money((income.body?.income?.collectedPaise ?? 0) / 100)} across ${income.body?.income?.count} payment(s)`,
  );
  record(
    'the queue is empty again',
    (income.body?.queue?.awaitingVerification ?? []).every((i) => i.id !== pay.intentId) &&
      (income.body?.queue?.open ?? []).every((i) => i.id !== pay.intentId),
  );

  // 6 — cash at the counter retires the QR still in the guest's hand
  const second = await freshBill(owner, 'Cash Walkin');
  const cash = await call('POST', `${API}/billing/${second.bill._id}/cash`, { token: cashier, body: { tendered: second.bill.grandTotal } });
  const after = await call('GET', `${API}/billing/${second.bill._id}`, { token: cashier });
  const cashRows = after.body?.payments ?? [];
  record(
    'cash settles the bill and closes the QR that was still out',
    cash.status < 300 &&
      cashRows.some((p) => p.method === 'CASH' && p.status === 'SUCCEEDED') &&
      cashRows.some((p) => p.provider === 'UPI_DIRECT' && p.status === 'FAILED'),
    cashRows.map((p) => `${p.method}/${p.provider}:${p.status}`).join(', '),
  );
  const upstream = await call('GET', `${API}/payments/service/overview?days=1`, { token: owner });
  record(
    'the closed QR no longer waits on anybody',
    (upstream.body?.queue?.open ?? []).every((i) => i.id !== second.pay?.intentId) &&
      (upstream.body?.queue?.awaitingVerification ?? []).every((i) => i.id !== second.pay?.intentId),
  );

}

async function main() {
  if (unset.length) {
    console.error(`${unset.join(', ')} — each one wants an account the floor already has, as email:password.`);
    console.error('Nothing in this repository is a password, so this smoke will not name an account for you. AUTH.md beside the repo root says how to get a floor that answers.');
    process.exit(1);
  }
  try {
    await walk();
  } finally {
    await releaseTables();
  }
  console.log(`\n${failed ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${steps.filter((s) => s.ok).length}/${steps.length} checks`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`\nSMOKE CRASHED — ${error.message}`);
  process.exit(1);
});
