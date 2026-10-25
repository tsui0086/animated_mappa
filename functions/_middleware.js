import { configured, hasValidSession, json } from './lib/auth.js';

const PUBLIC_PATHS = new Set(['/login.html', '/api/auth/login', '/api/auth/session', '/api/auth/logout']);

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (PUBLIC_PATHS.has(url.pathname)) return context.next();
  if (!configured(env)) {
    return new Response('Route Atlas authentication is not configured. Set ROUTE_ATLAS_PASSWORD and ROUTE_ATLAS_SESSION_SECRET in Cloudflare Pages.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (await hasValidSession(request, env.ROUTE_ATLAS_SESSION_SECRET)) return context.next();
  if (request.method === 'GET' || request.method === 'HEAD') return Response.redirect(new URL('/login.html', url), 302);
  return json({ error: 'Authentication required.' }, { status: 401 });
}
