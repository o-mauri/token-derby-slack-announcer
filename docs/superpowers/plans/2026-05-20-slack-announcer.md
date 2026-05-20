# Token Derby Slack Announcer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a standalone API Gateway + Lambda service that verifies token-derby webhooks (HMAC-SHA256), renders a PNG sprite of the winning horse, and posts a Block Kit message to a single Slack channel.

**Architecture:** TypeScript Node 22 Lambda behind an HTTP API. The handler verifies the signature against the raw body, branches on `x-token-derby-event`, renders the winner's horse PNG via `pngjs` for `race.ended`, head-or-uploads it to a public S3 bucket the stack owns, and posts to `chat.postMessage`. Two top-level workspaces — `./` for the Lambda runtime, `./infra` for the CDK stack — no monorepo glue beyond that.

**Tech Stack:** TypeScript, Node 22, Vitest, AWS CDK v2 (`HttpApi`, `NodejsFunction`, `s3.Bucket`), `@aws-sdk/client-s3`, `pngjs`, `node:crypto`. No external Slack SDK — we hand-roll a `fetch` to `chat.postMessage`.

---

## File Structure

**Create at the project root:**

- `package.json` — runtime + dev deps. The Lambda's runtime deps (`@aws-sdk/client-s3`, `pngjs`) and dev tooling (`typescript`, `vitest`, type packages).
- `tsconfig.json` — strict TS, `nodenext` module, target `es2022`.
- `vitest.config.ts` — points at `test/**/*.test.ts`, node environment.
- `.gitignore` — `node_modules/`, `dist/`, `cdk.out/`, `.env`, `*.tsbuildinfo`.
- `.env.example` — documented placeholder for the three runtime secrets.
- `README.md` — quick setup + deploy + wiring-to-token-derby steps.

**`src/` — Lambda code, one focused module each:**

- `src/types.ts` — `HorseColors`, `RaceCreatedEvent`, `RaceEndedResult`, `RaceEndedEvent`. Narrower than the source contract; only fields we use.
- `src/verify.ts` — `verifySignature(rawBody, headerValue, secret) -> boolean`. Uses `timingSafeEqual`.
- `src/sprite-grid.ts` — verbatim copy of token-derby's `site/src/sprite-grid.ts`. The 24×32 ASCII grid + the `SlotTag` type + `SPRITE_WIDTH` / `SPRITE_HEIGHT` constants.
- `src/sprite-png.ts` — `renderHorsePng(colors, scale = 8) -> Buffer`. Deterministic, pure.
- `src/sprite-store.ts` — `ensureSprite(client, bucket, colors) -> string`. Computes the content-addressed key, HEADs to check, PUTs if missing, returns the public URL.
- `src/slack.ts` — `postSlackMessage(token, channel, text, blocks) -> { ok: boolean; error?: string }`. Reads `SLACK_API_BASE` from env (defaults to `https://slack.com/api`) so tests can override.
- `src/messages.ts` — `buildRaceCreatedMessage(event)` and `buildRaceEndedMessage(event, spriteUrl?)` — pure Block Kit builders.
- `src/handler.ts` — Lambda entry. Reads env, orchestrates verify → parse → branch → render → post. Single file ~100 lines.

**`test/` — vitest:**

- `test/verify.test.ts`
- `test/sprite-png.test.ts`
- `test/sprite-store.test.ts`
- `test/messages.test.ts`
- `test/slack.test.ts`
- `test/handler.test.ts`

**`infra/` — CDK:**

- `infra/package.json` — CDK deps (`aws-cdk-lib`, `constructs`, `aws-cdk`).
- `infra/tsconfig.json`
- `infra/cdk.json` — `app: "npx ts-node bin/app.ts"`, `context` empty.
- `infra/bin/app.ts` — instantiates the single stack in `eu-west-1`.
- `infra/lib/announcer-stack.ts` — defines the bucket, the Lambda, the HTTP API, and the CFN outputs.

Each file owns one concept. Nothing reaches across modules except through the explicit signatures listed above.

---

