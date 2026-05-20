import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

export function verifySignature(
  rawBody: string | Buffer,
  headerValue: string | undefined,
  secret: string,
): boolean {
  if (!headerValue || !headerValue.startsWith(PREFIX)) return false;

  const expected = PREFIX + createHmac('sha256', secret).update(rawBody).digest('hex');
  if (headerValue.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected));
}
