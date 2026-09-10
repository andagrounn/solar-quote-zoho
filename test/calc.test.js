// test/calc.test.js
const { roundMoney, lineTotal, computeTotals } = require('../server/calc');

describe('roundMoney', () => {
  test('rounds half up to 2 decimals', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.344)).toBe(2.34);
    expect(roundMoney(10)).toBe(10);
  });
});

describe('lineTotal', () => {
  test('multiplies quantity by unit price rounded to 2dp', () => {
    expect(lineTotal({ quantity: 3, unitPrice: 250.5 })).toBe(751.5);
    expect(lineTotal({ quantity: 0, unitPrice: 99 })).toBe(0);
  });
});

describe('computeTotals', () => {
  test('sums line totals, applies GCT, returns grand total', () => {
    const items = [
      { quantity: 2, unitPrice: 100 },  // 200
      { quantity: 1, unitPrice: 50.5 }, // 50.5
    ];
    expect(computeTotals(items, 0.15)).toEqual({
      subTotal: 250.5,
      gct: 37.58,   // 250.5 * 0.15 = 37.575 -> 37.58
      total: 288.08,
    });
  });

  test('empty list yields zeros', () => {
    expect(computeTotals([], 0.15)).toEqual({ subTotal: 0, gct: 0, total: 0 });
  });
});
