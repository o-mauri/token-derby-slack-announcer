import type { GetOrgLeaderboardResponse } from './types.js';

/**
 * Fetch an org's leaderboard from the token-derby API.
 * `apiBase` has no trailing slash (e.g. https://token-derby.mauricode.co.uk).
 * Returns null on any network error or non-2xx response — the caller decides
 * what to do (the weekly job logs and skips).
 */
export async function fetchLeaderboard(
  apiBase: string,
  orgName: string,
): Promise<GetOrgLeaderboardResponse | null> {
  const url = `${apiBase}/api/organisations/${encodeURIComponent(orgName)}/leaderboard`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as GetOrgLeaderboardResponse;
  } catch {
    return null;
  }
}