## Task 1: Scaffold the repo

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`

- [ ] **Step 1: Create `package.json` at the project root**

Project working directory throughout this plan: `/Users/omauri/personal_projects/token-derby-slack-announcer`. Run all commands from there unless otherwise noted.

```json
{
  "name": "token-derby-slack-announcer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "test:watch": "vitest",
    "deploy": "npm --prefix infra run deploy",
    "destroy": "npm --prefix infra run destroy"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.650.0",
    "pngjs": "^7.0.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.145",
    "@types/node": "^22.7.0",
    "@types/pngjs": "^6.0.5",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "esModuleInterop": true,
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test", "infra"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
cdk.out/
.env
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 5: Create `.env.example`**

```
# token-derby webhook_secret (printed once by `token-derby organisation webhook set`).
WEBHOOK_SECRET=

# Slack bot user OAuth token (xoxb-...).
SLACK_BOT_TOKEN=

# Slack channel ID, not name (e.g. C0123ABCDEF).
SLACK_CHANNEL_ID=
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: deps install, `node_modules/` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore .env.example package-lock.json
git commit -m "chore: scaffold project (package.json, tsconfig, vitest, .env.example)"
```

---

## Task 2: Wire types (`src/types.ts`)

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create `src/types.ts`**

```ts
export type HorseColors = {
  body: string;
  mane: string;
  tail: string;
  saddle: string;
};

export type RaceCreatedEvent = {
  event: 'race.created';
  delivery_id: string;
  sent_at: string;
  organisation: { org_id: string; org_name: string };
  race: {
    race_id: string;
    name: string;
    join_code: string;
    start_time: string;
    end_time: string;
    tz: string;
  };
};

export type RaceEndedResult = {
  rank: number;
  name: string;
  final_tokens: number;
  user_name: string;
  colors: HorseColors;
};

export type RaceEndedEvent = {
  event: 'race.ended';
  delivery_id: string;
  sent_at: string;
  organisation: { org_id: string; org_name: string };
  race: {
    race_id: string;
    name: string;
    tz: string;
  };
  results: RaceEndedResult[];
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: succeeds, no output (the file has no value-level exports, but tsc still verifies syntax).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add local webhook event payload types"
```

---

## Task 3: HMAC verifier (`src/verify.ts`) + tests

**Files:**
- Create: `src/verify.ts`
- Create: `test/verify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/verify.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/verify.test.ts`
Expected: FAIL with "Cannot find module '../src/verify.js'".

- [ ] **Step 3: Implement `src/verify.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/verify.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/verify.ts test/verify.test.ts
git commit -m "feat(verify): add HMAC-SHA256 webhook signature verifier"
```

---

## Task 4: Vendored sprite grid (`src/sprite-grid.ts`)

**Files:**
- Create: `src/sprite-grid.ts`

- [ ] **Step 1: Create `src/sprite-grid.ts`**

This file is a verbatim copy of `site/src/sprite-grid.ts` from the
`token_derby` repo, with a header comment naming the source. Do not
modify the grid — layout is identical.

```ts
// Vendored from token-derby: site/src/sprite-grid.ts (copied 2026-05-20).
// Keep this file in sync if the canonical sprite ever changes.

export type SlotTag = 'B' | 'M' | 'T' | 'S' | 'H' | null;

const ROWS: readonly string[] = [
  '................................',
  '................................',
  '..........................MMM...',
  '..........................MMM...',
  '.........................MBBEBB.',
  '.........................MBBEBB.',
  '........................MBBBBBBB',
  '........................MBBBBBBB',
  '..................MMMMMMMBBB....',
  '..................MMMMMMMBBB....',
  '....BBBBBBBBSSSSSSMMBBBBBB......',
  '...BBBBBBBBBSSSSSSMMBBBBBB......',
  '.TTBBBBBBBBBSSSSSSBBBBBBBB......',
  '.TTBBBBBBBBBSSSSSSBBBBBBBB......',
  'TTTBBBBBBBBBBBBBBBBBBBBBBB......',
  'TTTBBBBBBBBBBBBBBBBBBBBB........',
  '...BBB.BBB.....BBB.BBB..........',
  '...BBB.BBB.....BBB.BBB..........',
  '....BB..BB......BB..BB..........',
  '....BB..BB......BB..BB..........',
  '....BB..BB......BB..BB..........',
  '....BB..BB......BB..BB..........',
  '....BB..BB......BB..BB..........',
  '...HHH.HHH.....HHH.HHH..........',
];

export const GRID: readonly (readonly SlotTag[])[] = ROWS.map((row, y) => {
  if (row.length !== 32) throw new Error(`sprite row ${y} has length ${row.length}, expected 32`);
  return [...row].map(c => toTag(c, y));
});

function toTag(c: string, y: number): SlotTag {
  switch (c) {
    case 'B': return 'B';
    case 'M': return 'M';
    case 'T': return 'T';
    case 'S': return 'S';
    case 'H': return 'H';
    case 'E': return 'B';
    case '.': return null;
    default: throw new Error(`unknown sprite char '${c}' at y=${y}`);
  }
}

export const SPRITE_WIDTH = 32;
export const SPRITE_HEIGHT = 24;
export const HOOF_COLOR = '#1F1108';
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/sprite-grid.ts
git commit -m "feat(sprite): vendor token-derby's 32x24 sprite grid"
```

---

## Task 5: Sprite PNG renderer (`src/sprite-png.ts`) + tests

**Files:**
- Create: `src/sprite-png.ts`
- Create: `test/sprite-png.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/sprite-png.test.ts`:

```ts
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
    // Row 14 col 10 is 'B' (body) in the grid.
    const idx = (14 * SPRITE_WIDTH + 10) * 4;
    expect(png.data[idx]).toBe(0xFF);     // R
    expect(png.data[idx + 1]).toBe(0x00); // G
    expect(png.data[idx + 2]).toBe(0x00); // B
    expect(png.data[idx + 3]).toBe(0xFF); // A
  });

  it('writes null-tag pixels as transparent', () => {
    const buf = renderHorsePng(RED, 1);
    const png = PNG.sync.read(buf);
    // Row 0 col 0 is '.' (null) — fully transparent.
    expect(png.data[3]).toBe(0x00);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/sprite-png.test.ts`
Expected: FAIL with "Cannot find module '../src/sprite-png.js'".

- [ ] **Step 3: Implement `src/sprite-png.ts`**

```ts
import { PNG } from 'pngjs';
import { GRID, SPRITE_WIDTH, SPRITE_HEIGHT, HOOF_COLOR, type SlotTag } from './sprite-grid.js';
import type { HorseColors } from './types.js';

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

function parseHex(hex: string): [number, number, number] {
  const m = HEX_RE.exec(hex);
  if (!m) throw new Error(`invalid hex colour "${hex}"`);
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF];
}

function rgbForTag(tag: SlotTag, colors: HorseColors): [number, number, number, number] {
  switch (tag) {
    case 'B': return [...parseHex(colors.body),   0xFF];
    case 'M': return [...parseHex(colors.mane),   0xFF];
    case 'T': return [...parseHex(colors.tail),   0xFF];
    case 'S': return [...parseHex(colors.saddle), 0xFF];
    case 'H': return [...parseHex(HOOF_COLOR),    0xFF];
    case null: return [0, 0, 0, 0];
  }
}

export function renderHorsePng(colors: HorseColors, scale: number = 8): Buffer {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('scale must be a positive integer');

  const width = SPRITE_WIDTH * scale;
  const height = SPRITE_HEIGHT * scale;
  const png = new PNG({ width, height });

  for (let gy = 0; gy < SPRITE_HEIGHT; gy++) {
    const row = GRID[gy]!;
    for (let gx = 0; gx < SPRITE_WIDTH; gx++) {
      const [r, g, b, a] = rgbForTag(row[gx]!, colors);
      for (let dy = 0; dy < scale; dy++) {
        const py = gy * scale + dy;
        for (let dx = 0; dx < scale; dx++) {
          const px = gx * scale + dx;
          const idx = (py * width + px) * 4;
          png.data[idx]     = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = a;
        }
      }
    }
  }

  return PNG.sync.write(png);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/sprite-png.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/sprite-png.ts test/sprite-png.test.ts
git commit -m "feat(sprite): render horse PNGs from colours via pngjs"
```

---

## Task 6: Sprite S3 store (`src/sprite-store.ts`) + tests

**Files:**
- Create: `src/sprite-store.ts`
- Create: `test/sprite-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/sprite-store.test.ts`. The test spins up a local HTTP server pretending to be S3, points the SDK at it, and asserts that:
- A missing object is rendered + PUT.
- A present object skips the PUT.
- The returned URL is the standard virtual-host form.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { S3Client } from '@aws-sdk/client-s3';
import { ensureSprite, spriteKey } from '../src/sprite-store.js';
import type { HorseColors } from '../src/types.js';

const COLORS: HorseColors = { body: '#FF0000', mane: '#000', tail: '#000', saddle: '#C00' };

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
    expect(put.body.length).toBeGreaterThan(100); // a real PNG body
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/sprite-store.test.ts`
Expected: FAIL with "Cannot find module '../src/sprite-store.js'".

- [ ] **Step 3: Implement `src/sprite-store.ts`**

```ts
import { createHash } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { renderHorsePng } from './sprite-png.js';
import type { HorseColors } from './types.js';

export function spriteKey(colors: HorseColors): string {
  const canonical = JSON.stringify({
    body:   colors.body.toLowerCase(),
    mane:   colors.mane.toLowerCase(),
    tail:   colors.tail.toLowerCase(),
    saddle: colors.saddle.toLowerCase(),
  });
  const hash = createHash('sha1').update(canonical).digest('hex');
  return `winners/${hash}.png`;
}

export async function ensureSprite(
  client: S3Client,
  bucket: string,
  colors: HorseColors,
): Promise<string> {
  const key = spriteKey(colors);
  const region = (await client.config.region()) ?? 'eu-west-1';
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return url; // Already there — skip render+upload.
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status !== 404 && status !== 403) throw err;
  }

  const body = renderHorsePng(colors);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return url;
}
```

Note: S3 returns 403 instead of 404 for missing objects when the caller lacks `s3:ListBucket`; we treat both as "object not present, go ahead and PUT".

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/sprite-store.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/sprite-store.ts test/sprite-store.test.ts
git commit -m "feat(sprite): head-or-upload sprite PNG to S3 with content-addressed key"
```

