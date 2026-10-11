/**
 * Reads a pull request's state by its provider-qualified identity using this
 * server's own GitHub/ADO credentials — the same credential sources the
 * existing PR services use — without needing a clone or a workspace.
 *
 * Unlike `ProviderFactory.createPullRequestsService`, the ADO organization
 * always comes from the PR URL (never the configured default org), so a PR
 * from any organization is read where it lives.
 *
 * Everything returned here (title, URL, merge commit) is untrusted provider
 * data: callers must treat it as display text, never as instructions.
 */

import type { IPullRequestsService } from '@plusplusoneplusplus/forge';
import { createAdoPullRequestsAdapter, createGitHubPullRequestsAdapter, resolveAdoAccessTokenValue } from '@plusplusoneplusplus/forge';
import { readProvidersConfig } from '../providers/providers-config';
import type { PrIdentity, WatchedPrStatus } from './trigger-types';

export interface PrStatusSnapshot {
    status: WatchedPrStatus;
    title: string;
    url: string;
    mergeCommit?: string;
    mergedAt?: string;
}

/** Fetch the current state of a watched PR. Throws on read/login failures. */
export type PrStatusFetcher = (pr: PrIdentity) => Promise<PrStatusSnapshot>;

/**
 * Parse a GitHub or Azure DevOps pull-request web URL into a canonical
 * identity. Returns null for anything that is not a recognizable PR URL.
 */
export function parsePullRequestUrl(input: string): PrIdentity | null {
    let url: URL;
    try { url = new URL(input.trim()); } catch { return null; }
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (host === 'github.com' || host === 'www.github.com') {
        const [owner, repo, kind, num] = parts;
        const number = parsePrNumber(num);
        if (!owner || !repo || kind !== 'pull' || number === undefined) return null;
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

/** Thrown when credentials for the PR's provider are not configured. */
export class PrCredentialsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PrCredentialsError';
    }
}

/** Build the production fetcher bound to the server's data directory. */
export function createPrStatusFetcher(options: { dataDir: string }): PrStatusFetcher {
    return async (pr) => {
        const service = await createService(options.dataDir, pr);
        const result = await service.getPullRequest(pr.repoPath, pr.number);
        return toSnapshot(pr, result);
    };
}

async function createService(dataDir: string, pr: PrIdentity): Promise<IPullRequestsService> {
    const [org, project, repo] = pr.repoPath.split('/');
    if (pr.provider === 'github') {
        const token = (await readProvidersConfig(dataDir)).providers.github?.token;
        if (!token) throw new PrCredentialsError('GitHub is not signed in on this server');
        return createGitHubPullRequestsAdapter({ token, owner: org, repo: project });
    }
    const orgUrl = pr.host === 'dev.azure.com' ? `https://dev.azure.com/${enc(org)}` : `https://${pr.host}`;
    const token = await resolveAdoAccessTokenValue({ dataDir });
    return createAdoPullRequestsAdapter({ orgUrl, token, project, repo });
}

function toSnapshot(pr: PrIdentity, result: Awaited<ReturnType<IPullRequestsService['getPullRequest']>>): PrStatusSnapshot {
    const raw = (result.raw ?? {}) as { merge_commit_sha?: unknown; lastMergeCommit?: { commitId?: unknown } };
    const mergeCommit = result.status === 'merged'
        ? stringOrUndefined(pr.provider === 'github' ? raw.merge_commit_sha : raw.lastMergeCommit?.commitId)
        : undefined;
    return {
        status: result.status,
        title: typeof result.title === 'string' ? result.title.slice(0, 300) : '',
        url: pr.url,
        ...(mergeCommit ? { mergeCommit } : {}),
        ...(result.mergedAt instanceof Date && !Number.isNaN(result.mergedAt.getTime())
            ? { mergedAt: result.mergedAt.toISOString() } : {}),
    };
}

function stringOrUndefined(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
