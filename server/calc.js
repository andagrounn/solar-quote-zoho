// server/calc.js
function roundMoney(n) {
  return Math.round((n + 1e-10) * 100) / 100;
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
