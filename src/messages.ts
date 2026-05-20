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
    `⏰  *Starts:* ${formatRaceTime(race.start_time, race.tz)}\n` +
    `🏁  *Ends:*    ${formatRaceTime(race.end_time,   race.tz)}\n\n` +
    `May the fastest horse win! 🐎`;

  return {
    text: `New race starting in Token Derby: ${race.name} — join code ${race.join_code}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🏇  A new Race is starting in Token Derby!', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: sectionText },
      },
      { type: 'divider' },
      {
        type: 'header',
        text: { type: 'plain_text', text: `🔑  JOIN CODE: ${race.join_code}`, emoji: true },
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
