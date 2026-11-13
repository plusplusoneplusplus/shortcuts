/**
 * UnifiedPanelOpenMenu — the searchable "+" menu of the unified right panel
 * (AC-03), replacing the shell's temporary action popover at the same
 * `onOpenMenu` seam.
 *
 * One popover, one cursor: file search results and resource actions (File via
 * search, New Terminal, Explorer, Notes, Browser, Canvas, Changes) share a single
 * arrow-navigable list built by `unifiedPanelOpenMenuModel`. A query that is an
 * http(s) URL or bare domain adds an "Open in Browser" row; one written with
 * another scheme adds an inline "not supported" row. There is no blank "Diff"
 * item — diffs arrive through existing
 * diff links, except for Changes, which is listed only when the selected chat
 * has recorded a file change and opens that chat's whole-chat diff in one
 * reused tab.
 *
 * What this component owns beyond rendering:
 *
 *  - **Search that behaves like QuickOpen's.** Nothing is fetched until the
 *    first keystroke (a repo's path list is megabytes and must never be pulled
 *    into the browser), typing is debounced, and each new query aborts the
 *    previous request. Highlights come from the server's `indices`, so the
 *    emphasis always shows the match the ranking used.
 *  - **A stale result can never open the wrong repo.** The repo picker lives on
 *    the tab strip, outside this menu, and a switch there closes the menu
 *    outright. Even so, a target change aborts the in-flight search before
 *    issuing the new one and discards the aborted request's response, so a
 *    result can never be listed under a repo it was not searched in.
 *  - **Every state is visible.** Loading, empty query, no results, and a failed
 *    search (with Retry) are all rendered; an unavailable target disables the
 *    repo-bound actions with the reason rather than silently dropping them.
 *
 * Extensions is a submenu: hovering it, selecting it or ArrowRight on it shows
 * the workspace's discovered Copilot canvas extensions in a flyout beside the
 * menu; ArrowLeft or Escape leave it. Picking one opens its canvas in the
 * selected chat. A query in the main list also reaches matching extensions
 * directly.
 *
 * Selection is handed back as an `OpenUnifiedTabInput` (files, canvases,
 * changes) or a workspace-resource action (terminal, explorer, notes) — `explorer` toggles
 * the panel's file-tree column rather than opening a tab; the panel owns the tab
 * session, so this component never touches it directly.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CanvasSummary } from '@plusplusoneplusplus/coc-client';
import { cn } from '../../../ui/cn';
import { getCocClientForWorkspace, resolveCloneRoute } from '../../../repos/cloneRegistry';
import { isRepoGroupWorkspaceId } from '../../../repos/virtualWorkspaceIds';
import { desktopBrowserBridge, openUrlInSystemBrowser } from '../../../shared/file-path/browser-bridge';
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
    workResourceWebUrls,
    type OpenMenuActionId,
    type OpenMenuCanvasResult,
    type OpenMenuExtensionResult,
    type OpenMenuFileResult,
    type OpenMenuItem,
    type WorkResourceKind,
} from './unifiedPanelOpenMenuModel';
import { chatChangesTabInput, useUnifiedChatChanges } from './unifiedChatChanges';
import { browserOpenInput } from './unifiedBrowserTabs';
import { GIT_ICON, SETTINGS_ICON, TODO_ICON, PULL_REQUESTS_ICON } from './UnifiedPanelTabStrip';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';
import { formatCocAddress, type CocAddress } from './unifiedPanelAddresses';

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
    /** Concrete clone route for the target repo. */
    targetRoutingRef?: string | null;
    /** Repo options for a group; a single-repo panel passes none. */
    targets?: readonly DockTarget[];
    /** Open a concrete resource — a searched file or a chat canvas. */
    onOpenResource: (input: OpenUnifiedTabInput) => void;
    /** The selected chat is a Sentinel chat with a To-do; false hides the entry. */
    todoAvailable?: boolean;
    /** The panel's workspace owns a Settings page; see `openMenuActions`. */
    settingsAvailable?: boolean;
    /** The panel can host the target repo's Git tab; see `openMenuActions`. */
    gitAvailable?: boolean;
    /** Open one of the workspace-owned views against the current target. */
    onOpenWorkspaceResource: (action: 'git' | 'work-items' | 'pull-requests' | 'explorer' | 'notes') => void;
    /** Dismiss the menu and hand focus back to the "+" trigger. */
    onClose: () => void;
    /**
     * Open a `coc://` page — a typed address, or the Terminal, Settings and
     * To-do entries; a string is an inline error.
     */
    onOpenCocAddress: (address: CocAddress) => string | void;
}

