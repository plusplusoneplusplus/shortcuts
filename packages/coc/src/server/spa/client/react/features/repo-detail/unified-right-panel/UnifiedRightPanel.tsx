/**
 * UnifiedRightPanel — the single right-side surface behind the
 * `unifiedRightPanel` flag (AC-01).
 *
 * One column, one tab strip, one visible view. Where the flag-off desktop has a
 * workspace dock plus whatever column a chat source link / canvas / diff opened
 * beside it, this panel is the only right-side column: selecting a tab swaps its
 * content in place. The tab session itself (ownership, identity, order,
 * persistence) lives in `useUnifiedPanelTabs`; this component is the shell
 * around it.
 *
 * Three things the shell is responsible for and the model is not:
 *
 *  - **Keep-alive.** A view is mounted the first time its tab becomes active and
 *    then stays mounted, hidden with `display:none` — the same pattern
 *    `WorkspaceRightDock` uses. That is what keeps a PTY, a scrollback, and an
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
 *    `useWorkspaceDock` controller, so the flag-on and flag-off panels share the
 *    same open/width persistence and the same header toggle.
 *  - **The file-tree column.** A collapsible tree pinned to the panel's right
 *    edge, beside whatever the active tab is showing — a terminal, a canvas, or
 *    the empty state. It is panel-level (`unifiedPanelTree`), not a tab and not
 *    per-tab, and it has its own drag: the tree gives up width before the view
 *    does, and a panel too narrow for both hides it without closing it.
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
import type { WorkspaceDockController } from '../WorkspaceRightDock';
import { ExplorerCloseTabsDialog } from '../explorer/ExplorerCloseTabsDialog';
import { ExplorerPanel } from '../explorer/ExplorerPanel';
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
import { UnifiedTabView } from './UnifiedTabView';
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
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

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
}

export function UnifiedRightPanel({ workspaceId, chatId = null, dock, targets }: UnifiedRightPanelProps) {
    const { isOpen, target, width, maxWidth, isDragging, handleMouseDown, handleTouchStart } = dock;
    const { tabs, activeId, active, open, activate, close, move } = useUnifiedPanelTabs(workspaceId, chatId);

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
    const openWorkspaceResource = useCallback((kind: 'terminal' | 'explorer' | 'notes') => {
        const owner = kind === 'notes' ? workspaceId : target;
        open({
            kind,
            ownerWorkspaceId: owner,
            chatId,
            resourceId: kind,
            label: kind === 'terminal' ? 'Terminal' : kind === 'explorer' ? 'Explorer' : 'Notes',
            ...(owner === workspaceId || !targetLabel ? {} : { repoLabel: targetLabel }),
        });
    }, [open, workspaceId, target, targetLabel, chatId]);

    // ------------------------------------------------------------------
    // The file-tree column (AC-01)
    // ------------------------------------------------------------------

    // Panel-level, not per-tab: the column stays put across tab switches, chat
    // switches, a collapse, and a reload, and it renders beside every kind of
    // view — including the empty state, which is why closing the last tab with
    // the tree open leaves the panel showing a tree next to "Nothing open".
    const tree = useUnifiedPanelTree(workspaceId);
    const treeVisible = isUnifiedTreeVisible(tree.state, width);

    // The column's drag. It is deliberately given no `storageKey`: the width
    // lives in the tree store, which the toggle in the toolbar shares, and two
    // localStorage owners for one number would drift. So the drag runs
    // uncommitted and the result is written back when it ends.
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
    // dragged narrow shrinks the tree first, and below the point where both fit
    // `treeVisible` hides it without touching the user's open bit.
    const treeWidth = clampUnifiedTreeWidth(treeResize.width, width);

    // A file picked in the tree opens against the dock's target, exactly as an
    // Explorer navigator tab's selection does — same descriptor builder, so the
    // tree column and the `+` menu file the same kind of tab.
    const openTreeFile = useCallback(
        (
            file: { path: string; name: string; line?: number },
            options: { preview: boolean; readOnly?: boolean },
        ) => {
            const input = explorerFileTabInput(file, options, {
                ownerWorkspaceId: target,
                scopeWorkspaceId: workspaceId,
                ownerLabel: targetLabel,
                chatId,
            });
            if (input) open(input);
        },
        [target, workspaceId, targetLabel, chatId, open],
    );

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
        (id: string, isDirty: boolean) => setFlag(setDirtyIds, id, isDirty),
        [setFlag],
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

    /** Cancel: the tab, its buffer, and its unsaved edits are all left alone. */
    const cancelDirtyClose = useCallback(() => {
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
                                openWorkspaceResource(kind);
                            }}
                            onClose={closeMenu}
                        />
                    </div>
                )}

                {/* Views on the left, the file tree pinned to the panel's right
                    edge — one row spanning everything below the tab strip. */}
                <div className="flex min-h-0 min-w-0 flex-1" data-testid="unified-panel-content">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                                    chatId={chatId}
                                    onOpenResource={openResource}
                                    onClose={requestClose}
                                    onDirtyChange={handleDirtyChange}
                                    onErrorChange={handleErrorChange}
                                    onRegisterSave={handleRegisterSave}
                                    onTerminalSessionsChange={handleTerminalSessions}
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

                    {/* Mounted while the user has the column open, hidden (never
                        unmounted) when the panel is too narrow to show it, so
                        widening restores the tree with its expansion intact. */}
                    {tree.state.open && (
                        <div
                            className="flex min-h-0 flex-shrink-0"
                            style={{ display: treeVisible ? undefined : 'none' }}
                            data-testid="unified-panel-tree"
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
                                <ExplorerPanel
                                    workspaceId={target}
                                    // Same rule as an Explorer tab: only a column
                                    // pointed at the panel's own workspace may write
                                    // the explorer deep-link hash, or a group member's
                                    // file click would navigate out of the group.
                                    deepLink={target === workspaceId}
                                    mode="sidebar"
                                    onOpenFile={openTreeFile}
                                />
                            </div>
                        </div>
                    )}
                </div>

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
