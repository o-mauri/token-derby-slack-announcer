import { describe, it, expect } from 'vitest';
import { buildWeeklyLeaderboardMessage } from '../src/messages.js';
import type { GetOrgLeaderboardResponse, LeaderboardEntry } from '../src/types.js';

function h(name: string, wins: number, podiums: number, xp: number): LeaderboardEntry {
  return { name, owner_name: `${name}Owner`, wins, podiums, xp, races_entered: wins + podiums };
}

function resp(horses: LeaderboardEntry[]): GetOrgLeaderboardResponse {
  return { org_name: 'TeamFoo', horses };
}

describe('buildWeeklyLeaderboardMessage', () => {
  it('shows three sections each ranked by their own metric, top 5', () => {
    const horses = [
      h('A', 10, 1, 50),
      h('B', 9, 12, 60),
      h('C', 8, 2, 999),
      h('D', 7, 3, 40),
      h('E', 6, 4, 30),
      h('F', 1, 11, 20),
    ];
    const msg = buildWeeklyLeaderboardMessage(resp(horses));

    expect(msg.text).toContain('TeamFoo');
    const allText = JSON.stringify(msg.blocks);
    expect(allText).toContain('Most Wins');
    expect(allText).toContain('Most Podiums');
    expect(allText).toContain('Most XP');

    const winsSection = (msg.blocks.find((b: any) => b.type === 'section' && b.text?.text?.includes('Most Wins')) as any).text.text as string;
    expect(winsSection.indexOf('*A*')).toBeGreaterThan(-1);
    expect(winsSection).not.toContain('*F*');

    const podSection = (msg.blocks.find((b: any) => b.type === 'section' && b.text?.text?.includes('Most Podiums')) as any).text.text as string;
    expect(podSection.indexOf('*B*')).toBeLessThan(podSection.indexOf('*F*'));

    const xpSection = (msg.blocks.find((b: any) => b.type === 'section' && b.text?.text?.includes('Most XP')) as any).text.text as string;
    expect(xpSection.indexOf('*C*')).toBeGreaterThan(-1);
    // top horse C sits on the gold-medal line, which carries the medal only (no "1.")
    const xpFirst = xpSection.split('\n').find(l => l.startsWith('🥇'));
    expect(xpFirst).toContain('*C*');
    expect(xpFirst).not.toContain('1.');
    // ranks 4 and 5 keep their numbered prefix
    expect(xpSection).toContain('4.');
    expect(xpSection).toContain('5.');
  });

  it('shows medals only for the top 3 and numbers for 4th/5th', () => {
    const horses = [
      h('A', 10, 0, 0), h('B', 9, 0, 0), h('C', 8, 0, 0), h('D', 7, 0, 0), h('E', 6, 0, 0),
    ];
    const winsSection = (buildWeeklyLeaderboardMessage(resp(horses)).blocks
      .find((b: any) => b.type === 'section' && b.text?.text?.includes('Most Wins')) as any).text.text as string;
    const entryLines = winsSection.split('\n').filter(l => l.includes('*A*') || l.includes('*B*') || l.includes('*C*') || l.includes('*D*') || l.includes('*E*'));
    expect(entryLines[0]).toBe('🥇  *A*  10 wins  ·  AOwner');
    expect(entryLines[1]!.startsWith('🥈')).toBe(true);
    expect(entryLines[2]!.startsWith('🥉')).toBe(true);
    expect(entryLines[3]).toBe('4.  *D*  7 wins  ·  DOwner');
    expect(entryLines[4]).toBe('5.  *E*  6 wins  ·  EOwner');
    // no numeric prefix on the medal lines
    expect(entryLines[0]).not.toContain('1.');
  });

  it('formats headings bold with no emoji and a blank line before the leaderboard', () => {
    const msg = buildWeeklyLeaderboardMessage(resp([h('A', 3, 2, 10)]));
    const winsSection = (msg.blocks.find((b: any) => b.type === 'section' && b.text?.text?.includes('Most Wins')) as any).text.text as string;
    // heading is bold, on its own line, with a blank line before the first entry
    expect(winsSection.startsWith('*Most Wins*\n\n')).toBe(true);
    // no emoji adjacent to the heading (🏆/🥈/⭐ removed); medal emoji still appear on rank lines
    expect(winsSection).not.toContain('🏆');
    expect(winsSection.split('\n\n')[0]).toBe('*Most Wins*');
  });

  it('places a divider between each stat section', () => {
    const msg = buildWeeklyLeaderboardMessage(resp([h('A', 3, 2, 10)]));
    const types = msg.blocks.map((b: any) => b.type);
    // header, section(subtitle), divider, section(wins), divider, section(podiums), divider, section(xp)
    expect(types).toEqual([
      'header', 'section', 'divider', 'section', 'divider', 'section', 'divider', 'section',
    ]);
  });

  it('handles fewer than 5 horses without padding', () => {
    const msg = buildWeeklyLeaderboardMessage(resp([h('Solo', 3, 3, 30), h('Duo', 1, 1, 10)]));
    const winsSection = (msg.blocks.find((b: any) => b.type === 'section' && b.text?.text?.includes('Most Wins')) as any).text.text as string;
    expect(winsSection).toContain('*Solo*');
    expect(winsSection).toContain('*Duo*');
    expect(winsSection).not.toContain('3.');
  });

  it('breaks win ties by podiums then xp then name', () => {
    const msg = buildWeeklyLeaderboardMessage(resp([
      h('Zed', 5, 1, 10),
      h('Ace', 5, 1, 99),
    ]));
    const winsSection = (msg.blocks.find((b: any) => b.type === 'section' && b.text?.text?.includes('Most Wins')) as any).text.text as string;
    expect(winsSection.indexOf('*Ace*')).toBeLessThan(winsSection.indexOf('*Zed*'));
  });
});