export function UnifiedPanelOpenMenu({
    workspaceId,
    chatId,
    target,
    targetRoutingRef,
    targets,
    onOpenResource,
    todoAvailable = false,
    settingsAvailable = false,
    gitAvailable = false,
    onOpenWorkspaceResource,
    onClose,
    onOpenCocAddress,
}: UnifiedPanelOpenMenuProps) {
    const [query, setQuery] = useState('');
    const [files, setFiles] = useState<readonly OpenMenuFileResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchError, setSearchError] = useState(false);
    const [canvases, setCanvases] = useState<readonly OpenMenuCanvasResult[]>([]);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [cocError, setCocError] = useState<string | null>(null);
    useEffect(() => { setCocError(null); }, [query]);
    // The Extensions flyout: null when closed; `cursor` is -1 until the
    // keyboard moves into it.
    const [flyout, setFlyout] = useState<{ cursor: number } | null>(null);
    const [flyoutPosition, setFlyoutPosition] = useState<{ left: number; top: number } | null>(null);
    const [extensions, setExtensions] = useState<readonly OpenMenuExtensionResult[]>([]);
    const [openingExtension, setOpeningExtension] = useState<string | null>(null);
    const [extensionError, setExtensionError] = useState<string | null>(null);
    const [cursor, setCursor] = useState(0);
    const [webLookup, setWebLookup] = useState<{
        key: string;
        urls: Record<WorkResourceKind, string> | null;
        error?: string;
        routeKey?: string;
    } | null>(null);
    const [webAttempt, setWebAttempt] = useState(0);
    const [webOpenError, setWebOpenError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const extensionsRowRef = useRef<HTMLButtonElement | null>(null);
    const flyoutRef = useRef<HTMLDivElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const targetOptions = targets ?? [];
    const targetOption = targetOptions.find(option => option.workspaceId === target);
    const targetUnavailable = targetOption?.disabled === true;
    const webKey = JSON.stringify([target, targetRoutingRef === undefined ? ['automatic'] : targetRoutingRef]);
    const webEligible = !targetUnavailable && !isRepoGroupWorkspaceId(target);
    const webResult = webLookup?.key === webKey ? webLookup : null;

    useEffect(() => {
        if (!webEligible) {
            setWebLookup(null);
            return;
        }
        let cancelled = false;
        setWebOpenError(null);
        const owner = targetRoutingRef === undefined ? target : targetRoutingRef;
        void Promise.resolve().then(async () => {
            if (cancelled) return;
            const route = resolveCloneRoute(owner);
            if (route.kind === 'unresolved-remote') {
                if (!cancelled) setWebLookup({ key: webKey, urls: null, error: 'The owning remote server is unavailable.' });
                return;
            }
            const info = await getCocClientForWorkspace(owner).workspaces.gitInfo(target);
            if (cancelled) return;
            const current = resolveCloneRoute(owner);
            if (current.kind !== route.kind
                || (current.kind === 'remote' && route.kind === 'remote' && current.baseUrl !== route.baseUrl)) {
                setWebLookup({ key: webKey, urls: null, error: 'Repository connection changed. Try again.' });
                return;
            }
            const urls = workResourceWebUrls(info.remoteUrl);
            setWebLookup({ key: webKey, urls, routeKey: JSON.stringify(route), ...(urls ? {} : { error: 'No supported GitHub or Azure DevOps remote found.' }) });
        }).catch(() => {
            if (!cancelled) setWebLookup({ key: webKey, urls: null, error: 'Could not read the repository remote. Try again.' });
        });
        return () => { cancelled = true; };
    }, [target, targetRoutingRef, webEligible, webKey, webAttempt]);

    // The selected chat's own recorded edits, published by its transcript. Read
    // live rather than fetched: the entry has to appear the moment the first
    // edit of a streaming turn completes, with the menu already open.
    const chatChanges = useUnifiedChatChanges(workspaceId, chatId);

    const actions = useMemo(() => openMenuActions({
        targetWorkspaceId: target,
        chatId,
        chatHasChanges: chatChanges !== null,
        todoAvailable,
        settingsAvailable,
        gitAvailable,
        extensionsAvailable: extensions.length > 0,
        ...(webEligible ? { webUnavailableReason: webResult?.error ?? (webResult ? undefined : 'Loading repository…') } : {}),
        ...(targetUnavailable
            ? { targetUnavailable, targetUnavailableReason: `${targetOption?.label ?? 'This repository'} is unavailable.` }
            : {}),
    }), [target, chatId, chatChanges, todoAvailable, settingsAvailable, gitAvailable, extensions.length, targetUnavailable, targetOption?.label, webEligible, webResult]);

    // Extensions open in a chat, so without one they are not offered at all.
    const items = useMemo(
        () => buildOpenMenuItems({ actions, files, canvases, extensions: chatId === null ? [] : extensions, query }),
        [actions, files, canvases, extensions, chatId, query],
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

    // The workspace's discovered extensions, listed once per workspace. The
    // server answers from discovery alone, so this never starts an extension.
    // Best-effort like canvases: a failure (or a server without the route)
    // just leaves the Extensions entry out.
    useEffect(() => {
        let cancelled = false;
        Promise.resolve()
            .then(() => getCocClientForWorkspace(workspaceId).canvases.listCopilotExtensions(workspaceId))
            .then(list => {
                if (!cancelled) setExtensions(list.map(({ extensionKey, name, description }) => ({ extensionKey, name, description })));
            })
            .catch(() => {
                if (!cancelled) setExtensions([]);
            });
        return () => { cancelled = true; };
    }, [workspaceId]);

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
        explorerApi.searchFiles(
            issuedFor,
            trimmed,
            { limit: RESULT_LIMIT, signal: abort.signal },
            targetRoutingRef,
        )
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
    }, [target, targetRoutingRef, targetUnavailable]);

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
        ...(targetRoutingRef === undefined ? {} : { ownerRoutingRef: targetRoutingRef }),
        scopeWorkspaceId: workspaceId,
        chatId,
        ...(targetOption?.label ? { ownerLabel: targetOption.label } : {}),
    }), [target, targetRoutingRef, workspaceId, chatId, targetOption?.label]);

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

    const openFlyout = useCallback((cursor: number) => {
        setFlyout(current => (current && cursor < 0 ? current : { cursor }));
    }, []);
    const closeFlyout = useCallback(() => {
        setFlyout(null);
        setExtensionError(null);
    }, []);
    // Typing changes the list under the flyout, and a list without the
    // Extensions row has nothing to hang it from.
    const extensionsListed = items.some(item => item.type === 'action'
        && item.action.id === 'extensions' && item.action.disabled !== true);
    useEffect(() => { closeFlyout(); }, [query, closeFlyout]);
    useEffect(() => { if (!extensionsListed) closeFlyout(); }, [extensionsListed, closeFlyout]);
    const flyoutOpen = flyout !== null;

    // Beside the menu, level with its row: left when there is room (the "+"
    // sits at the panel's right edge), otherwise right; kept on screen.
    useLayoutEffect(() => {
        if (!flyoutOpen) {
            setFlyoutPosition(null);
            return;
        }
        const row = extensionsRowRef.current?.getBoundingClientRect();
        const popover = popoverRef.current?.getBoundingClientRect();
        const box = flyoutRef.current?.getBoundingClientRect();
        if (!row || !popover) return;
        const width = box?.width || FLYOUT_WIDTH;
        const height = box?.height ?? 0;
        const left = popover.left - width - FLYOUT_GAP >= FLYOUT_MARGIN
            ? popover.left - width - FLYOUT_GAP
            : Math.min(popover.right + FLYOUT_GAP, window.innerWidth - width - FLYOUT_MARGIN);
        const top = Math.max(FLYOUT_MARGIN, Math.min(row.top - 4, window.innerHeight - height - FLYOUT_MARGIN));
        setFlyoutPosition(current => (current?.left === left && current.top === top ? current : { left, top }));
    }, [flyoutOpen, extensions, openingExtension, extensionError]);

    const openExtension = useCallback(async (extension: OpenMenuExtensionResult) => {
        if (chatId === null || openingExtension !== null) return;
        setOpeningExtension(extension.extensionKey);
        setExtensionError(null);
        try {
            const opened = await getCocClientForWorkspace(workspaceId).canvases.openCopilotExtensionByKey(workspaceId, {
                processId: chatId,
                extensionKey: extension.extensionKey,
            });
            // Like a new canvas, the record belongs to the chat's workspace.
            onOpenResource(canvasOpenInput({ id: opened.canvasId, title: opened.title }, {
                ...ownerContext,
                ownerWorkspaceId: workspaceId,
            }));
            onClose();
        } catch {
            setExtensionError(`Could not open ${extension.name}. Try again.`);
        } finally {
            setOpeningExtension(null);
        }
    }, [chatId, openingExtension, workspaceId, ownerContext, onOpenResource, onClose]);

    // A browser tab is owned by the target's concrete workspace — the identity
    // its temporary site session is keyed by.
    const browserContext = useMemo(() => ({
        ownerWorkspaceId: target,
        ...(targetRoutingRef === undefined ? {} : { ownerRoutingRef: targetRoutingRef }),
        chatId,
        ...(target !== workspaceId && targetOption?.label ? { repoLabel: targetOption.label } : {}),
    }), [target, targetRoutingRef, chatId, workspaceId, targetOption?.label]);

    const selectItem = useCallback((item: OpenMenuItem) => {
        if (item.type === 'url-error') return;
        if (item.type === 'coc') {
            const failure = onOpenCocAddress(item.address);
            if (failure) setCocError(failure);
            else onClose();
            return;
        }
        if (item.type === 'url') {
            onOpenResource(browserOpenInput(browserContext, item.url));
            onClose();
            return;
        }
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
        if (item.type === 'extension') {
            void openExtension(item.extension);
            return;
        }
        if (item.action.disabled === true) return;
        if (item.action.id === 'work-items' || item.action.id === 'pull-requests') {
            const url = webResult?.urls?.[item.action.id];
            if (!url) return;
            const route = resolveCloneRoute(targetRoutingRef === undefined ? target : targetRoutingRef);
            if (JSON.stringify(route) !== webResult?.routeKey) {
                setWebLookup({ key: webKey, urls: null, error: 'Repository connection changed. Try again.' });
                return;
            }
            setWebOpenError(null);
            if (desktopBrowserBridge()) {
                onOpenResource(browserOpenInput(browserContext, url));
                onClose();
            } else {
                void openUrlInSystemBrowser(url).then(opened => {
                    if (opened) onClose();
                    else setWebOpenError('Could not open the provider page. Try again.');
                });
            }
            return;
        }
        if (item.action.id === 'coc-work-items' || item.action.id === 'coc-pull-requests') {
            onOpenWorkspaceResource(item.action.id === 'coc-work-items' ? 'work-items' : 'pull-requests');
            onClose();
            return;
        }
        if (item.action.id === 'extensions') {
            openFlyout(0);
            return;
        }
        if (item.action.id === 'canvas') {
            void createCanvas();
            return;
        }
        if (item.action.id === 'browser') {
            onOpenResource(browserOpenInput(browserContext));
            onClose();
            return;
        }
        if (item.action.id === 'changes') {
            // The entry only exists with a context and a chat, but both are
            // read again here: the publish could have been withdrawn between
            // the render and the click.
            if (chatChanges === null || chatId === null) return;
            onOpenResource(chatChangesTabInput({
                changes: chatChanges,
                // The edits are against the clone the transcript recorded, not
                // whichever repo the picker happens to point at.
                ownerWorkspaceId: chatChanges.ctx.workspaceId ?? workspaceId,
                chatId,
                ...(targetOption?.label ? { repoLabel: targetOption.label } : {}),
            }));
            onClose();
            return;
        }
        const id = item.action.id;
        if (id === 'terminal' || id === 'settings' || id === 'todo' || id === 'notes') {
            const failure = onOpenCocAddress({ kind: id });
            if (failure) setCocError(failure);
            else onClose();
            return;
        }
        onOpenWorkspaceResource(id);
        onClose();
    }, [onOpenResource, onOpenWorkspaceResource, onOpenCocAddress, onClose, ownerContext, browserContext, workspaceId, createCanvas, openExtension, openFlyout, chatChanges, chatId, targetOption?.label, webResult, target, targetRoutingRef, webKey]);

    const flyoutExtensions = chatId === null ? [] : extensions;

    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
        // Inside the flyout the arrows walk the extensions; ArrowLeft and
        // Escape step back to the Extensions row before Escape closes the menu.
        if (flyout && flyout.cursor >= 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const count = flyoutExtensions.length;
                if (count > 0) setFlyout({ cursor: (flyout.cursor + (event.key === 'ArrowDown' ? 1 : -1) + count) % count });
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                const extension = flyoutExtensions[flyout.cursor];
                if (extension) void openExtension(extension);
                return;
            }
            if (event.key === 'ArrowLeft' || event.key === 'Escape') {
                event.preventDefault();
                closeFlyout();
                return;
            }
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            closeFlyout();
            setCursor(current => nextOpenMenuIndex(items, current, event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const item = items[cursor];
            if (item) selectItem(item);
        } else if (event.key === 'ArrowRight') {
            const item = items[cursor];
            if (item?.type === 'action' && item.action.id === 'extensions' && item.action.disabled !== true) {
                event.preventDefault();
                openFlyout(0);
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            if (flyout) closeFlyout();
            else onClose();
        }
    }, [items, cursor, selectItem, onClose, flyout, flyoutExtensions, openExtension, openFlyout, closeFlyout]);

    return (
        <div
            className={cn(
                'absolute right-1 top-[34px] z-20 flex w-[320px] max-w-[calc(100%-8px)] flex-col overflow-hidden',
                'rounded border border-[#c8c8c8] bg-white shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526]',
            )}
            role="dialog"
            aria-label="Open a resource"
            ref={popoverRef}
            onKeyDown={handleKeyDown}
            data-testid="unified-panel-open-menu-popover"
        >
            <div className="flex items-center gap-1.5 border-b border-[#e5e5e5] px-2 py-1.5 dark:border-[#3c3c3c]">
                <span aria-hidden className="text-xs opacity-60">🔍</span>
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={targetUnavailable ? 'Repository unavailable' : 'Search files or paste a URL…'}
                    disabled={targetUnavailable}
                    aria-label="Search files"
                    className="min-w-0 flex-1 bg-transparent text-xs text-[#1f1f1f] outline-none placeholder-[#999] dark:text-[#cccccc] dark:placeholder-[#777]"
                    data-testid="unified-panel-open-menu-search"
                />
            </div>

            <div className="max-h-[300px] overflow-y-auto py-1" ref={listRef} data-testid="unified-panel-open-menu-list">
                {items.map((item, index) => {
                    const selected = index === cursor;
                    // The row owns the foreground so monochrome icons (currentColor
                    // SVGs, ▶, ±) inherit the theme color instead of the button
                    // default, which is black and unreadable on the dark popover.
                    const rowClass = cn(
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[#1f1f1f] dark:text-[#cccccc]',
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
                                onMouseEnter={() => { setCursor(index); closeFlyout(); }}
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
                    if (item.type === 'url') {
                        return (
                            <button
                                key={item.key}
                                type="button"
                                className={rowClass}
                                title={item.url}
                                onMouseEnter={() => { setCursor(index); closeFlyout(); }}
                                onClick={() => selectItem(item)}
                                data-testid="unified-panel-open-menu-url"
                            >
                                <span aria-hidden className="opacity-60">{ACTION_ICONS.browser}</span>
                                <span className="truncate text-[#1f1f1f] dark:text-[#cccccc]">Open {item.url}</span>
                                <span className="ml-auto flex-shrink-0 text-[10px] text-[#8a8a8a]">Browser</span>
                            </button>
                        );
                    }
                    if (item.type === 'coc') {
                        const text = formatCocAddress(item.address);
                        return (
                            <button
                                key={item.key}
                                type="button"
                                className={rowClass}
                                title={text}
                                onMouseEnter={() => { setCursor(index); closeFlyout(); }}
                                onClick={() => selectItem(item)}
                                data-testid="unified-panel-open-menu-coc"
                            >
                                <span className="truncate text-[#1f1f1f] dark:text-[#cccccc]">Open {text}</span>
                            </button>
                        );
                    }
                    if (item.type === 'url-error') {
                        return (
                            <div
                                key={item.key}
                                role="alert"
                                className="px-2.5 py-1.5 text-[11px] text-[#a1260d] dark:text-[#f48771]"
                                data-testid="unified-panel-open-menu-url-error"
                            >
                                {item.reason}
                            </div>
                        );
                    }
                    if (item.type === 'canvas') {
                        return (
                            <button
                                key={item.key}
                                type="button"
                                className={rowClass}
                                onMouseEnter={() => { setCursor(index); closeFlyout(); }}
                                onClick={() => selectItem(item)}
                                data-testid={`unified-panel-open-menu-canvas-${item.canvas.id}`}
                            >
                                <span aria-hidden className="opacity-60">🎨</span>
                                <span className="truncate text-[#1f1f1f] dark:text-[#cccccc]">{item.canvas.title}</span>
                            </button>
                        );
                    }
                    if (item.type === 'extension') {
                        const opening = openingExtension === item.extension.extensionKey;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                className={rowClass}
                                title={item.extension.description}
                                onMouseEnter={() => { setCursor(index); closeFlyout(); }}
                                onClick={() => selectItem(item)}
                                data-testid={`unified-panel-open-menu-extension-${item.extension.extensionKey}`}
                            >
                                <span aria-hidden className="opacity-60">{ACTION_ICONS.extensions}</span>
                                <span className="flex-shrink-0 text-[#1f1f1f] dark:text-[#cccccc]">
                                    {opening ? `Opening ${item.extension.name}…` : item.extension.name}
                                </span>
                                {item.extension.description && (
                                    <span className="ml-auto truncate text-[10px] text-[#8a8a8a]">{item.extension.description}</span>
                                )}
                            </button>
                        );
                    }
                    const disabled = item.action.disabled === true;
                    const isExtensions = item.action.id === 'extensions';
                    return (
                        <button
                            key={item.key}
                            ref={isExtensions ? extensionsRowRef : undefined}
                            type="button"
                            disabled={disabled}
                            title={item.action.disabledReason}
                            aria-haspopup={isExtensions ? 'menu' : undefined}
                            aria-expanded={isExtensions ? flyout !== null : undefined}
                            className={cn(rowClass, disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent')}
                            onMouseEnter={() => {
                                if (disabled) return;
                                setCursor(index);
                                if (isExtensions) openFlyout(-1);
                                else closeFlyout();
                            }}
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
                            {!disabled && item.action.hint && (
                                <span className="ml-auto text-[10px] text-[#8a8a8a]">{item.action.hint}</span>
                            )}
                            {!disabled && item.action.id === 'extensions' && (
                                <span aria-hidden className="ml-auto text-[#8a8a8a]">›</span>
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
                {extensionError && !flyout && (
                    <div className="px-2.5 py-2 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="unified-panel-open-menu-extension-error">
                        {extensionError}
                    </div>
                )}
                {cocError && (
                    <div role="alert" className="px-2.5 py-2 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="unified-panel-open-menu-coc-error">
                        {cocError}
                    </div>
                )}
                {createError && (
                    <div className="px-2.5 py-2 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="unified-panel-open-menu-create-error">
                        {createError}
                    </div>
                )}
                {(webResult?.error || webOpenError) && (
                    <div role="alert" className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="unified-panel-open-menu-web-error">
                        <span>{webOpenError ?? webResult?.error}</span>
                        {webResult?.error && <button type="button" className="underline" onClick={() => {
                            setWebLookup(null);
                            setWebAttempt(value => value + 1);
                        }}>Retry</button>}
                    </div>
                )}
            </div>

            {flyout && (
                <div
                    ref={flyoutRef}
                    role="menu"
                    aria-label="Extensions"
                    data-testid="unified-panel-open-menu-extensions-flyout"
                    style={{ left: flyoutPosition?.left ?? 0, top: flyoutPosition?.top ?? 0, width: FLYOUT_WIDTH }}
                    className={cn(
                        'fixed z-30 max-h-[300px] overflow-y-auto rounded border border-[#c8c8c8] bg-white py-1 shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526]',
                        !flyoutPosition && 'invisible',
                    )}
                >
                    {flyoutExtensions.map((extension, index) => {
                        const opening = openingExtension === extension.extensionKey;
                        return (
                            <button
                                key={extension.extensionKey}
                                type="button"
                                role="menuitem"
                                title={extension.description}
                                onMouseEnter={() => setFlyout({ cursor: index })}
                                onClick={() => void openExtension(extension)}
                                className={cn(
                                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[#1f1f1f] dark:text-[#cccccc]',
                                    index === flyout.cursor ? 'bg-[#0078d4]/10 dark:bg-[#0078d4]/25' : 'hover:bg-[#f0f0f0] dark:hover:bg-[#37373d]',
                                )}
                                data-testid={`unified-panel-open-menu-extension-${extension.extensionKey}`}
                            >
                                <span aria-hidden className="opacity-60">{ACTION_ICONS.extensions}</span>
                                <span className="flex-shrink-0">{opening ? `Opening ${extension.name}…` : extension.name}</span>
                                {extension.description && (
                                    <span className="ml-auto truncate text-[10px] text-[#8a8a8a]">{extension.description}</span>
                                )}
                            </button>
                        );
                    })}
                    {extensionError && (
                        <div className="px-2.5 py-2 text-[11px] text-[#a1260d] dark:text-[#f48771]" data-testid="unified-panel-open-menu-extension-error">
                            {extensionError}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

const FLYOUT_WIDTH = 260;
const FLYOUT_GAP = 2;
const FLYOUT_MARGIN = 4;

/** Keyed by action id so a new action cannot ship without a leading icon. */
const ACTION_ICONS: Readonly<Record<OpenMenuActionId, ReactNode>> = {
    'work-items': TODO_ICON,
    'pull-requests': PULL_REQUESTS_ICON,
    'coc-work-items': TODO_ICON,
    'coc-pull-requests': PULL_REQUESTS_ICON,
    settings: SETTINGS_ICON,
    terminal: '▶',
    git: GIT_ICON,
    explorer: '🗂',
    notes: '🗒',
    browser: '🌐',
    canvas: '🎨',
    extensions: '🧩',
    changes: '±',
    todo: TODO_ICON,
};

function resourceName(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? path : path.slice(index + 1);
}

function resourceDir(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
}
