/**
 * Client-side cache for commit diffs.
 *
 * Module-level Map keyed by API URL. When the full-commit diff is fetched
 * we parse it and pre-populate per-file entries so subsequent file clicks
 * are instant cache hits with no network call.
 *
 * IMPORTANT: Per-file diff URLs (those containing `/files/`) MUST bypass
 * the pre-populated cache entries. Pre-populated slices come from the
 * full-commit diff which uses default context lines, whereas the server's
 * per-file endpoint uses `-U99999` (unlimited context) to return the
 * complete file. Using pre-populated data for per-file detail views would
 * show only the changed hunks instead of the entire file.
 */

import { useState, useEffect, useCallback } from 'react';
import { getCocClientForWorkspace, requestForWorkspace } from '../../../repos/cloneRegistry';

/** Module-level cache — survives re-renders, cleared on page reload. */
const diffCache = new Map<string, string>();

/**
 * Split a full unified diff into per-file sections and return
 * `[filePath, sectionText]` pairs.
 */
export function splitDiffByFile(fullDiff: string): Array<[string, string]> {
    const results: Array<[string, string]> = [];
    // Split on the `diff --git` boundary (keep the marker with each section).
    const sections = fullDiff.split(/\n(?=diff --git )/);
    for (const section of sections) {
        const trimmed = section.trimStart();
        if (!trimmed.startsWith('diff --git ')) continue;
        // Extract path from "diff --git a/foo b/bar"
        const headerLine = trimmed.slice(0, trimmed.indexOf('\n'));
        const bIdx = headerLine.indexOf(' b/');
        if (bIdx === -1) continue;
        const filePath = headerLine.slice(bIdx + 3);
        results.push([filePath, trimmed]);
    }
    return results;
}

/**
 * Build a per-file diff API URL matching the server route convention.
 */
export function buildFileDiffUrl(workspaceId: string, hash: string, filePath: string): string {
    return getCocClientForWorkspace(workspaceId).git.commitFileDiffPath(workspaceId, hash, filePath);
}

/**
 * Pre-populate the cache with per-file entries extracted from a full diff.
 */
export function prePopulatePerFileCache(
    fullDiff: string,
    workspaceId: string,
    hash: string,
): void {
    for (const [filePath, section] of splitDiffByFile(fullDiff)) {
        const url = buildFileDiffUrl(workspaceId, hash, filePath);
        if (!diffCache.has(url)) {
            diffCache.set(url, section);
        }
    }
}

export interface CachedDiffResult {
    diff: string | null;
    loading: boolean;
    error: string | null;
    retry: () => void;
}

/**
 * React hook that fetches a diff (or returns it from cache).
 *
 * When a full-commit diff is fetched, per-file entries are pre-populated
 * so that navigating to a single file is an instant cache hit.
 */
export function useCachedDiff(
    diffUrl: string | null,
    workspaceId: string,
    hash: string | undefined,
): CachedDiffResult {
    const [diff, setDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const doFetch = useCallback((url: string) => {
        // Per-file diff URLs bypass pre-populated cache entries: pre-populated
        // slices come from the full-commit diff (standard context lines) but
        // the server's per-file endpoint uses -U99999 (unlimited context) to
        // return the complete file. Always fetch fresh so the full file is shown.
        const isPerFileDiff = url.includes('/files/');
        const cached = isPerFileDiff ? undefined : diffCache.get(url);
        if (cached !== undefined) {
            setDiff(cached);
            setLoading(false);
            setError(null);
            return;
        }

        setLoading(true);
        setError(null);
        setDiff(null);
        requestForWorkspace<{ diff?: string }>(workspaceId, url)
            .then(data => {
                const raw: string = data.diff || '';
                diffCache.set(url, raw);
                setDiff(raw);

                // If this is the full-commit URL, pre-populate per-file entries
                if (hash && !url.includes('/files/')) {
                    prePopulatePerFileCache(raw, workspaceId, hash);
                }
            })
            .catch(err => setError(err.message || 'Failed to load diff'))
            .finally(() => setLoading(false));
    }, [workspaceId, hash]);

    useEffect(() => {
        if (!diffUrl) { setLoading(false); return; }
        doFetch(diffUrl);
    }, [diffUrl, doFetch]);

    const retry = useCallback(() => {
        if (!diffUrl) return;
        // Remove stale entry so we actually re-fetch
        diffCache.delete(diffUrl);
        doFetch(diffUrl);
    }, [diffUrl, doFetch]);

    return { diff, loading, error, retry };
}

/**
 * Evict all cache entries for a given commit hash.
 * Both full-commit URLs (`/commits/:hash/diff`) and per-file URLs
 * (`/commits/:hash/files/…`) contain the hash, so one pass covers both.
 */
export function clearCacheForHash(hash: string): void {
    for (const key of [...diffCache.keys()]) {
        if (key.includes(hash)) {
            diffCache.delete(key);
        }
    }
}

/** Expose cache for testing. */
export function _clearCache(): void {
    diffCache.clear();
}

export function _getCacheSize(): number {
    return diffCache.size;
}

export function _getCacheEntry(url: string): string | undefined {
    return diffCache.get(url);
}
