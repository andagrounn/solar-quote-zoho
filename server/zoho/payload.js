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
