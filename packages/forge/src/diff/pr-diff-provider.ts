/**
 * Pull-request diff providers: PR (latest) and PR iteration.
 *
 * Both providers work by fetching the full unified diff from the remote
 * provider (via `IPullRequestsService.getDiff()` or a caller-supplied
 * callback) and then parsing it into per-file chunks.
 *
 * This keeps the diff module decoupled from provider-specific APIs (ADO, GitHub).
 */

import type { IPullRequestsService } from '../providers/interfaces';
import type {
    DiffContent,
    DiffFileEntry,
    DiffSummary,
    GetFileDiffOptions,
    IDiffProvider,
    PullRequestDiffSource,
    PullRequestIterationDiffSource,
} from './types';
import { makeDiffContent, computeSummary, parseFullDiff } from './diff-utils';

// ── Core remote provider builder ─────────────────────────────
function createRemoteDiffProvider<S extends PullRequestDiffSource | PullRequestIterationDiffSource>(
    source: S,
    fetchFullDiff: () => Promise<string>,
): IDiffProvider {
    let cached: { files: DiffFileEntry[]; contentByPath: Map<string, DiffContent> } | undefined;

    async function ensureParsed() {
        if (!cached) {
            const fullDiff = await fetchFullDiff();
            cached = parseFullDiff(fullDiff);
        }
        return cached;
    }

    return {
        source,

        async listFiles(): Promise<DiffFileEntry[]> {
            const { files } = await ensureParsed();
            return files;
        },

        async getFileDiff(filePath: string, _options?: GetFileDiffOptions): Promise<DiffContent> {
            const { contentByPath } = await ensureParsed();
            return contentByPath.get(filePath) ?? makeDiffContent('');
        },

        async getFullDiff(): Promise<DiffContent> {
            const fullDiff = await fetchFullDiff();
            return makeDiffContent(fullDiff);
        },

        async prefetchAll(): Promise<Map<string, DiffContent>> {
            const { contentByPath } = await ensureParsed();
            return new Map(contentByPath);
        },

        async getSummary(): Promise<DiffSummary> {
            const { files } = await ensureParsed();
            return computeSummary(files);
        },
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
 * For ADO, the caller would use `AdoPullRequestsService.getPullRequestIterationChanges()`
 * and `buildUnifiedDiff()` to construct the diff string.
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
