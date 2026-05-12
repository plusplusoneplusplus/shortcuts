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
import type { GitChangeStatus } from '../git/types';
import type {
    DiffContent,
    DiffFileEntry,
    DiffSummary,
    GetFileDiffOptions,
    IDiffProvider,
    PullRequestDiffSource,
    PullRequestIterationDiffSource,
} from './types';

// ── Shared helpers ───────────────────────────────────────────

function makeDiffContent(raw: string): DiffContent {
    const totalLines = raw ? raw.split('\n').length : 0;
    return { raw, truncated: false, totalLines };
}

function computeSummary(files: DiffFileEntry[]): DiffSummary {
    let additions = 0;
    let deletions = 0;
    for (const f of files) {
        additions += f.additions ?? 0;
        deletions += f.deletions ?? 0;
    }
    return { filesChanged: files.length, additions, deletions };
}

/**
 * Infer `GitChangeStatus` from the diff header for a file chunk.
 *
 * Uses heuristics:
 * - `--- /dev/null`  → added
 * - `+++ /dev/null`  → deleted
 * - `rename from …`  → renamed
 * - `copy from …`    → copied
 * - otherwise        → modified
 */
function inferStatusFromDiffChunk(chunk: string): GitChangeStatus {
    if (/^--- \/dev\/null$/m.test(chunk)) return 'added';
    if (/^\+\+\+ \/dev\/null$/m.test(chunk)) return 'deleted';
    if (/^rename from /m.test(chunk)) return 'renamed';
    if (/^copy from /m.test(chunk)) return 'copied';
    return 'modified';
}

/**
 * Count additions/deletions from unified diff hunk lines.
 */
function countAdditionsDeletions(chunk: string): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
    return { additions, deletions };
}

/** Parse the `b/` path from a diff --git header. */
function extractBPath(chunk: string): string | undefined {
    const match = chunk.match(/^diff --git a\/.+ b\/(.+)$/m);
    return match?.[1];
}

/** Parse the `a/` path from a diff --git header (for renames). */
function extractAPath(chunk: string): string | undefined {
    const match = chunk.match(/^diff --git a\/(.+?) b\//m);
    return match?.[1];
}

/**
 * Split a full unified diff into per-file chunks and build file entries + content map.
 */
function parseFullDiff(fullDiff: string): {
    files: DiffFileEntry[];
    contentByPath: Map<string, DiffContent>;
} {
    const files: DiffFileEntry[] = [];
    const contentByPath = new Map<string, DiffContent>();

    if (!fullDiff.trim()) {
        return { files, contentByPath };
    }

    const chunks = fullDiff.split(/(?=^diff --git )/m);

    for (const chunk of chunks) {
        if (!chunk.trim()) continue;

        const bPath = extractBPath(chunk);
        if (!bPath) continue;

        const status = inferStatusFromDiffChunk(chunk);
        const { additions, deletions } = countAdditionsDeletions(chunk);

        const entry: DiffFileEntry = {
            path: bPath,
            status,
            additions,
            deletions,
        };

        // For renames/copies, extract original path
        if (status === 'renamed' || status === 'copied') {
            const aPath = extractAPath(chunk);
            if (aPath && aPath !== bPath) {
                entry.originalPath = aPath;
            }
        }

        // Detect binary: no hunk lines at all
        if (additions === 0 && deletions === 0 && !/^@@/m.test(chunk)) {
            entry.isBinary = true;
        }

        files.push(entry);
        contentByPath.set(bPath, makeDiffContent(chunk));
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, contentByPath };
}

/**
 * Build an `IDiffProvider` from a function that returns the full unified diff.
 * Both PR and PR-iteration providers share this core logic.
 */
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

// ── Exported parse utility (for testing) ─────────────────────

/** @internal Exposed for unit testing. */
export { parseFullDiff as _parseFullDiff };