---

## Task 7: Block Kit message builders (`src/messages.ts`) + tests

**Files:**
- Create: `src/messages.ts`
- Create: `test/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/messages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRaceCreatedMessage, buildRaceEndedMessage } from '../src/messages.js';
import type { RaceCreatedEvent, RaceEndedEvent, HorseColors } from '../src/types.js';

const COLORS: HorseColors = { body: '#FF0000', mane: '#000', tail: '#000', saddle: '#C00' };

const CREATED: RaceCreatedEvent = {
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
};

function endedEvent(results: RaceEndedEvent['results']): RaceEndedEvent {
  return {
    event: 'race.ended',
    delivery_id: 'd-2',
    sent_at: '2026-05-20T17:30:00.000Z',
    organisation: { org_id: 'o1', org_name: 'TeamFoo' },
    race: { race_id: 'r1', name: 'Friday Sprint', tz: 'Europe/London' },
    results,
  };
}

describe('buildRaceCreatedMessage', () => {
  it('returns a header + section block with race details', () => {
    const msg = buildRaceCreatedMessage(CREATED);
    expect(msg.text).toContain('Friday Sprint');
    expect(msg.blocks[0]!.type).toBe('header');
    expect((msg.blocks[0] as any).text.text).toContain('A new Race is starting');
    const sectionText = (msg.blocks[1] as any).text.text as string;
    expect(sectionText).toContain('Friday Sprint');
    expect(sectionText).toContain('TeamFoo');
    expect(sectionText).toContain('AB7XQ2');
    expect(sectionText).toMatch(/Starts:.*2026/);
    expect(sectionText).toMatch(/Ends:.*2026/);
    expect(sectionText).not.toContain('Created by');
  });
});

describe('buildRaceEndedMessage', () => {
  it('renders a podium with three finishers and the sprite image', () => {
    const msg = buildRaceEndedMessage(endedEvent([
      { rank: 1, name: 'Bolt',  final_tokens: 123, user_name: 'Omar', colors: COLORS },
      { rank: 2, name: 'Storm', final_tokens:  98, user_name: 'Jess', colors: COLORS },
      { rank: 3, name: 'Spark', final_tokens:  54, user_name: 'Kai',  colors: COLORS },
    ]), 'https://example.com/winners/abc.png');
    expect(msg.text).toContain('Friday Sprint');
    expect(msg.text).toContain('Bolt');
    const sectionText = (msg.blocks[1] as any).text.text as string;
    expect(sectionText).toContain('🥇');
    expect(sectionText).toContain('🥈');
    expect(sectionText).toContain('🥉');
    expect(sectionText).toContain('Bolt');
    expect(sectionText).toContain('123 tokens');
    expect(sectionText).toContain('Omar');
    const image = msg.blocks.find((b: any) => b.type === 'image') as any;
    expect(image).toBeDefined();
    expect(image.image_url).toBe('https://example.com/winners/abc.png');
    expect(image.alt_text).toContain('Bolt');
  });

  it('uses plain numbers for rank >= 4', () => {
    const msg = buildRaceEndedMessage(endedEvent([
      { rank: 1, name: 'A', final_tokens: 10, user_name: 'a', colors: COLORS },
      { rank: 2, name: 'B', final_tokens:  9, user_name: 'b', colors: COLORS },
      { rank: 3, name: 'C', final_tokens:  8, user_name: 'c', colors: COLORS },
      { rank: 4, name: 'D', final_tokens:  7, user_name: 'd', colors: COLORS },
      { rank: 5, name: 'E', final_tokens:  6, user_name: 'e', colors: COLORS },
    ]), 'https://example.com/x.png');
    const sectionText = (msg.blocks[1] as any).text.text as string;
    expect(sectionText).toMatch(/4\.\s+\*D\*/);
    expect(sectionText).toMatch(/5\.\s+\*E\*/);
  });

  it('omits the image block when there are no results', () => {
    const msg = buildRaceEndedMessage(endedEvent([]), undefined);
    const sectionText = (msg.blocks[1] as any).text.text as string;
    expect(sectionText).toContain('No horses finished');
    expect(msg.blocks.find((b: any) => b.type === 'image')).toBeUndefined();
  });

  it('omits the image block when spriteUrl is undefined', () => {
    const msg = buildRaceEndedMessage(endedEvent([
      { rank: 1, name: 'Bolt', final_tokens: 1, user_name: 'O', colors: COLORS },
    ]), undefined);
    expect(msg.blocks.find((b: any) => b.type === 'image')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/messages.test.ts`
