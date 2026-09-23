/**
 * ContentSearchOverlay — the centered, keyboard-first dialog behind
 * Ctrl/Cmd+Shift+F.
 *
 * It owns the dialog chrome, the query field, the search controls and the
 * keyboard model. Matches arrive as a flat, ordered list of rows and are drawn
 * as a collapsible repository -> file -> match tree, so nothing here knows how
 * a match was produced or which server answered.
 *
 * The keyboard model is a single roving selection with `-1` meaning "the query
 * field has focus":
 *
 *  - ArrowDown/ArrowUp walk the matches that are actually on screen — a
 *    collapsed repository or file drops out of the walk as well as the view —
 *    and walking back off the top returns to the query rather than trapping
 *    the user in the list;
 *  - Enter opens the selected match, or submits the query when the selection is
 *    still on the query field or on one of the search controls;
 *  - Escape closes, and the host restores focus to whatever invoked the
 *    overlay.
 *
 * Selection lives here rather than on the DOM's own focus so a re-render with
 * fresh results cannot silently move the user: the index is clamped back into
 * range whenever the match list changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../ui/cn';
import { usePortalContainer } from '../../../ui/usePortalContainer';
import type { ContentSearchScope } from './contentSearchShortcut';
import {
    DEFAULT_CONTENT_SEARCH_CONTROLS,
    type ContentSearchControls,
} from './contentSearchControls';
import {
    groupOverlayMatches,
    toggleCollapsed,
    visibleMatches,
    type ContentSearchRepoGroup,
} from './contentSearchGrouping';

/** One selectable row. Carries the owner identity the open path needs (AC-04). */
export interface ContentSearchOverlayMatch {
    /** Stable within a result set; used for React keys and test selection. */
    id: string;
    /** Member workspace the match belongs to — a group result spans several. */
    workspaceId: string;
    /** Concrete clone owner for the follow-up read, when the member is a clone. */
    routingRef?: string | null;
    /** Member label, shown only in a group scope. */
    repoLabel?: string | null;
    /** Repo-relative path. Never an absolute filesystem root. */
    path: string;
    /** One-based line number of the match. */
    line: number;
    /** The matching line, already trimmed by the server. */
    preview: string;
}

/**
 * A group member that could not contribute to the current answer. Lives with
 * the row type because both are what the dialog draws; the request layer
 * re-exports it.
 */
export interface ContentSearchOverlayFailure {
    workspaceId: string;
    /** Display label; absent when the workspace itself is gone. */
    repoLabel?: string;
    reason: 'stale' | 'unavailable' | 'error';
    message: string;
}

export interface ContentSearchOverlayProps {
    open: boolean;
    /** Decides the dialog's accessible name and whether member labels show. */
    scope: ContentSearchScope;
    query: string;
    onQueryChange: (query: string) => void;
    /** Enter from the query or the search controls — the only thing that searches. */
    onSubmit: () => void;
    onClose: () => void;
    matches: ContentSearchOverlayMatch[];
    onOpenMatch: (match: ContentSearchOverlayMatch) => void;
    /** A search is in flight. */
    busy?: boolean;
    /** The server capped the answer; the overlay says so above the results. */
    truncated?: boolean;
    /**
     * Group members that dropped out of the current answer. Listed by name
     * above the results so a partial answer never reads like a complete one.
     */
    failures?: readonly ContentSearchOverlayFailure[];
    /** Status line under the query: no results, errors, truncation notices. */
    status?: ReactNode;
    /**
     * Match-case / whole-word / regex, the glob boxes and the untracked
     * toggle. Changing any of them only edits this object — searching is
     * Enter's job alone, so nothing here calls `onSubmit`.
     */
    controls?: ContentSearchControls;
    onControlsChange?: (
        update: (current: ContentSearchControls) => ContentSearchControls,
    ) => void;
    /**
     * Bump to pull focus back into the query and select it. A counter, not a
     * boolean, because repeating the shortcut while the overlay is already up
     * has to re-focus an overlay that never unmounted.
     */
    focusToken?: number;
}

const QUERY_SELECTION = -1;

/** Stable identities so an absent prop cannot retrigger effects every render. */
const EMPTY_FAILURES: readonly ContentSearchOverlayFailure[] = [];
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set<string>();

/** Marks the expand/collapse buttons, which own Enter instead of the dialog. */
const TOGGLE_ATTRIBUTE = 'data-content-search-toggle';

