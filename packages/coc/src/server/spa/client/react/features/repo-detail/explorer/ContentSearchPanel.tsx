/**
 * ContentSearchPanel — the Explorer sidebar's Search view.
 *
 * Types a query, debounces it, calls `GET /api/repos/:id/search/content` through
 * `explorerApi`, and renders the capped result set grouped by file. Query and
 * toggles are persisted per workspace; results live in memory (see
 * explorerStateStore), so switching to the tree view and back shows the same
 * results without re-running the search.
 *
 * Two rules drive the request effect:
 *  - a *typed* change waits `SEARCH_DEBOUNCE_MS` of quiet before firing;
 *  - a *toggle* change re-runs the query it already has immediately, because the
 *    user has expressed intent and there is no further keystroke to wait for.
 *
 * Every request carries an AbortSignal and a monotonic run id. A superseded
 * response is dropped on the run-id check, so a slow early response can never
 * paint over a fast later one.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Spinner } from '../../../ui';
import { SearchBar, type SearchBarToggle } from './SearchBar';
import { ContentSearchResults, groupMatchesByFile } from './ContentSearchResults';
import { explorerApi } from './explorerApi';
import {
    useExplorerContentModes,
    useExplorerContentQuery,
    useExplorerContentResults,
    type ContentSearchState,
} from './explorerStateStore';
import type { ContentSearchModes } from './types';

/** Quiet period after the last keystroke before a search request fires. */
export const SEARCH_DEBOUNCE_MS = 250;

export interface ContentSearchPanelProps {
    workspaceId: string;
    /**
     * Repo-relative directory to scope the search to. Empty/undefined searches
     * the whole repo. Wired to the Explorer's currently selected directory.
     */
    scopePath?: string;
    /** Open a file at a one-based line — the click-through for a match. */
    onOpenMatch: (path: string, line: number) => void;
}

/**
 * Classify a failed search. The route answers an unparseable pattern with 400
 * and the engine's own message, which belongs inline against the query box; any
 * other failure is generic and retryable.
 */
export function classifySearchError(error: unknown, regexMode: boolean): ContentSearchState {
    const message = error instanceof Error ? error.message : '';
    const status = (error as { status?: unknown } | null)?.status;
    const isRegexError = status === 400
        && (regexMode || /regular expression/i.test(message));
    return {
        status: 'error',
        matches: [],
        truncated: false,
        error: message || 'Search failed',
        errorKind: isRegexError ? 'regex' : 'request',
        query: '',
    };
}

/** True for the rejection an aborted (superseded or unmounted) request produces. */
function isAbortError(error: unknown): boolean {
    return (error as { name?: unknown } | null)?.name === 'AbortError';
}