Expected: FAIL with "Cannot find module '../src/messages.js'".

- [ ] **Step 3: Implement `src/messages.ts`**

```ts
import type { RaceCreatedEvent, RaceEndedEvent, RaceEndedResult } from './types.js';

export type SlackMessage = {
  text: string;
  blocks: any[];
};

const MEDALS = ['🥇', '🥈', '🥉'] as const;

function formatRaceTime(iso: string, tz: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

export function buildRaceCreatedMessage(event: RaceCreatedEvent): SlackMessage {
  const { race, organisation } = event;
  const sectionText =
    `*"${race.name}"*  ·  _${organisation.org_name}_\n\n` +
    `🔑  *Join code:* \`${race.join_code}\`\n` +
    `⏰  *Starts:* ${formatRaceTime(race.start_time, race.tz)}\n` +
    `🏁  *Ends:*    ${formatRaceTime(race.end_time,   race.tz)}\n\n` +
    `May the fastest horse win! 🐎`;

  return {
    text: `New race starting in Token Derby: ${race.name}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🏇  A new Race is starting in Token Derby!', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: sectionText },
      },
    ],
  };
}

function rankPrefix(rank: number): string {
  if (rank >= 1 && rank <= 3) return MEDALS[rank - 1]!;
  return '  ';
}

function leaderboardLine(r: RaceEndedResult): string {
  const prefix = rankPrefix(r.rank);
  return `${prefix}  ${r.rank}.  *${r.name}*  ${r.final_tokens} tokens  ·  ${r.user_name}`;
}

export function buildRaceEndedMessage(event: RaceEndedEvent, spriteUrl?: string): SlackMessage {
  const { race, organisation, results } = event;
  const header = `*"${race.name}"*  ·  _${organisation.org_name}_`;
  const winner = results[0];

  let body: string;
  if (results.length === 0) {
    body = 'No horses finished this one.';
  } else {
    const board = results.map(leaderboardLine).join('\n');
    body = `${board}\n\n🎉  Congrats to *${winner!.name}*!`;
  }

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🏁  The Race has finished!', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${header}\n\n${body}` },
    },
  ];

  if (winner && spriteUrl) {
    blocks.push({
      type: 'image',
      image_url: spriteUrl,
      alt_text: `${winner.name} — winning horse`,
    });
  }

  const text = winner
    ? `Race finished: ${race.name} — winner ${winner.name}`
    : `Race finished: ${race.name}`;

  return { text, blocks };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/messages.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/messages.ts test/messages.test.ts
