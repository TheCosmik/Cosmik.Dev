import { requireWatchlistAccess } from '../lib/verify-session.js';
import { isAllowedPoster } from './media.js';

const MAX_TITLE_LENGTH = 120;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Runs the session + config checks shared by every watchlist route, then
// forwards the validated payload to the Durable Object.
async function forward(request, env, path, buildPayload) {
  if (!(await requireWatchlistAccess(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.WATCHLIST_STORE) return json({ error: 'not configured' }, 500);

  const init = {};
  if (buildPayload) {
    const payload = buildPayload(await readBody(request));
    if (!payload) return json({ error: 'invalid input' }, 400);
    init.method = 'POST';
    init.body = JSON.stringify(payload);
  }

  const stub = env.WATCHLIST_STORE.get(env.WATCHLIST_STORE.idFromName('main'));
  const res = await stub.fetch(`https://watchlist.internal${path}`, init);
  return json(await res.json(), res.status);
}

export function handleWatchlistList(request, env) {
  return forward(request, env, '/list', null);
}

export function handleWatchlistAdd(request, env) {
  return forward(request, env, '/add', (body) => {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
    if (!title) return null;
    const year = Number.isInteger(body.year) && body.year >= 1870 && body.year <= 2200 ? body.year : null;
    const kind = body.kind === 'movie' || body.kind === 'show' ? body.kind : null;
    const poster = typeof body.poster === 'string' && isAllowedPoster(body.poster) ? body.poster : null;
    return { title, year, kind, poster };
  });
}

export function handleWatchlistToggle(request, env) {
  return forward(request, env, '/toggle', (body) =>
    typeof body.id === 'string' && body.id ? { id: body.id, watched: Boolean(body.watched) } : null
  );
}

export function handleWatchlistDelete(request, env) {
  return forward(request, env, '/delete', (body) =>
    typeof body.id === 'string' && body.id ? { id: body.id } : null
  );
}
