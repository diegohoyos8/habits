// End-to-end test of the connector with Google mocked out. Run: npm test
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.TOKEN_SECRET = 'x'.repeat(48);
process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.ALLOWED_EMAIL = 'yo@example.com';
process.env.BASE_URL = 'https://mi-fitbit.example.app';

const B = process.env.BASE_URL;
const idToken = email => 'h.' + Buffer.from(JSON.stringify({ email, email_verified: true })).toString('base64url') + '.s';
let tokenEmail = 'yo@example.com', healthCalls = [], refreshCount = 0;

// ---- Google mock (shapes taken from the Google Health API docs) ----
const day = '2026-11-07';
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url === 'https://oauth2.googleapis.com/token') {
    const f = new URLSearchParams(init.body);
    if (f.get('grant_type') === 'authorization_code') {
      assert.equal(f.get('code'), 'google-code');
      assert.equal(f.get('redirect_uri'), B + '/callback');
      return reply({ access_token: 'g-at-1', refresh_token: 'g-rt-1', expires_in: 3599, id_token: idToken(tokenEmail) });
    }
    if (f.get('grant_type') === 'refresh_token') {
      refreshCount++;
      if (f.get('refresh_token') === 'g-rt-bad') return reply({ error: 'invalid_grant' }, 400);
      return reply({ access_token: 'g-at-2', expires_in: 3599, refresh_token: 'g-rt-2' });
    }
  }
  if (url.startsWith('https://health.googleapis.com/v4/users/me/')) {
    const path = url.slice('https://health.googleapis.com/v4/users/me/'.length);
    healthCalls.push({ path: decodeURIComponent(path), auth: init.headers.authorization, body: init.body });
    if (path === 'identity') return reply({ name: 'users/me/identity', healthUserId: '1' });
    if (path.startsWith('dataTypes/sleep/dataPoints?')) return reply({ dataPoints: [
      { sleep: { interval: { startTime: '2026-11-06T22:10:00Z', startUtcOffset: '3600s', endTime: '2026-11-07T05:40:00Z', endUtcOffset: '3600s' },
        type: 'STAGES',
        stages: [
          { startTime: '2026-11-06T22:10:00Z', endTime: '2026-11-07T00:10:00Z', type: 'LIGHT' },
          { startTime: '2026-11-07T00:10:00Z', endTime: '2026-11-07T01:40:00Z', type: 'DEEP' },
          { startTime: '2026-11-07T01:40:00Z', endTime: '2026-11-07T01:55:00Z', type: 'AWAKE' },
          { startTime: '2026-11-07T01:55:00Z', endTime: '2026-11-07T05:40:00Z', type: 'REM' } ],
        summary: { minutesInSleepPeriod: '450', minutesAsleep: '425', minutesAwake: '25' } } },
      { sleep: { interval: { startTime: '2026-11-07T14:00:00Z', startUtcOffset: '3600s', endTime: '2026-11-07T14:30:00Z', endUtcOffset: '3600s' },
        summary: { minutesInSleepPeriod: '30', minutesAsleep: '25' } } } ] });
    if (path === 'dataTypes/steps/dataPoints:dailyRollUp') {
      return reply({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 11, day: 7 }, time: {} }, steps: { countSum: '8421' } }] });
    }
    if (path === 'dataTypes/active-zone-minutes/dataPoints:dailyRollUp') return reply({ rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 7 } }, activeZoneMinutes: { sumInFatBurnHeartZone: '12', sumInCardioHeartZone: '16', sumInPeakHeartZone: '0' } } ] });
    if (path === 'dataTypes/active-minutes/dataPoints:dailyRollUp') return reply({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'scope' } }, 403);
    if (path.startsWith('dataTypes/exercise/dataPoints?')) return reply({ dataPoints: [
      { exercise: { interval: { startTime: '2026-11-07T07:05:00Z', startUtcOffset: '3600s', endTime: '2026-11-07T07:40:00Z', endUtcOffset: '3600s' }, exerciseType: 'WALKING', displayName: 'Walking', activeDuration: '1980s' } } ] });
    if (path.startsWith('dataTypes/daily-resting-heart-rate/dataPoints?')) return reply({ dataPoints: [
      { dailyRestingHeartRate: { date: { year: 2026, month: 11, day: 7 }, beatsPerMinute: '58' } } ] });
    return reply({ error: { code: 404, message: 'unexpected ' + path } }, 404);
  }
  throw new Error('Unexpected fetch ' + url);
};

