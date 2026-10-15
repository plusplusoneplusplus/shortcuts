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
export { parsePullRequestUrl } from '@plusplusoneplusplus/coc-client';

export interface PrStatusSnapshot {
    status: WatchedPrStatus;
    title: string;
    url: string;
    mergeCommit?: string;
    mergedAt?: string;
}

/** Fetch the current state of a watched PR. Throws on read/login failures. */
export type PrStatusFetcher = (pr: PrIdentity) => Promise<PrStatusSnapshot>;

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
