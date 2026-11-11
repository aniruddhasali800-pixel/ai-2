import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { buildUpiUri } from '../src/lib/payments/upi';
import { qrDataUrl } from '../src/lib/payments/qr';

/**
 * What a phone reads is the contract. This renders a real payment QR and decodes the image
 * back to text, so the picture can never disagree with the deep link the page also offers.
 */
test('the QR image decodes to exactly the intended upi:// URI', async () => {
  const uri = buildUpiUri({
    vpa: 'demo-cafe@okhdfcbank',
    payeeName: 'Demo Cafe',
    amountPaise: 152_000,
    note: 'Bill INV-20261007-0004',
    transactionRef: 'INV-20261007-0004',
  });

  const dataUrl = await qrDataUrl(uri);
  assert.match(dataUrl, /^data:image\/png;base64,/);

  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
  const found = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(found, 'the QR image did not decode at all');
  assert.equal(found.data, uri);
});

test('two different bills never share a QR', async () => {
  const one = await qrDataUrl(buildUpiUri({ vpa: 'sizzle-demo@okicici', payeeName: 'Cafe', amountPaise: 100, note: 'n', transactionRef: 'INV-1' }));
  const two = await qrDataUrl(buildUpiUri({ vpa: 'sizzle-demo@okicici', payeeName: 'Cafe', amountPaise: 101, note: 'n', transactionRef: 'INV-2' }));
  assert.notEqual(one, two);
});
