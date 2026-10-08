/**
 * Pull-request diff providers: PR (latest) and PR iteration.
 *
 * Both providers work by fetching the full unified diff from the remote
 * provider (via `IPullRequestsService.getDiff()` or a caller-supplied
 * callback) and processing it through the Rust patch backend.
 *
 * This keeps the diff module decoupled from provider-specific APIs (ADO, GitHub).
 */

import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import type { IPullRequestsService } from '../providers/interfaces';
import type {
    GetFileDiffOptions,
    IDiffProvider,
    PullRequestDiffSource,
    PullRequestIterationDiffSource,
} from './types';
import { nativePatchToDiff } from './diff-utils';

// ── Core remote provider builder ─────────────────────────────
function createRemoteDiffProvider<S extends PullRequestDiffSource | PullRequestIterationDiffSource>(
    source: S,
    fetchFullDiff: () => Promise<string>,
): IDiffProvider {
    async function load() {
        const addon = loadNativeGit();
        return addon.processGitPatch(await fetchFullDiff());
    }

    return {
        source,
        async listFiles() { return nativePatchToDiff((await load()).files).files; },
        async getFileDiff(filePath: string, options?: GetFileDiffOptions) {
            const raw = (await load()).files.find(file => file.path === filePath)?.raw ?? '';
            const maxLines = options?.maxLines == null ? undefined : Math.floor(options.maxLines);
            return (await loadNativeGit().processGitPatch(raw, maxLines)).content;
        },
        async getFullDiff() { return (await load()).content; },
        async prefetchAll() { return nativePatchToDiff((await load()).files).contentByPath; },
        async getSummary() { return (await load()).summary; },
    };
}

// ── PR diff provider ─────────────────────────────────────────

/**
 * Create a diff provider for a pull request (latest state).
 *
 * Uses `IPullRequestsService.getDiff()` to fetch the unified diff from
 * the remote provider (GitHub or ADO).
 *
 * @throws if the service does not implement `getDiff()`.
 */
export function createPullRequestDiffProvider(
    source: PullRequestDiffSource,
    prService: IPullRequestsService,
): IDiffProvider {
    if (!prService.getDiff) {
        throw new Error(
            `Pull request diff not supported: the ${source.provider} provider does not implement getDiff()`,
        );
    }

    const getDiff = prService.getDiff.bind(prService);

    return createRemoteDiffProvider(
        source,
        () => getDiff(source.remoteRepositoryId, source.pullRequestId),
    );
}

/**
 * Convenience factory that constructs the `PullRequestDiffSource` inline.
 */
export function createPullRequestDiffProviderFromParams(
    provider: 'ado' | 'github',
    repositoryRoot: string,
    remoteRepositoryId: string,
    pullRequestId: number | string,
    prService: IPullRequestsService,
): IDiffProvider {
    const source: PullRequestDiffSource = {
        kind: 'pr',
        provider,
        repositoryRoot,
        remoteRepositoryId,
        pullRequestId,
    };
    return createPullRequestDiffProvider(source, prService);
}

// ── PR iteration diff provider ───────────────────────────────

/**
 * Create a diff provider for a specific pull request iteration.
 *
 * The caller supplies a `fetchDiff` callback that returns the unified diff
 * for the given iteration. This keeps the diff module decoupled from
 * provider-specific iteration APIs.
 *
 * The callback supplies existing iteration data; this factory does not fetch
 * provider iterations or implement inter-iteration comparisons.
 */
export function createPullRequestIterationDiffProvider(
    source: PullRequestIterationDiffSource,
    fetchDiff: () => Promise<string>,
): IDiffProvider {
    return createRemoteDiffProvider(source, fetchDiff);
}

/**
 * Convenience factory that constructs the `PullRequestIterationDiffSource` inline.
 */
export function createPullRequestIterationDiffProviderFromParams(
    provider: 'ado' | 'github',
    repositoryRoot: string,
    remoteRepositoryId: string,
    pullRequestId: number | string,
    iterationId: number,
    fetchDiff: () => Promise<string>,
    baseIterationId?: number,
): IDiffProvider {
    const source: PullRequestIterationDiffSource = {
        kind: 'pr-iteration',
        provider,
        repositoryRoot,
        remoteRepositoryId,
        pullRequestId,
        iterationId,
        baseIterationId,
    };
    return createPullRequestIterationDiffProvider(source, fetchDiff);
}
