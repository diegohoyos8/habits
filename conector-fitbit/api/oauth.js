// OAuth 2.1 authorization server for the MCP connector (what claude.ai talks to),
// backed by Google sign-in. Stateless: every artifact is an encrypted token (lib/seal.js).
import { seal, open, now, sha256b64u } from '../lib/seal.js';
import { baseUrl, json, html } from '../lib/http.js';
import { googleAuthUrl, exchangeCode, refreshGoogle, emailFromIdToken, identity, HealthError, SCOPES } from '../lib/google.js';

const DEFAULT_REDIRECTS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];
const allowedRedirects = () => [
  ...DEFAULT_REDIRECTS,
  ...String(process.env.EXTRA_REDIRECT_URIS || '').split(',').map(s => s.trim()).filter(Boolean)
];
const oauthError = (error, description, status = 400) => json({ error, error_description: description }, status);
const missingConfig = () => ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ALLOWED_EMAIL'].filter(k => !process.env[k]).join(', ');

export async function GET(request) { return route(request); }
export async function POST(request) { return route(request); }

function routeName(url) {
  const r = url.searchParams.get('route');
  if (r) return r;
  const p = url.pathname;
  if (p.startsWith('/.well-known/oauth-protected-resource')) return 'prm';
  if (p.startsWith('/.well-known/oauth-authorization-server') || p.startsWith('/.well-known/openid-configuration')) return 'asm';
  return { '/register': 'register', '/authorize': 'authorize', '/callback': 'callback', '/token': 'token', '/': 'home' }[p] || '';
}

async function route(request) {
  const url = new URL(request.url);
  const origin = baseUrl(request);
  try {
    switch (routeName(url)) {
      case 'prm': return json({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        bearer_methods_supported: ['header'],
        resource_name: 'Mi Fitbit'
      });
      case 'asm': return json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none']
      });
      // `return await` keeps async failures inside this try/catch.
      case 'register': return request.method === 'POST' ? await register(request) : oauthError('invalid_request', 'Usa POST.', 405);
      case 'authorize': return await authorize(url, origin);
      case 'callback': return await callback(url, origin);
      case 'token': return request.method === 'POST' ? await token(request) : oauthError('invalid_request', 'Usa POST.', 405);
      case 'home': return html('Mi Fitbit', `<p>Conector MCP de solo lectura para tus datos de Fitbit.</p><p>URL para añadirlo en claude.ai: <code>${origin}/mcp</code></p>`);
      default: return json({ error: 'not_found' }, 404);
    }
  } catch (e) {
    console.error('oauth error', e && e.message);
    if (missingConfig()) {
      const msg = `Al conector le falta configuración en Vercel: ${missingConfig()}.`;
      return routeName(url) === 'authorize' || routeName(url) === 'callback'
        ? html('Falta configurar el conector', `<p>${msg} Añade esas variables de entorno en el proyecto de Vercel y vuelve a desplegar.</p>`, 503)
        : oauthError('temporarily_unavailable', msg, 503);
    }
    return oauthError('server_error', 'Error interno del conector.', 500);
  }
}

// RFC 7591 dynamic client registration. The client id is an encrypted copy of its redirect URIs.
async function register(request) {
  const body = await request.json().catch(() => null);
  const uris = body && Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length) return oauthError('invalid_redirect_uri', 'Falta redirect_uris.');
  const allowed = allowedRedirects();
  const bad = uris.find(u => !allowed.includes(u));
  if (bad) return oauthError('invalid_redirect_uri', `Redirect no permitido: ${bad}`);
  const issued = now();
  const client_id = await seal({ k: 'client', r: uris, iat: issued });
  return json({
    client_id, client_id_issued_at: issued, redirect_uris: uris,
    client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : undefined,
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']
  }, 201);
}

async function authorize(url, origin) {
  const q = url.searchParams;
  const client = await open(q.get('client_id'), 'client');
  const redirectUri = q.get('redirect_uri') || '';
  if (!client || !client.r.includes(redirectUri)) {
    return html('No se pudo conectar', '<p>La solicitud de conexión no es válida. Vuelve a intentarlo desde claude.ai.</p>', 400);
  }
  const back = (error, description) => {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error);
    if (description) u.searchParams.set('error_description', description);
    if (q.get('state')) u.searchParams.set('state', q.get('state'));
    return Response.redirect(u.toString(), 302);
  };
  if (q.get('response_type') !== 'code') return back('unsupported_response_type');
  const challenge = q.get('code_challenge') || '';
  if (q.get('code_challenge_method') !== 'S256' || challenge.length < 43) return back('invalid_request', 'Se requiere PKCE S256.');
  const state = await seal({ k: 'gstate', cid: q.get('client_id'), ru: redirectUri, cc: challenge, st: q.get('state') || '', exp: now() + 600 });
  return Response.redirect(googleAuthUrl(`${origin}/callback`, state), 302);
}

