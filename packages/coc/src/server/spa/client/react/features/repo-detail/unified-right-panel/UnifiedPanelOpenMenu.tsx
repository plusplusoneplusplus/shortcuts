/**
 * UnifiedPanelOpenMenu — the searchable "+" menu of the unified right panel
 * (AC-03), replacing the shell's temporary action popover at the same
 * `onOpenMenu` seam.
 *
 * One popover, one cursor: file search results and resource actions (File via
 * search, New Terminal, Explorer, Notes, Canvas) share a single arrow-navigable
 * list built by `unifiedPanelOpenMenuModel`. There is no URL/browser input and
 * no blank "Diff" item — diffs arrive through existing diff links.
 *
 * What this component owns beyond rendering:
 *
 *  - **Search that behaves like QuickOpen's.** Nothing is fetched until the
 *    first keystroke (a repo's path list is megabytes and must never be pulled
 *    into the browser), typing is debounced, and each new query aborts the
 *    previous request. Highlights come from the server's `indices`, so the
 *    emphasis always shows the match the ranking used.
 *  - **A stale result can never open the wrong repo.** Changing the repo picker
 *    aborts the in-flight search before issuing the new one, and an aborted
 *    request's response is discarded — so switching repos mid-flight abandons
 *    the old results instead of listing files the user would then open in the
 *    repo they just left.
 *  - **Every state is visible.** Loading, empty query, no results, and a failed
 *    search (with Retry) are all rendered; an unavailable target disables the
 *    repo-bound actions with the reason rather than silently dropping them.
 *
 * Selection is handed back as an `OpenUnifiedTabInput` (files, canvases) or a
 * workspace-resource kind (terminal, explorer, notes); the panel owns the tab
 * session, so this component never touches it directly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasSummary } from '@plusplusoneplusplus/coc-client';
import { cn } from '../../../ui/cn';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { explorerApi } from '../explorer/explorerApi';
import { highlightMatches, splitIndices } from '../explorer/QuickOpen';
import type { DockTarget } from '../WorkspaceDockToggle';
import {
    buildOpenMenuItems,
    canvasOpenInput,
    fileOpenInput,
    firstOpenMenuIndex,
    nextOpenMenuIndex,
    openMenuActions,
    type OpenMenuCanvasResult,
    type OpenMenuFileResult,
    type OpenMenuItem,
} from './unifiedPanelOpenMenuModel';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

/** Results requested and rendered per query, matching QuickOpen. */
const RESULT_LIMIT = 50;
/** Typing pause before a search is issued, matching QuickOpen. */
const SEARCH_DEBOUNCE_MS = 40;

export interface UnifiedPanelOpenMenuProps {
    /** The panel's workspace: owns Notes, the chat, and the chat's canvases. */
    workspaceId: string;
    /** Selected chat, or null. Files/canvases open under it; gates Canvas. */
    chatId: string | null;
    /** The repo new resources and file search act on. */
    target: string;
    /** Point the menu (and the dock) at another repo. */
    onSelectTarget: (workspaceId: string) => void;
    /** Repo options for a group; a single-repo panel passes none. */
    targets?: readonly DockTarget[];
    /** Open a concrete resource — a searched file or a chat canvas. */
    onOpenResource: (input: OpenUnifiedTabInput) => void;
    /** Open one of the workspace-owned views against the current target. */
    onOpenWorkspaceResource: (kind: 'terminal' | 'explorer' | 'notes') => void;
    /** Dismiss the menu and hand focus back to the "+" trigger. */
    onClose: () => void;
}

