import { configured, createSession, json, sessionCookie, verifyPassword } from '../../lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return json({ error: 'Authentication is not configured on this deployment.' }, { status: 503 });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!await verifyPassword(body?.password, env.ROUTE_ATLAS_PASSWORD)) {
    return json({ error: 'Incorrect password.' }, { status: 401 });
  }
  const token = await createSession(env.ROUTE_ATLAS_SESSION_SECRET);
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token) } });
}

export function onRequest(context) {
  return json({ error: `Method ${context.request.method} is not allowed.` }, { status: 405, headers: { Allow: 'POST' } });
}
