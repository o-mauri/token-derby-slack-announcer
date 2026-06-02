import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchLeaderboard } from '../src/leaderboard.js';

function startMock(status: number, body: string): Promise<{ server: Server; url: string; calls: string[] }> {
  return new Promise(resolve => {
    const calls: string[] = [];
    const server = createServer((req, res) => {
      calls.push(req.url ?? '');
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

describe('fetchLeaderboard', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise(r => server!.close(() => r(null)));
    server = undefined;
  });

  it('GETs the org leaderboard path and returns the parsed body', async () => {
    const payload = { org_name: 'TeamFoo', horses: [{ name: 'Bolt', owner_name: 'Bob', wins: 1, podiums: 2, xp: 3, races_entered: 4 }] };
    const started = await startMock(200, JSON.stringify(payload));
    server = started.server;

    const result = await fetchLeaderboard(started.url, 'TeamFoo');
    expect(started.calls[0]).toBe('/api/organisations/TeamFoo/leaderboard');
    expect(result?.horses[0]?.name).toBe('Bolt');
  });

  it('url-encodes the org name', async () => {
    const started = await startMock(200, JSON.stringify({ org_name: 'a b', horses: [] }));
    server = started.server;
    await fetchLeaderboard(started.url, 'a b');
    expect(started.calls[0]).toBe('/api/organisations/a%20b/leaderboard');
  });

  it('returns null on a non-2xx response', async () => {
    const started = await startMock(404, JSON.stringify({ code: 'ORG_NOT_FOUND' }));
    server = started.server;
    const result = await fetchLeaderboard(started.url, 'Nope');
    expect(result).toBeNull();
  });
});
