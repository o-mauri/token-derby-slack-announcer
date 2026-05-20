import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { S3Client } from '@aws-sdk/client-s3';
import { ensureSprite, spriteKey } from '../src/sprite-store.js';
import type { HorseColors } from '../src/types.js';

const COLORS: HorseColors = { body: '#FF0000', mane: '#000000', tail: '#000000', saddle: '#CC0000' };

type CapturedReq = { method: string; url: string; body: Buffer };

function startMockS3(handler: (req: CapturedReq) => { status: number; body?: string }): Promise<{ server: Server; url: string; calls: CapturedReq[] }> {
  return new Promise(resolve => {
    const calls: CapturedReq[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const captured: CapturedReq = { method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks) };
        calls.push(captured);
        const { status, body } = handler(captured);
        res.statusCode = status;
        res.end(body ?? '');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

function makeClient(endpoint: string): S3Client {
  return new S3Client({
    region: 'eu-west-1',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
  });
}

describe('spriteKey', () => {
  it('produces a stable content-addressed key', () => {
    expect(spriteKey(COLORS)).toMatch(/^winners\/[0-9a-f]{40}\.png$/);
    expect(spriteKey(COLORS)).toBe(spriteKey({ ...COLORS }));
  });

  it('differs for different colours', () => {
    expect(spriteKey(COLORS)).not.toBe(spriteKey({ ...COLORS, body: '#00FF00' }));
  });
});

describe('ensureSprite', () => {
  let server: Server | undefined;
  beforeEach(() => {});
  afterEach(async () => {
    if (server) await new Promise(r => server!.close(() => r(null)));
    server = undefined;
  });

  it('PUTs when the object is missing (HEAD returns 404)', async () => {
    const started = await startMockS3((req) => {
      if (req.method === 'HEAD') return { status: 404 };
      if (req.method === 'PUT') return { status: 200 };
      return { status: 405 };
    });
    server = started.server;
    const client = makeClient(started.url);
    const url = await ensureSprite(client, 'my-bucket', COLORS);
    expect(url).toMatch(/^https:\/\/my-bucket\.s3\.eu-west-1\.amazonaws\.com\/winners\/[0-9a-f]{40}\.png$/);
    const methods = started.calls.map(c => c.method);
    expect(methods).toContain('HEAD');
    expect(methods).toContain('PUT');
    const put = started.calls.find(c => c.method === 'PUT')!;
    expect(put.body.length).toBeGreaterThan(100);
  });

  it('skips PUT when the object already exists (HEAD returns 200)', async () => {
    const started = await startMockS3((req) => {
      if (req.method === 'HEAD') return { status: 200 };
      return { status: 200 };
    });
    server = started.server;
    const client = makeClient(started.url);
    const url = await ensureSprite(client, 'my-bucket', COLORS);
    expect(url).toMatch(/^https:\/\/my-bucket\.s3\.eu-west-1\.amazonaws\.com\/winners\/[0-9a-f]{40}\.png$/);
    const methods = started.calls.map(c => c.method);
    expect(methods).toContain('HEAD');
    expect(methods).not.toContain('PUT');
  });
});
