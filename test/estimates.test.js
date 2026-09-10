// test/estimates.test.js
const { findOrCreateContact } = require('../server/zoho/contacts');
const { createEstimate } = require('../server/zoho/estimates');

function makeClient(handlers) {
  return {
    calls: [],
    async request(method, path, body) {
      this.calls.push({ method, path, body });
      const key = `${method} ${path.split('?')[0]}`;
      const handler = handlers[key];
      if (!handler) throw new Error(`no handler for ${key}`);
      return handler({ method, path, body });
    },
  };
}

const customer = { name: 'Home Owner', email: 'ho@example.com' };

describe('findOrCreateContact', () => {
  test('returns existing contact id when email matches', async () => {
    const client = makeClient({
      'GET /contacts': () => ({ contacts: [{ contact_id: 'C1' }] }),
    });
    const id = await findOrCreateContact(client, customer);
    expect(id).toBe('C1');
  });

  test('creates a contact when none found', async () => {
    const client = makeClient({
      'GET /contacts': () => ({ contacts: [] }),
      'POST /contacts': () => ({ contact: { contact_id: 'C2' } }),
    });
    const id = await findOrCreateContact(client, customer);
    expect(id).toBe('C2');
    const create = client.calls.find((c) => c.method === 'POST');
    expect(create.body.contact_name).toBe('Home Owner');
  });
});

describe('createEstimate', () => {
  const form = {
    quotationNo: 'Q-1', inquiryNo: 'I-1', date: '2026-09-10', subject: 'S',
    customer,
    lineItems: [{ goodsType: 'Panel', description: 'd', unit: 'PCS', quantity: 1, unitPrice: 10 }],
    terms: { priceTerm: 'x', delivery: 'x', payment: 'x', warranty: 'x', validity: 'x' },
  };

  test('finds contact then creates estimate as draft', async () => {
    const client = makeClient({
      'GET /contacts': () => ({ contacts: [{ contact_id: 'C1' }] }),
      'POST /estimates': ({ body }) => {
        expect(body.customer_id).toBe('C1');
        expect(body.line_items[0].tax_id).toBe('TAX-15');
        return { estimate: { estimate_id: 'E9', estimate_number: 'EST-000009' } };
      },
    });
    const res = await createEstimate(client, form, 'TAX-15');
    expect(res).toEqual({ estimateId: 'E9', estimateNumber: 'EST-000009' });
  });
});