const oauth = await import('../api/oauth.js');
const mcp = await import('../api/mcp.js');
const req = (path, init = {}) => new Request(B + path, init);
const form = obj => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj).toString() });
let passed = 0; const ok = name => { passed++; console.log('ok -', name); };

// 1. Discovery
let r = await oauth.GET(req('/api/oauth?route=prm'));
let j = await r.json();
assert.equal(j.resource, B + '/mcp'); assert.deepEqual(j.authorization_servers, [B]); ok('protected resource metadata');
r = await oauth.GET(req('/api/oauth?route=asm')); j = await r.json();
assert.equal(j.token_endpoint, B + '/token'); assert.deepEqual(j.code_challenge_methods_supported, ['S256']); ok('authorization server metadata');

// 2. MCP without token -> 401 with resource metadata pointer
r = await mcp.POST(req('/api/mcp', { method: 'POST', body: '{}' }));
assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate'), /resource_metadata=".*oauth-protected-resource"/); ok('mcp requires a token');

// 3. Dynamic client registration
r = await oauth.POST(req('/api/oauth?route=register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }) }));
assert.equal(r.status, 400); ok('register rejects unknown redirect');
const CB = 'https://claude.ai/api/mcp/auth_callback';
r = await oauth.POST(req('/api/oauth?route=register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CB], client_name: 'Claude' }) }));
assert.equal(r.status, 201); const client = await r.json(); ok('register claude.ai');

// 4. Authorize -> Google
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const authQ = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'st-123', resource: B + '/mcp' });
r = await oauth.GET(req('/api/oauth?route=authorize&' + authQ));
assert.equal(r.status, 302);
const g = new URL(r.headers.get('location'));
assert.equal(g.origin + g.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
assert.equal(g.searchParams.get('redirect_uri'), B + '/callback');
assert.match(g.searchParams.get('scope'), /googlehealth\.sleep\.readonly/);
assert.equal(g.searchParams.get('access_type'), 'offline');
ok('authorize redirects to Google with read-only scopes');
r = await oauth.GET(req('/api/oauth?route=authorize&' + new URLSearchParams({ ...Object.fromEntries(authQ), redirect_uri: 'https://claude.ai/other' })));
assert.equal(r.status, 400); ok('authorize rejects mismatched redirect');

// 5. Callback: wrong account is refused
tokenEmail = 'otra@example.com';
r = await oauth.GET(req('/api/oauth?route=callback&' + new URLSearchParams({ code: 'google-code', state: g.searchParams.get('state') })));
assert.equal(r.status, 403); ok('callback refuses other Google accounts');
tokenEmail = 'yo@example.com';
r = await oauth.GET(req('/api/oauth?route=callback&' + new URLSearchParams({ code: 'google-code', state: g.searchParams.get('state') })));
assert.equal(r.status, 302);
const back = new URL(r.headers.get('location'));
assert.equal(back.origin + back.pathname, CB); assert.equal(back.searchParams.get('state'), 'st-123');
const code = back.searchParams.get('code'); assert.ok(code); ok('callback returns a code to claude.ai');

// 6. Token exchange with PKCE
r = await oauth.POST(req('/api/oauth?route=token', form({ grant_type: 'authorization_code', code, redirect_uri: CB, client_id: client.client_id, code_verifier: 'wrong'.repeat(10) })));
assert.equal(r.status, 400); ok('token rejects wrong PKCE verifier');
r = await oauth.POST(req('/api/oauth?route=token', form({ grant_type: 'authorization_code', code, redirect_uri: CB, client_id: client.client_id, code_verifier: verifier })));
assert.equal(r.status, 200); const tokens = await r.json();
assert.equal(tokens.token_type, 'Bearer'); assert.ok(tokens.expires_in > 3000); assert.ok(!tokens.access_token.includes('g-at-1')); ok('token issues encrypted tokens');

// 7. MCP session
const call = async (body, at = tokens.access_token) => mcp.POST(req('/api/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) }));
r = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
j = await r.json(); assert.equal(j.result.protocolVersion, '2025-06-18'); assert.equal(j.result.serverInfo.name, 'mi-fitbit'); ok('initialize');
r = await call({ jsonrpc: '2.0', method: 'notifications/initialized' }); assert.equal(r.status, 202); ok('notification accepted');
r = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); j = await r.json();
assert.deepEqual(j.result.tools.map(t => t.name), ['resumen_del_dia', 'resumen_de_dias']);
assert.ok(j.result.tools.every(t => t.annotations.readOnlyHint)); ok('tools/list (read-only)');

healthCalls = [];
r = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'resumen_del_dia', arguments: { fecha: day } } });
j = await r.json();
const s = j.result.structuredContent;
assert.ok(healthCalls.every(c => c.auth === 'Bearer g-at-1'));
assert.equal(healthCalls.length, 6);
const stepsBody = JSON.parse(healthCalls.find(c => c.path.startsWith('dataTypes/steps')).body);
assert.deepEqual(stepsBody.range.start.date, { year: 2026, month: 11, day: 7 });
assert.deepEqual(stepsBody.range.end.date, { year: 2026, month: 11, day: 8 });
assert.equal(stepsBody.windowSizeDays, 1);
assert.ok(healthCalls.some(c => c.path.includes('sleep.interval.civil_end_time >= "2026-11-07T00:00:00" AND sleep.interval.civil_end_time < "2026-11-08T00:00:00"')));
assert.equal(s.fecha, day);
assert.equal(s.sueno.minutosDormido, 425); assert.equal(s.sueno.horas, 7.1);
assert.equal(s.sueno.acostado, '23:10'); assert.equal(s.sueno.despierto, '06:40');
assert.deepEqual(s.sueno.etapas, { profundo: 90, ligero: 120, rem: 225, despierto: 15 });
assert.equal(s.sueno.siestas, 1); assert.equal(s.sueno.minutosSiestas, 25);
assert.equal(s.pasos, 8421); assert.equal(s.minutosZonaActiva, 28);
assert.equal(s.minutosActivos, null); assert.match(s.noDisponible.minutosActivos, /permiso/);
assert.deepEqual(s.ejercicios, [{ inicio: '08:05', tipo: 'WALKING', nombre: 'Walking', minutos: 33 }]);
assert.equal(s.pulsoReposo, 58);
assert.equal(JSON.parse(j.result.content[0].text).pasos, 8421);
ok('resumen_del_dia maps sleep, steps, AZM, exercise and resting HR');

r = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'resumen_de_dias', arguments: { desde: '2026-11-05', hasta: '2026-11-07' } } });
j = await r.json(); const dias = j.result.structuredContent.dias;
assert.deepEqual(dias.map(d => d.fecha), ['2026-11-05', '2026-11-06', '2026-11-07']);
assert.deepEqual(dias[0].sueno, { sinRegistro: true }); assert.equal(dias[0].pasos, null); assert.deepEqual(dias[0].ejercicios, []);
assert.equal(dias[2].pasos, 8421); ok('resumen_de_dias fills every day');
r = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'resumen_de_dias', arguments: { desde: '2026-01-01', hasta: '2026-03-01' } } });
j = await r.json(); assert.equal(j.result.isError, true); ok('range limit enforced');
r = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'resumen_del_dia', arguments: { fecha: '7/11/2026' } } });
j = await r.json(); assert.equal(j.result.isError, true); ok('bad date rejected');
r = await call({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, tokens.refresh_token);
assert.equal(r.status, 401); ok('refresh token is not accepted as access token');

// 8. Refresh
r = await oauth.POST(req('/api/oauth?route=token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id })));
assert.equal(r.status, 200); const t2 = await r.json(); assert.equal(refreshCount, 1);
healthCalls = [];
await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'resumen_del_dia', arguments: { fecha: day } } }, t2.access_token);
assert.ok(healthCalls.every(c => c.auth === 'Bearer g-at-2')); ok('refresh issues a working token');
r = await oauth.POST(req('/api/oauth?route=token', form({ grant_type: 'refresh_token', refresh_token: 'garbage-token-value-1234567890' })));
assert.equal(r.status, 400); ok('bad refresh token rejected');

// 9. Path-based routing (if the platform keeps the original path)
r = await oauth.GET(req('/.well-known/oauth-protected-resource/mcp'));
assert.equal((await r.json()).resource, B + '/mcp'); ok('path-based routing');

console.log(`\n${passed} checks passed`);
