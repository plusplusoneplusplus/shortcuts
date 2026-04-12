/**
 * useProcessSearch — server-side FTS5 search with debouncing and AbortController.
 * Only triggers when query >= 2 characters; cancels in-flight requests on query change.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiBase } from '../utils/config';

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
    debounceMs?: number;
    minQueryLength?: number;
}

export interface UseProcessSearchReturn {
    results: ProcessSearchResult[];
    total: number;
    loading: boolean;
    error: string | null;
}

export function useProcessSearch(
    query: string,
    options: UseProcessSearchOptions = {},
): UseProcessSearchReturn {
    const {
        workspace,
        statusFilter,
        debounceMs = 300,
        minQueryLength = 2,
    } = options;

    const [results, setResults] = useState<ProcessSearchResult[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    const executeSearch = useCallback(async (q: string, signal: AbortSignal) => {
        const params = new URLSearchParams({ q });
        if (workspace && workspace !== '__all') {
            params.set('workspaceId', workspace);
        }
        if (statusFilter && statusFilter !== '__all') {
            params.set('status', statusFilter);
        }
        const url = getApiBase() + '/processes/search?' + params.toString();
        const res = await fetch(url, { signal });
        if (!res.ok) {
            throw new Error(`Search failed: ${res.status}`);
        }
        return res.json() as Promise<ProcessSearchResponse>;
    }, [workspace, statusFilter]);

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
                        setError(err?.message || 'Search failed');
                        setLoading(false);
                    }
                });
        }, debounceMs);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, executeSearch, debounceMs, minQueryLength]);

    // Cleanup abort controller on unmount
    useEffect(() => {
        return () => {
            if (abortRef.current) abortRef.current.abort();
        };
    }, []);

    return { results, total, loading, error };
}
