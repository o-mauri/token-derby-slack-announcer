# Token Derby Slack Announcer — Design

## Goal

A lightweight standalone service that receives the two Token Derby
webhook events (`race.created`, `race.ended`) and posts a Block Kit
message to a single Slack channel.

## Scope

- One Slack channel, configured as a Lambda env var at deploy time.
- HMAC-SHA256 verification of every inbound request before any work.
- Both events supported.
- The `race.ended` message includes a coloured PNG sprite of the winning
  horse, rendered server-side from the horse's colors and hosted on a
  small public S3 bucket the stack owns.
- Single AWS account, single region (`eu-west-1`), single Lambda.
- No retries, no persistence beyond the sprite cache — token-derby is
  fire-and-forget, so we match its semantics.

## Out of scope

- Per-org channel routing.
- Multiple Slack workspaces / multiple bot tokens.
- Custom domain — the API Gateway URL is the webhook URL.
- A site, a dashboard, a queue.
- Slash commands or interactive Slack components.
- Tests against live Slack.

## Architecture

```
                                                            ┌──> S3 (winner sprite PNGs)
                                                            │     ▲
token-derby ──POST /webhook──> API Gateway HTTP API ──> Lambda ──> Slack chat.postMessage
                                                         │
                                                         └── verify HMAC, render+upload sprite,
                                                             build Block Kit, POST
```

Single CDK stack, single Lambda, single HTTP route, one small public
S3 bucket for sprite hosting.

## Configuration

Four Lambda environment variables:

| Variable           | Purpose                                                |
|--------------------|--------------------------------------------------------|
| `WEBHOOK_SECRET`   | The `webhook_secret` returned by token-derby on `PUT /webhook`. Used to HMAC-verify every inbound request. |
| `SLACK_BOT_TOKEN`  | The `xoxb-…` bot token of the Slack app posting messages. |
| `SLACK_CHANNEL_ID` | Channel ID (e.g. `C0123ABCDEF`) — not the name. IDs survive renames. |
| `SPRITE_BUCKET`    | Name of the public S3 bucket the stack created for sprite PNGs. Wired in automatically by CDK; not set by hand. |

All three are set in CDK as `lambda.Function` env vars. AWS encrypts
Lambda env vars at rest. No SSM, no Secrets Manager — this is a personal
project and the cost-of-loss is one Slack channel.

Values are read from a local `.env` file (gitignored) at deploy time and
injected into the stack via CDK context. A `.env.example` checked into
git documents the shape. `cdk.context.json` is reserved for CDK's own
lookup cache.

## Request flow

1. **Read the raw body** — HMAC verification depends on the exact bytes
   sent. Do not `JSON.parse` first.
2. **Verify the signature**:
   - Read `X-Token-Derby-Signature` header. Must be present and start
     with `sha256=`.
   - Compute `'sha256=' + hmacSha256Hex(WEBHOOK_SECRET, rawBody)`.
   - Compare with `timingSafeEqual` (constant-time).
   - On any failure, return `401 { error: 'invalid signature' }`. Log
     warn with the `X-Token-Derby-Delivery` header.
3. **Parse the JSON body**. Malformed → `400 { error: 'invalid json' }`.
4. **Branch on `X-Token-Derby-Event`**:
   - `race.created` → build the "Race starting" message.
   - `race.ended` → render-and-upload the winner's sprite PNG to S3
     (see "Sprite rendering" below), then build the "Race finished"
     message including the sprite image block.
   - Anything else → log warn, return `200 { ok: true, ignored: true }`.
     Token-derby is fire-and-forget so an error response wastes both
     sides; ignored is the right semantics for a new event type the
     announcer hasn't been updated for.
5. **POST to Slack** `https://slack.com/api/chat.postMessage` with
   `Authorization: Bearer ${SLACK_BOT_TOKEN}` and a JSON body containing
   `channel`, `text` (fallback for notifications), and `blocks`.
6. **Inspect the response.** Slack returns `200` even on logical errors,
   so check `body.ok === true`. On failure, log warn with `body.error`
   and the delivery_id. Return `200 { ok: true }` to token-derby anyway
   — retries would not be honoured.
7. **Return `200 { ok: true }`.**

## Slack message shapes (v1)

These are intentionally short and emoji-rich. They can be refined later
without touching the verification or wire-handling code.

### `race.created`

`text` fallback: `New race starting in Token Derby: <race name>`

Blocks:

```
header  "🏇  A new Race is starting in Token Derby!"
section mrkdwn:
  *"<race name>"*  ·  _<org name>_

  🔑  *Join code:* `<join_code>`
  ⏰  *Starts:* <start_time formatted in race tz>
  🏁  *Ends:*    <end_time   formatted in race tz>

  May the fastest horse win! 🐎
```

