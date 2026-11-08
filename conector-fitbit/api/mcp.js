// MCP server over Streamable HTTP (stateless JSON responses). Read-only tools.
import { open } from '../lib/seal.js';
import { baseUrl, json } from '../lib/http.js';
import { summaries, isDate, addDays, daysBetween, HealthError } from '../lib/google.js';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'mi-fitbit', title: 'Mi Fitbit', version: '1.0.0' };
const MAX_DAYS = 31;

const DAY_SHAPE = 'Cada día trae: sueno (la noche que terminó ese día: horas, minutosDormido, minutosEnCama, acostado, despierto, etapas en minutos y siestas; sinRegistro si no hubo), pasos, minutosZonaActiva, minutosActivos por nivel, ejercicios (inicio, tipo, nombre, minutos) y pulsoReposo. Un valor null significa sin dato (por ejemplo, la pulsera no se llevó puesta). noDisponible explica qué datos no se pudieron leer.';

const TOOLS = [
  {
    name: 'resumen_del_dia',
    title: 'Resumen del día',
    description: 'Sueño, pasos, minutos activos, ejercicios y pulso en reposo de un día, desde la Fitbit del usuario (Google Health). ' + DAY_SHAPE,
    inputSchema: {
      type: 'object',
      properties: { fecha: { type: 'string', description: 'Día en formato AAAA-MM-DD, en la hora local del usuario.' } },
      required: ['fecha'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  },
  {
    name: 'resumen_de_dias',
    title: 'Resumen de varios días',
    description: `Lo mismo que resumen_del_dia para un rango de hasta ${MAX_DAYS} días, ambos extremos incluidos. Útil para tendencias semanales. ` + DAY_SHAPE,
    inputSchema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Primer día, AAAA-MM-DD.' },
        hasta: { type: 'string', description: 'Último día, AAAA-MM-DD.' }
      },
      required: ['desde', 'hasta'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
  }
];

function unauthorized(origin, invalid) {
  const meta = `${origin}/.well-known/oauth-protected-resource`;
  return json({ error: invalid ? 'invalid_token' : 'unauthorized' }, 401, {
    'www-authenticate': `Bearer resource_metadata="${meta}"${invalid ? ', error="invalid_token"' : ''}`
  });
}

export async function GET() {
  return json({ error: 'Este servidor no ofrece flujo SSE. Usa POST.' }, 405, { allow: 'POST' });
}
export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}

export async function POST(request) {
  const origin = baseUrl(request);
  const auth = request.headers.get('authorization') || '';
  const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const tok = raw ? await open(raw, 'at') : null;
  if (!tok) return unauthorized(origin, !!raw);

  let msg;
  try { msg = await request.json(); } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido.' } }, 400);
  }
  const list = Array.isArray(msg) ? msg : [msg];
  const out = [];
  for (const m of list) {
    let r;
    try { r = await handle(m, tok.g); } catch (e) {
      if (e && e.reauth) return unauthorized(origin, true); // lets claude.ai refresh the token and retry
      throw e;
    }
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202 });
  return json(Array.isArray(msg) ? out : out[0]);
}

async function handle(m, googleToken) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    return { jsonrpc: '2.0', id: m && m.id !== undefined ? m.id : null, error: { code: -32600, message: 'Solicitud inválida.' } };
  }
  const isNotification = m.id === undefined || m.id === null;
  const ok = result => isNotification ? null : { jsonrpc: '2.0', id: m.id, result };
  const fail = (code, message) => isNotification ? null : { jsonrpc: '2.0', id: m.id, error: { code, message } };

  switch (m.method) {
    case 'initialize': {
      const asked = m.params && m.params.protocolVersion;
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: 'Datos de solo lectura de la Fitbit del usuario: sueño, pasos, actividad, ejercicios y pulso en reposo. Las fechas son AAAA-MM-DD en hora local.'
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': return ok(await callTool(m.params || {}, googleToken));
    default:
      if (m.method.startsWith('notifications/')) return null;
      return fail(-32601, `Método no soportado: ${m.method}`);
  }
}

function toolError(text) {
  return { isError: true, content: [{ type: 'text', text }] };
}

async function callTool(params, googleToken) {
  const args = params.arguments || {};
  let desde, hasta;
  if (params.name === 'resumen_del_dia') {
    if (!isDate(args.fecha)) return toolError('fecha debe tener el formato AAAA-MM-DD.');
    desde = hasta = args.fecha;
  } else if (params.name === 'resumen_de_dias') {
    if (!isDate(args.desde) || !isDate(args.hasta)) return toolError('desde y hasta deben tener el formato AAAA-MM-DD.');
    if (args.hasta < args.desde) return toolError('hasta no puede ser anterior a desde.');
    if (daysBetween(args.desde, args.hasta) >= MAX_DAYS) return toolError(`El rango máximo es de ${MAX_DAYS} días.`);
    desde = args.desde; hasta = args.hasta;
  } else {
    return toolError(`Herramienta desconocida: ${params.name}`);
  }
  if (desde > addDays(new Date().toISOString().slice(0, 10), 1)) return toolError('Esa fecha está en el futuro.');

  try {
    const r = await summaries(googleToken, desde, hasta);
    const result = params.name === 'resumen_del_dia' ? { ...r.dias[0], noDisponible: r.noDisponible } : r;
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (e) {
    if (e instanceof HealthError && e.reason === 'ACCOUNT_NOT_LINKED') {
      return toolError('Tu cuenta de Google no está vinculada a Google Health. Inicia sesión en la app Google Health y vuelve a conectar el conector.');
    }
    if (e instanceof HealthError && e.status === 401) throw Object.assign(new Error('reauth'), { reauth: true });
    console.error('tool error', e && e.message);
    return toolError('No se pudieron leer los datos de Google Health en este momento.');
  }
}
