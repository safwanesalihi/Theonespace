// Encrypts the tokens of connected social accounts before they are stored (AES-256-GCM). The key is
// derived from AUTH_SECRET, so a database dump alone never gives anyone access to a client's accounts.
//
// Rotation: seal() always uses the current AUTH_SECRET; open() tries it first, then each secret in
// AUTH_SECRET_PREVIOUS (comma-separated), so a new secret can be rolled in without losing accounts.
// 'v2' values bind an `aad` string (e.g. the workspace and row they belong to) as GCM additional
// authenticated data, so a sealed value copied to another row or workspace no longer opens.
// 'v1' values (no aad) are still read.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';

const derive = (secret: string) => Buffer.from(hkdfSync('sha256', secret, 'the-one-social', 'social-account-tokens', 32));

function key() {
  const secret = env.AUTH_SECRET || (env.NODE_ENV === 'production' ? '' : 'local-development-only-secret-000000');
  if (secret.length < 32) throw new Error('AUTH_SECRET manquant : il chiffre les comptes connectés.');
  return derive(secret);
}

/** The current key first, then the previous secrets that are long enough to have been real ones. */
function openKeys() {
  const previous = (env.AUTH_SECRET_PREVIOUS ?? '').split(',').map((s) => s.trim()).filter((s) => s.length >= 32);
  return [key(), ...previous.map(derive)];
}

export function seal(plain: string, aad = ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v2', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function open(sealed: string, aad = ''): string {
  const [version, iv, tag, body] = sealed.split('.');
  if ((version !== 'v1' && version !== 'v2') || !iv || !tag || !body) throw new Error('Jeton illisible.');
  for (const candidate of openKeys()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', candidate, Buffer.from(iv, 'base64url'));
      if (version === 'v2') decipher.setAAD(Buffer.from(aad, 'utf8')); // v1 carries none: aad is ignored
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    } catch { /* wrong key or wrong aad: try the next secret */ }
  }
  throw new Error('Jeton illisible.');
}
