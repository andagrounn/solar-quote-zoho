require('dotenv').config();
// server/index.js
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { checkPasscode, requireSession } = require('./auth');
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
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json({ ok: true });
  });

  app.post('/api/quote', requireSession, async (req, res) => {
    const details = validateQuote(req.body);
    if (details) return res.status(400).json({ error: 'Validation failed', details });

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
