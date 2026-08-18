import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_PORTKEY_SECRET_BYTES = 32;

export function assertValidPortkeyWebhookSecret(secret: string): void {
  if (secret.length < MIN_PORTKEY_SECRET_BYTES) {
    throw new Error(`portkeyWebhookSecret must contain at least ${MIN_PORTKEY_SECRET_BYTES} characters`);
  }
}

export function verifyPortkeyBearer(authorization: string | undefined, secret: string): boolean {
  const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
  if (match === null) return false;
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(secret));
}
