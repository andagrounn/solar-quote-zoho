# Solar Quote → Zoho Books Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared-passcode web form that lets sales reps create solar EPC quotations as Draft Estimates in Zoho Books via the Zoho Books API.

**Architecture:** One Node/Express app serves a vanilla-JS static frontend and exposes 3 JSON endpoints. Pure functions handle money math and Zoho payload building (unit-tested with no network). A thin Zoho client caches/refreshes the OAuth access token and is the only place secrets live. No database — Zoho Books is the store.

**Tech Stack:** Node.js (>=18, native `fetch`), Express, cookie-signing via `cookie-parser`, Jest for tests. Vanilla JS/HTML/CSS frontend (no framework, no build step).

**Spec:** `docs/superpowers/specs/2026-09-10-solar-quote-zoho-design.md`

## Global Constraints

- Node.js >= 18 (uses global `fetch`; no `node-fetch` dependency).
- All Zoho secrets (`ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`) and `QUOTE_PASSCODE` exist ONLY server-side in `.env`; never sent to the browser, never logged.
- Currency is USD. Tax is GCT 15%, applied via `ZOHO_GCT_TAX_ID` (Zoho computes tax totals; browser figures are display-only).
- Estimates are created as Draft (never auto-sent).
- Money math rounds to 2 decimals using half-up rounding at each row and on totals.
- Session cookie is `httpOnly`, `SameSite=Lax`, signed with `SESSION_SECRET`.
- Line items are freeform (no Zoho price-list lookup).
- Region-aware Zoho hosts: accounts `https://accounts.zoho.<region>`, API `https://www.zohoapis.<region>/books/v3`, where `<region>` ∈ {`com`, `eu`, `in`, `com.au`}.

---

### Task 1: Project scaffold + money math (`calc.js`)

**Files:**
- Create: `package.json`
- Create: `server/calc.js`
- Create: `.env.example`
- Test: `test/calc.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `roundMoney(n: number): number` — half-up to 2 decimals.
  - `lineTotal(item: {quantity:number, unitPrice:number}): number`
  - `computeTotals(lineItems: Array<{quantity:number, unitPrice:number}>, gctRate: number): { subTotal:number, gct:number, total:number }` — `gctRate` is a fraction (0.15 for 15%).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "solar-quote-zoho",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node server/index.js",
    "test": "jest"
  },
  "dependencies": {
    "cookie-parser": "^1.4.6",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Create `.env.example`**

```
PORT=3000
SESSION_SECRET=
QUOTE_PASSCODE=

ZOHO_REGION=com
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
ZOHO_ORG_ID=
ZOHO_GCT_TAX_ID=
ZOHO_CURRENCY=USD
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Write the failing test**

```js
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
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest test/calc.test.js`
Expected: FAIL — cannot find module `../server/calc`.

- [ ] **Step 6: Implement `server/calc.js`**

```js
// server/calc.js
function roundMoney(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function lineTotal(item) {
  return roundMoney((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0));
}

function computeTotals(lineItems, gctRate) {
  const subTotal = roundMoney(
    lineItems.reduce((sum, item) => sum + lineTotal(item), 0)
  );
  const gct = roundMoney(subTotal * gctRate);
  const total = roundMoney(subTotal + gct);
  return { subTotal, gct, total };
}

module.exports = { roundMoney, lineTotal, computeTotals };
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest test/calc.test.js`
Expected: PASS (all cases).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .env.example server/calc.js test/calc.test.js
git commit -m "feat: project scaffold + money math (calc.js)"
```

---

### Task 2: Zoho estimate payload builder (`zoho/payload.js`)

**Files:**
- Create: `server/zoho/payload.js`
- Test: `test/payload.test.js`

**Interfaces:**
- Consumes: nothing (pure function; totals are recomputed by Zoho, not sent).
- Produces:
  - `buildEstimatePayload(form, config): object` where
    `form = { quotationNo, inquiryNo, date, subject, customer, lineItems, terms }`
    (shape per spec §5) and `config = { customerId, gctTaxId }`.
  - `assembleNotes(terms): string` — formats the footer terms into a notes block.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/payload.test.js`
Expected: FAIL — cannot find module `../server/zoho/payload`.

- [ ] **Step 3: Implement `server/zoho/payload.js`**

