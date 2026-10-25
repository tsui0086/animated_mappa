import { configured, hasValidSession, json } from '../../lib/auth.js';

export async function onRequestGet({ request, env }) {
  return json({ authenticated: configured(env) && await hasValidSession(request, env.ROUTE_ATLAS_SESSION_SECRET) });
}

export function onRequest(context) {
  return json({ error: `Method ${context.request.method} is not allowed.` }, { status: 405, headers: { Allow: 'GET' } });
}
