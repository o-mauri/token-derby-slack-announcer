import { describe, it, expect } from 'vitest';
import { buildRaceCreatedMessage, buildRaceEndedMessage } from '../src/messages.js';
import type { RaceCreatedEvent, RaceEndedEvent, HorseColors } from '../src/types.js';

const COLORS: HorseColors = { body: '#FF0000', mane: '#000000', tail: '#000000', saddle: '#CC0000' };

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
