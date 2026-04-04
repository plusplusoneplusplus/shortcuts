import type { DiffCommentContext } from '../../diff-comment-types';
import { fetchApi } from '../hooks/useApi';

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
}

export function createCommitDiffSource(
    workspaceId: string,
    hash: string,
    options?: {
        commit?: { subject?: string };
        files?: string[];
    },
): DiffSource {
    const enc = encodeURIComponent;
    const shortHash = hash.slice(0, 7);
    return {
        label: `Commit ${shortHash}`,

        fileDiffUrl(filePath: string, full?: boolean): string {
            const base = `/workspaces/${enc(workspaceId)}/git/commits/${hash}/files/${enc(filePath)}/diff`;
            return full ? `${base}?full=true` : base;
        },

        fullDiffUrl(): string {
            return `/workspaces/${enc(workspaceId)}/git/commits/${hash}/diff`;
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
            const data: { path: string }[] | { files?: { path: string }[] } =
                await fetchApi(`/workspaces/${enc(workspaceId)}/git/commits/${hash}/files`);
            const arr = Array.isArray(data) ? data : (data.files ?? []);
            return arr.map(f => f.path).sort();
        },
    };
}

export function createBranchRangeDiffSource(
    workspaceId: string,
    options?: {
        files?: string[];
    },
): DiffSource {
    const enc = encodeURIComponent;
    return {
        label: 'Branch diff',

        fileDiffUrl(filePath: string, full?: boolean): string {
            const base = `/workspaces/${enc(workspaceId)}/git/branch-range/files/${enc(filePath)}/diff`;
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
