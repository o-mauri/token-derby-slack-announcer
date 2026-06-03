import type { RaceCreatedEvent, RaceEndedEvent, RaceEndedResult, LeaderboardEntry, GetOrgLeaderboardResponse } from './types.js';

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
    `<!here>\n\n` +
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
        type: 'section',
        text: { type: 'mrkdwn', text: 'Join code:' },
      },
      {
        type: 'header',
        text: { type: 'plain_text', text: `🔑  ${race.join_code}`, emoji: true },
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
  const header = `<!here>\n\n*"${race.name}"*  ·  _${organisation.org_name}_`;
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

type Metric = 'wins' | 'podiums' | 'xp';

// Sort a copy of the horses by `primary` desc, breaking ties with the other
// two metrics (desc) and finally by name (asc) for total determinism.
function rankBy(horses: LeaderboardEntry[], primary: Metric): LeaderboardEntry[] {
  const order: Record<Metric, Metric[]> = {
    wins:    ['wins', 'podiums', 'xp'],
    podiums: ['podiums', 'wins', 'xp'],
    xp:      ['xp', 'wins', 'podiums'],
  };
  const keys = order[primary];
  return [...horses].sort((a, b) => {
    for (const k of keys) {
      if (b[k] !== a[k]) return b[k] - a[k];
    }
    return a.name.localeCompare(b.name);
  });
}

function categorySection(title: string, horses: LeaderboardEntry[], metric: Metric, unit: string): any {
  const top = rankBy(horses, metric).slice(0, 5);
  const lines = top.map((h, i) => {
    const rank = i + 1;
    // Top 3 get a medal only; 4th/5th get a numbered prefix.
    const label = rank <= 3 ? MEDALS[rank - 1]! : `${rank}.`;
    const value = h[metric];
    // Singularise the unit for a count of 1 ("1 win", not "1 wins"). "XP" has no
    // trailing "s" so it is unaffected.
    const u = value === 1 ? unit.replace(/s$/, '') : unit;
    return `${label}  *${h.name}*  ${value} ${u}  ·  ${h.owner_name}`;
  });
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: `*${title}*\n\n${lines.join('\n')}` },
  };
}

export function buildWeeklyLeaderboardMessage(data: GetOrgLeaderboardResponse): SlackMessage {
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🏇  Weekly Stable Leaderboard', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `_${data.org_name}_  ·  all-time top horses` },
    },
    { type: 'divider' },
    categorySection('Most Wins', data.horses, 'wins', 'wins'),
    { type: 'divider' },
    categorySection('Most Podiums', data.horses, 'podiums', 'podiums'),
    { type: 'divider' },
    categorySection('Most XP', data.horses, 'xp', 'XP'),
  ];

  return {
    text: `Weekly leaderboard for ${data.org_name}`,
    blocks,
  };
}