```js
// server/zoho/payload.js
function assembleNotes(terms) {
  return [
    `Price Term: ${terms.priceTerm || ''}`,
    `Delivery: ${terms.delivery || ''}`,
    `Terms of Payment: ${terms.payment || ''}`,
    `Warranty: ${terms.warranty || ''}`,
    `Offer validity: ${terms.validity || ''}`,
  ].join('\n');
}

function buildEstimatePayload(form, config) {
  const payload = {
    customer_id: config.customerId,
    reference_number: form.inquiryNo || '',
    date: form.date,
    subject: form.subject || '',
    notes: assembleNotes(form.terms || {}),
    line_items: (form.lineItems || []).map((item) => ({
      name: item.goodsType || '',
      description: item.description || '',
      unit: item.unit || '',
      rate: Number(item.unitPrice) || 0,
      quantity: Number(item.quantity) || 0,
      tax_id: config.gctTaxId,
    })),
  };
  if (form.quotationNo) {
    payload.estimate_number = form.quotationNo;
  }
  return payload;
}

module.exports = { buildEstimatePayload, assembleNotes };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/payload.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/zoho/payload.js test/payload.test.js
git commit -m "feat: Zoho estimate payload builder"
```

---

### Task 3: Zoho OAuth client (`zoho/client.js`)

**Files:**
- Create: `server/zoho/client.js`
- Test: `test/client.test.js`

**Interfaces:**
- Consumes: env config.
- Produces:
  - `createZohoClient(config): { request(method, path, body?), getAccessToken() }`
    where `config = { region, clientId, clientSecret, refreshToken, orgId }`.
    Internally `request` prefixes the API base URL, appends `organization_id`,
    attaches `Authorization: Zoho-oauthtoken <token>`, and refreshes the token
    when missing/expired. `request` returns parsed JSON on 2xx; throws an Error
    with `.status` and `.details` on non-2xx.
  - The client accepts an injectable `fetchImpl` (defaults to global `fetch`) so
    tests can mock HTTP without network.

- [ ] **Step 1: Write the failing test**

```js
// test/client.test.js
const { createZohoClient } = require('../server/zoho/client');

function makeFetchMock(responses) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    const next = responses.shift();
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    };
  };
  impl.calls = calls;
  return impl;
}

const config = {
  region: 'com', clientId: 'cid', clientSecret: 'secret',
  refreshToken: 'rtok', orgId: 'ORG1',
};

test('fetches an access token then performs an authorized request', async () => {
  const fetchMock = makeFetchMock([
    { status: 200, body: { access_token: 'AT123', expires_in: 3600 } },
    { status: 200, body: { estimate: { estimate_id: 'E1' } } },
  ]);
  const client = createZohoClient({ ...config, fetchImpl: fetchMock });
  const res = await client.request('POST', '/estimates', { subject: 'x' });

  expect(res.estimate.estimate_id).toBe('E1');
  // first call = token endpoint
  expect(fetchMock.calls[0].url).toContain('accounts.zoho.com/oauth/v2/token');
  // second call = API with org id + auth header
  expect(fetchMock.calls[1].url).toContain('zohoapis.com/books/v3/estimates');
  expect(fetchMock.calls[1].url).toContain('organization_id=ORG1');
  expect(fetchMock.calls[1].opts.headers.Authorization).toBe('Zoho-oauthtoken AT123');
});

test('reuses a cached token across requests', async () => {
  const fetchMock = makeFetchMock([
    { status: 200, body: { access_token: 'AT123', expires_in: 3600 } },
    { status: 200, body: { ok: true } },
    { status: 200, body: { ok: true } },
  ]);
  const client = createZohoClient({ ...config, fetchImpl: fetchMock });
  await client.request('GET', '/a');
  await client.request('GET', '/b');
  // only ONE token call
  const tokenCalls = fetchMock.calls.filter((c) => c.url.includes('/oauth/v2/token'));
  expect(tokenCalls).toHaveLength(1);
});

test('throws with status and details on API error', async () => {
  const fetchMock = makeFetchMock([
    { status: 200, body: { access_token: 'AT', expires_in: 3600 } },
    { status: 400, body: { code: 4, message: 'Invalid value' } },
  ]);
  const client = createZohoClient({ ...config, fetchImpl: fetchMock });
  await expect(client.request('POST', '/estimates', {})).rejects.toMatchObject({
    status: 400,
    details: { code: 4, message: 'Invalid value' },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/client.test.js`
Expected: FAIL — cannot find module `../server/zoho/client`.

