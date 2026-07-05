export default async function handler(request) {
  return Response.json({ ok: true, time: Date.now() });
}