async function callback(url, origin) {
  const q = url.searchParams;
  const st = await open(q.get('state'), 'gstate');
  if (!st) return html('La conexión caducó', '<p>Pasaron más de 10 minutos o el enlace no es válido. Vuelve a conectar desde claude.ai.</p>', 400);
  const back = params => {
    const u = new URL(st.ru);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (st.st) u.searchParams.set('state', st.st);
    return Response.redirect(u.toString(), 302);
  };
  if (q.get('error')) return back({ error: 'access_denied', error_description: 'Se canceló el permiso en Google.' });

  const g = await exchangeCode(q.get('code') || '', `${origin}/callback`);
  const allowed = String(process.env.ALLOWED_EMAIL || '').toLowerCase();
  const email = emailFromIdToken(g.id_token);
  if (!allowed || email !== allowed) {
    return html('Cuenta no autorizada', '<p>Este conector es personal y solo acepta la cuenta de Google configurada en <code>ALLOWED_EMAIL</code>.</p>', 403);
  }
  // Google may grant only part of what was asked (unchecked boxes, or scopes not declared under Data Access).
  const granted = String(g.scope || '').split(/\s+/);
  const health = SCOPES.filter(sc => sc.includes('googlehealth'));
  console.log('callback: google granted', health.filter(sc => granted.includes(sc)).length, 'of', health.length, 'health scopes; scope field', g.scope ? 'present' : 'absent');
  if (g.scope && !health.some(sc => granted.includes(sc))) {
    return html('Google no concedió los permisos de salud', `<p>La conexión se hizo, pero sin acceso a tus datos de salud.</p>
<ol><li>En Google Cloud, en <b>Google Auth Platform → Acceso a los datos</b>, agrega los tres permisos de la Google Health API que terminan en <code>.readonly</code> y guarda.</li>
<li>Vuelve a conectar desde claude.ai y, en la pantalla de Google, <b>marca todas las casillas</b>.</li></ol>`, 400);
  }
  if (!g.refresh_token) {
    return html('Falta un permiso', '<p>Google no entregó acceso permanente. Quita el acceso de esta app en tu cuenta de Google (Seguridad → Apps de terceros) y vuelve a conectar.</p>', 400);
  }
  try {
    await identity(g.access_token);
  } catch (e) {
    if (e instanceof HealthError && e.reason === 'ACCOUNT_NOT_LINKED') {
      return html('Falta vincular Google Health', '<p>Tu cuenta de Google todavía no está vinculada a Google Health. Abre la app <b>Google Health</b> (o Fitbit) en el teléfono, inicia sesión con esta cuenta de Google y completa la migración de tu cuenta Fitbit. Después vuelve a conectar desde claude.ai.</p>', 400);
    }
    // Any other identity error is not fatal: the data calls report their own errors.
  }
  const code = await seal({
    k: 'code', cid: st.cid, ru: st.ru, cc: st.cc, exp: now() + 300,
    g: { at: g.access_token, rt: g.refresh_token, exp: now() + (g.expires_in || 3600) }
  });
  return back({ code });
}

async function readForm(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const b = await request.json().catch(() => ({}));
    return new URLSearchParams(Object.entries(b).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await request.text());
}

async function issue(g, cid) {
  const exp = Math.max(now() + 60, g.exp - 60);
  return json({
    access_token: await seal({ k: 'at', g: g.at, exp }),
    token_type: 'Bearer',
    expires_in: exp - now(),
    refresh_token: await seal({ k: 'rt', g: g.rt, cid })
  });
}

async function token(request) {
  const f = await readForm(request);
  const grant = f.get('grant_type');
  if (grant === 'authorization_code') {
    const code = await open(f.get('code'), 'code');
    if (!code) return oauthError('invalid_grant', 'Código inválido o caducado.');
    if (f.get('client_id') && f.get('client_id') !== code.cid) return oauthError('invalid_grant', 'El código no es de este cliente.');
    if ((f.get('redirect_uri') || code.ru) !== code.ru) return oauthError('invalid_grant', 'redirect_uri no coincide.');
    const verifier = f.get('code_verifier') || '';
    if (!verifier || (await sha256b64u(verifier)) !== code.cc) return oauthError('invalid_grant', 'PKCE no coincide.');
    return issue(code.g, code.cid);
  }
  if (grant === 'refresh_token') {
    const rt = await open(f.get('refresh_token'), 'rt');
    if (!rt) return oauthError('invalid_grant', 'Refresh token inválido.');
    let g;
    try {
      g = await refreshGoogle(rt.g);
    } catch (e) {
      return oauthError(e.oauthError === 'invalid_grant' ? 'invalid_grant' : 'temporarily_unavailable',
        'Google rechazó renovar el acceso. Vuelve a conectar el conector.', e.oauthError === 'invalid_grant' ? 400 : 503);
    }
    return issue({ at: g.access_token, rt: g.refresh_token || rt.g, exp: now() + (g.expires_in || 3600) }, rt.cid);
  }
  return oauthError('unsupported_grant_type', 'Solo authorization_code y refresh_token.');
}
