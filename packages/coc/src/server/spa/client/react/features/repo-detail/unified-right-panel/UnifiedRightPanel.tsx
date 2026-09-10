/**
 * UnifiedRightPanel — the workspace's one and only right-side surface.
 *
 * One column, one tab strip, one visible view: every terminal, file, note,
 * canvas and diff a workspace opens on the right lands here as a tab, and
 * selecting one swaps its content in place. The tab session itself
 * (ownership, identity, order, persistence) lives in `useUnifiedPanelTabs`;
 * this component is the shell around it.
 *
 * Three things the shell is responsible for and the model is not:
 *
 *  - **Keep-alive.** A view is mounted the first time its tab becomes active and
 *    then stays mounted, hidden with `display:none`. That is what keeps a
 *    PTY, a scrollback, and an
 *    unsaved buffer alive across tab switches and a collapse. The flip side is
 *    just as load-bearing: a view is NOT mounted merely because its tab was
 *    restored from localStorage, so a reload never spawns a terminal the user
 *    did not ask for.
 *  - **Collapse ≠ close.** Collapsing hides the column (again `display:none`,
 *    not an unmount): tabs, drafts, and sessions all survive, and the external
 *    dock toggle reopens it. Closing the last tab leaves an empty panel with an
 *    "Open…" action rather than auto-creating anything.
 *  - **Width.** One workspace-scoped width, clamped so the central chat keeps at
 *    least `DOCK_MIN_CHAT_WIDTH`. It comes from the existing
 *    `useWorkspaceDock` controller, which also owns the header toggle's open
 *    bit — the panel does not persist a width of its own.
 *  - **The toolbar row.** Directly under the strip, and only while a file tab
 *    is active: breadcrumbs for that file. Other kinds keep rendering their
 *    own toolbars inside their own views.
 *  - **The preview slot.** A single click in the tree opens into the section's
 *    one replaceable, italic preview tab; every other entry point — `+`, a chat
 *    source link, a note link, a double click — opens a permanent tab. The
 *    rules live in `unifiedPanelTabsModel`; what the shell adds is the guard,
 *    because reusing the slot destroys a buffer exactly as a close does.
 *  - **The Search/Explorer navigator.** The selected mode is pinned to the
 *    panel's right edge beside the resource view. Both bodies use the dock
 *    target, share one panel-scope width, and stay mounted after first use.
 *    The navigator gives up width before the resource view does.
 *
 * Closing is guarded rather than immediate where a close would destroy something
 * (AC-05). A terminal tab with live sessions asks before ending them; a file tab
 * with unsaved edits raises the Explorer's own Save / Don't Save / Cancel
 * prompt. Both guards share one rule: cancel changes nothing, and an action that
 * fails keeps the tab with a visible error instead of pretending it worked.
 *
 * Resource views are reused as-is and live in `UnifiedTabView`; their own
 * toolbars render below the strip rather than portaling into it, so the strip
 * stays the panel's only tab row. The shell keeps the per-tab dirty and error
 * state those views report, because a hidden tab's unsaved edits or failed read
 * have to be visible in the strip rather than only in the view itself.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../ui/cn';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import { DOCK_MIN_WIDTH, type DockTarget } from '../WorkspaceDockToggle';
import type { WorkspaceDockController } from '../useWorkspaceDock';
import { ExplorerCloseTabsDialog } from '../explorer/ExplorerCloseTabsDialog';
import { ContentSearchPanel } from '../explorer/ContentSearchPanel';
import { ExplorerPanel, getAncestorPaths } from '../explorer/ExplorerPanel';
import { useExplorerExpandedPaths, useExplorerSelectedPath } from '../explorer/explorerStateStore';
import { QuickOpen, type QuickOpenResult } from '../explorer/QuickOpen';
import { ExactOpen, TRUSTED_PATH_PREFIX, fileName as trustedFileName } from '../explorer/ExactOpen';
import {
    explorerQuickOpenHasFocus,
    isExplorerQuickOpenMounted,
    quickOpenOwner,
    quickOpenShortcut,
} from './quickOpenRouting';
import { closeTabOutcome, closeTabShortcut } from './closeTabRouting';
import { explorerFileTabInput } from './unifiedExplorerFiles';
import {
    UNIFIED_TREE_MIN_WIDTH,
    clampUnifiedTreeWidth,
    isUnifiedTreeVisible,
    maxUnifiedTreeWidth,
    useUnifiedPanelTree,
} from './unifiedPanelTree';
import { UnifiedPanelCloseConfirm } from './UnifiedPanelCloseConfirm';
import { UnifiedPanelOpenMenu } from './UnifiedPanelOpenMenu';
import { UnifiedPanelTabStrip } from './UnifiedPanelTabStrip';
import { UnifiedPanelToolbar } from './UnifiedPanelToolbar';
import { breadcrumbFolderPath, unifiedToolbarBreadcrumbs } from './unifiedPanelBreadcrumbs';
import { UnifiedTabView } from './UnifiedTabView';
import { migrateUnifiedPanelState } from './unifiedPanelStore';
import { useUnifiedPanelTabs } from './useUnifiedPanelTabs';
import {
    liveTerminalSessionIds,
    terminalCloseConfirmMessage,
    terminateTerminalSessions,
    type UnifiedTerminalSession,
} from './unifiedTerminalClose';
import {
    DIRTY_CLOSE_SAVE_FAILED,
    dirtyCloseLabel,
    needsDirtyCloseConfirm,
} from './unifiedDirtyClose';
import type { OpenUnifiedPreviewTabInput, OpenUnifiedTabInput } from './unifiedPanelTabsModel';
import { getRepoGroup } from '../../../repos/repoGroupService';
import {
    activateWorkspaceRouteForBaseUrl,
    hasWorkspaceRouteForBaseUrl,
} from '../../../repos/cloneRegistry';

export interface UnifiedRightPanelProps {
    /**
     * The panel's *scope*: which workspace owns its tab session, its open flag,
     * and its width — and which workspace Notes belongs to.
     */
    workspaceId: string;
    /**
     * The selected chat, or null when none is. Chat-owned tabs (file, canvas,
     * diff) are filed under it; workspace tabs stay visible either way.
     */
    chatId?: string | null;
    /** Open/width/resize + the target workspace new resources open against. */
    dock: WorkspaceDockController;
    /** Target options for repo groups; the "+" menu picks among them. */
    targets?: readonly DockTarget[];
    /** Group-owner context for group-wide Quick Open. */
    repoGroup?: {
        id: string;
        name: string;
        liveRepoCount: number;
        baseUrl?: string;
    };
}

