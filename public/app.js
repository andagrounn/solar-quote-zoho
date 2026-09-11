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

function showForm() {
  $('login').hidden = true;
  $('app').hidden = false;
  if (!$('itemsBody').children.length) addRow();
}

// On load, skip the login screen entirely when the server runs in open mode.
(async () => {
  try {
    const res = await fetch('/api/config', { credentials: 'same-origin' });
    const cfg = await res.json();
    if (cfg && cfg.authRequired === false) showForm();
  } catch (_) { /* leave login screen up if the probe fails */ }
})();

$('loginBtn').addEventListener('click', async () => {
  const { status } = await post('/api/login', { passcode: $('passcode').value });
  if (status === 200) {
    showForm();
  } else {
    $('loginError').hidden = false;
    $('loginError').textContent = 'Invalid passcode';
  }
});

function round2(n) { return Math.round((n + 1e-10) * 100) / 100; }

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
    quotationNo: '', // always blank -> Zoho auto-numbers the estimate
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
    $('quotationNo').value = data.estimateNumber || ''; // show Zoho's assigned number
    result.textContent = `Created estimate ${data.estimateNumber}. `;
    if (typeof data.url === 'string' && data.url.startsWith('https://')) {
      const a = document.createElement('a');
      a.href = data.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Open in Zoho';
      result.appendChild(a);
    }
  } else {
    result.textContent = '';
    const span = document.createElement('span');
    span.className = 'error';
    span.textContent = 'Error: ' + JSON.stringify(data.details || data.error);
    result.appendChild(span);
  }
});
