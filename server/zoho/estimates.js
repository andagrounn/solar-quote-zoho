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
