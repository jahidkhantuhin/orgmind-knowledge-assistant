import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

function encryptionKey(): Buffer {
  return createHash('sha256')
    .update(env.BETTER_AUTH_SECRET)
    .update(':mcp-integration-token')
    .digest();
}

export function encryptIntegrationToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptIntegrationToken(ciphertext: string): string {
  const [ivValue, tagValue, encryptedValue] = ciphertext.split('.');
  if (!ivValue || !tagValue || !encryptedValue)
    throw new Error('Stored connector credentials are invalid.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
