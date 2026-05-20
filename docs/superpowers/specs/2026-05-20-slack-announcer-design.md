# Token Derby Slack Announcer — Design

## Goal

A lightweight standalone service that receives the two Token Derby
webhook events (`race.created`, `race.ended`) and posts a Block Kit
message to a single Slack channel.

## Scope

- One Slack channel, configured as a Lambda env var at deploy time.
- HMAC-SHA256 verification of every inbound request before any work.
- Both events supported.
- Single AWS account, single region (`eu-west-1`), single Lambda.
- No retries, no persistence — token-derby is fire-and-forget, so we
  match its semantics.

## Out of scope

- Per-org channel routing.
- Multiple Slack workspaces / multiple bot tokens.
- Custom domain — the API Gateway URL is the webhook URL.
- A site, a dashboard, a queue.
- Slash commands or interactive Slack components.
- Tests against live Slack.

## Architecture

```
token-derby ──POST /webhook──> API Gateway HTTP API ──> Lambda ──> Slack chat.postMessage
                                                         │
                                                         └── verify HMAC, build Block Kit, POST
```

Single CDK stack, single Lambda, single HTTP route.

## Configuration

Three Lambda environment variables:

| Variable           | Purpose                                                |
|--------------------|--------------------------------------------------------|
| `WEBHOOK_SECRET`   | The `webhook_secret` returned by token-derby on `PUT /webhook`. Used to HMAC-verify every inbound request. |
| `SLACK_BOT_TOKEN`  | The `xoxb-…` bot token of the Slack app posting messages. |
| `SLACK_CHANNEL_ID` | Channel ID (e.g. `C0123ABCDEF`) — not the name. IDs survive renames. |

All three are set in CDK as `lambda.Function` env vars. AWS encrypts
Lambda env vars at rest. No SSM, no Secrets Manager — this is a personal
project and the cost-of-loss is one Slack channel.

A `cdk.context.json` (gitignored) holds the actual values used at deploy.
A `cdk.context.example.json` checked into git documents the shape.

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
   - `race.ended` → build the "Race finished" message.
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
```

If there are zero finishers (degenerate race), use the body
`No horses finished this one.` instead of the leaderboard.

Date formatting uses `Intl.DateTimeFormat('en-GB', { timeZone: tz, ... })`
so the user sees the race's local time, not the receiver's.

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

export type RaceEndedResult = {
  rank: number;
  name: string;
  final_tokens: number;
  user_name: string;
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
  `src/handler.ts`. Env vars from `cdk.context.json`.
- `HttpApi` with one route `POST /webhook` integrated to the Lambda.
- No DynamoDB, no Route53, no ACM, no CloudFront.
- `cdk.CfnOutput` for the API URL so the user can copy it into
  `token-derby organisation webhook set`.

The stack is intentionally tiny — under 100 lines.

## File layout

```
token-derby-slack-announcer/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── .gitignore
├── cdk.context.example.json
├── src/
│   ├── handler.ts          // Lambda entry, orchestrates the flow
│   ├── verify.ts           // HMAC verification (timingSafeEqual)
│   ├── slack.ts            // chat.postMessage client
│   ├── messages.ts         // Block Kit builders for both events
│   └── types.ts            // Local copy of event payload types
├── test/
│   ├── verify.test.ts
│   ├── messages.test.ts    // Snapshot tests for Block Kit JSON
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
  `RaceEndedEvent` fixtures, snapshot the resulting Block Kit JSON.
  Cover: 1 finisher, 3 finishers, 5 finishers (medals + numbers),
  0 finishers (degenerate race).
- **`handler.test.ts`**: spin up an in-process HTTP server as the mock
  Slack endpoint. Override the Slack base URL via env var. POST a real
  signed request to the handler, assert the mock server received the
  expected `channel`, `text`, and `blocks`. Cover: valid race.created,
  valid race.ended, invalid signature, malformed JSON, unknown event
  type, Slack returns `ok: false`.

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

1. Fill `cdk.context.json` with the three secrets and the channel ID.
2. `npm run build` (compiles TypeScript and the CDK stack).
3. `npm run deploy` (wraps `cdk deploy` from `infra/`).
4. Copy the printed API URL into
   `token-derby organisation webhook set <org-name> <url>`.
5. Save the printed token-derby secret as `WEBHOOK_SECRET` in
   `cdk.context.json` and redeploy.