export function UnifiedRightPanel({ workspaceId, chatId = null, dock, targets, repoGroup }: UnifiedRightPanelProps) {
    const { isOpen, mode, target, width, maxWidth, isDragging, handleMouseDown, handleTouchStart } = dock;
    const {
        tabs, activeId, active, open, openPreview, previewToReplace, promote, activate, close, move,
    } = useUnifiedPanelTabs(workspaceId, chatId);

    // Views mounted so far, by tab id. A tab enters this set when it first
    // becomes active and stays until it is closed — that is the keep-alive that
    // holds PTYs and unsaved buffers across tab and chat switches, and the
    // "active only" entry condition is what stops a restored terminal
    // descriptor from spawning a session nobody asked for.
    const [mountedIds, setMountedIds] = useState<ReadonlySet<string>>(() => new Set());
    useEffect(() => {
        if (activeId === null || !isOpen) return;
        setMountedIds(prev => (prev.has(activeId) ? prev : new Set(prev).add(activeId)));
    }, [activeId, isOpen]);

    // Tabs whose views are live right now: mounted, and still visible from this
    // chat. Dropping the invisible ones is what makes a chat switch swap the
    // chat-owned views without disturbing the workspace ones.
    const mountedTabs = useMemo(
        () => tabs.filter(tab => mountedIds.has(tab.id)),
        [tabs, mountedIds],
    );

    const targetOptions = targets ?? dock.targets;
    const targetLabel = useMemo(
        () => targetOptions.find(option => option.workspaceId === target)?.label,
        [targetOptions, target],
    );

    // New workspace resources open against the dock's current target, and carry
    // a repo label when that is not the panel's own workspace (a group member or
    // a remote clone) so two same-named tabs stay tellable apart.
    const openWorkspaceResource = useCallback((kind: 'terminal' | 'notes') => {
        const owner = kind === 'notes' ? workspaceId : target;
        open({
            kind,
            ownerWorkspaceId: owner,
            chatId,
            resourceId: kind,
            label: kind === 'terminal' ? 'Terminal' : 'Notes',
            ...(owner === workspaceId || !targetLabel ? {} : { repoLabel: targetLabel }),
        });
    }, [open, workspaceId, target, targetLabel, chatId]);

    // ------------------------------------------------------------------
    // The Search/Explorer navigator (AC-01)
    // ------------------------------------------------------------------

    // Panel-level, not per-tab: the navigator width stays put across tab
    // switches, mode switches, a collapse, and a reload.
    const tree = useUnifiedPanelTree(workspaceId);

    // Bring an older persisted layout up to the current codec, once per panel
    // scope. It runs in an effect rather than in the store's read because it
    // writes: an `explorer` tab from the previous version restores as "open the
    // tree column" instead of as a tab. Reads already tolerate the old payload,
    // so the first render is correct either way.
    useEffect(() => {
        migrateUnifiedPanelState(workspaceId);
    }, [workspaceId]);
    const modeColumnVisible = isUnifiedTreeVisible({ ...tree.state, open: true }, width);

    // The column's drag. It is deliberately given no `storageKey`: the width
    // lives in the existing panel navigator store, and two localStorage owners
    // for one number would drift. The drag runs uncommitted and writes back
    // when it ends.
    const treeResize = useResizablePanel({
        initialWidth: tree.state.width,
        minWidth: UNIFIED_TREE_MIN_WIDTH,
        maxWidth: maxUnifiedTreeWidth(width),
        direction: 'right',
    });
    const treeDragged = useRef(false);
    useEffect(() => {
        if (treeResize.isDragging) {
            treeDragged.current = true;
            return;
        }
        if (!treeDragged.current) return;
        treeDragged.current = false;
        tree.setWidth(treeResize.width);
    }, [treeResize.isDragging, treeResize.width, tree]);

    // What the column actually renders at: the live drag width, clamped against
    // the panel's current width so the active view keeps its minimum. A panel
    // dragged narrow shrinks the navigator first, and below the point where both
    // fit `modeColumnVisible` hides it.
    const treeWidth = clampUnifiedTreeWidth(treeResize.width, width);
    const [mountedModes, setMountedModes] = useState<ReadonlySet<typeof mode>>(() => new Set([mode]));
    useEffect(() => {
        if (!isOpen) return;
        setMountedModes(prev => (prev.has(mode) ? prev : new Set(prev).add(mode)));
    }, [isOpen, mode]);

    // A file picked in the tree opens a panel tab; that flow needs the close
    // guard's dirty state, so `openTreeFile` is defined with it further down.

    // ------------------------------------------------------------------
    // The toolbar row (AC-02)
    // ------------------------------------------------------------------

    // Breadcrumbs exist for file tabs only; every other kind brings its own
    // toolbar. A null here removes the row entirely.
    const toolbar = useMemo(() => unifiedToolbarBreadcrumbs(active, target), [active, target]);

    // Breadcrumb clicks drive the tree column through the Explorer's own
    // per-workspace state, the same store the column reads — so a click reveals
    // the folder without a second selection model and without touching tabs.
    const [, setTreeSelectedPath] = useExplorerSelectedPath(target);
    const [, setTreeExpandedPaths] = useExplorerExpandedPaths(target);
    const revealTreeFolder = useCallback((segmentIndex: number) => {
        const folder = breadcrumbFolderPath(toolbar?.segments ?? [], segmentIndex);
        if (folder === null) {
            // The root crumb: clear the selection, leave the expansion alone.
            setTreeSelectedPath(null);
            return;
        }
        setTreeSelectedPath(folder);
        // Expand the folder AND its ancestors: a row nobody can see is not a
        // reveal, and the tree lazy-loads each level as it renders.
        setTreeExpandedPaths(prev => new Set([...prev, ...getAncestorPaths(folder), folder]));
    }, [toolbar, setTreeSelectedPath, setTreeExpandedPaths]);

    // What the tree column should track (AC-06). The toolbar model already
    // decides whether the active file's path resolves inside the tree on screen,
    // so tracking reuses that answer rather than restating the rule: a file tab
    // the tree can show reveals it, a file tab it cannot (another clone, a
    // trusted absolute path) drops the highlight, and any other kind — or no
    // tabs at all — leaves the tree exactly where it is.
    const trackedTreeFile = useMemo<string | null | undefined>(() => {
        if (toolbar === null) return undefined;
        return toolbar.interactive ? toolbar.path : null;
    }, [toolbar]);

    // Per-tab dirty / error state, reported by the views. It lives here rather
    // than in each view because the strip has to show it for tabs that are not
    // the visible one — an unsaved buffer or a failed read behind another tab is
    // exactly the state a user cannot otherwise find.
    const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
    const [errorIds, setErrorIds] = useState<ReadonlySet<string>>(() => new Set());
    const setFlag = useCallback(
        (update: (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void, id: string, on: boolean) => {
            update(prev => {
                if (prev.has(id) === on) return prev;
                const next = new Set(prev);
                if (on) next.add(id); else next.delete(id);
                return next;
            });
        },
        [],
    );
    const handleDirtyChange = useCallback(
        (id: string, isDirty: boolean) => {
            setFlag(setDirtyIds, id, isDirty);
            // Typing into a preview keeps it (AC-04). The edit is the strongest
            // possible statement that this file is not a glance, and a preview
            // holding unsaved work would be one tree click from a close prompt.
            // `promote` is a no-op for a tab that is already permanent, so this
            // costs a lookup on every later dirty report and nothing else.
            if (isDirty) promote(id);
        },
        [setFlag, promote],
    );
    const handleErrorChange = useCallback(
        (id: string, hasError: boolean) => setFlag(setErrorIds, id, hasError),
        [setFlag],
    );

    // ------------------------------------------------------------------
    // Close guard (AC-05)
    // ------------------------------------------------------------------

    // What each terminal tab currently has running. The terminal view reports
    // it because the tab's ✕ lives in the strip, outside that view — without
    // this the panel would either kill PTYs silently or prompt about a tab that
    // holds nothing but tombstones.
    const [terminalSessions, setTerminalSessions] = useState<Record<string, readonly UnifiedTerminalSession[]>>({});
    const handleTerminalSessions = useCallback(
        (tabId: string, sessions: readonly UnifiedTerminalSession[]) => {
            setTerminalSessions(prev => (prev[tabId] === sessions ? prev : { ...prev, [tabId]: sessions }));
        },
        [],
    );

    // Each editable buffer registers a save function here, so the unsaved-changes
    // prompt can write the file without the user visiting the tab first. A
    // read-only tab registers nothing, which is what makes it impossible for a
    // close to attempt a write on one.
    const saveHandlers = useRef(new Map<string, () => Promise<boolean>>());
    const handleRegisterSave = useCallback(
        (tabId: string, save: (() => Promise<boolean>) | null) => {
            if (save) saveHandlers.current.set(tabId, save);
            else saveHandlers.current.delete(tabId);
        },
        [],
    );

    // A preview replacement that is waiting on the unsaved-edits prompt: the
    // outgoing buffer has to be saved or discarded before the slot can be
    // reused, and the new file must still open once it is.
    const pendingPreviewOpen = useRef<{ tabId: string; input: OpenUnifiedPreviewTabInput } | null>(null);

    const closeTab = useCallback((id: string) => {
        close(id);
        setMountedIds(prev => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
        setTerminalSessions(prev => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
        saveHandlers.current.delete(id);
        // The tree click that was blocked on this tab's unsaved edits now gets
        // its open, in the freed slot. Both go through the same functional
        // setter, so the close and the open compose in one tick.
        const queued = pendingPreviewOpen.current;
        if (queued !== null && queued.tabId === id) {
            pendingPreviewOpen.current = null;
            openPreview(queued.input);
        }
        // No flag clearing here on purpose: closing unmounts the view, and the
        // views report clean/ready from their own unmount cleanup, so a second
        // reset would be dead code. Verified by removing the cleanup's effect in
        // the close/reopen case rather than assumed.
    }, [close]);

    const [pendingClose, setPendingClose] = useState<
        { tabId: string; workspaceId: string; sessionIds: readonly string[] } | null
    >(null);
    const [closeError, setCloseError] = useState<string | null>(null);
    const [closeBusy, setCloseBusy] = useState(false);

    // The close waiting on the unsaved-changes prompt. Kept apart from
    // `pendingClose` because the two prompts ask different questions and can
    // never be up at the same time — a tab is either a terminal or a buffer.
    const [pendingDirty, setPendingDirty] = useState<{ tabId: string; label: string } | null>(null);
    const [dirtySaving, setDirtySaving] = useState(false);
    const [dirtyError, setDirtyError] = useState<string | null>(null);

    // The strip's ✕ and the views' own close buttons both come through here. A
    // terminal tab with nothing running still closes immediately: an exited
    // session is a tombstone, and prompting to kill a process that already ended
    // is noise.
    const requestClose = useCallback((id: string) => {
        const tab = tabs.find(candidate => candidate.id === id);
        if (tab?.kind === 'terminal') {
            const sessionIds = liveTerminalSessionIds(terminalSessions[id]);
            if (sessionIds.length > 0) {
                setPendingClose({ tabId: id, workspaceId: tab.ownerWorkspaceId, sessionIds });
                setCloseError(null);
                setCloseBusy(false);
                return;
            }
        }
        if (needsDirtyCloseConfirm(tab, dirtyIds.has(id))) {
            setPendingDirty({ tabId: id, label: dirtyCloseLabel(tab!) });
            setDirtyError(null);
            setDirtySaving(false);
            return;
        }
        closeTab(id);
    }, [tabs, terminalSessions, dirtyIds, closeTab]);

    // A file picked in the tree opens against the dock's target, exactly as an
    // Explorer navigator tab's selection does — same descriptor builder, so the
    // tree column and the `+` menu file the same kind of tab.
    const openFileForOwner = useCallback(
        (
            file: { path: string; name: string; line?: number },
            options: { preview: boolean; readOnly?: boolean },
            ownerWorkspaceId: string,
            ownerLabel?: string,
        ) => {
            const input = explorerFileTabInput(file, options, {
                ownerWorkspaceId,
                scopeWorkspaceId: workspaceId,
                ownerLabel,
                chatId,
            });
            if (input === null) return;
            // A double click (or any other permanent entry point) opens a normal
            // tab; only the tree's single click takes the preview slot (AC-03).
            if (!options.preview) {
                open(input);
                return;
            }
            const { kind: _kind, ...previewInput } = input;
            // Reusing the slot destroys the outgoing buffer, so it goes through
            // the same unsaved-edits guard a close does. In practice an edit has
            // already promoted the tab (AC-04), so this is a safety net: cancel
            // or a failed save leaves the old buffer, and the queued open is
            // dropped with the prompt.
            const outgoing = previewToReplace(previewInput);
            if (outgoing !== null && dirtyIds.has(outgoing.id)) {
                pendingPreviewOpen.current = { tabId: outgoing.id, input: previewInput };
                requestClose(outgoing.id);
                return;
            }
            openPreview(previewInput);
        },
        [workspaceId, chatId, open, openPreview, previewToReplace, dirtyIds, requestClose],
    );
    const openTreeFile = useCallback(
        (
            file: { path: string; name: string; line?: number },
            options: { preview: boolean; readOnly?: boolean },
        ) => openFileForOwner(file, options, target, targetLabel),
        [openFileForOwner, target, targetLabel],
    );
    const openSearchMatch = useCallback((path: string, line: number) => {
        const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
        openTreeFile({ path, name, line }, { preview: true });
    }, [openTreeFile]);

    // ------------------------------------------------------------------
    // Quick Open (Ctrl/Cmd+P) and Exact Open (Ctrl/Cmd+O)
    // ------------------------------------------------------------------
    //
    // The panel owns these itself rather than borrowing them from the Explorer
    // in its tree column: the column is collapsible, and a collapsed column used
    // to mean no listener at all. So the shortcut works with the tree open, with
    // it closed, and with the panel showing nothing but its empty state.

    const [quickOpenVisible, setQuickOpenVisible] = useState(false);
    const [exactOpenVisible, setExactOpenVisible] = useState(false);

    /**
     * A language-server jump out of an open file tab. It opens a permanent tab
     * against the SOURCE tab's owner rather than the dock's current target, so a
     * definition found in a group member's file keeps hitting that member's host
     * (AC-04), and it reuses the origin tab's repo label so the new tab reads
     * the same way in the strip.
     */
    const openNavigationFile = useCallback(
        (
            file: { path: string; name: string; line: number; column: number },
            origin: { ownerWorkspaceId: string; repoLabel?: string },
        ) => {
            const input = explorerFileTabInput(file, {}, {
                ownerWorkspaceId: origin.ownerWorkspaceId,
                scopeWorkspaceId: workspaceId,
                ownerLabel: origin.repoLabel ?? (origin.ownerWorkspaceId === target ? targetLabel : undefined),
                chatId,
            });
            if (input !== null) open(input);
        },
        [open, workspaceId, target, targetLabel, chatId],
    );

    /**
     * A file picked in either dialog. Same shape as the Explorer's own
     * `handleQuickOpenSelect`: a trusted absolute path is deliberate and
     * unwritable, so it lands as a pinned read-only tab, and everything else
     * takes the preview slot exactly as a single click in the tree would.
     *
     * Picking also opens the tree column. Revealing the row needs no new
     * machinery — the new tab becomes active, the toolbar model resolves its
     * path against the tree's target, and `ExplorerPanel`'s `activeFilePath`
     * tracking expands the ancestors and centres the row from there.
     */
    const handlePanelFileSelect = useCallback((filePath: string) => {
        setQuickOpenVisible(false);
        setExactOpenVisible(false);
        // The open bit is set even when the panel is currently too narrow for
        // `isUnifiedTreeVisible` to show the column: the bit is what the user
        // asked for, and widening the panel later brings the tree back. Forcing
        // the panel wider would move a boundary the user set by hand.
        tree.setOpen(true);
        if (filePath.startsWith(TRUSTED_PATH_PREFIX)) {
            const name = trustedFileName(filePath.slice(TRUSTED_PATH_PREFIX.length));
            openTreeFile({ path: filePath, name }, { preview: false, readOnly: true });
            return;
        }
        const name = filePath.includes('/') ? filePath.slice(filePath.lastIndexOf('/') + 1) : filePath;
        openTreeFile({ path: filePath, name }, { preview: true });
    }, [tree, openTreeFile]);

    const handleQuickOpenSelect = useCallback(async (result: QuickOpenResult) => {
        if (!('workspaceId' in result) || !repoGroup) {
            handlePanelFileSelect(result.path);
            return;
        }

        let latest;
        try {
            latest = await getRepoGroup(repoGroup.id, repoGroup.baseUrl);
        } catch {
            return { error: 'This repository is no longer available.', retry: true };
        }
        const member = latest.members.find(candidate => candidate.workspaceId === result.workspaceId);
        if (!member || member.stale) {
            return { error: 'This repository is no longer available.', retry: true };
        }
        if (
            repoGroup.baseUrl &&
            !hasWorkspaceRouteForBaseUrl(result.workspaceId, repoGroup.baseUrl)
        ) {
            return { error: 'This repository is no longer available.', retry: true };
        }
        if (result.workspaceId !== target && dock.setTarget(result.workspaceId) === false) {
            return false;
        }
        if (repoGroup.baseUrl) {
            activateWorkspaceRouteForBaseUrl(result.workspaceId, repoGroup.baseUrl);
        }

        if (!isOpen || mode !== 'explorer') dock.selectMode('explorer');
        tree.setOpen(true);
        const name = result.path.includes('/')
            ? result.path.slice(result.path.lastIndexOf('/') + 1)
            : result.path;
        openFileForOwner(
            { path: result.path, name },
            { preview: true },
            result.workspaceId,
            result.repoName,
        );
    }, [
        repoGroup,
        target,
        dock,
        isOpen,
        mode,
        tree,
        openFileForOwner,
        handlePanelFileSelect,
    ]);

    const panelRootRef = useRef<HTMLDivElement | null>(null);

    // Claimed in the CAPTURE phase, and stopped when this panel wins. That is
    // what keeps a single keypress to a single dialog: the Explorer sub-tab's
    // own listener sits on `document` in the bubble phase, so stopping here
    // suppresses it — and it also beats Monaco, whose handlers live on the
    // editor's own DOM, so Ctrl+P inside a code buffer in this panel opens this
    // dialog rather than Monaco's command palette (AC-04).
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const shortcut = quickOpenShortcut(event);
            if (shortcut === null) return;
            const root = panelRootRef.current;
            const focused = document.activeElement;
            // The dialogs portal to `document.body`, so containment alone would
            // hand the panel's own open dialog back to the Explorer tab.
            const dialogOpen = quickOpenVisible || exactOpenVisible;
            const panelHasFocus = dialogOpen || (
                root !== null && focused !== null && focused !== document.body && root.contains(focused)
            );
            const owner = quickOpenOwner({
                panelOpen: isOpen,
                panelHasFocus,
                explorerMounted: isExplorerQuickOpenMounted(),
                explorerHasFocus: explorerQuickOpenHasFocus(),
            });
            if (owner !== 'panel') return;
            event.preventDefault();
            event.stopPropagation();
            if (shortcut === 'quick') {
                setExactOpenVisible(false);
                setQuickOpenVisible(true);
            } else {
                setQuickOpenVisible(false);
                setExactOpenVisible(true);
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [isOpen, quickOpenVisible, exactOpenVisible]);

    // ------------------------------------------------------------------
    // Close the active tab (Ctrl/Cmd+W)
    // ------------------------------------------------------------------
    //
    // Same capture-phase listener idiom as Quick Open above, and for the same
    // reason: it has to beat Monaco's own handlers inside a code buffer. The
    // routing rule — including the terminal carve-out and the "focused with an
    // empty strip still swallows it" case — lives in `closeTabRouting`, and the
    // close itself goes through `requestClose`, never `closeTab`, so a live PTY
    // or an unsaved buffer still gets its prompt.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (closeTabShortcut(event) === null) return;
            const root = panelRootRef.current;
            const focused = document.activeElement;
            const panelHasFocus = (
                root !== null
                && root.offsetParent !== null
                && focused !== null
                && focused !== document.body
                && root.contains(focused)
            );
            // "Inside the active terminal" is the tab's own mounted view, not
            // the panel: focus parked on the strip's tab button is not somebody
            // typing at a prompt, so it must not fall through to the browser.
            const activeView = focused?.closest('[data-testid^="unified-panel-view-"]') ?? null;
            const focusedViewId = activeView?.getAttribute('data-testid')?.slice('unified-panel-view-'.length) ?? null;
            const outcome = closeTabOutcome({
                panelOpen: isOpen,
                panelHasFocus,
                focusInActiveTerminal: active?.kind === 'terminal' && focusedViewId === activeId,
                metaKey: event.metaKey,
                hasActiveTab: activeId !== null,
            });
            if (outcome === 'ignore') return;
            event.preventDefault();
            event.stopPropagation();
            if (outcome === 'close' && activeId !== null) requestClose(activeId);
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [isOpen, active, activeId, requestClose]);

    // A collapsed panel has no dialog to show: dismiss rather than leave one
    // floating over the chat with nothing behind it.
    useEffect(() => {
        if (isOpen) return;
        setQuickOpenVisible(false);
        setExactOpenVisible(false);
    }, [isOpen]);

    const cancelClose = useCallback(() => {
        setPendingClose(null);
        setCloseError(null);
        setCloseBusy(false);
    }, []);

    // Terminate, then close — never the other way round. If the server refuses,
    // the tab and its sessions both stay and the dialog turns into a retry.
    const confirmClose = useCallback(() => {
        if (pendingClose === null || closeBusy) return;
        const { tabId, workspaceId: owner, sessionIds } = pendingClose;
        setCloseBusy(true);
        setCloseError(null);
        void terminateTerminalSessions(owner, sessionIds)
            .then(() => {
                setPendingClose(null);
                setCloseBusy(false);
                closeTab(tabId);
            })
            .catch(err => {
                console.error('Failed to terminate terminal session:', err);
                setCloseBusy(false);
                setCloseError('Could not terminate the terminal session. The tab is still open.');
            });
    }, [pendingClose, closeBusy, closeTab]);

    // A pending prompt whose tab went away (a chat switch, a close from
    // elsewhere) has nothing left to confirm.
    useEffect(() => {
        if (pendingClose === null) return;
        if (!tabs.some(tab => tab.id === pendingClose.tabId)) cancelClose();
    }, [tabs, pendingClose, cancelClose]);

    /**
     * Cancel: the tab, its buffer, and its unsaved edits are all left alone —
     * and so is the preview slot, so a cancelled replacement leaves the old
     * file showing rather than opening the new one anyway.
     */
    const cancelDirtyClose = useCallback(() => {
        pendingPreviewOpen.current = null;
        setPendingDirty(null);
        setDirtyError(null);
        setDirtySaving(false);
    }, []);

    /** Don't Save: close the tab and let the buffer go with it. */
    const discardAndClose = useCallback(() => {
        const pending = pendingDirty;
        if (pending === null) return;
        setPendingDirty(null);
        setDirtyError(null);
        closeTab(pending.tabId);
    }, [pendingDirty, closeTab]);

    /**
     * Save: write the buffer, then close. A write that fails — or a tab that
     * registered no save function at all — keeps the tab open and dirty with the
     * error on the prompt, so a failed save is never reported as a close.
     */
    const saveAndClose = useCallback(() => {
        const pending = pendingDirty;
        if (pending === null || dirtySaving) return;
        const save = saveHandlers.current.get(pending.tabId);
        setDirtySaving(true);
        setDirtyError(null);
        void Promise.resolve(save ? save() : false)
            .catch(() => false)
            .then(saved => {
                setDirtySaving(false);
                if (!saved) {
                    setDirtyError(DIRTY_CLOSE_SAVE_FAILED);
                    return;
                }
                setPendingDirty(null);
                closeTab(pending.tabId);
            });
    }, [pendingDirty, dirtySaving, closeTab]);

    // Same rule as the terminal prompt: a question about a tab that is no longer
    // there (a chat switch, a close from elsewhere) has nothing left to answer.
    useEffect(() => {
        if (pendingDirty === null) return;
        if (!tabs.some(tab => tab.id === pendingDirty.tabId)) cancelDirtyClose();
    }, [tabs, pendingDirty, cancelDirtyClose]);

    // The "+" menu. Dismissal always hands focus back to whatever opened it —
    // the "+" button or the empty state's "Open…" — so a keyboard user is never
    // dropped back at the top of the document.
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const menuTriggerRef = useRef<HTMLElement | null>(null);
    const closeMenu = useCallback(() => {
        setMenuOpen(false);
        menuTriggerRef.current?.focus?.();
    }, []);
    useEffect(() => {
        if (!menuOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMenuOpen(false);
                menuTriggerRef.current?.focus?.();
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [menuOpen]);

    // A concrete resource picked in the menu (a searched file, a chat canvas).
    // The menu decides the descriptor — owning clone, chat scope, normalized
    // identity — so the panel only has to file it.
    const openResource = useCallback((input: OpenUnifiedTabInput) => {
        setMenuOpen(false);
        open(input);
    }, [open]);

    const toggleMenu = useCallback(() => {
        menuTriggerRef.current = document.activeElement as HTMLElement | null;
        setMenuOpen(prev => !prev);
    }, []);

    return (
        <div
            ref={panelRootRef}
            className="unified-right-panel flex h-full flex-shrink-0 border-l border-[#e5e5e5] dark:border-[#333]"
            // Collapsed hides the column without unmounting it: tabs, drafts,
            // and terminal sessions all survive a collapse/reopen cycle.
            style={{ display: isOpen ? undefined : 'none' }}
            data-testid="unified-right-panel"
            data-open={isOpen ? 'true' : 'false'}
        >
            {/* Left-edge resize handle — drag left to widen the right-anchored panel. */}
            <div
                className={cn(
                    'group relative flex w-2 flex-shrink-0 cursor-col-resize items-center justify-center border-x border-[#e0e0e0] dark:border-[#333]',
                    'hover:bg-[#007acc]/15 active:bg-[#007acc]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/40 transition-colors',
                    isDragging && 'bg-[#007acc]/20',
                )}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                data-testid="unified-panel-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize right panel"
                aria-valuemin={DOCK_MIN_WIDTH}
                aria-valuemax={maxWidth}
                aria-valuenow={width}
                tabIndex={0}
            >
                <span className="h-full w-px bg-[#c8c8c8] dark:bg-[#5a5a5a] group-hover:w-[2px] group-hover:bg-[#007acc] transition-all" />
            </div>

            <div
                className="relative flex min-h-0 flex-col overflow-hidden"
                style={{ width }}
                data-testid="unified-panel-body"
            >
                <UnifiedPanelTabStrip
                    tabs={tabs}
                    activeId={activeId}
                    dirtyIds={dirtyIds}
                    errorIds={errorIds}
                    onActivate={activate}
                    onClose={requestClose}
                    onMove={move}
                    onPromote={promote}
                    onOpenMenu={toggleMenu}
                />

                {menuOpen && (
                    <div ref={menuRef} className="contents">
                        <UnifiedPanelOpenMenu
                            workspaceId={workspaceId}
                            chatId={chatId}
                            target={target}
                            targets={targetOptions}
                            onSelectTarget={dock.setTarget}
                            onOpenResource={openResource}
                            onOpenWorkspaceResource={kind => {
                                setMenuOpen(false);
                                // Explorer is a panel mode, not a resource tab.
                                if (kind === 'explorer') {
                                    dock.selectMode('explorer');
                                    return;
                                }
                                openWorkspaceResource(kind);
                            }}
                            onClose={closeMenu}
                        />
                    </div>
                )}

                {/* Resource views on the left, the selected navigator mode on
                    the right — one row spanning everything below the strip. */}
                <div className="flex min-h-0 min-w-0 flex-1" data-testid="unified-panel-content">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    {toolbar !== null && (
                        <UnifiedPanelToolbar
                            breadcrumbs={toolbar}
                            onNavigate={revealTreeFolder}
                        />
                    )}
                    {tabs.length === 0 ? (
                        <div
                            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center"
                            data-testid="unified-panel-empty"
                        >
                            <p className="text-xs text-[#616161] dark:text-[#9d9d9d]">Nothing open in this panel.</p>
                            <button
                                type="button"
                                data-testid="unified-panel-empty-open"
                                onClick={toggleMenu}
                                className={cn(
                                    'rounded border border-[#c8c8c8] px-2.5 py-1 text-xs text-[#1f1f1f] hover:bg-[#e8e8e8]',
                                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/40',
                                    'dark:border-[#3c3c3c] dark:text-[#cccccc] dark:hover:bg-[#37373d]',
                                )}
                            >
                                Open…
                            </button>
                        </div>
                    ) : (
                        mountedTabs.map(tab => (
                            <div
                                key={tab.id}
                                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                                style={{ display: tab.id === activeId ? undefined : 'none' }}
                                data-testid={`unified-panel-view-${tab.id}`}
                                data-active={tab.id === activeId ? 'true' : 'false'}
                            >
                                <UnifiedTabView
                                    tab={tab}
                                    scopeWorkspaceId={workspaceId}
                                    onClose={requestClose}
                                    onDirtyChange={handleDirtyChange}
                                    onErrorChange={handleErrorChange}
                                    onRegisterSave={handleRegisterSave}
                                    onTerminalSessionsChange={handleTerminalSessions}
                                    onOpenFile={openNavigationFile}
                                />
                            </div>
                        ))
                    )}

                    {/* A tab is selected but its view has not mounted yet (restored
                        while the panel was collapsed): show nothing rather than the
                        empty state, which would read as "no tabs". */}
                    {tabs.length > 0 && active !== null && !mountedIds.has(active.id) && (
                        <div className="min-h-0 flex-1" data-testid="unified-panel-pending" />
                    )}
                    </div>

                    {/* Search and Explorer share this one navigator slot and its
                        persisted width. A mode mounts on first use and then stays
                        mounted so switching never loses Search or tree state. */}
                    {mountedModes.size > 0 && (
                        <div
                            className="flex min-h-0 flex-shrink-0"
                            style={{ display: modeColumnVisible ? undefined : 'none' }}
                            data-testid={tree.state.open ? 'unified-panel-tree' : 'unified-panel-mode-column'}
                            data-mode={mode}
                        >
                            {/* Right-anchored column: drag left to widen it. */}
                            <div
                                className={cn(
                                    'group relative flex w-1.5 flex-shrink-0 cursor-col-resize items-center justify-center border-l border-[#e0e0e0] dark:border-[#333]',
                                    'hover:bg-[#007acc]/15 active:bg-[#007acc]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/40 transition-colors',
                                    treeResize.isDragging && 'bg-[#007acc]/20',
                                )}
                                onMouseDown={treeResize.handleMouseDown}
                                onTouchStart={treeResize.handleTouchStart}
                                data-testid="unified-panel-tree-resize-handle"
                                role="separator"
                                aria-orientation="vertical"
                                aria-label="Resize file tree"
                                aria-valuemin={UNIFIED_TREE_MIN_WIDTH}
                                aria-valuemax={maxUnifiedTreeWidth(width)}
                                aria-valuenow={treeWidth}
                                tabIndex={0}
                            />
                            <div
                                className="flex min-h-0 flex-shrink-0 flex-col overflow-hidden"
                                style={{ width: treeWidth }}
                                data-tree-width={treeWidth}
                            >
                                {mountedModes.has('explorer') && (
                                    <div
                                        className="flex min-h-0 flex-1 flex-col"
                                        style={{ display: mode === 'explorer' ? undefined : 'none' }}
                                        data-testid="unified-panel-explorer-mode"
                                    >
                                        <ExplorerPanel
                                            key={target}
                                            workspaceId={target}
                                            // Same rule as an Explorer tab: only a column
                                            // pointed at the panel's own workspace may write
                                            // the explorer deep-link hash, or a group member's
                                            // file click would navigate out of the group.
                                            deepLink={target === workspaceId}
                                            mode="sidebar"
                                            activeFilePath={trackedTreeFile}
                                            onOpenFile={openTreeFile}
                                        />
                                    </div>
                                )}
                                {mountedModes.has('search') && (
                                    <div
                                        className="flex min-h-0 flex-1 flex-col"
                                        style={{ display: mode === 'search' ? undefined : 'none' }}
                                        data-testid="unified-panel-search-mode"
                                    >
                                        <ContentSearchPanel
                                            key={target}
                                            workspaceId={target}
                                            onOpenMatch={openSearchMatch}
                                            narrow={treeWidth < 300}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <QuickOpen
                    scope={repoGroup
                        ? {
                            kind: 'repo-group',
                            groupId: repoGroup.id,
                            groupName: repoGroup.name,
                            liveRepoCount: repoGroup.liveRepoCount,
                            baseUrl: repoGroup.baseUrl,
                        }
                        : { kind: 'repo', workspaceId: target }}
                    open={quickOpenVisible}
                    onClose={() => setQuickOpenVisible(false)}
                    onFileSelect={handleQuickOpenSelect}
                />
                <ExactOpen
                    workspaceId={target}
                    open={exactOpenVisible}
                    onClose={() => setExactOpenVisible(false)}
                    onFileSelect={handlePanelFileSelect}
                />

                <ExplorerCloseTabsDialog
                    open={pendingDirty !== null}
                    paths={pendingDirty === null ? [] : [pendingDirty.label]}
                    saving={dirtySaving}
                    error={dirtyError}
                    onSave={saveAndClose}
                    onDontSave={discardAndClose}
                    onCancel={cancelDirtyClose}
                />

                {pendingClose !== null && (
                    <UnifiedPanelCloseConfirm
                        message={terminalCloseConfirmMessage(pendingClose.sessionIds.length)}
                        confirmLabel="Terminate"
                        error={closeError}
                        busy={closeBusy}
                        onCancel={cancelClose}
                        onConfirm={confirmClose}
                    />
                )}
            </div>
        </div>
    );
}
