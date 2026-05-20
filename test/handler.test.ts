import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { handler } from '../src/handler.js';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const SECRET = 'shhh';

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

function makeEvent(body: string, headers: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /webhook',
    rawPath: '/webhook',
    rawQueryString: '',
    headers,
    requestContext: {} as any,
    body,
    isBase64Encoded: false,
  };
}

type Captured = { method: string; url: string; headers: Record<string, string>; body: string };

function startMock(handler: (req: Captured) => { status: number; headers?: Record<string, string>; body?: string }): Promise<{ server: Server; url: string; calls: Captured[] }> {
  return new Promise(resolve => {
    const calls: Captured[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const captured: Captured = { method: req.method ?? '', url: req.url ?? '', headers: req.headers as any, body };
        calls.push(captured);
        const r = handler(captured);
        res.statusCode = r.status;
        for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v);
        res.end(r.body ?? '');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

const CREATED_BODY = JSON.stringify({
  event: 'race.created',
  delivery_id: 'd-1',
  sent_at: '2026-05-20T17:00:00.000Z',
  organisation: { org_id: 'o1', org_name: 'TeamFoo' },
  race: {
    race_id: 'r1',
    name: 'Friday Sprint',
    join_code: 'AB7XQ2',
    start_time: '2026-05-21T17:00:00.000Z',
    end_time:   '2026-05-21T17:30:00.000Z',
    tz: 'Europe/London',
  },
});

const ENDED_BODY = JSON.stringify({
  event: 'race.ended',
  delivery_id: 'd-2',
  sent_at: '2026-05-20T17:30:00.000Z',
  organisation: { org_id: 'o1', org_name: 'TeamFoo' },
  race: { race_id: 'r1', name: 'Friday Sprint', tz: 'Europe/London' },
  results: [
    { rank: 1, name: 'Bolt',  final_tokens: 123, user_name: 'Omar', colors: { body: '#FF0000', mane: '#000000', tail: '#000000', saddle: '#CC0000' } },
    { rank: 2, name: 'Storm', final_tokens:  98, user_name: 'Jess', colors: { body: '#0000FF', mane: '#000000', tail: '#000000', saddle: '#0000CC' } },
  ],
});

describe('handler', () => {
  let slack: Server | undefined;
  let s3: Server | undefined;

  beforeEach(() => {
    process.env.WEBHOOK_SECRET = SECRET;
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_CHANNEL_ID = 'C123';
    process.env.SPRITE_BUCKET = 'my-bucket';
    process.env.AWS_REGION = 'eu-west-1';
  });

  afterEach(async () => {
    if (slack) await new Promise(r => slack!.close(() => r(null)));
    if (s3) await new Promise(r => s3!.close(() => r(null)));
    slack = undefined;
    s3 = undefined;
    delete process.env.SLACK_API_BASE;
    delete process.env.S3_ENDPOINT;
  });

  it('rejects requests with a missing signature', async () => {
    const res: any = await handler(makeEvent(CREATED_BODY, {
      'x-token-derby-event': 'race.created',
      'x-token-derby-delivery': 'd-1',
    }));
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with a bad signature', async () => {
    const res: any = await handler(makeEvent(CREATED_BODY, {
      'x-token-derby-event': 'race.created',
      'x-token-derby-delivery': 'd-1',
      'x-token-derby-signature': 'sha256=deadbeef',
    }));
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed JSON with a valid signature as 400', async () => {
    const body = '{not-json';
    const res: any = await handler(makeEvent(body, {
      'x-token-derby-event': 'race.created',
      'x-token-derby-delivery': 'd-x',
      'x-token-derby-signature': sign(body),
    }));
    expect(res.statusCode).toBe(400);
  });

  it('posts a race.created message to Slack and returns 200', async () => {
    const startedSlack = await startMock(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
    slack = startedSlack.server;
    process.env.SLACK_API_BASE = startedSlack.url;

    const res: any = await handler(makeEvent(CREATED_BODY, {
      'x-token-derby-event': 'race.created',
      'x-token-derby-delivery': 'd-1',
      'x-token-derby-signature': sign(CREATED_BODY),
    }));
    expect(res.statusCode).toBe(200);
    expect(startedSlack.calls).toHaveLength(1);
    const payload = JSON.parse(startedSlack.calls[0]!.body);
    expect(payload.channel).toBe('C123');
    expect(payload.text).toContain('Friday Sprint');
    expect(payload.blocks.some((b: any) => b.type === 'header')).toBe(true);
    expect(payload.blocks.some((b: any) => b.type === 'image')).toBe(false);
  });

  it('uploads the sprite and includes the image block on race.ended', async () => {
    const startedSlack = await startMock(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
    slack = startedSlack.server;
    process.env.SLACK_API_BASE = startedSlack.url;

    const startedS3 = await startMock((req) => {
      if (req.method === 'HEAD') return { status: 404 };
      if (req.method === 'PUT')  return { status: 200 };
      return { status: 405 };
    });
    s3 = startedS3.server;
    process.env.S3_ENDPOINT = startedS3.url;

    const res: any = await handler(makeEvent(ENDED_BODY, {
      'x-token-derby-event': 'race.ended',
      'x-token-derby-delivery': 'd-2',
      'x-token-derby-signature': sign(ENDED_BODY),
    }));
    expect(res.statusCode).toBe(200);

    expect(startedS3.calls.some(c => c.method === 'HEAD')).toBe(true);
    expect(startedS3.calls.some(c => c.method === 'PUT')).toBe(true);

    const payload = JSON.parse(startedSlack.calls[0]!.body);
    const image = payload.blocks.find((b: any) => b.type === 'image');
    expect(image).toBeDefined();
    expect(image.image_url).toMatch(/^https:\/\/my-bucket\.s3\.eu-west-1\.amazonaws\.com\/winners\/[0-9a-f]{40}\.png$/);
  });

  it('still posts the message (without image block) when S3 fails', async () => {
    const startedSlack = await startMock(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
    slack = startedSlack.server;
    process.env.SLACK_API_BASE = startedSlack.url;

    const startedS3 = await startMock(() => ({ status: 500 }));
    s3 = startedS3.server;
    process.env.S3_ENDPOINT = startedS3.url;

    const res: any = await handler(makeEvent(ENDED_BODY, {
      'x-token-derby-event': 'race.ended',
      'x-token-derby-delivery': 'd-2',
      'x-token-derby-signature': sign(ENDED_BODY),
    }));
    expect(res.statusCode).toBe(200);

    expect(startedSlack.calls).toHaveLength(1);
    const payload = JSON.parse(startedSlack.calls[0]!.body);
    expect(payload.blocks.find((b: any) => b.type === 'image')).toBeUndefined();
  });

  it('returns 200 ignored for an unknown event type', async () => {
    const startedSlack = await startMock(() => ({ status: 200, body: JSON.stringify({ ok: true }) }));
    slack = startedSlack.server;
    process.env.SLACK_API_BASE = startedSlack.url;

    const body = JSON.stringify({ event: 'race.cancelled', delivery_id: 'd-x', sent_at: '2026-01-01T00:00:00Z', organisation: { org_id: 'o', org_name: 'x' }, race: {} });
    const res: any = await handler(makeEvent(body, {
      'x-token-derby-event': 'race.cancelled',
      'x-token-derby-delivery': 'd-x',
      'x-token-derby-signature': sign(body),
    }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ignored).toBe(true);
    expect(startedSlack.calls).toHaveLength(0);
  });
});
