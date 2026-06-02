import type { ScheduledHandler } from 'aws-lambda';
import { fetchLeaderboard } from './leaderboard.js';
import { buildWeeklyLeaderboardMessage } from './messages.js';
import { postSlackMessage } from './slack.js';

const DEFAULT_API_BASE = 'https://token-derby.mauricode.co.uk';

export const handler: ScheduledHandler = async () => {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  const orgName = process.env.TOKEN_DERBY_ORG_NAME;
  const apiBase = process.env.TOKEN_DERBY_API_BASE ?? DEFAULT_API_BASE;

  if (!botToken || !channel || !orgName) {
    console.warn('weekly job: missing required env (SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, TOKEN_DERBY_ORG_NAME)');
    return;
  }

  const data = await fetchLeaderboard(apiBase, orgName);
  if (!data) {
    console.warn('weekly job: leaderboard fetch failed', { orgName });
    return;
  }
  if (data.horses.length === 0) {
    console.log('weekly job: org has no horses, skipping', { orgName });
    return;
  }

  const msg = buildWeeklyLeaderboardMessage(data);
  try {
    const result = await postSlackMessage(botToken, channel, msg.text, msg.blocks);
    if (!result.ok) console.warn('weekly job: slack post failed', { error: result.error });
  } catch (err) {
    console.warn('weekly job: slack post threw', { error: err instanceof Error ? err.message : String(err) });
  }
};
