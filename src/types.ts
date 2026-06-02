export type HorseColors = {
  body: string;
  mane: string;
  tail: string;
  saddle: string;
};

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

export type LeaderboardEntry = {
  name: string;
  owner_name: string;
  wins: number;
  podiums: number;
  xp: number;
  races_entered: number;
};

export type GetOrgLeaderboardResponse = {
  org_name: string;
  horses: LeaderboardEntry[];
};
