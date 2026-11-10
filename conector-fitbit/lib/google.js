// Google OAuth and Google Health API (v4) client, read-only.
export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
export const HEALTH = 'https://health.googleapis.com/v4/users/me';

const SCOPE = 'https://www.googleapis.com/auth/googlehealth.';
export const SCOPES = [
  'openid',
  'email',
  SCOPE + 'sleep.readonly',
  SCOPE + 'activity_and_fitness.readonly',
  SCOPE + 'health_metrics_and_measurements.readonly'
];

export class HealthError extends Error {
  constructor(status, reason, message) {
    super(message || `Google Health API respondió ${status}`);
    this.status = status;
    this.reason = reason || '';
  }
}

function clientCreds() {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET.');
  return { id, secret };
}

export function googleAuthUrl(redirectUri, state) {
  const { id } = clientCreds();
  const p = new URLSearchParams({
    client_id: id, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline',
    prompt: 'consent', include_granted_scopes: 'true', scope: SCOPES.join(' '), state
  });
  if (process.env.ALLOWED_EMAIL) p.set('login_hint', process.env.ALLOWED_EMAIL);
  return `${GOOGLE_AUTH}?${p}`;
}

async function tokenRequest(params) {
  const { id, secret } = clientCreds();
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error_description || body.error || `Google token ${res.status}`);
    err.oauthError = body.error || 'server_error';
    throw err;
  }
  return body;
}

export const exchangeCode = (code, redirectUri) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });

export const hasHealthScope = scope => SCOPES.some(sc => sc.includes('googlehealth') && String(scope || '').split(/\s+/).includes(sc));

export const refreshGoogle = refreshToken =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

/** Reads the email from an id_token received directly from Google's token endpoint over TLS. */
export function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    return payload.email_verified ? String(payload.email || '').toLowerCase() : '';
  } catch {
    return '';
  }
}

