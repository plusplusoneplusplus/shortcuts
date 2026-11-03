import type { SentinelTodoExternalReference } from './contracts/sentinel-todos';
import { parsePullRequestUrl } from './pull-request-url';

/** Validate display links locally, without fetching content or granting authority. */
export function normalizeSentinelTodoReferenceUrl(reference: Pick<SentinelTodoExternalReference, 'kind' | 'url'>): string | null {
  const input = reference.url.trim();
  if (!input || input.length > 2000 || /[\u0000-\u001f\u007f\\]/.test(input)) return null;
  if (reference.kind === 'pr') return parsePullRequestUrl(input)?.url ?? null;
  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (url.username || url.password) return null;
  if (reference.kind === 'teams' || reference.kind === 'slack') {
    if (url.protocol !== 'https:' || url.port) return null;
    if (reference.kind === 'teams') {
      if (!['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com'].includes(url.hostname)
        || !/^\/l\/(?:message|channel)\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname)) return null;
    } else {
      const workspaceLink = /^[a-z0-9-]+\.slack\.com$/.test(url.hostname)
        && /^\/archives\/[A-Z0-9]+(?:\/p[0-9]+)?\/?$/.test(url.pathname);
      const appLink = url.hostname === 'app.slack.com'
        && /^\/client\/[A-Z0-9]+\/[A-Z0-9]+(?:\/thread\/[A-Z0-9]+-[0-9.]+)?\/?$/.test(url.pathname);
      if (!workspaceLink && !appLink) return null;
    }
  } else if (reference.kind === 'email' && url.protocol === 'mailto:') {
    let recipients: string;
    try { recipients = decodeURIComponent(url.pathname); } catch { return null; }
    if (!recipients.split(',').every(address => /^[^\s<>@,/?#]+@[^\s<>@,/?#]+\.[^\s<>@,/?#]+$/.test(address))
      || /%0[ad]/i.test(input)) return null;
  } else if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  return url.href;
}
