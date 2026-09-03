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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '../../../ui';
import { SearchBar, type SearchBarToggle } from './SearchBar';
import { SearchFilters } from './SearchFilters';
import { ContentSearchToolbar } from './ContentSearchToolbar';
import {
    ContentSearchResults,
    collapsibleTreePaths,
    groupMatchesByFile,
    toggleCollapsedPath,
} from './ContentSearchResults';
import { explorerApi } from './explorerApi';
import {
    useExplorerContentFilters,
    useExplorerContentModes,
    useExplorerContentQuery,
    useExplorerContentResults,
    useExplorerContentResultView,
    NO_COLLAPSED_GROUPS,
    type ContentSearchState,
} from './explorerStateStore';
import {
    DEFAULT_CONTENT_SEARCH_FILTERS,
    contentSearchFiltersActive,
    parseGlobList,
    type ContentSearchModes,
} from './types';

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
        collapsed: NO_COLLAPSED_GROUPS,
    };
}

/**
 * Narrow a carried-over collapsed set to the paths the new result set actually
 * has, so a file that stops matching does not leave its path behind forever.
 * Returns the shared empty array when nothing survives, keeping the reference
 * stable for consumers.
 */
export function keepCollapsedPaths(
    collapsed: readonly string[],
    matches: readonly { path: string }[],
): readonly string[] {
    if (collapsed.length === 0) return NO_COLLAPSED_GROUPS;
    const present = new Set(matches.map(entry => entry.path));
    const kept = collapsed.filter(path => present.has(path));
    return kept.length > 0 ? kept : NO_COLLAPSED_GROUPS;
}

/** True for the rejection an aborted (superseded or unmounted) request produces. */
function isAbortError(error: unknown): boolean {
    return (error as { name?: unknown } | null)?.name === 'AbortError';
}

