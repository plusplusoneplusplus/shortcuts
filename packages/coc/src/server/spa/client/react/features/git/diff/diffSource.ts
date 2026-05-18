import type { DiffCommentContext } from '../../../../comments/diff-comment-types';
import { fetchApi } from '../../../hooks/useApi';
import { getSpaCocClient } from '../../../api/cocClient';

/**
 * Result of fetching a diff, including truncation metadata.
 * Mirrors the server response shape from truncateDiffIfNeeded().
 */
export interface DiffFetchResult {
    diff: string;
    truncated: boolean;
    totalLines: number;
}

/**
 * Props needed to render CommitChatPanel, minus onClose (UI concern).
 * Undefined when AI chat is not available for this source.
 */
export interface ChatAvailability {
    workspaceId: string;
    commitHash: string;
    commitMessage?: string;
}

/**
 * Context identifiers for PR-level AI chat in the pop-out window.
 * The AI uses these to determine what to read — no diff content in the prompt.
 */
export interface PrChatContext {
    workspaceId: string;
    prId: string;
    /** Currently selected file in the pop-out (may be null if no file selected). */
    filePath?: string;
}

/**
 * Generic classification key that any DiffSource can opt into.
 * Allows the classification system to work across PRs, commits, and branch ranges.
 */
export interface ClassificationKey {
    type: 'pr' | 'commit' | 'branch-range';
    repoId: string;
    /**
     * For PR: `prId:headSha` (new push auto-invalidates).
     * For commit: hash.
     * For branch-range: `baseRef..headRef`.
     */
    identifier: string;
}

export interface DiffSource {
    /** Human-readable label, e.g. "Commit abc1234" or "Branch diff". */
    readonly label: string;

    /**
     * Build the API URL for a single-file diff.
     * @param full — when true, appends ?full=true to bypass server truncation.
     */
    fileDiffUrl(filePath: string, full?: boolean): string;

    /**
     * Build the API URL for the full (all-files) diff.
     * Returns null when the source does not support a combined diff endpoint
     * (branch-range has no combined endpoint used by the SPA).
     */
    fullDiffUrl(): string | null;

    /**
     * Build the DiffCommentContext for a given file.
     */
    commentContext(filePath: string): DiffCommentContext;

    /**
     * Ordered file paths for cross-file navigation.
     * Populated from props (branch-range) or lazy-fetched (commit).
     * Empty array when the list is not yet available.
     */
    readonly files: string[];

    /**
     * When non-null, the source supports an AI chat side-panel.
     * The returned object contains the props needed to render CommitChatPanel
     * (minus the onClose callback, which is a UI concern).
     */
    readonly chat: ChatAvailability | null;

    /**
     * Whether this source supports diff truncation (server returns truncated flag).
     * Commit diffs via useCachedDiff ignore truncation; branch-range respects it.
     */
    readonly supportsTruncation: boolean;

    /**
     * Cache key prefix for this source, used to build module-level cache keys.
     * E.g. "commit:<hash>" or "branch-range".
     */
    readonly cacheKey: string;

    /**
     * Lazy-fetch the ordered file list for this source.
     * Used by FileDiffPanel when `files` is empty (e.g. commit sources
     * where the file list isn't known at construction time).
     */
    fetchFileList?(): Promise<string[]>;

    /**
     * Optional classification key. When present, the diff viewer can
     * offer AI classification (logic/mechanical/test/generated) for
     * the hunks in this source.
     */
    readonly classificationKey?: ClassificationKey;
}

export function createCommitDiffSource(
    workspaceId: string,
    hash: string,
    options?: {
        commit?: { subject?: string };
        files?: string[];
    },
): DiffSource {
    const shortHash = hash.slice(0, 7);
    return {
        label: `Commit ${shortHash}`,

        fileDiffUrl(filePath: string, full?: boolean): string {
            const base = getSpaCocClient().git.commitFileDiffPath(workspaceId, hash, filePath);
            return full ? `${base}?full=true` : base;
        },

        fullDiffUrl(): string {
            return getSpaCocClient().git.commitDiffPath(workspaceId, hash);
        },

        commentContext(filePath: string): DiffCommentContext {
            return {
                repositoryId: workspaceId,
                filePath,
                oldRef: `${hash}^`,
                newRef: hash,
            };
        },

        files: options?.files ?? [],

        chat: {
            workspaceId,
            commitHash: hash,
            commitMessage: options?.commit?.subject,
        },

        supportsTruncation: false,

        cacheKey: `commit:${hash}`,

        async fetchFileList(): Promise<string[]> {
            const data = await getSpaCocClient().git.listCommitFiles(workspaceId, hash);
            return (data.files ?? []).map(f => f.path).sort();
        },
    };
}

