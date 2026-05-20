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
  // Re-build whenever S3_ENDPOINT is set so tests' per-test mock servers
  // always win. In production this branch is taken once on cold start.
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
  if (!bucket) console.warn('SPRITE_BUCKET is not set — race.ended messages will post without the winner sprite');

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
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