git commit -m "feat(messages): build race.created and race.ended Block Kit messages"
```

---

## Task 8: Slack client (`src/slack.ts`) + tests

**Files:**
- Create: `src/slack.ts`
- Create: `test/slack.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/slack.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/slack.test.ts`
Expected: FAIL with "Cannot find module '../src/slack.js'".

- [ ] **Step 3: Implement `src/slack.ts`**

```ts
export type SlackPostResult = { ok: boolean; error?: string };

const DEFAULT_BASE = 'https://slack.com/api';

export async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
  blocks: unknown[],
): Promise<SlackPostResult> {
  const base = process.env.SLACK_API_BASE ?? DEFAULT_BASE;
  const res = await fetch(`${base}/chat.postMessage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, text, blocks }),
  });

  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` };
  }

  const json = (await res.json()) as { ok?: boolean; error?: string };
  if (json.ok) return { ok: true };
  return { ok: false, error: json.error ?? 'unknown_slack_error' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/slack.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/slack.ts test/slack.test.ts
git commit -m "feat(slack): add chat.postMessage client with SLACK_API_BASE override"
```

---

## Task 9: Lambda handler (`src/handler.ts`) + integration tests

**Files:**
- Create: `src/handler.ts`
- Create: `test/handler.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `test/handler.test.ts`:

```ts
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
    { rank: 1, name: 'Bolt',  final_tokens: 123, user_name: 'Omar', colors: { body: '#FF0000', mane: '#000', tail: '#000', saddle: '#C00' } },
    { rank: 2, name: 'Storm', final_tokens:  98, user_name: 'Jess', colors: { body: '#0000FF', mane: '#000', tail: '#000', saddle: '#00C' } },
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/handler.test.ts`
Expected: FAIL with "Cannot find module '../src/handler.js'".

- [ ] **Step 3: Implement `src/handler.ts`**

```ts
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { verifySignature } from './verify.js';
import { ensureSprite } from './sprite-store.js';
import { buildRaceCreatedMessage, buildRaceEndedMessage } from './messages.js';
import { postSlackMessage } from './slack.js';
import type { RaceCreatedEvent, RaceEndedEvent } from './types.js';

function header(headers: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === name) {
      const v = headers[k];
      return typeof v === 'string' ? v : undefined;
    }
  }
  return undefined;
}

function json(status: number, body: object) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

let s3Client: S3Client | undefined;
function getS3Client(): S3Client {
  if (s3Client && !process.env.S3_ENDPOINT) return s3Client;
  // Re-build when S3_ENDPOINT is set (tests override per-test) so the test
  // endpoint always wins. In production this branch is taken once on cold start.
  s3Client = new S3Client({
    region: process.env.AWS_REGION ?? 'eu-west-1',
    ...(process.env.S3_ENDPOINT
      ? {
          endpoint: process.env.S3_ENDPOINT,
          forcePathStyle: true,
          credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
        }
      : {}),
  });
  return s3Client;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const secret = process.env.WEBHOOK_SECRET;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  const bucket = process.env.SPRITE_BUCKET;
  if (!secret || !botToken || !channel) {
    return json(500, { error: 'missing required env' });
  }

  const rawBody = event.body ?? '';
  const sigHeader = header(event.headers, 'x-token-derby-signature');
  const deliveryId = header(event.headers, 'x-token-derby-delivery') ?? 'unknown';
  const eventType = header(event.headers, 'x-token-derby-event') ?? 'unknown';

  if (!verifySignature(rawBody, sigHeader, secret)) {
    console.warn('webhook signature invalid', { deliveryId, eventType });
    return json(401, { error: 'invalid signature' });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'invalid json' });
  }

  if (eventType === 'race.created') {
    const msg = buildRaceCreatedMessage(parsed as RaceCreatedEvent);
    const result = await postSlackMessage(botToken, channel, msg.text, msg.blocks);
    if (!result.ok) console.warn('slack post failed', { deliveryId, eventType, error: result.error });
    return json(200, { ok: true });
  }

  if (eventType === 'race.ended') {
    const ended = parsed as RaceEndedEvent;
    let spriteUrl: string | undefined;
    const winner = ended.results?.[0];
    if (winner && bucket) {
      try {
        spriteUrl = await ensureSprite(getS3Client(), bucket, winner.colors);
      } catch (err) {
        console.warn('sprite upload failed', { deliveryId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const msg = buildRaceEndedMessage(ended, spriteUrl);
    const result = await postSlackMessage(botToken, channel, msg.text, msg.blocks);
    if (!result.ok) console.warn('slack post failed', { deliveryId, eventType, error: result.error });
    return json(200, { ok: true });
  }

  console.warn('ignored unknown event type', { deliveryId, eventType });
  return json(200, { ok: true, ignored: true });
};
```

- [ ] **Step 4: Run all tests to verify everything passes**

Run: `npm test`
Expected: every test file green; total ~25+ tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/handler.ts test/handler.test.ts
git commit -m "feat(handler): orchestrate verify, render+upload sprite, post to slack"
```

---

## Task 10: CDK infra (`infra/`)

**Files:**
- Create: `infra/package.json`, `infra/tsconfig.json`, `infra/cdk.json`, `infra/bin/app.ts`, `infra/lib/announcer-stack.ts`

- [ ] **Step 1: Create `infra/package.json`**

```json
{
  "name": "token-derby-slack-announcer-infra",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc -p .",
    "synth": "cdk synth",
    "deploy": "cdk deploy --require-approval never",
    "destroy": "cdk destroy --force"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "aws-cdk": "^2.150.0",
    "aws-cdk-lib": "^2.150.0",
    "constructs": "^10.3.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `infra/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "commonjs",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["bin/**/*.ts", "lib/**/*.ts"],
  "exclude": ["node_modules", "cdk.out", "dist"]
}
```

- [ ] **Step 3: Create `infra/cdk.json`**

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts",
  "watch": { "include": ["**"], "exclude": ["node_modules", "cdk.out"] },
  "context": {
    "@aws-cdk/core:newStyleStackSynthesis": true
  }
}
```

- [ ] **Step 4: Create `infra/bin/app.ts`**

```ts
import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import * as fs from 'fs';
import { TokenDerbySlackAnnouncerStack } from '../lib/announcer-stack';

// Load .env from the project root so the same file works for `npm run deploy`.
const envPath = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

const required = ['WEBHOOK_SECRET', 'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID'] as const;
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Missing required env var ${k} (check .env in project root)`);
    process.exit(1);
  }
}

