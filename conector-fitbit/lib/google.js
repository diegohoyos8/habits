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

const SHORT_ROLLUP = new Set(['active-minutes', 'total-calories', 'heart-rate', 'calories-in-heart-rate-zone']);

/** Daily rollup over [desde, hasta], split into the per-request range Google allows for the type. */
async function dailyRoll(at, type, desde, hasta) {
  const max = SHORT_ROLLUP.has(type) ? 14 : 90, out = [];
  for (let from = desde; from <= hasta; from = addDays(from, max)) {
    const to = addDays(from, max - 1) < hasta ? addDays(from, max - 1) : hasta;
    const d = await call(at, 'POST', `dataTypes/${type}/dataPoints:dailyRollUp`,
      { range: { start: civil(from), end: civil(addDays(to, 1)) }, windowSizeDays: 1 });
    out.push(...(d.rollupDataPoints || []));
  }
  return out;
}
const dailyList = (at, type, desde, hasta) => {
  const f = type.replace(/-/g, '_');
  return listAll(at, type, `${f}.date >= "${desde}" AND ${f}.date < "${addDays(hasta, 1)}"`, 10);
};

/** Summaries for each day in [desde, hasta], inclusive. */
export async function summaries(at, desde, hasta) {
  const end = addDays(hasta, 1);
  const roll = type => dailyRoll(at, type, desde, hasta);
  const jobs = {
    sueno: listAll(at, 'sleep', `sleep.interval.civil_end_time >= "${desde}T00:00:00" AND sleep.interval.civil_end_time < "${end}T00:00:00"`, 10),
    pasos: roll('steps'),
    minutosZonaActiva: roll('active-zone-minutes'),
    minutosActivos: roll('active-minutes'),
    ejercicios: listAll(at, 'exercise', `exercise.interval.civil_start_time >= "${desde}" AND exercise.interval.civil_start_time < "${end}"`, 10),
    pulsoReposo: dailyList(at, 'daily-resting-heart-rate', desde, hasta)
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
  return { dias, noDisponible: missing, sleeps, exercises };
}

const round = (v, d = 1) => v === null || v === undefined || isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
const toMin = hhmm => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : null; };

/**
 * One flat row per day, for charts: sleep and its stages, activity, resting heart rate and the
 * nightly vitals (HRV, SpO2, breathing), VO2 max, distance, floors and calories. Null = no data.
 */
export async function dailySeries(at, desde, hasta) {
  const base = await summaries(at, desde, hasta);
  const jobs = {
    vfc: dailyList(at, 'daily-heart-rate-variability', desde, hasta),
    spo2: dailyList(at, 'daily-oxygen-saturation', desde, hasta),
    respiracion: dailyList(at, 'daily-respiratory-rate', desde, hasta),
    vo2max: dailyList(at, 'daily-vo2-max', desde, hasta),
    distancia: dailyRoll(at, 'distance', desde, hasta),
    pisos: dailyRoll(at, 'floors', desde, hasta),
    calorias: dailyRoll(at, 'total-calories', desde, hasta),
    peso: dailyRoll(at, 'weight', desde, hasta)
  };
  const keys = Object.keys(jobs), settled = await Promise.allSettled(Object.values(jobs)), got = {}, missing = { ...base.noDisponible };
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') got[keys[i]] = r.value;
    else {
      missing[keys[i]] = reasonText(r.reason);
      const e = r.reason || {};
      console.error('health api error', keys[i], e.status || '', e.reason || '', String(e.message || '').slice(0, 300));
    }
  });
  const byDate = (rows, field, pick) => new Map((rows || []).map(p => p[field]).filter(Boolean).map(v => [ymd(v.date), pick(v)]));
  const byCivil = (rows, field, pick) => new Map((rows || []).filter(r => r[field]).map(r => [ymd(r.civilStartTime && r.civilStartTime.date), pick(r[field])]));
  const vfc = byDate(got.vfc, 'dailyHeartRateVariability', v => round(v.averageHeartRateVariabilityMilliseconds));
  const spo2 = byDate(got.spo2, 'dailyOxygenSaturation', v => round(v.averagePercentage));
  const resp = byDate(got.respiracion, 'dailyRespiratoryRate', v => round(v.breathsPerMinute));
  const vo2 = byDate(got.vo2max, 'dailyVo2Max', v => round(v.vo2Max));
  const dist = byCivil(got.distancia, 'distance', v => round((int(v.millimetersSum) || 0) / 1e6, 2));
  const floors = byCivil(got.pisos, 'floors', v => int(v.countSum));
  const kcal = byCivil(got.calorias, 'totalCalories', v => Math.round(Number(v.kcalSum) || 0));
  const peso = byCivil(got.peso, 'weight', v => v.weightGramsAvg ? round(Number(v.weightGramsAvg) / 1000, 1) : null);

  const rows = base.dias.map(d => {
    const s = d.sueno && !d.sueno.sinRegistro ? d.sueno : null;
    const bed = s ? toMin(s.acostado) : null, wake = s ? toMin(s.despierto) : null;
    const am = d.minutosActivos || {}, ex = d.ejercicios || [];
    const get = (m, k) => m && m.has(k) ? m.get(k) : null;
    return {
      fecha: d.fecha,
      sueno_h: s ? s.horas : null,
      sueno_min: s ? s.minutosDormido : null,
      cama_min: s ? s.minutosEnCama : null,
      profundo_min: s && s.etapas ? s.etapas.profundo : null,
      ligero_min: s && s.etapas ? s.etapas.ligero : null,
      rem_min: s && s.etapas ? s.etapas.rem : null,
      despierto_min: s && s.etapas ? s.etapas.despierto : null,
      hora_dormir: s ? s.acostado : null,
      // Minutes from midnight: negative before midnight (23:10 → -50), positive after (01:25 → 85).
      hora_dormir_min: bed === null ? null : (bed >= 720 ? bed - 1440 : bed),
      hora_despertar: s ? s.despierto : null,
      hora_despertar_min: wake,
      siestas_min: s ? s.minutosSiestas : null,
      pasos: d.pasos,
      zona_activa_min: d.minutosZonaActiva,
      activo_ligero_min: d.minutosActivos ? (am.light ?? 0) : null,
      activo_moderado_min: d.minutosActivos ? (am.moderate ?? 0) : null,
      activo_vigoroso_min: d.minutosActivos ? (am.vigorous ?? 0) : null,
      ejercicio_min: d.ejercicios ? ex.reduce((t, e) => t + (e.minutos || 0), 0) : null,
      ejercicios: d.ejercicios ? ex.length : null,
      pulso_reposo: d.pulsoReposo,
      vfc_ms: get(vfc, d.fecha),
      spo2_pct: get(spo2, d.fecha),
      respiracion_rpm: get(resp, d.fecha),
      vo2max: get(vo2, d.fecha),
      distancia_km: got.distancia ? get(dist, d.fecha) : null,
      pisos: got.pisos ? get(floors, d.fecha) : null,
      calorias: got.calorias ? get(kcal, d.fecha) : null,
      peso_kg: got.peso ? get(peso, d.fecha) : null
    };
  });
  return { rows, noDisponible: missing };
}

