import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/verify.js';

const SECRET = 'shhh';
const BODY = '{"event":"race.created"}';
const GOOD = 'sha256=' + createHmac('sha256', SECRET).update(BODY).digest('hex');

describe('verifySignature', () => {
  it('accepts a known-good signature', () => {
    expect(verifySignature(BODY, GOOD, SECRET)).toBe(true);
  });

  it('rejects a signature from a different secret', () => {
    const wrong = 'sha256=' + createHmac('sha256', 'other').update(BODY).digest('hex');
    expect(verifySignature(BODY, wrong, SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifySignature(BODY, undefined, SECRET)).toBe(false);
  });

  it('rejects an empty header', () => {
    expect(verifySignature(BODY, '', SECRET)).toBe(false);
  });

  it('rejects a header without the sha256= prefix', () => {
    const naked = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(verifySignature(BODY, naked, SECRET)).toBe(false);
  });

  it('rejects a length-mismatched signature without throwing', () => {
    expect(verifySignature(BODY, 'sha256=abc', SECRET)).toBe(false);
  });
});
