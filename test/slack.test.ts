import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { postSlackMessage } from '../src/slack.js';

type CapturedReq = { url: string; headers: Record<string, string>; body: string };

function startMockSlack(response: { status: number; body: string }): Promise<{ server: Server; url: string; calls: CapturedReq[] }> {
  return new Promise(resolve => {
    const calls: CapturedReq[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        calls.push({ url: req.url ?? '', headers: req.headers as any, body });
        res.statusCode = response.status;
        res.setHeader('content-type', 'application/json');
        res.end(response.body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

describe('postSlackMessage', () => {
  let server: Server | undefined;
  beforeEach(() => {
    delete process.env.SLACK_API_BASE;
  });
  afterEach(async () => {
    if (server) await new Promise(r => server!.close(() => r(null)));
    server = undefined;
    delete process.env.SLACK_API_BASE;
  });

  it('POSTs the right payload and returns ok:true on success', async () => {
    const started = await startMockSlack({ status: 200, body: JSON.stringify({ ok: true }) });
    server = started.server;
    process.env.SLACK_API_BASE = started.url;

    const result = await postSlackMessage('xoxb-test', 'C123', 'hello', [{ type: 'section' }]);
    expect(result).toEqual({ ok: true });
    expect(started.calls).toHaveLength(1);
    const c = started.calls[0]!;
    expect(c.url).toBe('/chat.postMessage');
    expect(c.headers['authorization']).toBe('Bearer xoxb-test');
    expect(c.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(c.body)).toEqual({
      channel: 'C123',
      text: 'hello',
      blocks: [{ type: 'section' }],
    });
  });

  it('returns ok:false with the error string when Slack responds ok:false', async () => {
    const started = await startMockSlack({
      status: 200,
      body: JSON.stringify({ ok: false, error: 'channel_not_found' }),
    });
    server = started.server;
    process.env.SLACK_API_BASE = started.url;

    const result = await postSlackMessage('xoxb-test', 'C404', 'x', []);
    expect(result).toEqual({ ok: false, error: 'channel_not_found' });
  });

  it('returns ok:false on non-2xx HTTP status', async () => {
    const started = await startMockSlack({ status: 500, body: 'boom' });
    server = started.server;
    process.env.SLACK_API_BASE = started.url;

    const result = await postSlackMessage('xoxb-test', 'C1', 'x', []);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/http_500/);
  });
});