- [ ] **Step 3: Implement `server/zoho/client.js`**

```js
// server/zoho/client.js
function createZohoClient(config) {
  const fetchImpl = config.fetchImpl || fetch;
  const accountsBase = `https://accounts.zoho.${config.region}`;
  const apiBase = `https://www.zohoapis.${config.region}/books/v3`;

  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt) return cachedToken;

    const params = new URLSearchParams({
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    });
    const res = await fetchImpl(`${accountsBase}/oauth/v2/token?${params}`, {
      method: 'POST',
    });
    const body = await res.json();
    if (!res.ok || !body.access_token) {
      const err = new Error('Zoho authentication failed');
      err.status = 502;
      err.details = body;
      throw err;
    }
    cachedToken = body.access_token;
    // refresh 5 minutes before expiry
    tokenExpiresAt = now + (body.expires_in - 300) * 1000;
    return cachedToken;
  }

  async function request(method, path, jsonBody) {
    const token = await getAccessToken();
    const sep = path.includes('?') ? '&' : '?';
    const url = `${apiBase}${path}${sep}organization_id=${config.orgId}`;
    const opts = {
      method,
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    };
    if (jsonBody !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(jsonBody);
    }
    const res = await fetchImpl(url, opts);
    const body = await res.json();
    if (!res.ok) {
      const err = new Error('Zoho request failed');
      err.status = res.status;
      err.details = body;
      throw err;
    }
    return body;
  }

  return { request, getAccessToken };
}

module.exports = { createZohoClient };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/client.test.js`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add server/zoho/client.js test/client.test.js
git commit -m "feat: Zoho OAuth client with token caching"
```

---

### Task 4: Contacts + estimates helpers (`zoho/contacts.js`, `zoho/estimates.js`)

**Files:**
- Create: `server/zoho/contacts.js`
- Create: `server/zoho/estimates.js`
- Test: `test/estimates.test.js`

**Interfaces:**
- Consumes: `createZohoClient` (Task 3) via an injected `client` object with a
  `request(method, path, body?)` method; `buildEstimatePayload` (Task 2).
- Produces:
  - `findOrCreateContact(client, customer): Promise<string>` — returns
    `contact_id`. Searches by email (if present) then by name; creates if none.
  - `createEstimate(client, form, gctTaxId): Promise<{estimateId, estimateNumber}>`
    — calls `findOrCreateContact`, builds payload, POSTs `/estimates`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/estimates.test.js`
Expected: FAIL — cannot find module `../server/zoho/contacts`.

- [ ] **Step 3: Implement `server/zoho/contacts.js`**

```js
// server/zoho/contacts.js
async function findOrCreateContact(client, customer) {
  let found = null;

  if (customer.email) {
    const byEmail = await client.request(
      'GET',
      `/contacts?email=${encodeURIComponent(customer.email)}`
    );
    found = (byEmail.contacts || [])[0];
  }

  if (!found && customer.name) {
    const byName = await client.request(
      'GET',
      `/contacts?contact_name=${encodeURIComponent(customer.name)}`
    );
    found = (byName.contacts || [])[0];
  }

  if (found) return found.contact_id;

  const created = await client.request('POST', '/contacts', {
    contact_name: customer.name,
    ...(customer.email ? { email: customer.email } : {}),
    ...(customer.phone ? { phone: customer.phone } : {}),
  });
  return created.contact.contact_id;
}

module.exports = { findOrCreateContact };
```

- [ ] **Step 4: Implement `server/zoho/estimates.js`**

```js
// server/zoho/estimates.js
const { findOrCreateContact } = require('./contacts');
const { buildEstimatePayload } = require('./payload');

async function createEstimate(client, form, gctTaxId) {
  const customerId = await findOrCreateContact(client, form.customer);
  const payload = buildEstimatePayload(form, { customerId, gctTaxId });
  const res = await client.request('POST', '/estimates', payload);
  return {
    estimateId: res.estimate.estimate_id,
    estimateNumber: res.estimate.estimate_number,
  };
}

module.exports = { createEstimate };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest test/estimates.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/zoho/contacts.js server/zoho/estimates.js test/estimates.test.js
git commit -m "feat: Zoho contacts find-or-create + estimate creation"
```

---

### Task 5: Auth (passcode + session) (`auth.js`)

**Files:**
- Create: `server/auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: env `QUOTE_PASSCODE`.
- Produces:
  - `checkPasscode(input: string, expected: string): boolean` — constant-time compare.
  - `requireSession(req, res, next)` — Express middleware; 401 JSON if
    `req.signedCookies.session !== 'ok'`.

