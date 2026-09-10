// test/payload.test.js
const { buildEstimatePayload, assembleNotes } = require('../server/zoho/payload');

const form = {
  quotationNo: 'Q-1001',
  inquiryNo: 'INQ-55',
  date: '2026-09-10',
  subject: 'Rooftop solar system',
  customer: { name: 'Home Owner', email: 'ho@example.com' },
  lineItems: [
    { goodsType: 'Solar Panels', description: '550W mono', unit: 'PCS', quantity: 10, unitPrice: 120, remark: 'black frame' },
    { goodsType: 'Solar Cable', description: '6mm2', unit: 'Meter', quantity: 50, unitPrice: 2, remark: '' },
  ],
  terms: {
    priceTerm: 'EPC turnkey',
    delivery: '30 days',
    payment: '50% advance, 50% before shipment',
    warranty: '60 months on battery',
    validity: '15 days',
  },
};

describe('assembleNotes', () => {
  test('renders each term on a labeled line', () => {
    const notes = assembleNotes(form.terms);
    expect(notes).toContain('Price Term: EPC turnkey');
    expect(notes).toContain('Delivery: 30 days');
    expect(notes).toContain('Terms of Payment: 50% advance, 50% before shipment');
    expect(notes).toContain('Warranty: 60 months on battery');
    expect(notes).toContain('Offer validity: 15 days');
  });
});

describe('buildEstimatePayload', () => {
  const payload = buildEstimatePayload(form, { customerId: 'CUST-9', gctTaxId: 'TAX-15' });

  test('sets top-level estimate fields', () => {
    expect(payload.customer_id).toBe('CUST-9');
    expect(payload.reference_number).toBe('INQ-55');
    expect(payload.estimate_number).toBe('Q-1001');
    expect(payload.date).toBe('2026-09-10');
    expect(payload.subject).toBe('Rooftop solar system');
    expect(payload.notes).toContain('Price Term: EPC turnkey');
  });

  test('maps line items with tax_id attached', () => {
    expect(payload.line_items).toHaveLength(2);
    expect(payload.line_items[0]).toEqual({
      name: 'Solar Panels',
      description: '550W mono',
      unit: 'PCS',
      rate: 120,
      quantity: 10,
      tax_id: 'TAX-15',
    });
  });

  test('omits estimate_number when quotationNo is blank (Zoho auto-numbers)', () => {
    const p = buildEstimatePayload({ ...form, quotationNo: '' }, { customerId: 'C', gctTaxId: 'T' });
    expect(p).not.toHaveProperty('estimate_number');
  });
});