async function call(at, method, path, body) {
  const res = await fetch(`${HEALTH}/${path}`, {
    method,
    headers: { authorization: `Bearer ${at}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    const reason = (e.details || []).map(d => d.reason).find(Boolean) || e.status;
    throw new HealthError(res.status, reason, e.message);
  }
  return data;
}

/** Scopes actually carried by an access token (Google tokeninfo). Returns short names, or null if unknown. */
export async function grantedScopes(at) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(at));
    if (!res.ok) return null;
    const body = await res.json();
    return String(body.scope || '').split(/\s+/).filter(Boolean).map(sc => sc.replace('https://www.googleapis.com/auth/', ''));
  } catch {
    return null;
  }
}

export async function identity(at) {
  return call(at, 'GET', 'identity');
}

async function listAll(at, dataType, filter, maxPages = 6) {
  const out = [];
  let token = '';
  for (let i = 0; i < maxPages; i++) {
    // encodeURIComponent writes spaces as %20, as in Google's filter examples.
    let q = `filter=${encodeURIComponent(filter)}&page_size=100`;
    if (token) q += `&page_token=${encodeURIComponent(token)}`;
    const data = await call(at, 'GET', `dataTypes/${dataType}/dataPoints?${q}`);
    out.push(...(data.dataPoints || []));
    token = data.nextPageToken || '';
    if (!token) break;
  }
  return out;
}

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const civil = s => { const [year, month, day] = s.split('-').map(Number); return { date: { year, month, day }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }; };
const ymd = d => d && d.year ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : '';
const offsetSec = s => { const m = /^(-?\d+(?:\.\d+)?)s$/.exec(s || ''); return m ? parseFloat(m[1]) : 0; };
/** Local wall-clock date and time of a physical timestamp, using the offset Google stored with it. */
function local(ts, off) {
  const t = Date.parse(ts);
  if (isNaN(t)) return { date: '', time: '' };
  const iso = new Date(t + offsetSec(off) * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
const int = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
const durMin = s => { const m = /^(\d+(?:\.\d+)?)s$/.exec(s || ''); return m ? Math.round(parseFloat(m[1]) / 60) : null; };

/* ---------- summary ---------- */
function sleepSummary(points) {
  const sessions = points.map(p => p.sleep).filter(Boolean).map(s => {
    const iv = s.interval || {};
    const sum = s.summary || {};
    const inBed = int(sum.minutesInSleepPeriod) ?? Math.round((Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 60000);
    const stages = {};
    for (const st of s.stages || []) {
      const m = Math.round((Date.parse(st.endTime) - Date.parse(st.startTime)) / 60000);
      if (m > 0) stages[st.type] = (stages[st.type] || 0) + m;
    }
    return {
      end: local(iv.endTime, iv.endUtcOffset), start: local(iv.startTime, iv.startUtcOffset),
      asleep: int(sum.minutesAsleep) ?? Math.max(0, inBed - (int(sum.minutesAwake) || 0)),
      inBed, stages
    };
  });
  return sessions;
}

function buildDay(fecha, sleeps, steps, azm, am, exercises, rhr) {
  const daySleeps = sleeps ? sleeps.filter(s => s.end.date === fecha).sort((a, b) => b.inBed - a.inBed) : null;
  const main = daySleeps && daySleeps[0];
  const naps = daySleeps ? daySleeps.slice(1) : [];
  const st = main ? main.stages : {};
  return {
    fecha,
    sueno: sleeps === null ? null : main ? {
      horas: Math.round(main.asleep / 6) / 10,
      minutosDormido: main.asleep,
      minutosEnCama: main.inBed,
      acostado: main.start.time,
      despierto: main.end.time,
      etapas: Object.keys(st).length ? {
        profundo: st.DEEP || 0, ligero: st.LIGHT || 0, rem: st.REM || 0, despierto: st.AWAKE || 0
      } : null,
      siestas: naps.length,
      minutosSiestas: naps.reduce((a, s) => a + s.asleep, 0)
    } : { sinRegistro: true },
    pasos: steps ? steps.get(fecha) ?? null : null,
    minutosZonaActiva: azm ? azm.get(fecha) ?? null : null,
    minutosActivos: am ? am.get(fecha) ?? null : null,
    ejercicios: exercises ? exercises.filter(e => e.fecha === fecha).map(({ fecha: _f, ...e }) => e) : null,
    pulsoReposo: rhr ? rhr.get(fecha) ?? null : null
  };
}

function reasonText(e) {
  if (e instanceof HealthError) {
    if (e.reason === 'ACCOUNT_NOT_LINKED') return 'Tu cuenta de Google no está vinculada a Google Health. Inicia sesión en la app Google Health y vuelve a conectar.';
    if (e.status === 403) {
      if (e.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') return 'Falta el permiso para este dato: vuelve a conectar y marca todas las casillas en Google (403 ACCESS_TOKEN_SCOPE_INSUFFICIENT).';
      if (e.reason === 'SERVICE_DISABLED') return 'La Google Health API no está habilitada en el proyecto de Google Cloud de este conector (403 SERVICE_DISABLED).';
      return `Google Health negó el acceso (403${e.reason ? ' ' + e.reason : ''}${e.message ? ': ' + e.message.slice(0, 200) : ''}).`;
    }
    if (e.status === 401) return 'La autorización expiró. Vuelve a conectar el conector.';
    if (e.status === 429) return 'Google limitó las consultas por un momento. Intenta en unos minutos.';
    return `Google Health respondió ${e.status}${e.reason ? ' (' + e.reason + ')' : ''}.`;
  }
  return 'No se pudo leer este dato.';
}

/** Summaries for each day in [desde, hasta], inclusive. Six API calls whatever the range. */
export async function summaries(at, desde, hasta) {
  const end = addDays(hasta, 1);
  const range = { start: civil(desde), end: civil(end) };
  const roll = type => call(at, 'POST', `dataTypes/${type}/dataPoints:dailyRollUp`, { range, windowSizeDays: 1 })
    .then(d => d.rollupDataPoints || []);
  const jobs = {
    sueno: listAll(at, 'sleep', `sleep.interval.civil_end_time >= "${desde}T00:00:00" AND sleep.interval.civil_end_time < "${end}T00:00:00"`),
    pasos: roll('steps'),
    minutosZonaActiva: roll('active-zone-minutes'),
    minutosActivos: roll('active-minutes'),
    ejercicios: listAll(at, 'exercise', `exercise.interval.civil_start_time >= "${desde}" AND exercise.interval.civil_start_time < "${end}"`),
    pulsoReposo: listAll(at, 'daily-resting-heart-rate', `daily_resting_heart_rate.date >= "${desde}" AND daily_resting_heart_rate.date < "${end}"`)
  };
  const keys = Object.keys(jobs);
  const settled = await Promise.allSettled(Object.values(jobs));
  const got = {}, missing = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') got[keys[i]] = r.value;
    else {
      missing[keys[i]] = reasonText(r.reason);
      const e = r.reason || {};
      console.error('health api error', keys[i], e.status || '', e.reason || '', String(e.message || '').slice(0, 300));
    }
  });
  // On a scope error, report which scopes the token really has, so a bad grant is easy to tell apart.
  if (settled.some(r => r.status === 'rejected' && r.reason && r.reason.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    const scopes = await grantedScopes(at);
    if (scopes) {
      missing.permisosConcedidos = scopes.join(', ') || '(ninguno)';
      const health = scopes.filter(sc => sc.startsWith('googlehealth')).length;
      console.error('token scopes', health, 'health scopes of', scopes.length);
      // A grant with no health scope at all is useless: make the client re-run the full consent.
      if (!health) throw new HealthError(401, 'NO_HEALTH_SCOPES', 'El permiso de Google no incluye datos de salud.');
    }
  }
  // If every call failed for the same auth reason, surface it as one error.
  if (!Object.keys(got).length) {
    const first = settled[0].reason;
    if (first instanceof HealthError && (first.status === 401 || first.reason === 'ACCOUNT_NOT_LINKED')) throw first;
  }

  const byDay = (rows, pick) => {
    if (!rows) return null;
    const m = new Map();
    for (const r of rows) { const d = ymd(r.civilStartTime && r.civilStartTime.date); const v = pick(r); if (d && v !== null) m.set(d, v); }
    return m;
  };
  const steps = byDay(got.pasos, r => r.steps ? int(r.steps.countSum) : null);
  const azm = byDay(got.minutosZonaActiva, r => {
    const a = r.activeZoneMinutes; if (!a) return null;
    return (int(a.sumInFatBurnHeartZone) || 0) + (int(a.sumInCardioHeartZone) || 0) + (int(a.sumInPeakHeartZone) || 0);
  });
  const am = byDay(got.minutosActivos, r => {
    const a = r.activeMinutes; if (!a) return null;
    const out = {};
    for (const x of a.activeMinutesRollupByActivityLevel || []) out[String(x.activityLevel || 'OTRO').toLowerCase()] = int(x.activeMinutesSum) || 0;
    return out;
  });
  const exercises = got.ejercicios ? got.ejercicios.map(p => p.exercise).filter(Boolean).map(e => {
    const iv = e.interval || {};
    const s = local(iv.startTime, iv.startUtcOffset);
    return {
      fecha: s.date, inicio: s.time, tipo: e.exerciseType || 'OTHER', nombre: e.displayName || '',
      minutos: durMin(e.activeDuration) ?? Math.round((Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 60000)
    };
  }) : null;
  const rhr = got.pulsoReposo ? new Map(got.pulsoReposo.map(p => p.dailyRestingHeartRate).filter(Boolean)
    .map(r => [ymd(r.date), int(r.beatsPerMinute)])) : null;
  const sleeps = got.sueno ? sleepSummary(got.sueno) : null;

  const dias = [];
  for (let d = desde; d <= hasta; d = addDays(d, 1)) dias.push(buildDay(d, sleeps, steps, azm, am, exercises, rhr));
  return { dias, noDisponible: missing };
}
