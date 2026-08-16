import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  if (!env.webhookSecretKey) {
    throw new Error('WEBHOOK_SECRET_KEY is not set -- required to store or read webhook secrets');
  }
  const key = Buffer.from(env.webhookSecretKey, 'hex');
  if (key.length !== 32) {
    throw new Error('WEBHOOK_SECRET_KEY must be 32 bytes (64 hex characters)');
  }
  return key;
}

/**
 * Webhook signing secrets are encrypted, not hashed (DECISIONS.md #23): unlike a password
 * or an API key, the plaintext has to be recoverable to compute the outgoing HMAC, and a
 * one-way hash can't be reversed for that.
 *
 * Stored as iv:authTag:ciphertext, all hex. GCM's auth tag makes tampering with a stored
 * secret detectable rather than silently producing a wrong signature.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(':');
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Stored webhook secret is malformed');
  }
  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];

  const authTag = Buffer.from(authTagHex, 'hex');
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Stored webhook secret has an invalid auth tag');
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}