- [ ] **Step 1: Write the failing test**

```js
// test/auth.test.js
const { checkPasscode, requireSession } = require('../server/auth');

describe('checkPasscode', () => {
  test('true for exact match, false otherwise', () => {
    expect(checkPasscode('hunter2', 'hunter2')).toBe(true);
    expect(checkPasscode('wrong', 'hunter2')).toBe(false);
    expect(checkPasscode('', 'hunter2')).toBe(false);
  });
});

describe('requireSession', () => {
  function run(signedCookies) {
    const req = { signedCookies };
    let statusCode = 200;
    let jsonBody = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { jsonBody = b; return this; },
    };
    let nextCalled = false;
    requireSession(req, res, () => { nextCalled = true; });
    return { statusCode, jsonBody, nextCalled };
  }

  test('calls next when session cookie is ok', () => {
    expect(run({ session: 'ok' }).nextCalled).toBe(true);
  });

  test('401 when session cookie missing', () => {
    const r = run({});
    expect(r.statusCode).toBe(401);
    expect(r.nextCalled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/auth.test.js`
Expected: FAIL — cannot find module `../server/auth`.

- [ ] **Step 3: Implement `server/auth.js`**

```js
// server/auth.js
const crypto = require('crypto');

function checkPasscode(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireSession(req, res, next) {
  if (req.signedCookies && req.signedCookies.session === 'ok') return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

module.exports = { checkPasscode, requireSession };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth.js test/auth.test.js
git commit -m "feat: passcode check + session middleware"
```

---

### Task 6: Express app + routes (`index.js`)

**Files:**
- Create: `server/index.js`
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: `checkPasscode`, `requireSession` (Task 5); `createZohoClient` (Task 3);
  `createEstimate` (Task 4); `computeTotals` (Task 1).
- Produces:
  - `createApp(deps): Express` where `deps = { passcode, sessionSecret, currency,
    gctTaxId, region, zohoClient, estimateUrlBase }`. Injecting `zohoClient` lets
    tests avoid live Zoho.
  - Routes: `POST /api/login`, `POST /api/quote` (auth-gated), `GET /api/health`.
  - `server/index.js` also has a bottom block that builds real deps from `process.env`
    and calls `app.listen` when run directly (`require.main === module`).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/routes.test.js`
Expected: FAIL — cannot find module `../server/index`.

- [ ] **Step 3: Implement `server/index.js`**

```js
// server/index.js
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { checkPasscode, requireSession } = require('./auth');
const { computeTotals } = require('./calc');
const { createEstimate } = require('./zoho/estimates');
const { createZohoClient } = require('./zoho/client');

function validateQuote(body) {
  const details = {};
  if (!body || typeof body !== 'object') return { lineItems: 'Missing body' };
  if (!body.customer || !body.customer.name) details.customer = 'Customer name required';
  if (!body.date) details.date = 'Date required';
  if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
    details.lineItems = 'At least one line item required';
  }
  return Object.keys(details).length ? details : null;
}