export function ContentSearchPanel({ workspaceId, scopePath, onOpenMatch }: ContentSearchPanelProps) {
    const [query, setQuery] = useExplorerContentQuery(workspaceId);
    const [modes, setModes] = useExplorerContentModes(workspaceId);
    const [state, setState] = useExplorerContentResults(workspaceId);

    // Monotonic run id: only the newest request may write results.
    const runIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    // The query the previous effect run searched for, so a mode-only change can
    // skip the debounce instead of waiting for a keystroke that will not come.
    const lastQueryRef = useRef<string | null>(null);

    const trimmed = query.trim();

    useEffect(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        const runId = ++runIdRef.current;

        if (!trimmed) {
            lastQueryRef.current = '';
            setState({
                status: 'idle',
                matches: [],
                truncated: false,
                error: null,
                errorKind: null,
                query: '',
            });
            return;
        }

        const queryChanged = lastQueryRef.current !== trimmed;
        lastQueryRef.current = trimmed;
        const delay = queryChanged ? SEARCH_DEBOUNCE_MS : 0;

        const timer = setTimeout(() => {
            const controller = new AbortController();
            abortRef.current = controller;
            setState(prev => ({ ...prev, status: 'loading', error: null, errorKind: null }));
            explorerApi.searchContent(workspaceId, trimmed, {
                path: scopePath || undefined,
                caseSensitive: modes.caseSensitive,
                wholeWord: modes.wholeWord,
                regex: modes.regex,
                signal: controller.signal,
            })
                .then(response => {
                    if (runId !== runIdRef.current) return;
                    setState({
                        status: response.matches.length > 0 ? 'success' : 'empty',
                        matches: response.matches,
                        truncated: response.truncated,
                        error: null,
                        errorKind: null,
                        query: trimmed,
                    });
                })
                .catch(error => {
                    if (runId !== runIdRef.current || isAbortError(error)) return;
                    setState({ ...classifySearchError(error, modes.regex), query: trimmed });
                });
        }, delay);

        return () => {
            clearTimeout(timer);
            abortRef.current?.abort();
        };
    }, [workspaceId, trimmed, scopePath, modes, setState]);

    // Unmounting mid-request must not leave a request running: bump the run id
    // so any in-flight response is discarded, and abort the fetch itself.
    useEffect(() => () => {
        runIdRef.current++;
        abortRef.current?.abort();
    }, []);

    const toggleMode = useCallback((key: keyof ContentSearchModes) => {
        setModes(prev => ({ ...prev, [key]: !prev[key] }));
    }, [setModes]);

    const toggles = useMemo<SearchBarToggle[]>(() => [
        {
            id: 'case',
            label: 'Aa',
            title: 'Match case',
            active: modes.caseSensitive,
            onToggle: () => toggleMode('caseSensitive'),
        },
        {
            id: 'word',
            label: 'ab',
            title: 'Match whole word',
            active: modes.wholeWord,
            onToggle: () => toggleMode('wholeWord'),
        },
        {
            id: 'regex',
            label: '.*',
            title: 'Use regular expression',
            active: modes.regex,
            onToggle: () => toggleMode('regex'),
        },
    ], [modes, toggleMode]);

    const groups = useMemo(() => groupMatchesByFile(state.matches), [state.matches]);

    const onClear = useCallback(() => setQuery(''), [setQuery]);

    return (
        <div className="flex flex-col flex-1 min-h-0" data-testid="content-search-panel">
            <SearchBar
                value={query}
                onChange={setQuery}
                onClear={onClear}
                placeholder="Search in files…"
                toggles={toggles}
                testIdPrefix="content-search"
            />
            {scopePath && (
                <div className="px-3 pb-1 text-[11px] text-[#848484] truncate" data-testid="content-search-scope">
                    in {scopePath}
                </div>
            )}

            {state.status === 'idle' && (
                <p className="px-3 py-2 text-xs text-[#848484]" data-testid="content-search-idle">
                    Search the text of every non-ignored file in this repository.
                </p>
            )}

            {state.status === 'loading' && (
                <div
                    className="flex items-center gap-2 px-3 py-2 text-xs text-[#848484]"
                    data-testid="content-search-loading"
                >
                    <Spinner size="sm" /> Searching…
                </div>
            )}

            {state.status === 'error' && (
                <div
                    className="px-3 py-2 text-xs text-[#d32f2f] dark:text-[#f48771]"
                    data-testid={state.errorKind === 'regex' ? 'content-search-regex-error' : 'content-search-error'}
                >
                    {state.error}
                </div>
            )}

            {state.status === 'empty' && (
                <p className="px-3 py-2 text-xs text-[#848484]" data-testid="content-search-empty">
                    No results for “{state.query}”.
                </p>
            )}

            {state.status === 'success' && (
                <>
                    <div
                        className="px-3 py-1 text-[11px] text-[#848484] border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                        data-testid="content-search-summary"
                    >
                        {state.matches.length} {state.matches.length === 1 ? 'result' : 'results'}
                        {' in '}
                        {groups.length} {groups.length === 1 ? 'file' : 'files'}
                    </div>
                    {state.truncated && (
                        <div
                            className="px-3 py-1 text-[11px] text-[#8a6d00] dark:text-[#d7ba7d] border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                            data-testid="content-search-truncated"
                        >
                            Results truncated — showing the first 500 matches (max 20 per file, files
                            over 1 MB skipped). Narrow the query to see the rest.
                        </div>
                    )}
                    <ContentSearchResults groups={groups} onOpenMatch={onOpenMatch} />
                </>
            )}
        </div>
    );
}
