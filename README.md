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
