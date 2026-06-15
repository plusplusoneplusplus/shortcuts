/**
 * useProcessSearch — server-side FTS5 search with debouncing and AbortController.
 * Only triggers when query >= 2 characters; cancels in-flight requests on query change.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CocNetworkError } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../repos/cloneRouting';

export interface ProcessSearchResult {
    processId: string;
    turnIndex: number;
    role: string;
    snippet: string;
    rank: number;
    processTitle?: string;
    promptPreview: string;
    processStatus: string;
    processType: string;
    workspaceId: string;
    startTime: string;
}

export interface ProcessSearchResponse {
    results: ProcessSearchResult[];
    total: number;
    query: string;
    limit: number;
    offset: number;
}

export interface UseProcessSearchOptions {
    workspace?: string;
    statusFilter?: string;
    typeFilter?: string;
    debounceMs?: number;
    minQueryLength?: number;
    limit?: number;
}

export interface UseProcessSearchReturn {
    results: ProcessSearchResult[];
    total: number;
    loading: boolean;
    error: string | null;
    hasMore: boolean;
    loadMore: () => void;
    loadingMore: boolean;
}

function getSearchErrorMessage(error: unknown): string {
    if (error instanceof CocNetworkError && error.cause instanceof Error) {
        return error.cause.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Search failed';
}

export function useProcessSearch(
    query: string,
    options: UseProcessSearchOptions = {},
): UseProcessSearchReturn {
    const {
        workspace,
        statusFilter,
        typeFilter,
        debounceMs = 300,
        minQueryLength = 2,
        limit = 50,
    } = options;

    const [results, setResults] = useState<ProcessSearchResult[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    // Track current query for loadMore to reference
    const queryRef = useRef(query);
    queryRef.current = query;

    // Route a single-workspace search to that clone's server (AC-07); an
    // all-workspace search ('__all'/undefined) resolves to the default client.
    const client = useCocClient(workspace);

    const executeSearch = useCallback(async (q: string, signal: AbortSignal, offset = 0) => {
        return client.processes.search({
            q,
            ...(workspace && workspace !== '__all' ? { workspace } : {}),
            ...(statusFilter && statusFilter !== '__all' ? { status: statusFilter } : {}),
            ...(typeFilter ? { type: typeFilter } : {}),
            limit,
            ...(offset > 0 ? { offset } : {}),
        }, { signal });
    }, [client, workspace, statusFilter, typeFilter, limit]);

    useEffect(() => {
        // Clear debounce on every query/filter change
        if (debounceRef.current) clearTimeout(debounceRef.current);

        // Below minimum length — reset to empty
        if (query.length < minQueryLength) {
            // Abort any in-flight request
            if (abortRef.current) {
                abortRef.current.abort();
                abortRef.current = null;
            }
            setResults([]);
            setTotal(0);
            setLoading(false);
            setError(null);
            return;
        }

        setLoading(true);

        debounceRef.current = setTimeout(() => {
            // Abort previous request
            if (abortRef.current) abortRef.current.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            executeSearch(query, controller.signal)
                .then((data) => {
                    if (!controller.signal.aborted) {
                        setResults(data.results);
                        setTotal(data.total);
                        setError(null);
                        setLoading(false);
                    }
                })
                .catch((err) => {
                    if (!controller.signal.aborted) {
                        setResults([]);
                        setTotal(0);
                        setError(getSearchErrorMessage(err));
                        setLoading(false);
                    }
                });
        }, debounceMs);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, executeSearch, debounceMs, minQueryLength]);

    const loadMore = useCallback(() => {
        const q = queryRef.current;
        if (q.length < minQueryLength || loadingMore || loading) return;
        setLoadingMore(true);
        const controller = new AbortController();
        executeSearch(q, controller.signal, results.length)
            .then((data) => {
                if (!controller.signal.aborted) {
                    setResults(prev => [...prev, ...data.results]);
                    setTotal(data.total);
                    setLoadingMore(false);
                }
            })
            .catch((err) => {
                if (!controller.signal.aborted) {
                    setError(getSearchErrorMessage(err));
                    setLoadingMore(false);
                }
            });
    }, [executeSearch, results.length, minQueryLength, loadingMore, loading]);

    // Cleanup abort controller on unmount
    useEffect(() => {
        return () => {
            if (abortRef.current) abortRef.current.abort();
        };
    }, []);

    const hasMore = results.length < total;

    return { results, total, loading, error, hasMore, loadMore, loadingMore };
}
