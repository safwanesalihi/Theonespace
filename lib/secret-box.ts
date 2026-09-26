// Encrypts the tokens of connected social accounts before they are stored (AES-256-GCM). The key is
// derived from AUTH_SECRET, so a database dump alone never gives anyone access to a client's accounts.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';

function key() {
  const secret = env.AUTH_SECRET || (env.NODE_ENV === 'production' ? '' : 'local-development-only-secret-000000');
  if (secret.length < 32) throw new Error('AUTH_SECRET manquant : il chiffre les comptes connectés.');
  return Buffer.from(hkdfSync('sha256', secret, 'the-one-social', 'social-account-tokens', 32));
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function open(sealed: string): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Jeton illisible.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
