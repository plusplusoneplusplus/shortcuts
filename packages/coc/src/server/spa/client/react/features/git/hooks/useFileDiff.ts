/**
 * useFileDiff — fetch hook for single-file diffs.
 *
 * Abstracts the two diff-loading strategies (cached commit diff vs. direct
 * branch-range fetch with truncation) behind one return type. Both paths
 * reduce to "fetch URL, parse { diff, truncated?, totalLines? }".
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchDiffFromSource } from '../diff/diffSource';
import type { DiffFetchResult } from '../diff/diffSource';

export interface FileDiffState {
    diff: string | null;
    loading: boolean;
    error: string | null;
    retry: () => void;
    /** True when the server truncated the response. */
    truncated: boolean;
    /** Total line count before truncation (0 when not truncated). */
    totalLines: number;
    /** Call to re-fetch with full=true. No-op if not truncated. */
    requestFullDiff: () => void;
    /**
     * True when a full-context diff was requested but the server could not
     * produce one after loading/fetching PR commits. The diff field holds
     * the normal hunk-only diff as a fallback.
     */
    fullContextUnavailable?: boolean;
}

/**
 * Fetch a single-file diff from the given URL.
 *
 * @param url         - API URL for the file diff (from DiffSource.fileDiffUrl).
 *                      Pass null to skip fetching.
 * @param fullUrl     - API URL with ?full=true for the full (non-truncated) diff.
 *                      Pass null when the source doesn't support truncation.
 */
export function useFileDiff(
    url: string | null,
    fullUrl?: string | null,
): FileDiffState {
    const [diff, setDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(url !== null);
    const [error, setError] = useState<string | null>(null);
    const [truncated, setTruncated] = useState(false);
    const [totalLines, setTotalLines] = useState(0);
    const [fullRequested, setFullRequested] = useState(false);
    const [fullContextUnavailable, setFullContextUnavailable] = useState<boolean | undefined>(undefined);

    // Track the latest url to avoid stale fetches
    const urlRef = useRef(url);
    urlRef.current = url;

    const doFetch = useCallback((fetchUrl: string) => {
        setLoading(true);
        setError(null);
        fetchDiffFromSource(fetchUrl)
            .then((result: DiffFetchResult) => {
                // Guard against stale responses after url changed
                if (urlRef.current !== url) return;
                setDiff(result.diff);
                setTruncated(result.truncated);
                setTotalLines(result.totalLines);
                setFullContextUnavailable(result.fullContextUnavailable);
            })
            .catch((err: Error) => {
                if (urlRef.current !== url) return;
                setError(err.message || 'Failed to load diff');
            })
            .finally(() => {
                if (urlRef.current !== url) return;
                setLoading(false);
            });
    }, [url]);

    // Initial fetch on URL change
    useEffect(() => {
        setFullRequested(false);
        setTruncated(false);
        setTotalLines(0);
        setFullContextUnavailable(undefined);
        if (!url) {
            setDiff(null);
            setLoading(false);
            setError(null);
            return;
        }
        doFetch(url);
    }, [url, doFetch]);

    // Full-diff fetch when requested
    useEffect(() => {
        if (!fullRequested || !fullUrl) return;
        doFetch(fullUrl);
    }, [fullRequested, fullUrl, doFetch]);

    const retry = useCallback(() => {
        if (!url) return;
        setError(null);
        doFetch(fullRequested && fullUrl ? fullUrl : url);
    }, [url, fullUrl, fullRequested, doFetch]);

    const requestFullDiff = useCallback(() => {
        if (!truncated || !fullUrl) return;
        setFullRequested(true);
    }, [truncated, fullUrl]);

    return { diff, loading, error, retry, truncated, totalLines, requestFullDiff, fullContextUnavailable };
}
