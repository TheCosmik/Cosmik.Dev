import { requireSession } from '../lib/verify-session.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function statsFetch(env, path) {
  const id = env.STREAM_STATS.idFromName('main');
  const res = await env.STREAM_STATS.get(id).fetch(`https://stream-stats.internal${path}`);
  return { status: res.status, data: await res.json() };
}

export async function handleStreamCurrent(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STREAM_STATS) return json({ error: 'not configured' }, 500);
  const { data } = await statsFetch(env, '/current');
  return json(data);
}

export async function handleStreamHistory(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STREAM_STATS) return json({ error: 'not configured' }, 500);
  const { data } = await statsFetch(env, '/history');
  return json(data);
}

export async function handleStreamSession(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STREAM_STATS) return json({ error: 'not configured' }, 500);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'invalid input' }, 400);
  const { status, data } = await statsFetch(env, `/session?id=${encodeURIComponent(id)}`);
  return json(data, status);
}