### `race.ended`

`text` fallback: `Race finished: <race name> — winner <horse name>`

Blocks:

```
header  "🏁  The Race has finished!"
section mrkdwn:
  *"<race name>"*  ·  _<org name>_

  🥇  1.  *<horse>*  <tokens> tokens  ·  <user_name>
  🥈  2.  *<horse>*  <tokens> tokens  ·  <user_name>
  🥉  3.  *<horse>*  <tokens> tokens  ·  <user_name>
        4.  *<horse>*  <tokens> tokens  ·  <user_name>
  ... (one line per result, sorted by rank ascending)

  🎉  Congrats to *<rank-1 horse>*!
image (winner sprite):
  image_url: https://<sprite-bucket-domain>/winners/<sha1(colors)>.png
  alt_text:  "<rank-1 horse> — winning horse"
```

If there are zero finishers (degenerate race), use the body
`No horses finished this one.` instead of the leaderboard and omit the
sprite image block.

Date formatting uses `Intl.DateTimeFormat('en-GB', { timeZone: tz, ... })`
so the user sees the race's local time, not the receiver's.

## Sprite rendering

The winner's horse is drawn server-side from a copy of token-derby's
sprite grid plus the four colors the user picked. The output is a small
PNG (under 5 kB) hosted on a public S3 bucket the stack owns.

**Vendored grid.** `src/sprite-grid.ts` is a verbatim copy of
`site/src/sprite-grid.ts` from token-derby — a 32×24 ASCII-encoded grid
of slot tags (B/M/T/S/H/null) where the letters map to body / mane /
tail / saddle / hoof. The vendored file carries a header comment naming
the source path and the date it was copied. Sprite layout changes in
token-derby are intentionally out of band — this is a tiny, stable
input, not a shared library.

**Render.** `src/sprite-png.ts` exports
`renderHorsePng(colors: HorseColors, scale = 8): Buffer`. It uses
`pngjs` (~3 kB pure-JS, zero native deps). For each `(y, x)` in the
grid, look up the tag, map to one of `colors.body / mane / tail /
saddle` or the fixed hoof colour `#1F1108`, and write a `scale × scale`
block of RGBA bytes into the PNG buffer. Background pixels (`null`
tag) are written as transparent. Result at scale=8 is 256×192 pixels.

**Hosting.** A separate `cdk-managed` S3 bucket
`token-derby-slack-announcer-sprites-<account>-<region>` (CDK auto-names
it) with:

- `BlockPublicAccess.BLOCK_ACLS` (modern setting; bucket policy still
  grants public read).
- A bucket policy granting `s3:GetObject` on `arn:.../winners/*` to
  `Principal: *`.
- `RemovalPolicy.DESTROY` and `autoDeleteObjects: true` so `cdk destroy`
  cleans up — these are derived files, not state.
- No versioning, no lifecycle expiry. Files are content-addressed (see
  below) so they're effectively immutable.

**Object naming.** Keys are `winners/<sha1(JSON.stringify(colors))>.png`.
Content-addressed naming means:

- Two horses with identical colour choices share a single PNG.
- The handler can `HeadObject` first and skip the render+upload if the
  PNG already exists — typical race involves repeat colour combos.
- The PNG never needs to change once written, so cache headers are
  aggressive: `Cache-Control: public, max-age=31536000, immutable`.

**URL.** The public URL is `https://${bucket}.s3.${region}.amazonaws.com/winners/<hash>.png`.
The Lambda assembles this from `SPRITE_BUCKET` and `process.env.AWS_REGION`
rather than constructing it from a website endpoint.

**Head-or-upload.** On every `race.ended`, the Lambda first issues an
S3 `HeadObject` for the computed key. If it returns 200, the PNG is
already in the bucket and the upload is skipped. If it returns 404,
`renderHorsePng` is invoked and the result is `PutObject`-ed with
content-type and cache-control headers. Common colour combinations
(default-themed horses) effectively only ever render once.

**Failure mode.** If the S3 upload fails (IAM, throttling, transport),
the handler logs warn and posts the Slack message **without** the image
block — leaderboard still shows. The race-ended announcement degrades
gracefully rather than failing the whole delivery.

## Wire types

A redeclared subset of token-derby's webhook payloads, in
`src/types.ts`, with only the fields this service actually uses:

