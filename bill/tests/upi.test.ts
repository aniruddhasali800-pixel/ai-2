import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpiUri, parseUpiUri, UpiUriError } from '../src/lib/payments/upi';

const base = {
  vpa: 'demo-cafe@okhdfcbank',
  payeeName: 'Demo Cafe',
  amountPaise: 11900,
  note: 'Bill INV-20261007-0004',
  transactionRef: 'INV-20261007-0004',
};

test('the URI carries rupees with two decimals, never paise', () => {
  const uri = buildUpiUri(base);
  assert.match(uri, /^upi:\/\/pay\?/);
  assert.match(uri, /am=119\.00/);
});

test('a scan reads back the same payee, amount and reference', () => {
  const parsed = parseUpiUri(buildUpiUri(base));
  assert.equal(parsed.vpa, base.vpa);
  assert.equal(parsed.payeeName, base.payeeName);
  assert.equal(parsed.amountPaise, base.amountPaise);
  assert.equal(parsed.currency, 'INR');
  assert.equal(parsed.note, base.note);
  assert.equal(parsed.transactionRef, base.transactionRef);
});

test('a payee that would silently misroute money is refused', () => {
  for (const vpa of ['', 'nope', 'name', '@bank', 'a@', 'na me@bank', 'x@bank space']) {
    assert.throws(() => buildUpiUri({ ...base, vpa }), UpiUriError, `accepted ${JSON.stringify(vpa)}`);
  }
});

test('amounts must be whole positive paise', () => {
  for (const amountPaise of [0, -100, 119.5]) {
    assert.throws(() => buildUpiUri({ ...base, amountPaise }), UpiUriError, `accepted ${amountPaise}`);
  }
});

test('free text cannot smuggle an extra parameter into the URI', () => {
  const uri = buildUpiUri({ ...base, payeeName: 'Demo&pa=hacker@bank', note: 'a&am=1\nb' });
  const parsed = parseUpiUri(uri);
  assert.equal(parsed.vpa, base.vpa, 'an injected payee must not displace the real one');
  assert.equal(parsed.amountPaise, base.amountPaise, 'an injected amount must not displace the bill total');
  assert.deepEqual(
    [...new URLSearchParams(uri.slice('upi://pay?'.length)).keys()].sort(),
    ['am', 'cu', 'pa', 'pn', 'tn', 'tr'],
    'the URI carries exactly the parameters we chose',
  );
  assert.doesNotMatch(parsed.payeeName, /[&=?#%+]/, 'parameter separators are stripped from display text');
});

test('long payee names are cut, not rejected, so a bill is still payable', () => {
  const parsed = parseUpiUri(buildUpiUri({ ...base, payeeName: 'X'.repeat(120) }));
  assert.equal(parsed.payeeName.length, 50);
});