/** Why a member is missing, in words the user can act on. */
function describeFailure(failure: ContentSearchOverlayFailure): string {
    const name = failure.repoLabel || failure.workspaceId;
    switch (failure.reason) {
        case 'stale':
            return `${name} is no longer part of this group.`;
        case 'unavailable':
            return `${name} is not a Git repository.`;
        case 'error':
            return `${name} could not be searched: ${failure.message}`;
    }
}

/** The three mode toggles, with VS Code's glyphs. */
const MODE_CONTROLS: { id: keyof ContentSearchControls['modes']; label: string; glyph: string }[] = [
    { id: 'caseSensitive', label: 'Match case', glyph: 'Aa' },
    { id: 'wholeWord', label: 'Match whole word', glyph: 'ab' },
    { id: 'regex', label: 'Use regular expression', glyph: '.*' },
];

export function ContentSearchOverlay(props: ContentSearchOverlayProps) {
    const {
        open,
        scope,
        query,
        onQueryChange,
        onSubmit,
        onClose,
        matches,
        onOpenMatch,
        busy,
        truncated = false,
        failures = EMPTY_FAILURES,
        status,
        controls = DEFAULT_CONTENT_SEARCH_CONTROLS,
        onControlsChange,
        focusToken = 0,
    } = props;
    const portalContainer = usePortalContainer(open);
    const queryRef = useRef<HTMLInputElement | null>(null);
    const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [selected, setSelected] = useState(QUERY_SELECTION);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(EMPTY_COLLAPSED);

    const repos = useMemo(() => groupOverlayMatches(matches), [matches]);
    // The keyboard model walks only what is drawn, so collapsing a group
    // removes its matches from the selectable list as well as from the view.
    const rows = useMemo(() => visibleMatches(repos, collapsed), [repos, collapsed]);
    // A fresh result set starts fully expanded: the keys in `collapsed` belong
    // to the previous answer's groups and must not silently hide new ones.
    useEffect(() => {
        setCollapsed(EMPTY_COLLAPSED);
    }, [matches]);

    // Opening, and every repeat of the shortcut, puts the caret in the query
    // with the previous term selected so typing replaces it. A passive effect,
    // not a layout one: the portal container is attached by `usePortalContainer`
    // in its own effect, and focusing a detached input is a no-op.
    useEffect(() => {
        if (!open) return;
        setSelected(QUERY_SELECTION);
        const input = queryRef.current;
        if (input === null) return;
        input.focus();
        input.select();
    }, [open, focusToken]);

    // A smaller visible list — a new result set, or a group the user just
    // collapsed — must not leave the selection pointing past the end.
    useEffect(() => {
        setSelected((current) => (current >= rows.length ? rows.length - 1 : current));
    }, [rows]);

    // Move DOM focus to follow the selection, so screen readers and the browser
    // agree with the highlighted row.
    useEffect(() => {
        if (!open) return;
        if (selected === QUERY_SELECTION) return;
        rowRefs.current[selected]?.focus();
    }, [open, selected]);

    const onKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key === 'ArrowDown') {
                if (rows.length === 0) return;
                event.preventDefault();
                setSelected((current) => Math.min(current + 1, rows.length - 1));
                return;
            }
            if (event.key === 'ArrowUp') {
                if (rows.length === 0) return;
                event.preventDefault();
                setSelected((current) => {
                    const next = current - 1;
                    if (next < QUERY_SELECTION) return QUERY_SELECTION;
                    if (next === QUERY_SELECTION) {
                        queryRef.current?.focus();
                    }
                    return next;
                });
                return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
                // An expand/collapse button keeps its own Enter: pressing it is
                // a toggle, not a search and not an open.
                const target = event.target;
                if (
                    target instanceof HTMLElement
                    && target.closest(`[${TOGGLE_ATTRIBUTE}]`) !== null
                ) {
                    return;
                }
                event.preventDefault();
                const match = selected >= 0 ? rows[selected] : undefined;
                if (match) onOpenMatch(match);
                else onSubmit();
            }
        },
        [rows, onClose, onOpenMatch, onSubmit, selected],
    );

    const onToggleGroup = useCallback((key: string) => {
        setCollapsed((current) => toggleCollapsed(current, key));
    }, []);

    if (!open || portalContainer === null) return null;

    const title = scope === 'group' ? 'Search repository group' : 'Search repository';

    return createPortal(
        <div
            className="fixed inset-0 z-[10002] flex items-start justify-center bg-black/40 dark:bg-black/60 pt-[10vh]"
            data-testid="content-search-overlay-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                data-testid="content-search-overlay"
                className="w-full max-w-2xl max-h-[70vh] flex flex-col rounded-lg border border-[#c8c8c8] dark:border-[#555555] bg-white dark:bg-[#252526] shadow-xl overflow-hidden"
                onKeyDown={onKeyDown}
            >
                <div className="flex items-center gap-2 p-3 border-b border-[#e5e5e5] dark:border-[#3c3c3c]">
                    <input
                        ref={queryRef}
                        type="text"
                        aria-label="Search query"
                        data-testid="content-search-overlay-query"
                        placeholder="Search tracked files"
                        className="flex-1 px-2 py-1 text-sm bg-transparent border border-[#c8c8c8] dark:border-[#555555] rounded outline-none focus:border-[#0078d4]"
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                    />
                    <button
                        type="button"
                        aria-label="Close search"
                        data-testid="content-search-overlay-close"
                        className="px-2 text-[#616161] dark:text-[#cccccc]"
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-xs">
                    {MODE_CONTROLS.map(mode => (
                        <button
                            key={mode.id}
                            type="button"
                            aria-label={mode.label}
                            aria-pressed={controls.modes[mode.id]}
                            data-testid={`content-search-overlay-mode-${mode.id}`}
                            className={cn(
                                'px-1.5 py-0.5 rounded border border-transparent font-mono',
                                controls.modes[mode.id]
                                    && 'border-[#0078d4] bg-[#e8e8e8] dark:bg-[#37373d]',
                            )}
                            onClick={() =>
                                onControlsChange?.(current => ({
                                    ...current,
                                    modes: {
                                        ...current.modes,
                                        [mode.id]: !current.modes[mode.id],
                                    },
                                }))
                            }
                        >
                            {mode.glyph}
                        </button>
                    ))}
                    <input
                        type="text"
                        aria-label="Files to include"
                        data-testid="content-search-overlay-include"
                        placeholder="files to include"
                        className="w-32 px-2 py-0.5 bg-transparent border border-[#c8c8c8] dark:border-[#555555] rounded outline-none focus:border-[#0078d4]"
                        value={controls.include}
                        onChange={event => {
                            const include = event.target.value;
                            onControlsChange?.(current => ({ ...current, include }));
                        }}
                    />
                    <input
                        type="text"
                        aria-label="Files to exclude"
                        data-testid="content-search-overlay-exclude"
                        placeholder="files to exclude"
                        className="w-32 px-2 py-0.5 bg-transparent border border-[#c8c8c8] dark:border-[#555555] rounded outline-none focus:border-[#0078d4]"
                        value={controls.exclude}
                        onChange={event => {
                            const exclude = event.target.value;
                            onControlsChange?.(current => ({ ...current, exclude }));
                        }}
                    />
                    <label className="flex items-center gap-1">
                        <input
                            type="checkbox"
                            data-testid="content-search-overlay-untracked"
                            checked={controls.includeUntracked}
                            onChange={event => {
                                const includeUntracked = event.target.checked;
                                onControlsChange?.(current => ({ ...current, includeUntracked }));
                            }}
                        />
                        Include untracked files
                    </label>
                </div>
                <div
                    role="status"
                    aria-live="polite"
                    data-testid="content-search-overlay-status"
                    className="px-3 py-1 text-xs text-[#616161] dark:text-[#a0a0a0] min-h-[1.5rem]"
                >
                    {busy ? 'Searching…' : status}
                </div>
                {truncated ? (
                    <div
                        data-testid="content-search-overlay-truncated"
                        className="px-3 py-1 text-xs text-[#9a6700] dark:text-[#d7a72a]"
                    >
                        Too many matches. Showing the first results only — narrow the
                        query or the include/exclude filters.
                    </div>
                ) : null}
                {failures.length > 0 ? (
                    <ul
                        data-testid="content-search-overlay-failures"
                        aria-label="Repositories that could not be searched"
                        className="px-3 py-1 text-xs text-[#a1260d] dark:text-[#f48771] space-y-0.5"
                    >
                        {failures.map((failure) => (
                            <li
                                key={failure.workspaceId}
                                data-testid={`content-search-overlay-failure-${failure.workspaceId}`}
                            >
                                {describeFailure(failure)}
                            </li>
                        ))}
                    </ul>
                ) : null}
                <div
                    role="tree"
                    aria-label="Search results"
                    data-testid="content-search-overlay-results"
                    className="flex-1 overflow-auto"
                >
                    {renderGroups({
                        repos,
                        scope,
                        collapsed,
                        selected,
                        rowRefs,
                        onToggleGroup,
                        onSelect: setSelected,
                        onOpenMatch,
                    })}
                </div>
            </div>
        </div>,
        portalContainer,
    );
}

