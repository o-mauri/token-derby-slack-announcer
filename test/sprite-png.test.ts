import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { renderHorsePng } from '../src/sprite-png.js';
import { SPRITE_WIDTH, SPRITE_HEIGHT } from '../src/sprite-grid.js';
import { PNG } from 'pngjs';

const RED   = { body: '#FF0000', mane: '#000000', tail: '#000000', saddle: '#FF0000' };
const BLUE  = { body: '#0000FF', mane: '#000000', tail: '#000000', saddle: '#0000FF' };

function sha1(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex');
}

describe('renderHorsePng', () => {
  it('produces a valid PNG buffer at scale=8', () => {
    const buf = renderHorsePng(RED);
    expect(buf.length).toBeGreaterThan(100);
    const png = PNG.sync.read(buf);
    expect(png.width).toBe(SPRITE_WIDTH * 8);
    expect(png.height).toBe(SPRITE_HEIGHT * 8);
  });

  it('is deterministic — same colors render to the same bytes', () => {
    const a = renderHorsePng(RED);
    const b = renderHorsePng(RED);
    expect(sha1(a)).toBe(sha1(b));
  });

  it('produces different bytes for different colors', () => {
    const a = renderHorsePng(RED);
    const b = renderHorsePng(BLUE);
    expect(sha1(a)).not.toBe(sha1(b));
  });

  it('honours a custom scale', () => {
    const buf = renderHorsePng(RED, 4);
    const png = PNG.sync.read(buf);
    expect(png.width).toBe(SPRITE_WIDTH * 4);
    expect(png.height).toBe(SPRITE_HEIGHT * 4);
  });

  it('writes the body colour into a known body pixel', () => {
    const buf = renderHorsePng(RED, 1);
    const png = PNG.sync.read(buf);
    const idx = (14 * SPRITE_WIDTH + 10) * 4;
    expect(png.data[idx]).toBe(0xFF);
    expect(png.data[idx + 1]).toBe(0x00);
    expect(png.data[idx + 2]).toBe(0x00);
    expect(png.data[idx + 3]).toBe(0xFF);
  });

  it('writes null-tag pixels as transparent', () => {
    const buf = renderHorsePng(RED, 1);
    const png = PNG.sync.read(buf);
    expect(png.data[3]).toBe(0x00);
  });
});