const app = new cdk.App();
new TokenDerbySlackAnnouncerStack(app, 'TokenDerbySlackAnnouncerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:  process.env.CDK_DEFAULT_REGION ?? 'eu-west-1',
  },
  webhookSecret: process.env.WEBHOOK_SECRET!,
  slackBotToken: process.env.SLACK_BOT_TOKEN!,
  slackChannelId: process.env.SLACK_CHANNEL_ID!,
});
```

- [ ] **Step 5: Create `infra/lib/announcer-stack.ts`**

```ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as path from 'path';

export interface TokenDerbySlackAnnouncerStackProps extends cdk.StackProps {
  webhookSecret: string;
  slackBotToken: string;
  slackChannelId: string;
}

export class TokenDerbySlackAnnouncerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TokenDerbySlackAnnouncerStackProps) {
    super(scope, id, props);

    // Public S3 bucket for sprite PNGs. Content-addressed keys, immutable.
    const spriteBucket = new s3.Bucket(this, 'SpriteBucket', {
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    spriteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      principals: [new iam.AnyPrincipal()],
      resources: [spriteBucket.arnForObjects('winners/*')],
    }));

    const fn = new NodejsFunction(this, 'AnnouncerFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.resolve(__dirname, '..', '..', 'src', 'handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(5),
      memorySize: 256,
      bundling: {
        target: 'node22',
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        WEBHOOK_SECRET:    props.webhookSecret,
        SLACK_BOT_TOKEN:   props.slackBotToken,
        SLACK_CHANNEL_ID:  props.slackChannelId,
        SPRITE_BUCKET:     spriteBucket.bucketName,
        NODE_OPTIONS:      '--enable-source-maps',
      },
    });

    spriteBucket.grantReadWrite(fn);

    const httpApi = new HttpApi(this, 'AnnouncerApi', { apiName: 'token-derby-slack-announcer' });
    httpApi.addRoutes({
      path: '/webhook',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('WebhookInt', fn),
    });

    new cdk.CfnOutput(this, 'WebhookUrl', { value: `${httpApi.url}webhook` });
    new cdk.CfnOutput(this, 'SpriteBucketName', { value: spriteBucket.bucketName });
  }
}
```

- [ ] **Step 6: Install infra deps**

Run: `npm install --prefix infra`
Expected: deps install cleanly.

- [ ] **Step 7: Build infra**

Run: `npm run build --prefix infra`
Expected: succeeds with no TS errors.

- [ ] **Step 8: Synth the stack to verify the CDK assembly works**

Run: `npm --prefix infra run synth -- --quiet 2>&1 | tail -20`
Expected: prints the synthesised template tail (or nothing). If it fails for AWS credentials/account reasons, that's NOT a Task 10 failure — the TS build in step 7 is the required gate. To skip account lookups during synth, the alternative is `CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION=eu-west-1 npm --prefix infra run synth -- --quiet`.

- [ ] **Step 9: Commit**

```bash
git add infra/
git commit -m "feat(infra): CDK stack — bucket, Lambda, HTTP API"
```

---

## Task 11: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# token-derby-slack-announcer

Lightweight receiver for [token-derby](../token_derby) webhooks. Posts a
Block Kit message to a single Slack channel on `race.created` and
`race.ended`, with a coloured PNG sprite of the winning horse on
`race.ended`.

## Architecture

- API Gateway HTTP API → Lambda → Slack `chat.postMessage`.
- Public S3 bucket (`SpriteBucket`) hosts content-addressed PNGs.
- HMAC-SHA256 verification on every inbound request.
- Fire-and-forget — token-derby retries nothing, neither do we.

## Setup

1. Copy `.env.example` to `.env` and fill the three values:

   ```
   WEBHOOK_SECRET=...        # printed by `token-derby organisation webhook set`
   SLACK_BOT_TOKEN=xoxb-...  # bot user OAuth token
   SLACK_CHANNEL_ID=C0123... # channel ID, not name
   ```

2. Install deps:

   ```bash
   npm install
   npm install --prefix infra
   ```

3. Bootstrap your AWS account once per region (skip if already done):

   ```bash
   npm --prefix infra exec -- cdk bootstrap aws://<account>/eu-west-1
   ```

4. Deploy:

   ```bash
   npm run deploy
   ```

   The output `WebhookUrl` is what you paste into
   `token-derby organisation webhook set <org-name> <url>`. The
   token-derby command prints a `webhook_secret`; copy it back into
   `.env` as `WEBHOOK_SECRET` and redeploy.

## Development

- `npm test` — vitest suites (no AWS, no Slack).
- `npm run build` — typecheck the Lambda.
- `npm --prefix infra run synth` — CDK synth without deploying.
- `npm run destroy` — `cdk destroy`. Bucket is `autoDeleteObjects` so the
  PNGs go with it.

## Layout

- `src/` — Lambda runtime.
- `test/` — vitest, all in-process mocks (no live Slack or AWS).
- `infra/` — CDK app + single stack.
- `docs/superpowers/` — spec and plan.
```

- [ ] **Step 2: Run the full test suite one more time**

Run: `npm test`
Expected: every suite passes.

- [ ] **Step 3: Run the Lambda typecheck and the infra build together**

Run: `npm run build && npm run build --prefix infra`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, deploy, and dev instructions"
```

---

## Out of scope reminders (do NOT do these in this plan)

- Per-org channel routing or any DynamoDB.
- Custom Route 53 / ACM / CloudFront domain.
- Slash commands or interactive Slack features.
- Retries, DLQs, or any persistence beyond the sprite bucket.
- A live-Slack integration test.
- Migrating sprite logic into a shared package with token-derby. The
  vendored copy is intentional.
