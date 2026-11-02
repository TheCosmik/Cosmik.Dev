import { requireWatchlistAccess } from '../lib/verify-session.js';

// Poster art is hotlinked from these hosts only (see isAllowedPoster).
const POSTER_HOSTS = new Set(['m.media-amazon.com', 'static.tvmaze.com']);
const KIND_BY_IMDB_TYPE = {
  feature: 'movie',
  'TV movie': 'movie',
  'TV series': 'show',
  'TV mini-series': 'show',
  'TV miniseries': 'show'
};
const MAX_RESULTS = 8;
const CACHE_SECONDS = 60 * 60 * 24;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export function isAllowedPoster(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && POSTER_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// IMDb serves full-size posters (~400KB); this size is ~35KB and still sharp.
function resizeImdbPoster(url) {
  return url.replace(/\._V1_.*\.jpg$/, '._V1_UY450_.jpg');
}

async function searchImdb(normalized) {
  const first = normalized[0];
  const res = await fetch(
    `https://v2.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(normalized.replace(/ /g, '_'))}.json`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
  );
  if (!res.ok) throw new Error(`imdb ${res.status}`);
  const data = await res.json();

  const results = [];
  for (const row of Array.isArray(data.d) ? data.d : []) {
    const kind = KIND_BY_IMDB_TYPE[row.q];
    if (!kind || !row.l) continue;
    const poster = row.i && typeof row.i.imageUrl === 'string' ? resizeImdbPoster(row.i.imageUrl) : null;
    results.push({
      id: row.id,
      title: String(row.l).slice(0, 120),
      year: Number.isInteger(row.y) ? row.y : null,
      kind,
      poster: poster && isAllowedPoster(poster) ? poster : null
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

// Backup source for TV shows if IMDb's suggestion endpoint is unavailable.
async function searchTvmaze(query) {
  const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`tvmaze ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : []).slice(0, MAX_RESULTS).map(({ show }) => {
    const poster = show.image && show.image.medium ? show.image.medium.replace('http://', 'https://') : null;
    return {
      id: `tvmaze-${show.id}`,
      title: String(show.name).slice(0, 120),
      year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
      kind: 'show',
      poster: poster && isAllowedPoster(poster) ? poster : null
    };
  });
}

export async function handleMediaSearch(request, env) {
  if (!(await requireWatchlistAccess(request, env))) return json({ error: 'unauthorized' }, 401);

  const query = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 80);
  // IMDb's endpoint is keyed by a plain lowercase, accent-free form of the query.
  const normalized = query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
  if (normalized.length < 2 || !/^[a-z0-9]/.test(normalized)) return json({ results: [] });

  const cache = caches.default;
  const cacheKey = new Request(`https://media-search.internal/?q=${encodeURIComponent(normalized)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return json(await cached.json());

  let results;
  try {
    results = await searchImdb(normalized);
  } catch {
    try {
      results = await searchTvmaze(query);
    } catch {
      return json({ error: 'search unavailable' }, 502);
    }
  }

  const body = { results };
  await cache.put(cacheKey, new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` }
  }));
  return json(body);
}
