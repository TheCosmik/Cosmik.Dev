import { requireSession } from '../lib/verify-session.js';

const MAX_NAME_LENGTH = 80;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function getFinanceStore(env) {
  const id = env.FINANCE_STORE.idFromName('main');
  return env.FINANCE_STORE.get(id);
}

function parseSubscription(body) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  const amount = Number(body.amount);
  const chargeDay = Number(body.chargeDay);
  if (!name || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(chargeDay) || chargeDay < 1 || chargeDay > 31) {
    return null;
  }
  return { name, amount, chargeDay };
}

export async function handleFinanceList(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.FINANCE_STORE) return json({ error: 'not configured' }, 500);

  const res = await getFinanceStore(env).fetch('https://finance.internal/list');
  return json(await res.json());
}

export async function handleFinanceAdd(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.FINANCE_STORE) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const sub = parseSubscription(body);
  if (!sub) return json({ error: 'invalid input' }, 400);

  const res = await getFinanceStore(env).fetch('https://finance.internal/add', {
    method: 'POST',
    body: JSON.stringify(sub)
  });
  return json(await res.json());
}

export async function handleFinanceUpdate(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.FINANCE_STORE) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const sub = parseSubscription(body);
  if (!sub || !body.id) return json({ error: 'invalid input' }, 400);

  const res = await getFinanceStore(env).fetch('https://finance.internal/update', {
    method: 'POST',
    body: JSON.stringify({ id: body.id, ...sub })
  });
  const data = await res.json();
  return json(data, res.status);
}

export async function handleFinanceDelete(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.FINANCE_STORE) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (!body.id) return json({ error: 'invalid input' }, 400);

  const res = await getFinanceStore(env).fetch('https://finance.internal/delete', {
    method: 'POST',
    body: JSON.stringify({ id: body.id })
  });
  return json(await res.json());
}
