import { describe, expect, it } from 'vitest';
import {
  computeTotals,
  discountAmountOf,
  externalLines,
  lineTotalOf,
  type PricedLine,
} from '../src/services/pricing.service';
import { round2, roundToRupee } from '../src/utils/money';

function line(partial: Partial<PricedLine> & { price: number; qty: number }): PricedLine {
  const base: PricedLine = {
    productId: null,
    name: 'Line',
    price: 0,
    qty: 1,
    taxPercent: 5,
    station: 'MAIN',
    isVeg: true,
    addons: [],
    notes: '',
    lineTotal: 0,
  };
  const merged = { ...base, ...partial };
  merged.lineTotal = lineTotalOf(merged);
  return merged;
}

describe('money helpers', () => {
  it('rounds bills to the nearest rupee and records the round-off', () => {
    expect(roundToRupee(170.25)).toEqual({ total: 170, roundOff: -0.25 });
    expect(roundToRupee(199.6)).toEqual({ total: 200, roundOff: 0.4 });
    expect(roundToRupee(500)).toEqual({ total: 500, roundOff: 0 });
  });

  it('keeps two decimals without float drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1108.4999999999998)).toBe(1108.5);
  });
});

describe('line totals', () => {
  it('multiplies price plus add-ons by quantity', () => {
    const value = line({
      price: 249.5,
      qty: 3,
      addons: [
        { addonId: null, name: 'Extra gravy', price: 90 },
        { addonId: null, name: 'Extra butter', price: 30 },
      ],
    });
    expect(value.lineTotal).toBe(1108.5);
  });

  it('prices external channel lines at the partner price', () => {
    const lines = externalLines([{ name: 'Butter Chicken', price: 340, qty: 2, notes: 'Less spicy' }], 5);
    expect(lines[0].lineTotal).toBe(680);
    expect(lines[0].taxPercent).toBe(5);
    expect(lines[0].productId).toBeNull();
    expect(lines[0].notes).toBe('Less spicy');
  });
});

describe('discounts', () => {
  it('applies a percentage discount', () => {
    expect(discountAmountOf(640, { type: 'PERCENT', value: 10 })).toBe(64);
  });

  it('applies a flat discount', () => {
    expect(discountAmountOf(640, { type: 'FLAT', value: 100 })).toBe(100);
  });

  it('rejects impossible discounts', () => {
    expect(() => discountAmountOf(640, { type: 'PERCENT', value: 120 })).toThrow(/100%/);
    expect(() => discountAmountOf(640, { type: 'FLAT', value: 900 })).toThrow(/more than/i);
  });

  it('treats a missing or zero discount as no discount', () => {
    expect(discountAmountOf(640)).toBe(0);
    expect(discountAmountOf(640, { type: 'FLAT', value: 0 })).toBe(0);
  });
});

describe('computeTotals', () => {
  it('splits CGST/SGST per tax bucket and charges service on the discounted net', () => {
    const totals = computeTotals({
      lines: [line({ price: 100, qty: 1, taxPercent: 5 }), line({ price: 100, qty: 1, taxPercent: 12 })],
      discount: { type: 'FLAT', value: 50, note: 'Manager gesture' },
      serviceChargePercent: 5,
    });

    expect(totals.subtotal).toBe(200);
    expect(totals.discountAmount).toBe(50);
    expect(totals.serviceCharge).toBe(7.5);
    expect(totals.taxTotal).toBe(12.75);
    expect(totals.grandTotal).toBe(170.25);
    expect(totals.taxBreakup).toEqual([
      { label: 'CGST', percent: 2.5, amount: 1.88 },
      { label: 'SGST', percent: 2.5, amount: 1.87 },
      { label: 'CGST', percent: 6, amount: 4.5 },
      { label: 'SGST', percent: 6, amount: 4.5 },
    ]);
  });

  it('reduces tax buckets proportionally when a discount is applied', () => {
    const noDiscount = computeTotals({ lines: [line({ price: 500, qty: 1, taxPercent: 12 })], serviceChargePercent: 0 });
    const discounted = computeTotals({
      lines: [line({ price: 500, qty: 1, taxPercent: 12 })],
      discount: { type: 'PERCENT', value: 50 },
      serviceChargePercent: 0,
    });

    expect(noDiscount.taxTotal).toBe(60);
    expect(discounted.taxTotal).toBe(30);
    expect(discounted.grandTotal).toBe(280);
  });

  it('handles an empty stack without dividing by zero', () => {
    const totals = computeTotals({ lines: [], serviceChargePercent: 5 });
    expect(totals).toMatchObject({ subtotal: 0, taxTotal: 0, serviceCharge: 0, discountAmount: 0, grandTotal: 0 });
  });
});