function createApp(deps) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser(deps.sessionSecret));
  const createEstimateImpl = deps.createEstimateImpl || createEstimate;

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.post('/api/login', (req, res) => {
    const ok = checkPasscode((req.body && req.body.passcode) || '', deps.passcode);
    if (!ok) return res.status(401).json({ error: 'Invalid passcode' });
    res.cookie('session', 'ok', {
      httpOnly: true, sameSite: 'lax', signed: true,
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json({ ok: true });
  });

  app.post('/api/quote', requireSession, async (req, res) => {
    const details = validateQuote(req.body);
    if (details) return res.status(400).json({ error: 'Validation failed', details });

    // recompute totals server-side (display parity; Zoho is authoritative)
    computeTotals(req.body.lineItems, 0.15);

    try {
      const result = await createEstimateImpl(deps.zohoClient, req.body, deps.gctTaxId);
      const url = `${deps.estimateUrlBase}/${result.estimateId}`;
      res.json({ ok: true, ...result, url });
    } catch (err) {
      res.status(502).json({
        error: 'Zoho rejected the request',
        details: err.details || err.message,
      });
    }
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const region = process.env.ZOHO_REGION || 'com';
  const zohoClient = createZohoClient({
    region,
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
    orgId: process.env.ZOHO_ORG_ID,
  });
  const app = createApp({
    passcode: process.env.QUOTE_PASSCODE,
    sessionSecret: process.env.SESSION_SECRET,
    currency: process.env.ZOHO_CURRENCY || 'USD',
    gctTaxId: process.env.ZOHO_GCT_TAX_ID,
    region,
    zohoClient,
    estimateUrlBase: `https://books.zoho.${region}/app#/estimates`,
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`solar-quote-zoho on :${port}`));
}
```

- [ ] **Step 4: Add env loading for `npm start`**

Add `require('dotenv').config();` at the very top of `server/index.js`, and add `dotenv` to dependencies:

Run: `npm install dotenv@^16.4.5`

Then edit the top of `server/index.js` so the first line is:

```js
require('dotenv').config();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest test/routes.test.js`
Expected: PASS (all six cases).

- [ ] **Step 6: Commit**

```bash
git add server/index.js test/routes.test.js package.json package-lock.json
git commit -m "feat: Express app with login/quote/health routes"
```

---

### Task 7: Frontend form (`public/index.html`, `app.js`, `styles.css`)

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/styles.css`

**Interfaces:**
- Consumes: `POST /api/login`, `POST /api/quote` (Task 6).
- Produces: no exports (browser app). Manual verification via the browse skill.

- [ ] **Step 1: Create `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Solar Quotation</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <section id="login" class="card">
    <h1>Sales Quotation</h1>
    <label>Team passcode
      <input id="passcode" type="password" autocomplete="off" />
    </label>
    <button id="loginBtn">Enter</button>
    <p id="loginError" class="error" hidden></p>
  </section>

  <main id="app" hidden>
    <header class="quote-head">
      <div class="head-fields">
        <label>Quotation #<input id="quotationNo" /></label>
        <label>Inquiry #<input id="inquiryNo" /></label>
        <label>Date<input id="date" type="date" /></label>
        <label>Subject<input id="subject" /></label>
      </div>
      <fieldset class="customer">
        <legend>Customer</legend>
        <label>Name<input id="custName" /></label>
        <label>Email<input id="custEmail" type="email" /></label>
        <label>Phone<input id="custPhone" /></label>
      </fieldset>
    </header>

    <table id="items">
      <thead>
        <tr>
          <th>No</th><th>Goods Type</th><th>Description</th><th>Unit</th>
          <th>Quan.</th><th>Unit Price USD</th><th>Total USD</th><th>Remark</th><th></th>
        </tr>
      </thead>
      <tbody id="itemsBody"></tbody>
      <tfoot>
        <tr><td colspan="6">Sub Total (USD)</td><td id="subTotal">0.00</td><td colspan="2"></td></tr>
        <tr><td colspan="6">GCT (15%)</td><td id="gct">0.00</td><td colspan="2"></td></tr>
        <tr><td colspan="6"><strong>Total (USD)</strong></td><td id="total"><strong>0.00</strong></td><td colspan="2"></td></tr>
      </tfoot>
    </table>
    <button id="addRow" type="button">+ Add row</button>

    <fieldset class="terms">
      <legend>Terms</legend>
      <label>Price Term<input id="priceTerm" value="EPC turnkey prices — equipment supply, installation, and commissioning." /></label>
      <label>Delivery<input id="delivery" value="30 days ready for delivery after technical clarification and receipt of written order and payment." /></label>
      <label>Terms of Payment<input id="payment" value="50% advance payment by T/T, 50% balance paid before shipment." /></label>
      <label>Warranty<input id="warranty" value="Battery guaranteed for 60 months from date of delivery. Excludes damage from improper installation or use." /></label>
      <label>Offer validity<input id="validity" value="This offer is valid for 15 days from the quotation date." /></label>
    </fieldset>

    <div class="actions">
      <button id="createBtn" type="button">Create in Zoho</button>
      <p id="result" class="result" hidden></p>
    </div>
  </main>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/styles.css`**

```css
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 1.5rem; color: #1a1a1a; background: #f5f6f8; }
.card { max-width: 360px; margin: 4rem auto; background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
h1 { font-size: 1.25rem; }
label { display: block; margin: .5rem 0; font-size: .85rem; }
input { width: 100%; padding: .45rem; border: 1px solid #cbd2d9; border-radius: 4px; font-size: .9rem; }
button { background: #0b5cad; color: #fff; border: 0; padding: .55rem 1rem; border-radius: 4px; cursor: pointer; font-size: .9rem; }
button:hover { background: #094a8c; }
main { max-width: 1100px; margin: 0 auto; background: #fff; padding: 1.5rem; border-radius: 8px; }
.quote-head { display: flex; gap: 2rem; flex-wrap: wrap; }
.head-fields { flex: 1; min-width: 260px; }
.customer { flex: 1; min-width: 260px; border: 1px solid #e1e5ea; border-radius: 6px; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
th, td { border: 1px solid #d0d6dd; padding: .35rem; font-size: .82rem; text-align: left; }
th { background: #eef1f5; }
td input { border: 0; padding: .3rem; }
tfoot td { background: #f7f9fb; text-align: right; }
.terms { margin-top: 1rem; border: 1px solid #e1e5ea; border-radius: 6px; }
.actions { margin-top: 1rem; }
.error { color: #b00020; font-size: .85rem; }
.result { margin-top: .75rem; font-size: .9rem; }
.result a { color: #0b5cad; }
.row-del { background: #b00020; padding: .25rem .5rem; }
</style>
```

Note: remove the trailing `</style>` line — CSS files contain no `<style>` tags. The file must contain only the CSS rules above.

- [ ] **Step 3: Create `public/app.js`**

```js
const $ = (id) => document.getElementById(id);

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

$('loginBtn').addEventListener('click', async () => {
  const { status } = await post('/api/login', { passcode: $('passcode').value });
  if (status === 200) {
    $('login').hidden = true;
    $('app').hidden = false;
    addRow();
  } else {
    $('loginError').hidden = false;
    $('loginError').textContent = 'Invalid passcode';
  }
});

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function recalc() {
  let sub = 0;
  document.querySelectorAll('#itemsBody tr').forEach((tr) => {
    const q = Number(tr.querySelector('.q').value) || 0;
    const p = Number(tr.querySelector('.p').value) || 0;
    const t = round2(q * p);
    tr.querySelector('.t').textContent = t.toFixed(2);
    sub += t;
  });
  sub = round2(sub);
  const gct = round2(sub * 0.15);
  $('subTotal').textContent = sub.toFixed(2);
  $('gct').textContent = gct.toFixed(2);
  $('total').querySelector('strong').textContent = round2(sub + gct).toFixed(2);
}

function addRow() {
  const tb = $('itemsBody');
  const n = tb.children.length + 1;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${n}</td>
    <td><input class="goods" /></td>
    <td><input class="desc" /></td>
    <td><input class="unit" /></td>
    <td><input class="q" type="number" min="0" step="any" /></td>
    <td><input class="p" type="number" min="0" step="any" /></td>
    <td class="t">0.00</td>
    <td><input class="remark" /></td>
    <td><button type="button" class="row-del">×</button></td>`;
  tb.appendChild(tr);
  tr.querySelector('.q').addEventListener('input', recalc);
  tr.querySelector('.p').addEventListener('input', recalc);
  tr.querySelector('.row-del').addEventListener('click', () => {
    tr.remove();
    renumber();
    recalc();
  });
}

function renumber() {
  document.querySelectorAll('#itemsBody tr').forEach((tr, i) => {
    tr.firstElementChild.textContent = i + 1;
  });
}

$('addRow').addEventListener('click', addRow);

$('createBtn').addEventListener('click', async () => {
  const lineItems = [...document.querySelectorAll('#itemsBody tr')].map((tr) => ({
    goodsType: tr.querySelector('.goods').value,
    description: tr.querySelector('.desc').value,
    unit: tr.querySelector('.unit').value,
    quantity: Number(tr.querySelector('.q').value) || 0,
    unitPrice: Number(tr.querySelector('.p').value) || 0,
    remark: tr.querySelector('.remark').value,
  }));
  const payload = {
    quotationNo: $('quotationNo').value,
    inquiryNo: $('inquiryNo').value,
    date: $('date').value,
    subject: $('subject').value,
    customer: { name: $('custName').value, email: $('custEmail').value, phone: $('custPhone').value },
    lineItems,
    terms: {
      priceTerm: $('priceTerm').value, delivery: $('delivery').value,
      payment: $('payment').value, warranty: $('warranty').value, validity: $('validity').value,
    },
  };
  const result = $('result');
  result.hidden = false;
  result.textContent = 'Creating…';
  const { status, data } = await post('/api/quote', payload);
  if (status === 200) {
    result.innerHTML = `Created estimate ${data.estimateNumber}. <a href="${data.url}" target="_blank" rel="noopener">Open in Zoho</a>`;
  } else {
    result.innerHTML = `<span class="error">Error: ${JSON.stringify(data.details || data.error)}</span>`;
  }
});
```

- [ ] **Step 4: Manual verification with the browse skill**

Start the server with a test env (real Zoho not required for UI check — use a throwaway passcode and expect the quote call to fail at Zoho, which is fine for verifying the form renders and totals compute):

```bash
QUOTE_PASSCODE=test SESSION_SECRET=devsecret PORT=3000 node server/index.js
```

Use the browse skill to:
1. Open `http://localhost:3000`, enter passcode `test`, confirm the form appears.
2. Add 2 rows, type quantities/prices, confirm row totals, Sub Total, GCT (15%), and Total update live.
3. Screenshot the form for the record.

Expected: form renders matching the sample column layout; totals math matches `calc.js`.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat: sales-rep quotation form frontend"
```

---

### Task 8: README + full test/run verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: docs only.

- [ ] **Step 1: Write `README.md`**

````markdown
# Solar Quote → Zoho Books

Web form for sales reps to create solar EPC quotations as **Draft Estimates**
in Zoho Books. Shared passcode; no per-rep logins; no database.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `QUOTE_PASSCODE` — shared team passcode
   - `SESSION_SECRET` — random string
   - `ZOHO_REGION` — `com` | `eu` | `in` | `com.au`
   - `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`
   - `ZOHO_ORG_ID` — Zoho Books organization id
   - `ZOHO_GCT_TAX_ID` — the `tax_id` of your 15% GCT tax in Zoho Books
3. `npm start` → open `http://localhost:3000`

## Finding your GCT tax_id

Call `GET https://www.zohoapis.<region>/books/v3/settings/taxes?organization_id=<org>`
with a valid token and copy the `tax_id` of the 15% GCT entry.

## How it works

- Reps enter passcode → session cookie.
- Fill header, customer, freeform line items, terms.
- "Create in Zoho" finds-or-creates the contact and posts a Draft estimate.
- Zoho computes tax/totals authoritatively; the browser figures are display-only.

## Tests

`npm test` — money math, payload builder, Zoho client, contacts/estimates, routes.
All tests mock Zoho; no network or credentials required.
````

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all suites PASS (`calc`, `payload`, `client`, `estimates`, `auth`, `routes`).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with setup + GCT tax_id lookup"
```

---

## Self-Review

**1. Spec coverage:**
- §2 freeform line items → Task 7 form + Task 2 payload. ✓
- §3 file structure → Tasks 1–8 create exactly those files. ✓
- §4 data flow (login → fill → find/create contact → create estimate → link) → Tasks 5, 7, 4, 6. ✓
- §5 API contract (`/api/login`, `/api/quote`, `/api/health`, status codes, body shape) → Task 6 routes + tests. ✓
- §6 Zoho integration (OAuth refresh + cache, region hosts, org id, contact, estimate, GCT tax_id) → Tasks 3, 4. ✓
- §7 config (.env keys) → Task 1 `.env.example`, Task 6 env wiring. ✓
- §8 error handling (bad passcode 401, validation 400 w/ details, Zoho error 502 verbatim) → Task 6 tests. ✓
- §9 testing (calc, payload, mocked estimates) → Tasks 1, 2, 4 + client/auth/routes. ✓
- §10 security (secrets server-side, httpOnly/SameSite/signed cookie, constant-time passcode) → Tasks 5, 6. ✓
- §11 open config items → README GCT tax_id lookup + `.env.example`. ✓

**2. Placeholder scan:** No TBD/TODO; all code steps contain full implementations. One instructional note in Task 7 Step 2 (strip the stray `</style>`) is a real instruction, not a placeholder. ✓

**3. Type consistency:** `computeTotals(items, gctRate)`, `buildEstimatePayload(form, {customerId, gctTaxId})`, `findOrCreateContact(client, customer)→contact_id`, `createEstimate(client, form, gctTaxId)→{estimateId, estimateNumber}`, `createZohoClient(config)→{request,getAccessToken}`, `createApp(deps)`, `checkPasscode/requireSession` — names/signatures match across producing and consuming tasks. ✓