```ts
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

export type HorseColors = {
  body: string;
  mane: string;
  tail: string;
  saddle: string;
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

This is intentionally a narrower view than the source contract — fewer
fields means fewer points of breakage if token-derby grows its payload.

## CDK stack

Single stack `TokenDerbySlackAnnouncerStack` (region `eu-west-1`):

- `NodejsFunction` (Node 22, 256 MB, 5 s timeout) bundled from
  `src/handler.ts`. Env vars from `.env` plus the auto-injected
  `SPRITE_BUCKET`.
- `HttpApi` with one route `POST /webhook` integrated to the Lambda.
- `s3.Bucket` for sprite hosting (public-read on `winners/*`, autodelete
  on stack destroy, no versioning, no lifecycle). The bucket grants
  `s3:PutObject` and `s3:GetObject` to the Lambda's execution role.
- No DynamoDB, no Route53, no ACM, no CloudFront.
- `cdk.CfnOutput` for the API URL so the user can copy it into
  `token-derby organisation webhook set`.

The stack is intentionally small — well under 150 lines.

## File layout

```
token-derby-slack-announcer/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── .gitignore
├── .env.example
├── src/
│   ├── handler.ts          // Lambda entry, orchestrates the flow
│   ├── verify.ts           // HMAC verification (timingSafeEqual)
│   ├── slack.ts            // chat.postMessage client
│   ├── messages.ts         // Block Kit builders for both events
│   ├── sprite-grid.ts      // Vendored 32×24 grid from token-derby
│   ├── sprite-png.ts       // pngjs renderer: HorseColors -> PNG Buffer
│   ├── sprite-store.ts     // S3 head-or-upload + URL builder
│   └── types.ts            // Local copy of event payload types
├── test/
│   ├── verify.test.ts
│   ├── messages.test.ts    // Snapshot tests for Block Kit JSON
│   ├── sprite-png.test.ts  // Render is deterministic, hash matches
│   └── handler.test.ts     // End-to-end with mock Slack server
└── infra/
    ├── package.json
    ├── tsconfig.json
    ├── cdk.json
    ├── bin/
    │   └── app.ts
    └── lib/
        └── announcer-stack.ts
```

The `infra/` subdir has its own `package.json` so its CDK dependencies
don't pollute the runtime bundle, mirroring the token-derby split.

## Testing

- **`verify.test.ts`**: known-good signature passes; mismatched fails;
  missing header fails; using a different secret fails; comparison is
  timing-safe (no early-return on first mismatched byte).
- **`messages.test.ts`**: feed canned `RaceCreatedEvent` /
  `RaceEndedEvent` fixtures, snapshot the resulting Block Kit JSON
  (with the sprite image URL stubbed). Cover: 1 finisher, 3 finishers,
  5 finishers (medals + numbers), 0 finishers (image block omitted).
- **`sprite-png.test.ts`**: given fixed colors, `renderHorsePng` returns
  a deterministic PNG buffer — sha1 of the bytes is asserted against a
  golden value. Re-rendering with the same colors gives the same hash.
  Different colors give different hashes.
- **`handler.test.ts`**: spin up two in-process HTTP servers — one as
  the mock Slack endpoint, one as a mock S3 endpoint (HEAD + PUT).
  Override the Slack and S3 base URLs via env vars. POST a real signed
  request to the handler, assert both mocks received what they should.
  Cover: valid race.created (no sprite path), valid race.ended (sprite
  uploaded, image URL present), invalid signature, malformed JSON,
  unknown event type, Slack returns `ok: false`, S3 PUT fails (message
  still sent, sans image block).

No live Slack calls in CI.

## Operational notes

- API Gateway throttling: stick to the CDK default (10 000 req/s) — this
  service is single-channel and will never get close.
- Lambda logs land in CloudWatch under
  `/aws/lambda/TokenDerbySlackAnnouncerStack-AnnouncerFn-<id>`.
- Cold starts: NodejsFunction with no Slack SDK (we hand-roll `fetch` to
  `chat.postMessage`) cold-starts in well under 500 ms. Token-derby's
  2 s timeout accommodates this with room to spare.
- Idempotency: the `delivery_id` header is logged for tracing. We don't
  dedup — fire-and-forget means a duplicate would only arrive on retry,
  and token-derby doesn't retry.

## Deployment

1. Copy `.env.example` to `.env` and fill the three values. (The
   token-derby `WEBHOOK_SECRET` is the one printed by
   `token-derby organisation webhook set` — see step 4.)
2. `npm run build` (compiles TypeScript and the CDK stack).
3. `npm run deploy` (wraps `cdk deploy` from `infra/`, sources `.env`).
4. Copy the printed API URL into
   `token-derby organisation webhook set <org-name> <url>`. Save the
   printed `webhook_secret` as `WEBHOOK_SECRET` in `.env` and redeploy.
