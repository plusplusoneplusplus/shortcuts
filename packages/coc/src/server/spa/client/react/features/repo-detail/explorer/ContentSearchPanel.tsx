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
 * Enter in the query box takes that second path too: it is the same re-run the
 * toolbar's Refresh issues, so it skips whatever debounce is still pending. The
 * box is a textarea, so Shift+Enter adds a line and the query goes multi-line.
 *
 * Every request carries an AbortSignal and a monotonic run id. A superseded
 * response is dropped on the run-id check, so a slow early response can never
 * paint over a fast later one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';
import { Spinner } from '../../../ui';
import { SearchBar, type SearchBarToggle } from './SearchBar';
import { SearchFilters } from './SearchFilters';
import { ReplaceRow } from './ReplaceRow';
import { ContentSearchToolbar } from './ContentSearchToolbar';
import {
    ContentSearchResults,
    applyDismissals,
    collapsibleTreePaths,
    dismissRow,
    groupMatchesByFile,
    toggleCollapsedPath,
} from './ContentSearchResults';
import { buildSearchEditorText } from './searchEditorText';
import {
    buildReplaceFiles,
    countReplaceTargets,
    describeReplaceResult,
    replaceConfirmMessage,
} from './contentReplaceRequest';
import { explorerApi } from './explorerApi';
import {
    useExplorerContentFilters,
    useExplorerContentModes,
    useExplorerContentQuery,
    useExplorerContentReplace,
    useExplorerContentResults,
    useExplorerContentResultView,
    NO_COLLAPSED_GROUPS,
    NO_DISMISSED_ROWS,
    type ContentSearchState,
} from './explorerStateStore';
import {
    DEFAULT_CONTENT_SEARCH_FILTERS,
    DEFAULT_CONTENT_SEARCH_REPLACE,
    contentSearchFiltersActive,
    isMultiLineQuery,
    parseGlobList,
    type ContentSearchErrorKind,
    type ContentSearchModes,
} from './types';

/**
 * One testid per error kind, so a test can assert *which* input the message is
 * blaming without parsing the message itself. `regex` and `request` keep the
 * ids they have always had.
 */
const SEARCH_ERROR_TESTIDS: Record<ContentSearchErrorKind, string> = {
    regex: 'content-search-regex-error',
    glob: 'content-search-glob-error',
    request: 'content-search-error',
};

/**
 * Replacing more than one span at a time asks first. A single match row applies
 * straight away, as VS Code's does — one span is a change the user can see in
 * full before clicking, and a modal per match would make the row action useless.
 */
export const REPLACE_CONFIRM_THRESHOLD = 2;

/** Shown in place of the replace field for a query the endpoint would reject. */
export const MULTILINE_REPLACE_NOTICE = 'Replace is not available for a multi-line query.';

/** Quiet period after the last keystroke before a search request fires. */
export const SEARCH_DEBOUNCE_MS = 250;

export interface ContentSearchPanelProps {
    workspaceId: string;
    /**
     * Bump to move focus into the query box. A counter rather than a boolean
     * because the request ("Find in Folder") can arrive while the view is
     * already showing, when there is no mount to hang an autoFocus on; every
     * distinct value is one focus request. Zero means "never asked".
     */
    focusQueryToken?: number;
    /** Open a file at a one-based line — the click-through for a match. */
    onOpenMatch: (path: string, line: number) => void;
    /**
     * Show the result set as a read-only text buffer in the preview pane
     * (§2.7's "Open in Editor"). The panel builds the text — it owns the query,
     * the filters and the surviving matches — and the host decides where it
     * goes. A host with nowhere to put it omits the prop and the toolbar button
     * stays disabled.
     */
    onOpenInEditor?: (text: string, query: string) => void;
}

/**
 * Classify a failed search. The route answers an unparseable pattern — or an
 * unparseable include/exclude glob — with 400 and the engine's own message,
 * which belongs inline against the input at fault; any other failure is generic
 * and retryable.
 *
 * The glob check runs first and is message-driven rather than mode-driven: a
 * bad glob is a 400 whether or not `.*` happens to be on, so keying off
 * `regexMode` alone would file it under the query box.
 */
