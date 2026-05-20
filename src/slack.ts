export type SlackPostResult = { ok: boolean; error?: string };

const DEFAULT_BASE = 'https://slack.com/api';

export async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
  blocks: unknown[],
): Promise<SlackPostResult> {
  const base = process.env.SLACK_API_BASE ?? DEFAULT_BASE;
  const res = await fetch(`${base}/chat.postMessage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, text, blocks }),
  });

  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` };
  }

  const json = (await res.json()) as { ok?: boolean; error?: string };
  if (json.ok) return { ok: true };
  return { ok: false, error: json.error ?? 'unknown_slack_error' };
}
