// Stateless, encrypted tokens (AES-256-GCM). Every token this server hands out
// (client ids, auth codes, access and refresh tokens) is an encrypted blob that
// only this server can open, so no database is needed.
const enc = new TextEncoder();
const dec = new TextDecoder();
let keyPromise = null;

function key() {
  if (!keyPromise) {
    keyPromise = (async () => {
      const secret = process.env.TOKEN_SECRET || '';
      if (secret.length < 32) throw new Error('TOKEN_SECRET debe tener al menos 32 caracteres.');
      const raw = await crypto.subtle.digest('SHA-256', enc.encode('conector-fitbit:v1:' + secret));
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    })();
  }
  return keyPromise;
}

export const now = () => Math.floor(Date.now() / 1000);
export const b64u = buf => Buffer.from(buf).toString('base64url');

export async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64u(out);
}

/** Opens a token of the given kind; returns null if it is invalid, of another kind or expired. */
export async function open(token, kind) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) return null;
  try {
    const buf = Buffer.from(token, 'base64url');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) }, await key(), buf.subarray(12));
    const obj = JSON.parse(dec.decode(pt));
    if (kind && obj.k !== kind) return null;
    if (obj.exp && obj.exp < now()) return null;
    return obj;
  } catch {
    return null;
  }
}

export async function sha256b64u(text) {
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}
