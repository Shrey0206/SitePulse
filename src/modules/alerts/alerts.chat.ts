import type { AlertContext, ChannelType, DeliveryOutcome } from './alerts.types.js';

/**
 * Discord and Slack incoming-webhook channels (DECISIONS.md #38).
 *
 * The generic webhook channel sends SitePulse's own signed JSON, which neither service
 * accepts: Discord requires a `content`/`embeds` body and Slack requires `text`/`blocks`.
 * These channels send each service's native format. Unlike the generic webhook there is no
 * signature -- the URL itself is the credential, so it is stored encrypted and only ever
 * shown masked (see maskChatWebhookUrl).
 */
export type ChatChannelType = Extract<ChannelType, 'discord' | 'slack'>;

const TIMEOUT_MS = 5000;
const ERROR_BODY_MAX_CHARS = 120;

const COLOR_DOWN = 0xe5484d;
const COLOR_RECOVERED = 0x30a46c;

const DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com',
]);
const DISCORD_PATH = /^\/api(?:\/v\d+)?\/webhooks\/(\d+)\/[A-Za-z0-9_-]+$/;
const SLACK_HOST = 'hooks.slack.com';
const SLACK_PATH = /^\/services\/(T[A-Z0-9]+)\/(B[A-Z0-9]+)\/[A-Za-z0-9]+$/;

const MASK = '••••••••';

export const CHAT_SERVICE_LABEL: Record<ChatChannelType, string> = {
  discord: 'Discord',
  slack: 'Slack',
};

export function isChatChannelType(type: ChannelType): type is ChatChannelType {
  return type === 'discord' || type === 'slack';
}

/**
 * Parses and strictly validates a chat webhook URL, returning null for anything else.
 *
 * Pinned to each service's real host and path shape rather than "any https URL". That is
 * what makes these channels safe to accept from any signed-up user: the server will only
 * ever POST to discord.com or hooks.slack.com, so a channel cannot be pointed at an
 * internal address (contrast the generic webhook, which accepts any host). Userinfo, ports,
 * query strings and fragments are rejected so `https://discord.com@evil.test/...` and
 * lookalike hosts cannot get through.
 */
function parseChatWebhookUrl(type: ChatChannelType, raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;

  if (type === 'discord') {
    return DISCORD_HOSTS.has(url.hostname) && DISCORD_PATH.test(url.pathname) ? url : null;
  }
  return url.hostname === SLACK_HOST && SLACK_PATH.test(url.pathname) ? url : null;
}

export function isChatWebhookUrl(type: ChatChannelType, raw: string): boolean {
  return parseChatWebhookUrl(type, raw) !== null;
}

/**
 * The label stored as `target` and shown in the UI, API responses and the delivery log.
 * Keeps the non-secret identifiers (so several channels stay distinguishable) and masks the
 * token, so a screenshot or a database dump never contains a working URL.
 */
export function maskChatWebhookUrl(type: ChatChannelType, raw: string): string {
  const url = parseChatWebhookUrl(type, raw);
  if (!url) throw new Error(`Not a valid ${CHAT_SERVICE_LABEL[type]} webhook URL`);

  const segments = url.pathname.split('/').filter(Boolean);
  segments[segments.length - 1] = MASK;
  return `${url.hostname}/${segments.join('/')}`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function buildDiscordPayload(context: AlertContext) {
  const opened = context.event === 'incident_opened';
  const headline = opened
    ? `🔴 ${context.monitorName} is DOWN`
    : `🟢 ${context.monitorName} has RECOVERED`;

  return {
    username: 'SitePulse',
    // Monitor names are user-controlled text. Without this, a monitor named "@everyone"
    // would ping the whole server on every incident.
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: truncate(headline, 256),
        description: opened ? 'Not responding as expected.' : 'Responding normally again.',
        color: opened ? COLOR_DOWN : COLOR_RECOVERED,
        fields: [
          { name: 'URL', value: truncate(context.monitorUrl, 1024) },
          { name: 'Incident', value: context.incidentId },
        ],
        timestamp: context.occurredAt.toISOString(),
      },
    ],
  };
}

/** Slack mrkdwn treats these three characters as control syntax, so user text must escape them. */
function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inside a `<url|label>` link, `|` and `>` would end the URL early. */
function slackLinkUrl(url: string): string {
  return url.replace(/[|<>]/g, (char) => encodeURIComponent(char));
}

export function buildSlackPayload(context: AlertContext) {
  const opened = context.event === 'incident_opened';
  const name = escapeSlack(truncate(context.monitorName, 200));
  const headline = opened ? `🔴 ${name} is DOWN` : `🟢 ${name} has RECOVERED`;
  const unix = Math.floor(context.occurredAt.getTime() / 1000);
  const iso = context.occurredAt.toISOString();

  return {
    // Shown in notifications and anywhere blocks are not rendered.
    text: headline,
    attachments: [
      {
        color: opened ? '#e5484d' : '#30a46c',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: opened ? 'Not responding as expected.' : 'Responding normally again.',
            },
            fields: [
              {
                type: 'mrkdwn',
                text: `*URL*\n<${slackLinkUrl(context.monitorUrl)}|${escapeSlack(truncate(context.monitorUrl, 300))}>`,
              },
              { type: 'mrkdwn', text: `*Incident*\n${context.incidentId}` },
            ],
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `<!date^${unix}^{date_short_pretty} at {time_secs}|${iso}>` },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Takes the already-decrypted URL; the caller owns decryption so it can isolate a failure
 * to one channel (same split as sendAlertWebhook). Single attempt, no retry, for the same
 * reason as the generic webhook (DECISIONS.md #23): reliable retries would need a queue.
 */
export async function sendAlertChat(
  type: ChatChannelType,
  webhookUrl: string,
  context: AlertContext,
): Promise<DeliveryOutcome> {
  const payload = type === 'discord' ? buildDiscordPayload(context) : buildSlackPayload(context);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Neither service redirects a valid webhook; following one would let a changed or
      // hijacked endpoint bounce the request (and the message) somewhere else.
      redirect: 'error',
      signal: controller.signal,
    });

    let error: string | null = null;
    if (!response.ok) {
      // Both services explain a rejection in the body ("Unknown Webhook", "invalid_token").
      // That is the actionable part, and the delivery log exists to answer "why did it fail".
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim();
      error = `Received HTTP ${response.status}${detail ? `: ${truncate(detail, ERROR_BODY_MAX_CHARS)}` : ''}`;
    }

    return {
      status: response.ok ? 'sent' : 'failed',
      responseCode: response.status,
      latencyMs: Math.round(performance.now() - start),
      error,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      status: 'failed',
      responseCode: null,
      latencyMs: Math.round(performance.now() - start),
      // err.message is deliberately not forwarded: a network error can embed the request
      // URL, and here the URL is the secret.
      error: isAbort ? 'Request timed out' : `Could not reach ${CHAT_SERVICE_LABEL[type]}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