export function ContentSearchPanel({ workspaceId, scopePath, onOpenMatch }: ContentSearchPanelProps) {
    const [query, setQuery] = useExplorerContentQuery(workspaceId);
    const [modes, setModes] = useExplorerContentModes(workspaceId);
    const [filters, setFilters] = useExplorerContentFilters(workspaceId);
    const [state, setState] = useExplorerContentResults(workspaceId);
    // List vs. tree is a display preference, not part of the query, so it is
    // persisted and never touches the request effect.
    const [resultView, setResultView] = useExplorerContentResultView(workspaceId);
    // The `…` section starts open when it is already filtering, so a persisted
    // filter is never hidden behind a collapsed chevron on the first render.
    const [filtersExpanded, setFiltersExpanded] = useState(() => contentSearchFiltersActive(filters));

    // Bumped by the toolbar's Refresh. It is an effect dep but not part of
    // `typedSignature`, so the re-run it triggers takes the zero-delay path: a
    // refresh is intent, like a toggle, and must not wait out the debounce.
    const [refreshTick, setRefreshTick] = useState(0);

    // Monotonic run id: only the newest request may write results.
    const runIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    // What the previous effect run typed — query plus the two glob boxes. A
    // change to any of them is a keystroke and waits out the debounce; a change
    // to a toggle is intent and re-runs at once, because no further keystroke is
    // coming.
    const lastTypedRef = useRef<string | null>(null);

    const trimmed = query.trim();
    // Keyed off the *parsed* glob lists, not the raw text, so typing a space
    // after a comma neither changes the request nor re-fires the effect. A glob
    // cannot contain a comma (the route splits on it), so join/split round trips.
    const includeKey = (parseGlobList(filters.include) ?? []).join(',');
    const excludeKey = (parseGlobList(filters.exclude) ?? []).join(',');
    const include = useMemo(() => (includeKey ? includeKey.split(',') : undefined), [includeKey]);
    const exclude = useMemo(() => (excludeKey ? excludeKey.split(',') : undefined), [excludeKey]);
    // `\u0000` cannot appear in a glob or a query, so the join is unambiguous.
    const typedSignature = `${trimmed}\u0000${includeKey}\u0000${excludeKey}`;

    useEffect(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        const runId = ++runIdRef.current;

        if (!trimmed) {
            lastTypedRef.current = null;
            setState({
                status: 'idle',
                matches: [],
                truncated: false,
                error: null,
                errorKind: null,
                query: '',
                collapsed: NO_COLLAPSED_GROUPS,
            });
            return;
        }

        const typedChanged = lastTypedRef.current !== typedSignature;
        lastTypedRef.current = typedSignature;
        const delay = typedChanged ? SEARCH_DEBOUNCE_MS : 0;

        const timer = setTimeout(() => {
            const controller = new AbortController();
            abortRef.current = controller;
            setState(prev => ({ ...prev, status: 'loading', error: null, errorKind: null }));
            explorerApi.searchContent(workspaceId, trimmed, {
                path: scopePath || undefined,
                caseSensitive: modes.caseSensitive,
                wholeWord: modes.wholeWord,
                regex: modes.regex,
                showIgnored: !filters.useIgnoreFiles,
                include,
                exclude,
                signal: controller.signal,
            })
                .then(response => {
                    if (runId !== runIdRef.current) return;
                    setState(prev => ({
                        status: response.matches.length > 0 ? 'success' : 'empty',
                        matches: response.matches,
                        truncated: response.truncated,
                        error: null,
                        errorKind: null,
                        query: trimmed,
                        // A new query starts fully expanded; a re-run of the same
                        // one keeps the groups the user closed, which is what
                        // makes the collapse state survive a tree round trip (the
                        // panel re-searches on every remount) and a Refresh.
                        collapsed: prev.query === trimmed
                            ? keepCollapsedPaths(prev.collapsed, response.matches)
                            : NO_COLLAPSED_GROUPS,
                    }));
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
    }, [workspaceId, trimmed, typedSignature, include, exclude, scopePath, modes, filters.useIgnoreFiles, refreshTick, setState]);

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

    // Refresh is a re-run, never a no-op: the query is unchanged, so the effect
    // only re-fires because this counter moved.
    const onRefresh = useCallback(() => setRefreshTick(tick => tick + 1), []);

    // Clear wipes the query and the filters together — the filters are part of
    // the search, and leaving a stale include glob behind after "Clear" would
    // silently narrow the next query.
    const onClearAll = useCallback(() => {
        setQuery('');
        setFilters(DEFAULT_CONTENT_SEARCH_FILTERS);
    }, [setQuery, setFilters]);

    // Derived from `prev.matches` rather than the rendered `groups` so the
    // updater stays pure and cannot collapse against a stale result set. It
    // collects the directory rows too, so one click closes everything in either
    // layout — and switching layouts afterwards finds it already collapsed.
    const onCollapseAll = useCallback(() => {
        setState(prev => {
            const paths = collapsibleTreePaths(groupMatchesByFile(prev.matches));
            return { ...prev, collapsed: paths.length > 0 ? paths : NO_COLLAPSED_GROUPS };
        });
    }, [setState]);

    const onToggleResultView = useCallback(() => {
        setResultView(prev => (prev === 'tree' ? 'list' : 'tree'));
    }, [setResultView]);

    const onToggleCollapsed = useCallback((path: string) => {
        setState(prev => ({ ...prev, collapsed: toggleCollapsedPath(prev.collapsed, path) }));
    }, [setState]);

    return (
        <div className="flex flex-col flex-1 min-h-0" data-testid="content-search-panel">
            <ContentSearchToolbar
                enabled={trimmed.length > 0}
                onRefresh={onRefresh}
                onClear={onClearAll}
                onCollapseAll={onCollapseAll}
                resultView={resultView}
                onToggleResultView={onToggleResultView}
                testIdPrefix="content-search"
            />
            <SearchBar
                value={query}
                onChange={setQuery}
                onClear={onClear}
                placeholder="Search in files…"
                toggles={toggles}
                testIdPrefix="content-search"
            />
            <SearchFilters
                filters={filters}
                onChange={setFilters}
                expanded={filtersExpanded}
                onToggleExpanded={() => setFiltersExpanded(prev => !prev)}
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
                    <ContentSearchResults
                        groups={groups}
                        onOpenMatch={onOpenMatch}
                        collapsed={state.collapsed}
                        onToggleCollapsed={onToggleCollapsed}
                        resultView={resultView}
                    />
                </>
            )}
        </div>
    );
}