export function UnifiedPanelOpenMenu({
    workspaceId,
    chatId,
    target,
    onSelectTarget,
    targets,
    onOpenResource,
    onOpenWorkspaceResource,
    onClose,
}: UnifiedPanelOpenMenuProps) {
    const [query, setQuery] = useState('');
    const [files, setFiles] = useState<readonly OpenMenuFileResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchError, setSearchError] = useState(false);
    const [canvases, setCanvases] = useState<readonly OpenMenuCanvasResult[]>([]);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [cursor, setCursor] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const targetOptions = targets ?? [];
    const targetOption = targetOptions.find(option => option.workspaceId === target);
    const targetUnavailable = targetOption?.disabled === true;

    const actions = useMemo(() => openMenuActions({
        targetWorkspaceId: target,
        chatId,
        ...(targetUnavailable
            ? { targetUnavailable, targetUnavailableReason: `${targetOption?.label ?? 'This repository'} is unavailable.` }
            : {}),
    }), [target, chatId, targetUnavailable, targetOption?.label]);

    const items = useMemo(
        () => buildOpenMenuItems({ actions, files, canvases, query }),
        [actions, files, canvases, query],
    );

    // The cursor is an index into a list that changes under it; re-seat it on
    // the first selectable row whenever the list is rebuilt.
    useEffect(() => {
        setCursor(firstOpenMenuIndex(items));
        // Only the identity of the list matters, not the cursor it re-seats.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items]);

    useEffect(() => {
        // Focus the search box on open: typing is the primary action, and the
        // trigger gets focus back on Escape.
        const raf = requestAnimationFrame(() => inputRef.current?.focus());
        return () => cancelAnimationFrame(raf);
    }, []);

    // The chat's canvases, listed once per chat. Best-effort: a failure leaves
    // the section empty rather than blocking the rest of the menu.
    useEffect(() => {
        if (chatId === null) {
            setCanvases([]);
            return;
        }
        let cancelled = false;
        getCocClientForWorkspace(workspaceId).canvases.list(workspaceId, { processId: chatId })
            .then((summaries: CanvasSummary[]) => {
                if (cancelled) return;
                setCanvases(summaries.map(summary => ({ id: summary.id, title: summary.title })));
            })
            .catch(() => {
                if (!cancelled) setCanvases([]);
            });
        return () => { cancelled = true; };
    }, [workspaceId, chatId]);

    // Debounced server-side search, one request in flight, scoped to the repo
    // that was the target when it was issued.
    const runSearch = useCallback((raw: string) => {
        const trimmed = raw.trim();
        abortRef.current?.abort();
        if (trimmed === '' || targetUnavailable) {
            setFiles([]);
            setLoading(false);
            setSearchError(false);
            return;
        }
        const abort = new AbortController();
        abortRef.current = abort;
        // The repo this request is for is captured here, not read back later:
        // the effect below re-runs on a target change, which aborts this
        // request first, so a superseded response can never be applied.
        const issuedFor = target;
        setLoading(true);
        setSearchError(false);
        explorerApi.searchFiles(issuedFor, trimmed, { limit: RESULT_LIMIT, signal: abort.signal })
            .then(data => {
                if (abort.signal.aborted) return;
                setFiles(data.results);
                setLoading(false);
            })
            .catch(() => {
                if (abort.signal.aborted) return;
                setFiles([]);
                setSearchError(true);
                setLoading(false);
            });
    }, [target, targetUnavailable]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const trimmed = query.trim();
        if (trimmed === '') {
            abortRef.current?.abort();
            setFiles([]);
            setLoading(false);
            setSearchError(false);
            return;
        }
        debounceRef.current = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, target, runSearch]);

    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        abortRef.current?.abort();
    }, []);

    useEffect(() => {
        const node = listRef.current?.children[cursor] as HTMLElement | undefined;
        node?.scrollIntoView?.({ block: 'nearest' });
    }, [cursor]);

    const ownerContext = useMemo(() => ({
        ownerWorkspaceId: target,
        scopeWorkspaceId: workspaceId,
        chatId,
        ...(targetOption?.label ? { ownerLabel: targetOption.label } : {}),
    }), [target, workspaceId, chatId, targetOption?.label]);

    const createCanvas = useCallback(async () => {
        if (chatId === null || creating) return;
        setCreating(true);
        setCreateError(null);
        try {
            const created = await getCocClientForWorkspace(workspaceId).canvases.create(workspaceId, {
                type: 'markdown',
                title: 'Untitled canvas',
                content: '',
                processId: chatId,
            });
            onOpenResource(canvasOpenInput({ id: created.id, title: created.title }, {
                ...ownerContext,
                // A canvas belongs to the chat's workspace, not to whichever
                // repo the terminal happens to point at.
                ownerWorkspaceId: workspaceId,
            }));
            onClose();
        } catch {
            setCreateError('Could not create the canvas. Try again.');
        } finally {
            setCreating(false);
        }
    }, [chatId, creating, workspaceId, ownerContext, onOpenResource, onClose]);

    const selectItem = useCallback((item: OpenMenuItem) => {
        if (item.type === 'file') {
            onOpenResource(fileOpenInput(item.file.path, ownerContext));
            onClose();
            return;
        }
        if (item.type === 'canvas') {
            onOpenResource(canvasOpenInput(item.canvas, { ...ownerContext, ownerWorkspaceId: workspaceId }));
            onClose();
            return;
        }
        if (item.action.disabled === true) return;
        if (item.action.id === 'canvas') {
            void createCanvas();
            return;
        }
        onOpenWorkspaceResource(item.action.id);
        onClose();
    }, [onOpenResource, onOpenWorkspaceResource, onClose, ownerContext, workspaceId, createCanvas]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setCursor(current => nextOpenMenuIndex(items, current, event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const item = items[cursor];
            if (item) selectItem(item);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        }
    }, [items, cursor, selectItem, onClose]);

    return (
        <div
            className={cn(
                'absolute right-1 top-[34px] z-20 flex w-[320px] max-w-[calc(100%-8px)] flex-col overflow-hidden',
                'rounded border border-[#c8c8c8] bg-white shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526]',
            )}
            role="dialog"
            aria-label="Open a resource"
            onKeyDown={handleKeyDown}
            data-testid="unified-panel-open-menu-popover"
        >
            {targetOptions.length > 1 && (
                <div className="flex items-center gap-1.5 border-b border-[#e5e5e5] px-2 py-1.5 dark:border-[#3c3c3c]">
                    <span className="text-[10px] uppercase tracking-wide text-[#8a8a8a]">Repo</span>
                    <select
                        className="min-w-0 flex-1 rounded border border-[#d0d0d0] bg-transparent px-1 py-0.5 text-xs text-[#1f1f1f] dark:border-[#3c3c3c] dark:text-[#cccccc]"
                        value={target}
                        onChange={event => onSelectTarget(event.target.value)}
                        data-testid="unified-panel-open-menu-repo"
                    >
                        {targetOptions.map(option => (
                            <option key={option.workspaceId} value={option.workspaceId}>
                                {option.label}{option.disabled ? ' (unavailable)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="flex items-center gap-1.5 border-b border-[#e5e5e5] px-2 py-1.5 dark:border-[#3c3c3c]">
                <span aria-hidden className="text-xs opacity-60">🔍</span>
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={targetUnavailable ? 'Repository unavailable' : 'Search files…'}
                    disabled={targetUnavailable}
                    aria-label="Search files"
                    className="min-w-0 flex-1 bg-transparent text-xs text-[#1f1f1f] outline-none placeholder-[#999] dark:text-[#cccccc] dark:placeholder-[#777]"
                    data-testid="unified-panel-open-menu-search"
                />
            </div>

            <div className="max-h-[300px] overflow-y-auto py-1" ref={listRef} data-testid="unified-panel-open-menu-list">
                {items.map((item, index) => {
                    const selected = index === cursor;
                    const rowClass = cn(
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs',
                        selected ? 'bg-[#0078d4]/10 dark:bg-[#0078d4]/25' : 'hover:bg-[#f0f0f0] dark:hover:bg-[#37373d]',
                    );
                    if (item.type === 'file') {
                        const matched = splitIndices(item.file.path, item.file.indices ?? []);
                        const name = resourceName(item.file.path);
                        const dir = resourceDir(item.file.path);
                        return (
                            <button
                                key={item.key}
                                type="button"
                                className={rowClass}
                                title={item.file.path}
                                onMouseEnter={() => setCursor(index)}
                                onClick={() => selectItem(item)}
                                data-testid={`unified-panel-open-menu-file-${index}`}
                            >
                                <span aria-hidden className="opacity-60">📄</span>
                                <span className="truncate text-[#1f1f1f] dark:text-[#cccccc]">
                                    {highlightMatches(name, matched.name)}
                                </span>
                                {dir && (
                                    <span className="ml-auto truncate text-[10px] text-[#8a8a8a]">
                                        {highlightMatches(dir, matched.dir)}
                                    </span>
                                )}
                            </button>
                        );
                    }
                    if (item.type === 'canvas') {
                        return (
                            <button
                                key={item.key}
                                type="button"
                                className={rowClass}
                                onMouseEnter={() => setCursor(index)}
                                onClick={() => selectItem(item)}
                                data-testid={`unified-panel-open-menu-canvas-${item.canvas.id}`}
                            >
                                <span aria-hidden className="opacity-60">🎨</span>
                                <span className="truncate text-[#1f1f1f] dark:text-[#cccccc]">{item.canvas.title}</span>
                            </button>
                        );
                    }
                    const disabled = item.action.disabled === true;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            disabled={disabled}
                            title={item.action.disabledReason}
                            className={cn(rowClass, disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent')}
                            onMouseEnter={() => { if (!disabled) setCursor(index); }}
                            onClick={() => selectItem(item)}
                            data-testid={`unified-panel-open-${item.action.id}`}
                        >
                            <span aria-hidden className="opacity-60">{ACTION_ICONS[item.action.id]}</span>
                            <span className="truncate text-[#1f1f1f] dark:text-[#cccccc]">
                                {item.action.id === 'canvas' && creating ? 'Creating canvas…' : item.action.label}
                            </span>
                            {disabled && item.action.disabledReason && (
                                <span className="ml-auto truncate text-[10px] text-[#8a8a8a]">{item.action.disabledReason}</span>
                            )}
                        </button>
                    );
                })}

                {loading && files.length === 0 && (
                    <div className="px-2.5 py-2 text-[11px] text-[#8a8a8a]" data-testid="unified-panel-open-menu-loading">
                        Searching files…
                    </div>
                )}
                {searchError && (
                    <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="unified-panel-open-menu-error">
                        <span>File search failed.</span>
                        <button
                            type="button"
                            className="underline"
                            onClick={() => runSearch(query)}
                            data-testid="unified-panel-open-menu-retry"
                        >
                            Retry
                        </button>
                    </div>
                )}
                {!loading && !searchError && query.trim() !== '' && files.length === 0 && (
                    <div className="px-2.5 py-2 text-[11px] text-[#8a8a8a]" data-testid="unified-panel-open-menu-no-results">
                        No matching files
                    </div>
                )}
                {createError && (
                    <div className="px-2.5 py-2 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="unified-panel-open-menu-create-error">
                        {createError}
                    </div>
                )}
            </div>
        </div>
    );
}

const ACTION_ICONS: Record<string, string> = {
    terminal: '▶',
    explorer: '🗂',
    notes: '🗒',
    canvas: '🎨',
};

function resourceName(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? path : path.slice(index + 1);
}

function resourceDir(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
}
