import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handler } from '../src/weekly.js';

type Captured = { url: string; body: string };

function startMock(leaderboardBody: { status: number; body: string }): Promise<{ server: Server; url: string; calls: Captured[] }> {
  return new Promise(resolve => {
    const calls: Captured[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const url = req.url ?? '';
        calls.push({ url, body });
        if (url.includes('/leaderboard')) {
          res.statusCode = leaderboardBody.status;
          res.setHeader('content-type', 'application/json');
          res.end(leaderboardBody.body);
        } else {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

const HORSES = { org_name: 'TeamFoo', horses: [
  { name: 'Bolt', owner_name: 'Bob', wins: 5, podiums: 6, xp: 700, races_entered: 9 },
] };

describe('weekly handler', () => {
  let server: Server | undefined;
  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_CHANNEL_ID = 'C123';
    process.env.TOKEN_DERBY_ORG_NAME = 'TeamFoo';
  });
  afterEach(async () => {
    if (server) await new Promise(r => server!.close(() => r(null)));
    server = undefined;
    delete process.env.SLACK_API_BASE;
    delete process.env.TOKEN_DERBY_API_BASE;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
    delete process.env.TOKEN_DERBY_ORG_NAME;
  });

  it('fetches the leaderboard and posts to Slack', async () => {
    const started = await startMock({ status: 200, body: JSON.stringify(HORSES) });
    server = started.server;
    process.env.TOKEN_DERBY_API_BASE = started.url;
    process.env.SLACK_API_BASE = `${started.url}/api`;

    await handler({} as any, {} as any, () => {});

    const lb = started.calls.find(c => c.url.includes('/leaderboard'));
    const slack = started.calls.find(c => c.url.includes('chat.postMessage'));
    expect(lb).toBeTruthy();
    expect(slack).toBeTruthy();
    const payload = JSON.parse(slack!.body);
    expect(payload.text).toContain('Weekly leaderboard');
    expect(payload.text).toContain('TeamFoo');
    expect(slack!.body).toContain('Bolt'); // horse name appears in the rendered blocks
    expect(started.calls).toHaveLength(2); // exactly one leaderboard GET + one Slack POST
  });

  it('skips Slack when the org has no horses', async () => {
    const started = await startMock({ status: 200, body: JSON.stringify({ org_name: 'TeamFoo', horses: [] }) });
    server = started.server;
    process.env.TOKEN_DERBY_API_BASE = started.url;
    process.env.SLACK_API_BASE = `${started.url}/api`;

    await handler({} as any, {} as any, () => {});

    expect(started.calls.find(c => c.url.includes('chat.postMessage'))).toBeUndefined();
  });

  it('does not post when the leaderboard fetch fails', async () => {
    const started = await startMock({ status: 500, body: JSON.stringify({ error: 'boom' }) });
    server = started.server;
    process.env.TOKEN_DERBY_API_BASE = started.url;
    process.env.SLACK_API_BASE = `${started.url}/api`;

    await handler({} as any, {} as any, () => {});

    expect(started.calls.find(c => c.url.includes('/leaderboard'))).toBeTruthy(); // it tried
    expect(started.calls.find(c => c.url.includes('chat.postMessage'))).toBeUndefined(); // but did not post
  });

  it('does nothing when required env is missing', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const started = await startMock({ status: 200, body: JSON.stringify(HORSES) });
    server = started.server;
    process.env.TOKEN_DERBY_API_BASE = started.url;
    process.env.SLACK_API_BASE = `${started.url}/api`;

    await handler({} as any, {} as any, () => {});
    expect(started.calls).toHaveLength(0);
  });
});