/** Weight (and body fat when a scale records it), one row per day with a measurement, oldest first. */
export async function weights(at, desde, hasta) {
  const end = addDays(hasta, 1);
  const range = f => `${f}.sample_time.civil_time >= "${desde}T00:00:00" AND ${f}.sample_time.civil_time < "${end}T00:00:00"`;
  const [w, bf] = await Promise.allSettled([listAll(at, 'weight', range('weight'), 10), listAll(at, 'body-fat', range('body_fat'), 10)]);
  if (w.status === 'rejected') throw w.reason;
  const dayOf = st => (st && st.civilTime && ymd(st.civilTime.date)) || (st ? local(st.physicalTime, st.utcOffset).date : '');
  const days = new Map();
  const add = (d, k, v) => { if (!d || v === null || isNaN(v)) return; const e = days.get(d) || { fecha: d, peso: [], grasa: [] }; e[k].push(v); days.set(d, e); };
  for (const p of w.value) if (p.weight) add(dayOf(p.weight.sampleTime), 'peso', Number(p.weight.weightGrams) / 1000);
  if (bf.status === 'fulfilled') for (const p of bf.value) if (p.bodyFat) add(dayOf(p.bodyFat.sampleTime), 'grasa', Number(p.bodyFat.percentage));
  const mean = a => a.length ? round(a.reduce((x, y) => x + y, 0) / a.length, 1) : null;
  const rows = [...days.values()].filter(e => e.fecha >= desde && e.fecha <= hasta)
    .map(e => ({ fecha: e.fecha, peso_kg: mean(e.peso), grasa_pct: mean(e.grasa) }))
    .filter(r => r.peso_kg !== null || r.grasa_pct !== null)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  return { rows };
}

/** One row per exercise session in [desde, hasta]. */
export async function sessions(at, desde, hasta) {
  const end = addDays(hasta, 1);
  const pts = await listAll(at, 'exercise', `exercise.interval.civil_start_time >= "${desde}" AND exercise.interval.civil_start_time < "${end}"`, 10);
  const rows = pts.map(p => p.exercise).filter(Boolean).map(e => {
    const iv = e.interval || {}, s = local(iv.startTime, iv.startUtcOffset);
    return {
      fecha: s.date, inicio: s.time, tipo: e.exerciseType || 'OTHER', nombre: e.displayName || '',
      minutos: durMin(e.activeDuration) ?? Math.round((Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 60000)
    };
  }).filter(r => r.fecha >= desde && r.fecha <= hasta).sort((a, b) => (a.fecha + a.inicio < b.fecha + b.inicio ? -1 : 1));
  return { rows };
}
