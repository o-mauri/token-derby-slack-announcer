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