interface RenderGroupsArgs {
    repos: readonly ContentSearchRepoGroup[];
    scope: ContentSearchScope;
    collapsed: ReadonlySet<string>;
    selected: number;
    rowRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
    onToggleGroup: (key: string) => void;
    onSelect: (index: number) => void;
    onOpenMatch: (match: ContentSearchOverlayMatch) => void;
}

/**
 * Draw the repository/file/match tree.
 *
 * The tree is flattened: every row is a direct `treeitem` child of the tree and
 * says where it sits with `aria-level`, rather than nesting `role="group"`
 * wrappers. That keeps one linear DOM order — the same order `visibleMatches`
 * produces — so the selection index, the ref array and what a screen reader
 * walks can never drift apart.
 *
 * A single-repo search skips the repository level entirely: there is one
 * repository and no member label worth a row.
 */
function renderGroups(args: RenderGroupsArgs): ReactNode[] {
    const { repos, scope, collapsed, selected, rowRefs, onToggleGroup, onSelect, onOpenMatch }
        = args;
    const showRepoLevel = scope === 'group';
    const fileLevel = showRepoLevel ? 2 : 1;
    const nodes: ReactNode[] = [];
    let rowIndex = 0;

    for (const repo of repos) {
        const repoExpanded = !collapsed.has(repo.key);
        if (showRepoLevel) {
            const label = repo.repoLabel || repo.workspaceId;
            nodes.push(
                <button
                    key={`repo:${repo.key}`}
                    type="button"
                    role="treeitem"
                    aria-level={1}
                    aria-expanded={repoExpanded}
                    aria-label={`${label}, ${repo.matchCount} ${repo.matchCount === 1 ? 'result' : 'results'}`}
                    tabIndex={0}
                    {...{ [TOGGLE_ATTRIBUTE]: 'repo' }}
                    data-testid={`content-search-overlay-repo-${repo.workspaceId}`}
                    className="w-full flex items-baseline gap-2 px-2 py-1 text-left text-xs font-medium"
                    onClick={() => onToggleGroup(repo.key)}
                >
                    <span aria-hidden="true">{repoExpanded ? '▾' : '▸'}</span>
                    <span className="truncate">{label}</span>
                    <span className="text-[#616161] dark:text-[#a0a0a0]">{repo.matchCount}</span>
                </button>,
            );
        }
        if (!repoExpanded) continue;

        for (const file of repo.files) {
            const fileExpanded = !collapsed.has(file.key);
            nodes.push(
                <button
                    key={`file:${file.key}`}
                    type="button"
                    role="treeitem"
                    aria-level={fileLevel}
                    aria-expanded={fileExpanded}
                    aria-label={`${file.path}, ${file.matches.length} ${file.matches.length === 1 ? 'result' : 'results'}`}
                    tabIndex={0}
                    {...{ [TOGGLE_ATTRIBUTE]: 'file' }}
                    data-testid={`content-search-overlay-file-${file.key}`}
                    className={cn(
                        'w-full flex items-baseline gap-2 py-0.5 text-left text-xs',
                        showRepoLevel ? 'pl-6 pr-2' : 'px-2',
                    )}
                    onClick={() => onToggleGroup(file.key)}
                >
                    <span aria-hidden="true">{fileExpanded ? '▾' : '▸'}</span>
                    <span className="truncate">{file.path}</span>
                    <span className="text-[#616161] dark:text-[#a0a0a0]">
                        {file.matches.length}
                    </span>
                </button>,
            );
            if (!fileExpanded) continue;

            for (const match of file.matches) {
                const index = rowIndex;
                rowIndex += 1;
                nodes.push(
                    <button
                        key={match.id}
                        ref={(node) => {
                            rowRefs.current[index] = node;
                        }}
                        type="button"
                        role="treeitem"
                        aria-level={fileLevel + 1}
                        aria-selected={index === selected}
                        tabIndex={index === selected ? 0 : -1}
                        data-testid={`content-search-overlay-match-${match.id}`}
                        className={cn(
                            'w-full flex items-baseline gap-2 py-0.5 text-left text-xs',
                            showRepoLevel ? 'pl-10 pr-2' : 'pl-6 pr-2',
                            index === selected && 'bg-[#e8e8e8] dark:bg-[#37373d]',
                        )}
                        onClick={() => {
                            onSelect(index);
                            onOpenMatch(match);
                        }}
                    >
                        <span className="shrink-0 tabular-nums text-[#616161] dark:text-[#a0a0a0]">
                            {match.line}
                        </span>
                        <span className="truncate font-mono">{match.preview}</span>
                    </button>,
                );
            }
        }
    }

    return nodes;
}
