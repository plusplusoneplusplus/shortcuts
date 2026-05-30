/**
 * Helpers for the "Open PR" input on the Pull Requests tab.
 *
 * Pure functions only — parsing user input (bare number or full PR URL),
 * normalizing repository remote URLs (https / ssh / git+ssh / .git suffix),
 * and matching a parsed URL against the user's registered workspaces.
 *
 * Stateless: introduces no persistent storage, no feature flags, no caches.
 */

export interface ParsedPrNumberInput {
    kind: 'number';
    number: number;
}

export interface ParsedPrUrlInput {
    kind: 'url';
    host: string;
    owner: string;
    repo: string;
    number: number;
}

export interface ParsedPrInvalidInput {
    kind: 'invalid';
    reason: string;
}

export type ParsedPrInput = ParsedPrNumberInput | ParsedPrUrlInput | ParsedPrInvalidInput;

export interface RepoRemote {
    host: string;
    owner: string;
    repo: string;
}

/**
 * Parse user input from the Open PR field.
 *
 * - A bare positive integer becomes a `number` input.
 * - A string containing `://` or starting with `git@` is treated as a URL.
 * - Everything else is `invalid`.
 */
export function parsePrInput(raw: string): ParsedPrInput {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { kind: 'invalid', reason: 'Enter a PR number or paste a PR URL.' };
    }

    if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n <= 0) {
            return { kind: 'invalid', reason: 'PR number must be a positive integer.' };
        }
        return { kind: 'number', number: n };
    }

    if (trimmed.includes('://') || trimmed.startsWith('git@')) {
        return parsePrUrl(trimmed);
    }

    return { kind: 'invalid', reason: 'Enter a PR number or paste a PR URL.' };
}

/**
 * Parse a full pull request URL.
 *
 * Supports GitHub-style URLs of the form
 * `https://github.com/<owner>/<repo>/pull/<n>` (also `/pulls/<n>`) as the
 * primary case. Trailing slash, query string, fragment, or extra path
 * segments after the PR number are accepted and ignored.
 */
export function parsePrUrl(raw: string): ParsedPrUrlInput | ParsedPrInvalidInput {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { kind: 'invalid', reason: 'Not a valid pull request URL.' };
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { kind: 'invalid', reason: 'URL must use http or https.' };
    }

    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    // Expect: [owner, repo, ('pull'|'pulls'), number, ...]
    if (segments.length < 4) {
        return { kind: 'invalid', reason: 'Not a pull request URL.' };
    }
    const [owner, repo, kind, numberSeg] = segments;
    if (kind !== 'pull' && kind !== 'pulls') {
        return { kind: 'invalid', reason: 'URL is not a pull request URL.' };
    }
    if (!/^\d+$/.test(numberSeg)) {
        return { kind: 'invalid', reason: 'Pull request number is missing from the URL.' };
    }
    const number = Number(numberSeg);
    if (!Number.isFinite(number) || number <= 0) {
        return { kind: 'invalid', reason: 'Pull request number is missing from the URL.' };
    }

    return {
        kind: 'url',
        host,
        owner: stripDotGit(owner).toLowerCase(),
        repo: stripDotGit(repo).toLowerCase(),
        number,
    };
}

function stripDotGit(s: string): string {
    return s.endsWith('.git') ? s.slice(0, -4) : s;
}

/**
 * Normalize a repository remote URL into `{ host, owner, repo }`.
 *
 * Recognizes the common shapes used by GitHub, GitHub Enterprise, and
 * generic Git providers:
 * - `https://host/owner/repo(.git)`
 * - `http://host/owner/repo(.git)`
 * - `ssh://git@host/owner/repo(.git)`
 * - `git@host:owner/repo(.git)`
 * - `git+ssh://git@host/owner/repo(.git)`
 *
 * Returns null when the URL is not parseable in any of those shapes.
 */
export function normalizeRemoteUrl(remoteUrl: string | null | undefined): RepoRemote | null {
    if (!remoteUrl) return null;
    const trimmed = remoteUrl.trim();
    if (!trimmed) return null;

    // scp-like form: git@host:owner/repo[.git]
    const scpMatch = /^[a-z0-9._-]+@([^:]+):(.+)$/i.exec(trimmed);
    if (scpMatch && !trimmed.includes('://')) {
        const host = scpMatch[1].toLowerCase();
        const pathPart = scpMatch[2].replace(/^\/+/, '');
        const segments = pathPart.split('/').filter(Boolean);
        if (segments.length < 2) return null;
        const owner = segments[segments.length - 2];
        const repo = stripDotGit(segments[segments.length - 1]);
        return { host, owner: owner.toLowerCase(), repo: repo.toLowerCase() };
    }

    let url: URL;
    try {
        const normalized = trimmed.replace(/^git\+/, '');
        url = new URL(normalized);
    } catch {
        return null;
    }

    const host = url.hostname.toLowerCase();
    if (!host) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const owner = segments[segments.length - 2];
    const repo = stripDotGit(segments[segments.length - 1]);
    if (!owner || !repo) return null;
    return { host, owner: owner.toLowerCase(), repo: repo.toLowerCase() };
}

export interface WorkspaceLike {
    id: string;
    remoteUrl?: string | null;
}

/**
 * Return the first registered workspace whose remote URL matches the
 * `host/owner/repo` triple from a parsed PR URL. Matching is
 * case-insensitive and tolerates `.git` suffixes and protocol differences.
 *
 * Returns null when no workspace remote matches.
 */
export function matchWorkspaceForPrUrl<T extends WorkspaceLike>(
    workspaces: readonly T[] | null | undefined,
    parsed: Pick<ParsedPrUrlInput, 'host' | 'owner' | 'repo'>,
): T | null {
    if (!workspaces || workspaces.length === 0) return null;
    for (const ws of workspaces) {
        const remote = normalizeRemoteUrl(ws.remoteUrl ?? null);
        if (!remote) continue;
        if (
            remote.host === parsed.host &&
            remote.owner === parsed.owner &&
            remote.repo === parsed.repo
        ) {
            return ws;
        }
    }
    return null;
}
