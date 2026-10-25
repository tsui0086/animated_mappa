import { json, sessionCookie } from '../../lib/auth.js';

export async function onRequestPost() {
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', 0) } });
}

export function onRequest(context) {
  return json({ error: `Method ${context.request.method} is not allowed.` }, { status: 405, headers: { Allow: 'POST' } });
}