export function createBranchRangeDiffSource(
    workspaceId: string,
    options?: {
        files?: string[];
    },
): DiffSource {
    return {
        label: 'Branch diff',

        fileDiffUrl(filePath: string, full?: boolean): string {
            const base = getSpaCocClient().git.branchRangeFileDiffPath(workspaceId, filePath);
            return full ? `${base}?full=true` : base;
        },

        fullDiffUrl(): null {
            return null;
        },

        commentContext(filePath: string): DiffCommentContext {
            return {
                repositoryId: workspaceId,
                filePath,
                oldRef: 'branch-base',
                newRef: 'branch-head',
            };
        },

        files: options?.files ?? [],

        chat: null,

        supportsTruncation: true,

        cacheKey: 'branch-range',
    };
}

/**
 * Fetch a diff from the given URL and normalize the response into
 * a DiffFetchResult. Handles both response shapes:
 *   - { diff: string, truncated?: boolean, totalLines?: number }  (server standard)
 *   - { diff: string }  (useCachedDiff pre-populated entries)
 */
export async function fetchDiffFromSource(url: string): Promise<DiffFetchResult> {
    const data = await fetchApi(url);
    return {
        diff: data.diff ?? '',
        truncated: !!data.truncated,
        totalLines: data.totalLines ?? 0,
    };
}

/**
 * Create a DiffSource backed by a pull request's diff endpoint.
 *
 * Uses the existing `/api/repos/:repoId/pull-requests/:prId/diff` endpoint
 * and client-side extraction for per-file diffs from the combined payload.
 */
export function createPrDiffSource(
    workspaceId: string,
    repoId: string,
    prId: string,
    options?: {
        headSha?: string;
        files?: string[];
        title?: string;
    },
): DiffSource {
    return {
        label: options?.title ? `PR: ${options.title}` : `PR #${prId}`,

        fileDiffUrl(filePath: string, _full?: boolean): string {
            // PR diffs use the combined endpoint — per-file extraction is client-side.
            // Return the combined diff URL; FileDiffPanel uses extractFileDiff() for isolation.
            const base = `/api/repos/${encodeURIComponent(repoId)}/pull-requests/${encodeURIComponent(prId)}/diff`;
            return base;
        },

        fullDiffUrl(): string {
            return `/api/repos/${encodeURIComponent(repoId)}/pull-requests/${encodeURIComponent(prId)}/diff`;
        },

        commentContext(filePath: string): DiffCommentContext {
            return {
                repositoryId: workspaceId,
                filePath,
                oldRef: `pr-${prId}-base`,
                newRef: `pr-${prId}-head`,
            };
        },

        files: options?.files ?? [],

        chat: null, // PR chat lives at the pop-out level, not per-file (uses workspaceId + prId + currentFilePath)

        supportsTruncation: false,

        cacheKey: `pr:${repoId}:${prId}`,

        async fetchFileList(): Promise<string[]> {
            const client = getSpaCocClient();
            const diff = await client.pullRequests.getDiff(repoId, prId);
            return extractFilePathsFromDiff(diff);
        },

        classificationKey: options?.headSha
            ? { type: 'pr', repoId, identifier: `${prId}:${options.headSha}` }
            : undefined,
    };
}

/**
 * Extract file paths from a combined unified diff text.
 * Used by createPrDiffSource to lazily populate the file list.
 */
export function extractFilePathsFromDiff(diffText: string): string[] {
    const paths: string[] = [];
    for (const line of diffText.split('\n')) {
        if (line.startsWith('diff --git ')) {
            const body = line.slice('diff --git '.length);
            // Extract b/path from "a/old b/new"
            const bIdx = body.lastIndexOf(' b/');
            if (bIdx !== -1) {
                paths.push(body.slice(bIdx + 3));
            }
        }
    }
    return paths;
}

/**
 * Extract the diff text for a single file from a combined unified diff.
 * Returns the raw diff section (from `diff --git` to the next `diff --git` or EOF).
 */
export function extractFileDiffFromCombined(combinedDiff: string, filePath: string): string | null {
    const lines = combinedDiff.split('\n');
    let capturing = false;
    let result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) {
            if (capturing) break; // hit next file
            // Check if this is the file we want
            const body = line.slice('diff --git '.length);
            const bIdx = body.lastIndexOf(' b/');
            const path = bIdx !== -1 ? body.slice(bIdx + 3) : '';
            if (path === filePath) {
                capturing = true;
                result.push(line);
            }
        } else if (capturing) {
            result.push(line);
        }
    }

    return result.length > 0 ? result.join('\n') : null;
}
