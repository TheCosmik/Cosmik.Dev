const listEl = document.getElementById('finance-list');
const totalEl = document.getElementById('finance-total');
const addBtn = document.getElementById('finance-add-btn');
const modalEl = document.getElementById('finance-modal');
const modalCloseBtn = document.getElementById('finance-modal-close');
const modalTitleEl = document.getElementById('finance-modal-title');
const formEl = document.getElementById('finance-form');
const formErrorEl = document.getElementById('finance-form-error');
const nameInput = document.getElementById('finance-name');
const amountInput = document.getElementById('finance-amount');
const dayInput = document.getElementById('finance-day');

let editingId = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatAmount(amount) {
  return `$${amount.toFixed(2)}`;
}

function openModal(sub) {
  editingId = sub ? sub.id : null;
  modalTitleEl.textContent = sub ? 'Edit Subscription' : 'Add Subscription';
  nameInput.value = sub ? sub.name : '';
  amountInput.value = sub ? sub.amount : '';
  dayInput.value = sub ? sub.chargeDay : '';
  formErrorEl.textContent = '';
  modalEl.classList.add('open');
  nameInput.focus();
}

function closeModal() {
  modalEl.classList.remove('open');
}

addBtn.addEventListener('click', () => openModal(null));
modalCloseBtn.addEventListener('click', closeModal);
modalEl.addEventListener('click', (e) => {
  if (e.target === modalEl) closeModal();
});

function renderList(subscriptions) {
  listEl.innerHTML = '';

  if (subscriptions.length === 0) {
    listEl.innerHTML = '<div class="finance-empty">No subscriptions tracked yet.</div>';
  }

  const sorted = [...subscriptions].sort((a, b) => a.chargeDay - b.chargeDay);
  for (const sub of sorted) {
    const row = document.createElement('div');
    row.className = 'finance-row';
    row.innerHTML = `
      <div class="finance-row-main">
        <span class="finance-row-name">${escapeHtml(sub.name)}</span>
        <span class="finance-row-day">Charges on the ${ordinal(sub.chargeDay)}</span>
      </div>
      <span class="finance-row-amount">${formatAmount(sub.amount)}/mo</span>
      <div class="finance-row-actions">
        <button class="finance-edit" aria-label="Edit">✎</button>
        <button class="finance-delete" aria-label="Delete">✕</button>
      </div>
    `;
    row.querySelector('.finance-edit').addEventListener('click', () => openModal(sub));
    row.querySelector('.finance-delete').addEventListener('click', () => deleteSubscription(sub.id));
    listEl.appendChild(row);
  }

  const total = subscriptions.reduce((sum, s) => sum + s.amount, 0);
  totalEl.textContent = formatAmount(total);
}

async function loadSubscriptions() {
  try {
    const res = await fetch('/api/finance/list');
    if (!res.ok) return;
    const data = await res.json();
    renderList(data.subscriptions || []);
  } catch {
    // ignore
  }
}

async function deleteSubscription(id) {
  if (!confirm('Remove this subscription?')) return;
  try {
    await fetch('/api/finance/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    await loadSubscriptions();
  } catch {
    // ignore
  }
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  formErrorEl.textContent = '';

  const payload = {
    name: nameInput.value.trim(),
    amount: Number(amountInput.value),
    chargeDay: Number(dayInput.value)
  };

  if (!payload.name || !Number.isFinite(payload.amount) || payload.amount < 0 ||
      !Number.isInteger(payload.chargeDay) || payload.chargeDay < 1 || payload.chargeDay > 31) {
    formErrorEl.textContent = 'Enter a valid name, amount, and day (1-31).';
    return;
  }

  const endpoint = editingId ? '/api/finance/update' : '/api/finance/add';
  if (editingId) payload.id = editingId;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      formErrorEl.textContent = 'Save failed. Try again.';
      return;
    }
    closeModal();
    await loadSubscriptions();
  } catch {
    formErrorEl.textContent = 'Save failed. Try again.';
  }
});

loadSubscriptions();