export function classifySearchError(error: unknown, regexMode: boolean): ContentSearchState {
    const message = error instanceof Error ? error.message : '';
    const status = (error as { status?: unknown } | null)?.status;
    const isGlobError = status === 400 && /invalid glob/i.test(message);
    const isRegexError = !isGlobError
        && status === 400
        && (regexMode || /regular expression/i.test(message));
    const errorKind: ContentSearchErrorKind = isGlobError
        ? 'glob'
        : isRegexError ? 'regex' : 'request';
    return {
        status: 'error',
        matches: [],
        truncated: false,
        error: message || 'Search failed',
        errorKind,
        query: '',
        collapsed: NO_COLLAPSED_GROUPS,
        dismissed: NO_DISMISSED_ROWS,
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

export function ContentSearchPanel({
    workspaceId,
    focusQueryToken = 0,
    onOpenMatch,
    onOpenInEditor,
}: ContentSearchPanelProps) {
    const [query, setQuery] = useExplorerContentQuery(workspaceId);
    const [modes, setModes] = useExplorerContentModes(workspaceId);
    const [filters, setFilters] = useExplorerContentFilters(workspaceId);
    // Replace state is persisted like the query, and deliberately kept out of
    // the request effect: nothing here changes what was searched.
    const [replace, setReplace] = useExplorerContentReplace(workspaceId);
    const [state, setState] = useExplorerContentResults(workspaceId);
    // List vs. tree is a display preference, not part of the query, so it is
    // persisted and never touches the request effect.
    const [resultView, setResultView] = useExplorerContentResultView(workspaceId);
    // The `…` section starts open when it is already filtering, so a persisted
    // filter is never hidden behind a collapsed chevron on the first render.
    const [filtersExpanded, setFiltersExpanded] = useState(() => contentSearchFiltersActive(filters));
    // Same rule for the replace chevron: a persisted replacement is never left
    // hidden behind a collapsed row.
    const [replaceExpanded, setReplaceExpanded] = useState(() => replace.replacement.length > 0);

    // The outcome of the last replace, shown under the toolbar until the query
    // changes. It survives the re-run a replace triggers on purpose: that re-run
    // is how the results stop being stale, and it must not erase the report.
    const [replaceNotice, setReplaceNotice] = useState<string | null>(null);

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
    const queryInputRef = useRef<HTMLTextAreaElement>(null);

    // Focus on request from the host (Find in Folder). Skipped at zero so a
    // plain mount does not steal focus from wherever the user actually is.
    useEffect(() => {
        if (focusQueryToken > 0) queryInputRef.current?.focus();
    }, [focusQueryToken]);

    // A new query makes the old report meaningless — it described a result set
    // that is now gone.
    useEffect(() => { setReplaceNotice(null); }, [query]);

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
                dismissed: NO_DISMISSED_ROWS,
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
                        // Dismissals are per result list, not per file, so any
                        // new response — including a Refresh of the same query —
                        // brings the hidden rows back.
                        dismissed: NO_DISMISSED_ROWS,
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
    }, [workspaceId, trimmed, typedSignature, include, exclude, modes, filters.useIgnoreFiles, refreshTick, setState]);

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

    // Two groupings on purpose: the rendered tree drops the rows the user
    // dismissed, while the summary keeps reporting what the *search* found —
    // dismissing is a view filter, not a correction to the result count.
    const visibleMatches = useMemo(
        () => applyDismissals(state.matches, state.dismissed),
        [state.matches, state.dismissed],
    );
    const groups = useMemo(() => groupMatchesByFile(visibleMatches), [visibleMatches]);
    const fileCount = useMemo(() => groupMatchesByFile(state.matches).length, [state.matches]);

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
        setReplace(DEFAULT_CONTENT_SEARCH_REPLACE);
    }, [setQuery, setFilters, setReplace]);

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

    const onDismiss = useCallback((key: string) => {
        setState(prev => ({ ...prev, dismissed: dismissRow(prev.dismissed, key) }));
    }, [setState]);

    // Built from the dismissal-filtered matches, not `state.matches`: the buffer
    // is an export of what is on screen.
    const onOpenInEditorClick = useCallback(() => {
        if (!onOpenInEditor) return;
        onOpenInEditor(
            buildSearchEditorText({
                query: state.query || trimmed,
                modes,
                filters,
                matches: visibleMatches,
                truncated: state.truncated,
            }),
            state.query || trimmed,
        );
    }, [onOpenInEditor, state.query, state.truncated, trimmed, modes, filters, visibleMatches]);

    // Replacing is possible only when the row is showing (so a replacement is
    // visible and editable) and the query is single-line (the endpoint answers a
    // multi-line one with a 400).
    const replaceAvailable = replaceExpanded && !isMultiLineQuery(query);

    // Guards against a second write while the first is in flight — the results
    // on screen are already stale at that point.
    const replacingRef = useRef(false);

    /**
     * Write the given matches. The request lists exactly these spans and the
     * endpoint never re-searches, so a replace can only ever touch rows the user
     * is looking at. Afterwards the result set describes a file that no longer
     * says that, so the search is re-run.
     */
    const runReplace = useCallback(async (matches: readonly ExplorerContentMatch[]) => {
        const files = buildReplaceFiles(matches);
        if (files.length === 0 || replacingRef.current) return;
        if (countReplaceTargets(files) >= REPLACE_CONFIRM_THRESHOLD
            && typeof window !== 'undefined'
            && typeof window.confirm === 'function'
            && !window.confirm(replaceConfirmMessage(files))) return;

        replacingRef.current = true;
        setReplaceNotice(null);
        try {
            const response = await explorerApi.replaceContent(
                workspaceId,
                state.query || trimmed,
                replace.replacement,
                files,
                {
                    caseSensitive: modes.caseSensitive,
                    wholeWord: modes.wholeWord,
                    regex: modes.regex,
                    preserveCase: replace.preserveCase,
                },
            );
            setReplaceNotice(describeReplaceResult(response));
            setRefreshTick(tick => tick + 1);
        } catch (error) {
            setReplaceNotice(error instanceof Error && error.message ? error.message : 'Replace failed');
        } finally {
            replacingRef.current = false;
        }
    }, [workspaceId, state.query, trimmed, replace, modes]);

    const onReplaceRows = useMemo(
        () => (replaceAvailable ? runReplace : undefined),
        [replaceAvailable, runReplace],
    );

    // Replace All takes the dismissal-filtered set, like Open in Editor: it acts
    // on the view, and a dismissed row is one the user has said to leave alone.
    const onReplaceAll = useCallback(() => { void runReplace(visibleMatches); }, [runReplace, visibleMatches]);

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
                onOpenInEditor={onOpenInEditorClick}
                hasResults={onOpenInEditor !== undefined && visibleMatches.length > 0}
                onReplaceAll={onReplaceAll}
                canReplaceAll={replaceAvailable && visibleMatches.length > 0}
                testIdPrefix="content-search"
            />
            <ReplaceRow
                replace={replace}
                onChange={setReplace}
                expanded={replaceExpanded}
                onToggleExpanded={() => setReplaceExpanded(prev => !prev)}
                disabledReason={isMultiLineQuery(query) ? MULTILINE_REPLACE_NOTICE : undefined}
                testIdPrefix="content-search"
            >
                <SearchBar
                    value={query}
                    onChange={setQuery}
                    onClear={onClear}
                    placeholder="Search in files…"
                    toggles={toggles}
                    inputRef={queryInputRef}
                    multiline
                    onSubmit={onRefresh}
                    testIdPrefix="content-search"
                />
            </ReplaceRow>
            {replaceNotice && (
                <p
                    className="px-3 py-1 text-[11px] text-[#848484]"
                    data-testid="content-search-replace-status"
                    role="status"
                >
                    {replaceNotice}
                </p>
            )}
            <SearchFilters
                filters={filters}
                onChange={setFilters}
                expanded={filtersExpanded}
                onToggleExpanded={() => setFiltersExpanded(prev => !prev)}
                testIdPrefix="content-search"
            />

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
                    data-testid={SEARCH_ERROR_TESTIDS[state.errorKind ?? 'request']}
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
                        {fileCount} {fileCount === 1 ? 'file' : 'files'}
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
                        onDismiss={onDismiss}
                        onReplace={onReplaceRows}
                    />
                </>
            )}
        </div>
    );
}
