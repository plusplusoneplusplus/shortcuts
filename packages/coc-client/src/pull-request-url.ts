import type { SentinelTodoPrIdentity } from './contracts/sentinel-todos';

/** Parse a supported PR web URL without provider I/O or workspace assumptions. */
export function parsePullRequestUrl(input: string): SentinelTodoPrIdentity | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  let parts: string[];
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return null; }
  if (parts.some(part => /[/\\\u0000-\u001f]/.test(part))) return null;

  if (host === 'github.com' || host === 'www.github.com') {
    const [owner, repo, kind, num] = parts;
    const number = parsePrNumber(num);
    if (!owner || !repo || !/^[a-zA-Z0-9_.-]+$/.test(owner)
      || !/^[a-zA-Z0-9_.-]+$/.test(repo) || kind !== 'pull' || number === undefined) return null;
    return {
      provider: 'github', host: 'github.com', repoPath: `${owner}/${repo}`, number,
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
    };
  }

  let org: string | undefined;
  let rest: string[];
  if (host === 'dev.azure.com') {
    [org, ...rest] = parts;
  } else if (host.endsWith('.visualstudio.com')) {
    org = host.slice(0, -'.visualstudio.com'.length);
    rest = parts[0]?.toLowerCase() === 'defaultcollection' ? parts.slice(1) : parts;
  } else {
    return null;
  }
  const [project, git, repo, kind, num] = rest;
  const number = parsePrNumber(num);
  if (!org || !project || git !== '_git' || !repo || kind?.toLowerCase() !== 'pullrequest' || number === undefined) {
    return null;
  }
  const base = host === 'dev.azure.com' ? `https://dev.azure.com/${enc(org)}` : `https://${host}`;
  return {
    provider: 'ado', host, repoPath: `${org}/${project}/${repo}`, number,
    url: `${base}/${enc(project)}/_git/${enc(repo)}/pullrequest/${number}`,
  };
}

function parsePrNumber(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
