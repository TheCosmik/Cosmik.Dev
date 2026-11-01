import { requireSession } from '../lib/verify-session.js';

const MAX_NAME_LENGTH = 100;
const SLUG = /^[A-Za-z0-9_-]{4,120}$/;
const KICK_CLIP_ID = /clip_[0-9A-Za-z]{10,40}/;
const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'clips.twitch.tv']);
const KICK_HOSTS = new Set(['kick.com', 'www.kick.com']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function httpsOrNull(value) {
  try {
    return new URL(value).protocol === 'https:' ? String(value) : null;
  } catch {
    return null;
  }
}

// Returns { platform, clipId } for a Twitch or Kick clip link, else null.
export function parseClipUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();

  if (KICK_HOSTS.has(host)) {
    const match = u.href.match(KICK_CLIP_ID);
    return match ? { platform: 'kick', clipId: match[0] } : null;
  }

  if (TWITCH_HOSTS.has(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    let slug = null;
    if (host === 'clips.twitch.tv') {
      slug = parts[0] === 'embed' ? u.searchParams.get('clip') : parts[0];
    } else {
      const at = parts.indexOf('clip');
      if (at !== -1) slug = parts[at + 1];
    }
    return slug && SLUG.test(slug) ? { platform: 'twitch', clipId: slug } : null;
  }

  return null;
}

async function lookupKick(clipId) {
  const res = await fetch(`https://kick.com/api/v2/clips/${clipId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`kick ${res.status}`);
  const clip = (await res.json()).clip;
  if (!clip) return { notFound: true };

  const channelSlug = clip.channel && clip.channel.slug;
  return {
    title: clip.title || 'Kick clip',
    channel: (clip.channel && (clip.channel.username || clip.channel.slug)) || null,
    thumbnail: httpsOrNull(clip.thumbnail_url),
    playUrl: httpsOrNull(clip.video_url || clip.clip_url),
    duration: Number(clip.duration) || null,
    url: channelSlug ? `https://kick.com/${channelSlug}/clips/${clipId}` : `https://kick.com/clips/${clipId}`
  };
}

async function lookupTwitch(clipId, env, getTwitchToken) {
  const token = await getTwitchToken(env);
  if (!token) throw new Error('twitch token');
  const res = await fetch(`https://api.twitch.tv/helix/clips?id=${encodeURIComponent(clipId)}`, {
    headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`twitch ${res.status}`);
  const clip = ((await res.json()).data || [])[0];
  if (!clip) return { notFound: true };

  return {
    title: clip.title || 'Twitch clip',
    channel: clip.broadcaster_name || null,
    thumbnail: httpsOrNull(clip.thumbnail_url),
    playUrl: null,
    duration: Number(clip.duration) || null,
    url: httpsOrNull(clip.url) || `https://clips.twitch.tv/${clipId}`
  };
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function getStore(env) {
  return env.CLIPS_STORE.get(env.CLIPS_STORE.idFromName('main'));
}

async function guard(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.CLIPS_STORE) return json({ error: 'not configured' }, 500);
  return null;
}

export async function handleClipsList(request, env) {
  const denied = await guard(request, env);
  if (denied) return denied;
  const res = await getStore(env).fetch('https://clips.internal/list');
  return json(await res.json());
}

export async function handleClipsAdd(request, env, getTwitchToken) {
  const denied = await guard(request, env);
  if (denied) return denied;

  const body = await readBody(request);
  const parsed = parseClipUrl(body.url);
  if (!parsed) return json({ error: 'unsupported' }, 400);
  const customName = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '';

  let info;
  try {
    info = parsed.platform === 'kick'
      ? await lookupKick(parsed.clipId)
      : await lookupTwitch(parsed.clipId, env, getTwitchToken);
  } catch {
    return json({ error: 'lookup failed' }, 502);
  }
  if (info.notFound) return json({ error: 'not found' }, 404);

  const res = await getStore(env).fetch('https://clips.internal/add', {
    method: 'POST',
    body: JSON.stringify({
      platform: parsed.platform,
      clipId: parsed.clipId,
      title: customName || info.title,
      channel: info.channel,
      thumbnail: info.thumbnail,
      playUrl: info.playUrl,
      duration: info.duration,
      url: info.url
    })
  });
  return json(await res.json(), res.status);
}

export async function handleClipsDelete(request, env) {
  const denied = await guard(request, env);
  if (denied) return denied;

  const body = await readBody(request);
  if (typeof body.id !== 'string' || !body.id) return json({ error: 'invalid input' }, 400);
  const res = await getStore(env).fetch('https://clips.internal/delete', {
    method: 'POST',
    body: JSON.stringify({ id: body.id })
  });
  return json(await res.json());
}
