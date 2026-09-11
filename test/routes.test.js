// test/routes.test.js
const request = require('supertest');
const { createApp } = require('../server/index');

function makeDeps(overrides = {}) {
  return {
    passcode: 'secret',
    sessionSecret: 'testsecret',
    currency: 'USD',
    gctTaxId: 'TAX-15',
    region: 'com',
    estimateUrlBase: 'https://books.zoho.com/app#/estimates',
    zohoClient: {},
    createEstimateImpl: async () => ({ estimateId: 'E9', estimateNumber: 'EST-9' }),
    ...overrides,
  };
}

const validQuote = {
  quotationNo: 'Q-1', inquiryNo: 'I-1', date: '2026-09-10', subject: 'S',
  customer: { name: 'Home Owner', email: 'ho@example.com' },
  lineItems: [{ goodsType: 'Panel', description: 'd', unit: 'PCS', quantity: 1, unitPrice: 10 }],
  terms: { priceTerm: 'x', delivery: 'x', payment: 'x', warranty: 'x', validity: 'x' },
};

test('health returns ok', async () => {
  const res = await request(createApp(makeDeps())).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});

test('login rejects wrong passcode', async () => {
  const res = await request(createApp(makeDeps()))
    .post('/api/login').send({ passcode: 'nope' });
  expect(res.status).toBe(401);
});

test('quote requires auth', async () => {
  const res = await request(createApp(makeDeps()))
    .post('/api/quote').send(validQuote);
  expect(res.status).toBe(401);
});

test('login then create quote succeeds', async () => {
  const app = createApp(makeDeps());
  const agent = request.agent(app);
  const login = await agent.post('/api/login').send({ passcode: 'secret' });
  expect(login.status).toBe(200);

  const res = await agent.post('/api/quote').send(validQuote);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, estimateId: 'E9', estimateNumber: 'EST-9' });
  expect(res.body.url).toContain('E9');
});

test('quote validation rejects empty line items', async () => {
  const app = createApp(makeDeps());
  const agent = request.agent(app);
  await agent.post('/api/login').send({ passcode: 'secret' });
  const res = await agent.post('/api/quote').send({ ...validQuote, lineItems: [] });
  expect(res.status).toBe(400);
  expect(res.body.details).toHaveProperty('lineItems');
});

test('config reports authRequired true when a passcode is set', async () => {
  const res = await request(createApp(makeDeps())).get('/api/config');
  expect(res.body).toEqual({ authRequired: true });
});

test('open mode: no passcode -> config false and quote works without login', async () => {
  const app = createApp(makeDeps({ passcode: '' }));
  const cfg = await request(app).get('/api/config');
  expect(cfg.body).toEqual({ authRequired: false });

  // no login call at all
  const res = await request(app).post('/api/quote').send(validQuote);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, estimateId: 'E9' });
});

test('surfaces Zoho errors as 502 with details', async () => {
  const app = createApp(makeDeps({
    createEstimateImpl: async () => {
      const err = new Error('Zoho request failed');
      err.status = 400; err.details = { message: 'Invalid value' };
      throw err;
    },
  }));
  const agent = request.agent(app);
  await agent.post('/api/login').send({ passcode: 'secret' });
  const res = await agent.post('/api/quote').send(validQuote);
  expect(res.status).toBe(502);
  expect(res.body.details).toEqual({ message: 'Invalid value' });
});
