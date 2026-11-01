import { useFileIdentityOpen } from '../../language-servers/useFileIdentityOpen';
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
 *    dock toggle reopens it. A user close that empties the strip collapses the
 *    panel unless the Search/Explorer navigator is showing; an empty panel
 *    opened on purpose keeps its "Open…" action and is never auto-created into.
 *  - **Width.** One workspace-scoped width, clamped so the central chat keeps at
 *    least `DOCK_MIN_CHAT_WIDTH`. It comes from the existing
 *    `useWorkspaceDock` controller, which also owns the header toggle's open
 *    bit — the panel does not persist a width of its own.
 *  - **The toolbar row.** Directly under the strip, and only while a file tab
 *    is active: breadcrumbs for that file plus the navigator toggle. Other
 *    kinds keep rendering their own toolbars inside their own views, with the
 *    toggle moving into the tab strip.
 *  - **The preview slot.** A single click in the tree opens into the section's
 *    one replaceable, italic preview tab; every other entry point — `+`, a chat
 *    source link, a note link, a double click — opens a permanent tab. The
 *    rules live in `unifiedPanelTabsModel`; what the shell adds is the guard,
 *    because reusing the slot destroys a buffer exactly as a close does.
 *  - **The Search/Explorer navigator.** The selected mode is pinned to the
 *    panel's right edge beside the resource view. Both bodies use the dock
 *    target, share one panel-scope width, and stay mounted after first use.
 *    The navigator can be collapsed independently of the panel and gives up
 *    width before the resource view does.
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

import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { cn } from '../../../ui/cn';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isBrowserTabShortcutsEnabled, isChatScopedBrowserTabsEnabled, isSessionContextAttachmentsEnabled, isPanelSourceSplitEnabled, isPanelTabReorderingEnabled, isPanelTabGroupsEnabled } from '../../../utils/config';
import {
    BROWSER_TAB_HINT_DELAY_MS, browserTabForDigit, browserTabShortcutDigit, browserTabShortcutModifierDown,
    browserTabShortcutsMac, isBrowserTabShortcutModifier,
} from './browserTabShortcuts';
import { useContainerWidth } from '../../chat/hooks/useContainerWidth';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import {
    DOCK_MIN_WIDTH,
    SearchIcon,
    setWorkspaceDockExpanded,
    setWorkspaceDockOpen,
    useWorkspaceDockExpanded,
    type DockTarget,
} from '../WorkspaceDockToggle';
import type { WorkspaceDockController } from '../useWorkspaceDock';
import { ExplorerCloseTabsDialog } from '../explorer/ExplorerCloseTabsDialog';
import { ContentSearchPanel } from '../explorer/ContentSearchPanel';
import { ExplorerPanel } from '../explorer/ExplorerPanel';
import type { FileReloadControl } from '../explorer/PreviewPane';
import { QuickOpen, type QuickOpenResult } from '../explorer/QuickOpen';
import type { PaletteMode } from '../explorer/paletteQuery';
import { ExactOpen, TRUSTED_PATH_PREFIX, fileName as trustedFileName } from '../explorer/ExactOpen';
import { WORKSPACE_PREVIEW_PREFIX } from '../../../shared/file-viewer/workspacePreview';
import {
    explorerQuickOpenHasFocus,
    isExplorerQuickOpenMounted,
    quickOpenOwner,
    quickOpenShortcut,
} from './quickOpenRouting';
import { isEditableTarget } from '../../../hooks/useScopedFindShortcut';
import { closeTabOutcome, closeTabShortcut, shouldCollapseAfterClose } from './closeTabRouting';
import { findFilterOwner, findFilterShortcut } from './findRouting';
import { returnToDiffDefinitionOrigin } from '../../git/diff/diffDefinitionReturn';
import {
    keyboardNavigationDirection,
    mouseNavigationDirection,
    panelOwnsFileNavigation,
    tabStripClaimsKey,
} from './fileNavigationRouting';
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
import { UnifiedPanelRepoPicker } from './UnifiedPanelRepoPicker';
import { isRepoGroupWorkspaceId } from '../../../repos/virtualWorkspaceIds';
import { UnifiedPanelTabStrip } from './UnifiedPanelTabStrip';
import { compressedCanvasTabs, UnifiedPanelCanvasStack } from './UnifiedPanelCanvasStack';
import { toggleGroupFolded, useUnifiedTabGroupState } from './unifiedPanelTabGroupStore';
import { UnifiedPanelToolbar } from './UnifiedPanelToolbar';
import { UnifiedPanelTreeToggle } from './UnifiedPanelTreeToggle';
import { unifiedToolbarBreadcrumbs } from './unifiedPanelBreadcrumbs';
import { UnifiedTabView } from './UnifiedTabView';
import { useWorkspaceSettingsOwner } from '../../repo-settings/WorkspaceSettingsHost';
import { panelWorkspaceResourceInput } from './unifiedPanelWorkspaceResources';
import { UnifiedHtmlPageTab } from './UnifiedHtmlPageTab';
import { UnifiedBrowserTab } from './UnifiedBrowserTab';
import { attachBrowserWebview, removeBrowserWebview } from './browserWebviewLayerStore';
import {
    browserLabelForUrl, browserOpenInput, browserSessionKey, duplicateBrowserTabInput, normalizeBrowserUrl,
} from './unifiedBrowserTabs';
import {
    closedBrowserTabScopeKey,
    popClosedBrowserTab,
    recordClosedBrowserTab,
    reopenBrowserTabInput,
    reopenClosedTabShortcut,
} from './unifiedClosedBrowserTabs';
import {
    desktopBrowserBridge,
    OPEN_BROWSER_URL_EVENT,
    type BrowserDemoOwner,
    type OpenBrowserUrlDetail,
} from '../../../shared/file-path/browser-bridge';
import { setBrowserDemoViewingChat } from '../../../shared/file-path/browser-demo';
import { desktopHtmlPageBridge, HTML_PAGE_VIEW_PREFIX, type OpenHtmlPageDetail } from '../../../shared/file-path/html-page-bridge';
import { migrateUnifiedPanelState } from './unifiedPanelStore';
import { useUnifiedPanelTabs } from './useUnifiedPanelTabs';
import { useSentinelTodoChat, useSentinelTodoEvents } from './sentinelTodoChats';
import { sentinelTodoTabInput, shouldAutoOpenSentinelTodoTab, type SentinelTodoOwner } from './sentinelTodoPanelModel';
import type {
    EditorModelMountContext,
    EditorNavigationController,
    EditorNavigationReason,
    EditorNavigationSnapshot,
} from '../../../shared/file-viewer/MonacoFileEditor';
import {
    SOURCE_SPLIT_DIVIDER_WIDTH,
    SOURCE_SPLIT_RATIO_STEP,
    canSplitTab,
    clampSourceSplitRatio,
    isSourceSplitWide,
    otherSourceSplitPane,
    reconcileSourceSplit,
    sourceSplitForDrop,
    sourceSplitScopeKey,
    useSourceSplit,
    writeSourceSplit,
    type SourceSplitPane,
} from './unifiedPanelSourceSplit';
import { UnifiedSourceMirror } from './UnifiedSourceMirror';
import {
    dropReplayedNavigationEntry,
    finishNavigationReplay,
    navigationFileOf,
    navigationHistoryDestination,
    navigationReopenInput,
    recordNavigationLocation,
    stepNavigationHistory,
    type NavigationDirection,
    type UnifiedPanelNavigationFile,
    type UnifiedPanelNavigationLocation,
} from './unifiedPanelNavigationHistory';
import {
    readUnifiedPanelNavigationHistory,
    writeUnifiedPanelNavigationHistory,
} from './unifiedPanelNavigationStore';
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
import { OPEN_PANEL_DIRECTORY_EVENT, type OpenPanelDirectoryDetail } from './resolveChatFileLink';
import {
    releaseBrowserChatOwners,
    unifiedTabId,
    type OpenUnifiedPreviewTabInput,
    type OpenUnifiedTabInput,
    type UnifiedPanelTab,
} from './unifiedPanelTabsModel';
import { openUnifiedPanelTab, updateUnifiedPanelState } from './unifiedPanelOpen';
import { getRepoGroup } from '../../../repos/repoGroupService';
import {
    activateWorkspaceRouteForBaseUrl,
    hasWorkspaceRouteForBaseUrl,
} from '../../../repos/cloneRegistry';
import { routingRefForPanelOwner } from './unifiedPanelOwnerRouting';
import { createWorkingTreeFileContextPayload } from '../../chat/gitFileContext';
import { ToastContainer, useToast } from '../../../ui/Toast';
import { copyToClipboard } from '../../../utils/format';
import {
    unifiedPanelAbsoluteFilePath,
    unifiedPanelBulkCloseTargets,
    unifiedPanelFileActionAvailability,
    unifiedPanelRelativeFilePath,
    type UnifiedPanelTabMenuAction,
} from './unifiedPanelTabMenuModel';

export interface UnifiedRightPanelProps {
    /**
     * The panel's *scope*: which workspace owns its tab session, its open flag,
     * and its width — and which workspace Notes belongs to.
     */
    workspaceId: string;
    /** Concrete route for the panel scope; `null` explicitly means local. */
    routingRef?: string | null;
    /**
     * The selected chat, or null when none is. Chat-owned tabs (file, canvas,
     * diff) are filed under it; workspace tabs stay visible either way.
     */
    chatId?: string | null;
    /** Concrete selected conversation when a group panel shows a member chat. */
    viewingChatOwner?: BrowserDemoOwner | null;
    /** Open/width/resize + the target workspace new resources open against. */
    dock: WorkspaceDockController;
    /** Absolute root path on the scope's host, when the scope is a concrete repo. */
    workspaceRootPath?: string;
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

type PendingNavigationReplay = UnifiedPanelNavigationLocation & {
    direction: NavigationDirection;
    reopened: boolean;
};

/** Basename of a workspace-relative path. */
function fileNameOf(path: string): string {
    return path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
}

export function UnifiedRightPanel({
    workspaceId,
    routingRef,
    chatId = null,
    viewingChatOwner,
    dock,
    workspaceRootPath,
    targets,
    repoGroup,
}: UnifiedRightPanelProps) {
    const { isOpen, mode, target, width, maxWidth, isDragging, handleMouseDown, handleTouchStart } = dock;
    const { toasts, addToast, removeToast } = useToast();
    const [reorderEnabled, setReorderEnabled] = useState(() => isPanelTabReorderingEnabled());
    const [groupsEnabled, setGroupsEnabled] = useState(() => isPanelTabGroupsEnabled());
    const [browserTabShortcutsEnabled, setBrowserTabShortcutsEnabled] = useState(() => isBrowserTabShortcutsEnabled());
    const [chatScopedBrowserTabs, setChatScopedBrowserTabs] = useState(() => isChatScopedBrowserTabsEnabled());
    const foldedGroups = useUnifiedTabGroupState(workspaceId);
    const [splitEnabled, setSplitEnabled] = useState(() => isPanelSourceSplitEnabled());
    const settingsOwner = useWorkspaceSettingsOwner();
    useEffect(() => {
        const update = () => {
            setReorderEnabled(isPanelTabReorderingEnabled());
            setGroupsEnabled(isPanelTabGroupsEnabled());
            setBrowserTabShortcutsEnabled(isBrowserTabShortcutsEnabled());
            setChatScopedBrowserTabs(isChatScopedBrowserTabsEnabled());
            setSplitEnabled(isPanelSourceSplitEnabled());
        };
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
    }, []);
    const {
        state, tabs, activeId, active, pinnedId, open, openBeside, openPreview, previewToReplace, promote, activate, close, move,
        updateNotesSelection,
        updateBrowser,
    } = useUnifiedPanelTabs(workspaceId, chatId, reorderEnabled || groupsEnabled);
    // With `features.chatScopedBrowserTabs` off, every page shows in every chat again.
    useEffect(() => {
        if (!chatScopedBrowserTabs) updateUnifiedPanelState(workspaceId, releaseBrowserChatOwners);
    }, [chatScopedBrowserTabs, workspaceId]);

    // Reconcile only at the chat-selection boundary. Resource entry points still
    // reveal the panel themselves, and a user may explicitly keep an empty panel
    // open until another selection (or a reload) asks us to reconcile again.
    // A chat joining a To-do excursion is such a boundary too: the chat records
    // its visit after this selection renders, and its pinned To-do starts active.
    const hasVisibleTabsRef = useRef(tabs.length > 0);
    hasVisibleTabsRef.current = tabs.length > 0;
    useEffect(() => {
        setWorkspaceDockOpen(workspaceId, hasVisibleTabsRef.current);
    }, [workspaceId, chatId, pinnedId]);
    useEffect(() => {
        if (pinnedId !== null) activate(pinnedId);
    }, [pinnedId, activate]);
    const demoWorkspaceId = viewingChatOwner === undefined ? workspaceId : viewingChatOwner?.workspaceId;
    const demoRoutingRef = viewingChatOwner === undefined ? routingRef ?? workspaceId : viewingChatOwner?.routingRef;
    const demoProcessId = viewingChatOwner === undefined ? chatId : viewingChatOwner?.processId;
    // Leaving the exact chat/server/workspace that records a demo pauses it.
    useEffect(() => setBrowserDemoViewingChat(demoWorkspaceId && demoRoutingRef && demoProcessId
        ? { workspaceId: demoWorkspaceId, routingRef: demoRoutingRef, processId: demoProcessId } : null),
    [demoWorkspaceId, demoRoutingRef, demoProcessId]);

    // Expanded covers the workspace row; only an open panel can be expanded, and
    // closing the panel drops the flag so the next open starts at its own width.
    const expandedFlag = useWorkspaceDockExpanded(workspaceId);
    const { isMobile } = useBreakpoint();
    const expanded = isOpen && (isMobile || expandedFlag);
    useEffect(() => {
        if (!isOpen) setWorkspaceDockExpanded(workspaceId, false);
    }, [isOpen, workspaceId]);

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

    // The two-pane source split. It names tab ids only; the views below stay
    // keyed by tab, so entering, resizing or leaving the split never remounts a
    // buffer. Session-only and scoped by panel storage scope plus chat.
    const splitKey = sourceSplitScopeKey(workspaceId, chatId);
    const splitKeyRef = useRef(splitKey);
    splitKeyRef.current = splitKey;
    const storedSplit = useSourceSplit(splitKey);
    const split = splitEnabled ? reconcileSourceSplit(storedSplit, tabs, active) : null;
    const splitRef = useRef(split);
    splitRef.current = split;
    useEffect(() => {
        if (split !== storedSplit) writeSourceSplit(splitKey, split);
    }, [split, storedSplit, splitKey]);
    const viewsRef = useRef<HTMLDivElement | null>(null);
    const { width: viewsWidth } = useContainerWidth(viewsRef, { throttleMs: 0 });
    // Narrower than two minimum panes: only the focused pane (the active tab)
    // shows, and the remembered split returns once there is room again.
    const splitShown = split !== null && active?.id === split[split.focus] && isSourceSplitWide(viewsWidth);
    const splitRatio = split === null ? 0.5 : clampSourceSplitRatio(split.ratio, viewsWidth);
    const splitPaneOf = (tabId: string): SourceSplitPane | null => {
        if (!splitShown || split === null) return null;
        if (tabId === split.left) return 'left';
        return tabId === split.right ? 'right' : null;
    };
    const splitLeftBasis = `calc((100% - ${SOURCE_SPLIT_DIVIDER_WIDTH}px) * ${splitRatio})`;
    const splitLeftId = split?.left;
    const splitRightId = split?.right;
    useEffect(() => {
        if (!splitShown || !isOpen || !splitLeftId || !splitRightId) return;
        setMountedIds(prev => (prev.has(splitLeftId) && prev.has(splitRightId)
            ? prev
            : new Set(prev).add(splitLeftId).add(splitRightId)));
    }, [splitShown, isOpen, splitLeftId, splitRightId]);
    // A tree click replaces the preview slot; the pane the user is not working
    // in must never be the tab that disappears under it.
    const unfocusedSplitId = split === null ? null : split[otherSourceSplitPane(split.focus)];
    useEffect(() => {
        if (unfocusedSplitId !== null && tabs.some(tab => tab.id === unfocusedSplitId && tab.preview)) {
            promote(unfocusedSplitId);
        }
    }, [unfocusedSplitId, tabs, promote]);
    // Each file tab's live text model, so the second pane of a file shown on
    // both sides attaches to the same buffer.
    const [sourceModels, setSourceModels] = useState<ReadonlyMap<string, EditorModelMountContext>>(() => new Map());
    const handleSourceModelChange = useCallback((tabId: string, context: EditorModelMountContext | null) => {
        setSourceModels(prev => {
            if ((prev.get(tabId) ?? null) === context) return prev;
            const next = new Map(prev);
            if (context) next.set(tabId, context);
            else next.delete(tabId);
            return next;
        });
    }, []);
    const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
    const [splitDropHover, setSplitDropHover] = useState(false);
    const splitDropAvailable = splitEnabled && canSplitTab(tabs.find(tab => tab.id === draggedTabId));
    const handleTabDragChange = useCallback((tabId: string | null) => {
        setDraggedTabId(tabId);
        setSplitDropHover(false);
    }, []);

    // Tabs whose views are live right now: mounted, and still visible from this
    // chat. Dropping the invisible ones is what makes a chat switch swap the
    // chat-owned views without disturbing the workspace ones.
    const retainedScope = JSON.stringify([workspaceId, routingRef]);
    const retainedScopeRef = useRef(retainedScope);
    const retainedWorkTabs = useRef(new Map<string, UnifiedPanelTab>());
    const mountedTabs = useMemo(() => {
        if (retainedScopeRef.current !== retainedScope) {
            retainedWorkTabs.current.clear();
            retainedScopeRef.current = retainedScope;
        }
        const live = tabs.filter(tab => mountedIds.has(tab.id));
        for (const tab of live) {
            if (tab.kind === 'work-items' || tab.kind === 'pull-requests') retainedWorkTabs.current.set(tab.id, tab);
        }
        return [...live, ...Array.from(retainedWorkTabs.current.values()).filter(tab => !live.some(item => item.id === tab.id))];
    }, [tabs, mountedIds, retainedScope]);
    // A collapsed canvas burst: the active canvas carries the switcher chip in
    // its own header, next to the title (the strip shows it otherwise).
    const stackedCanvasTabs = useMemo(() => groupsEnabled ? [] : compressedCanvasTabs(tabs, activeId).canvasTabs, [tabs, activeId, groupsEnabled]);

    const targetOptions = targets ?? dock.targets;
    const targetLabel = useMemo(
        () => targetOptions.find(option => option.workspaceId === target)?.label,
        [targetOptions, target],
    );
    const targetRoutingRef = useMemo(
        () => routingRefForPanelOwner(routingRef, target),
        [routingRef, target],
    );
    const rootPathForTab = useCallback(
        (tab: (typeof tabs)[number]) => (
            (tab.ownerRoutingRef ?? null) !== (routingRefForPanelOwner(routingRef, tab.ownerWorkspaceId) ?? null)
                ? undefined
                : tab.ownerWorkspaceId === workspaceId
                    ? workspaceRootPath
                    : targetOptions.find(option => option.workspaceId === tab.ownerWorkspaceId)?.rootPath
        ),
        [routingRef, targetOptions, workspaceId, workspaceRootPath],
    );
    const definitionPreviewOwners = useMemo(() => (
        repoGroup
            ? targetOptions
                .filter(option => !option.disabled && !option.deprioritized)
                .map(option => ({
                    workspaceId: option.workspaceId,
                    routingRef: routingRefForPanelOwner(routingRef, option.workspaceId),
                }))
            : undefined
    ), [repoGroup, targetOptions, routingRef]);

    // New workspace resources open against the dock's current target, and carry
    // a repo label when that is not the panel's own workspace (a group member or
    // a remote clone) so two same-named tabs stay tellable apart.
    // Explicit menu intent is ephemeral; restored descriptors never create PTYs.
    const [terminalOpenRequests, setTerminalOpenRequests] = useState<Record<string, number>>({});
    useEffect(() => {
        setTerminalOpenRequests(prev => {
            const retained = Object.fromEntries(Object.entries(prev).filter(([id]) => state.tabs.some(tab => tab.id === id)));
            return Object.keys(retained).length === Object.keys(prev).length ? prev : retained;
        });
    }, [state.tabs]);
    const openWorkspaceResource = useCallback((kind: 'terminal' | 'notes' | 'settings' | 'work-items' | 'pull-requests') => {
        if (kind === 'work-items' || kind === 'pull-requests') {
            open({ ...panelWorkspaceResourceInput(kind, { workspaceId: target, routingRef: targetRoutingRef ?? null, chatId }), ...(target !== workspaceId ? { repoLabel: targetLabel } : {}) });
            return;
        }
        if (kind !== 'terminal') {
            open(panelWorkspaceResourceInput(kind, { workspaceId, routingRef: routingRef ?? null, chatId }));
            return;
        }
        const input: OpenUnifiedTabInput = {
            kind,
            ownerWorkspaceId: target,
            ownerRoutingRef: targetRoutingRef,
            chatId,
            resourceId: kind,
            label: 'Terminal',
            ...(target === workspaceId || !targetLabel ? {} : { repoLabel: targetLabel }),
        };
        open(input);
        const id = unifiedTabId(input);
        setTerminalOpenRequests(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    }, [open, workspaceId, target, targetLabel, chatId, targetRoutingRef, routingRef]);

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
    const modeColumnVisible = isUnifiedTreeVisible(tree.state, width);
    // Opens (never toggles) the Explorer navigator. `selectMode` closes the
    // whole panel when its mode is already selected, which is what the To-do
    // tab leaves behind after hiding the tree.
    const showExplorer = useCallback(() => {
        if (!isOpen || mode !== 'explorer') dock.selectMode('explorer');
        tree.setOpen(true);
    }, [dock, isOpen, mode, tree]);

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
    // toolbar. A null here removes the row and moves the navigator toggle into
    // the tab strip.
    const toolbar = useMemo(() => unifiedToolbarBreadcrumbs(active), [active]);

    const explorerToggle = useCallback(
        (placement: 'toolbar' | 'strip') => (
            <UnifiedPanelTreeToggle
                open={tree.state.open && mode === 'explorer'}
                onToggle={() => {
                    if (mode === 'explorer') {
                        tree.toggleOpen();
                        return;
                    }
                    dock.selectMode('explorer');
                    tree.setOpen(true);
                }}
                placement={placement}
            />
        ),
        [dock, mode, tree],
    );
    const navigatorControls = useCallback(
        (placement: 'toolbar' | 'strip') => {
            const active = tree.state.open && mode === 'search';
            const label = active ? 'Hide Search' : 'Show Search';
            return (
                <div className="flex flex-shrink-0 items-center" data-testid="unified-panel-navigator-controls">
                    <button
                        type="button"
                        aria-label={label}
                        aria-pressed={active}
                        title={label}
                        data-testid="unified-panel-search-toggle"
                        data-placement={placement}
                        onClick={() => {
                            if (active) {
                                tree.setOpen(false);
                                return;
                            }
                            if (mode !== 'search') dock.selectMode('search');
                            tree.setOpen(true);
                        }}
                        className={cn(
                            'flex flex-shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0',
                            'text-[#616161] hover:text-[#1f1f1f] focus-visible:outline-none focus-visible:ring-1',
                            'focus-visible:ring-inset focus-visible:ring-[#0078d4] dark:text-[#9d9d9d] dark:hover:text-white',
                            'dark:focus-visible:ring-[#3794ff]',
                            placement === 'strip'
                                ? 'h-[35px] w-8 border-l border-[#e5e5e5] dark:border-[#333]'
                                : 'h-5 w-5',
                            active && 'text-[#0078d4] dark:text-[#3794ff]',
                        )}
                    >
                        <SearchIcon />
                    </button>
                    {explorerToggle(placement)}
                </div>
            );
        },
        [dock, explorerToggle, mode, tree],
    );

    // What the tree column should track (AC-06). Breadcrumbs may browse through
    // the active file's owner even when that is not the tree on screen, but the
    // tree highlight must stay scoped to the dock's current target: a file tab
    // the tree can show reveals it, a file tab it cannot (another clone, a
    // trusted absolute path) drops the highlight, and any other kind — or no
    // tabs at all — leaves the tree exactly where it is.
    const trackedTreeFile = useMemo<string | null | undefined>(() => {
        if (toolbar === null) return undefined;
        return toolbar.interactive && active?.ownerWorkspaceId === target ? toolbar.path : null;
    }, [active?.ownerWorkspaceId, target, toolbar]);

    // ------------------------------------------------------------------
    // File location history
    // ------------------------------------------------------------------

    const navigationHistoryRef = useRef(readUnifiedPanelNavigationHistory(workspaceId));
    const navigationControllers = useRef(new Map<string, EditorNavigationController>());
    // Every file tab seen in this scope, closed ones included, so a location
    // recorded as its tab closes still carries what reopening it needs.
    const navigationFiles = useRef(new Map<string, UnifiedPanelNavigationFile>());
    const pendingNavigationReason = useRef<{ tabId: string; reason: EditorNavigationReason } | null>(null);
    // The entry a Back/Forward is bringing up, until its editor restores it.
    // `reopened` marks a tab the replay itself opened, so a missing file's
    // tab is closed again when the entry is skipped.
    const pendingReplay = useRef<PendingNavigationReplay | null>(null);
    const navigationScope = useRef(workspaceId);
    if (navigationScope.current !== workspaceId) {
        navigationScope.current = workspaceId;
        navigationHistoryRef.current = readUnifiedPanelNavigationHistory(workspaceId);
        navigationControllers.current.clear();
        navigationFiles.current.clear();
        pendingNavigationReason.current = null;
        pendingReplay.current = null;
    }
    const activeIdRef = useRef(activeId);
    activeIdRef.current = activeId;
    const fileIdentity = useFileIdentityOpen(JSON.stringify([workspaceId, routingRef, chatId]));
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;
    for (const tab of tabs) {
        if (tab.kind === 'file') navigationFiles.current.set(tab.id, navigationFileOf(tab));
    }
    const setNavigationHistory = useCallback((history: typeof navigationHistoryRef.current) => {
        navigationHistoryRef.current = history;
        writeUnifiedPanelNavigationHistory(workspaceId, history);
    }, [workspaceId]);

    const recordFileLocation = useCallback((
        tabId: string,
        snapshot: EditorNavigationSnapshot,
        reason: EditorNavigationReason,
    ) => {
        const file = navigationFiles.current.get(tabId);
        if (!file) return;
        setNavigationHistory(recordNavigationLocation(
            navigationHistoryRef.current,
            { scopeWorkspaceId: workspaceId, tabId, file, ...snapshot },
            reason,
        ));
    }, [setNavigationHistory, workspaceId]);

    const captureActiveFileLocation = useCallback((reason: EditorNavigationReason) => {
        const id = activeIdRef.current;
        if (id === null || tabsRef.current.find(tab => tab.id === id)?.kind !== 'file') return;
        const snapshot = navigationControllers.current.get(id)?.capture();
        if (snapshot) recordFileLocation(id, snapshot, reason);
    }, [recordFileLocation]);

    const prepareFileNavigation = useCallback((tabId: string, reason: EditorNavigationReason) => {
        captureActiveFileLocation(reason);
        pendingNavigationReason.current = { tabId, reason };
    }, [captureActiveFileLocation]);

    const restoreNavigationLocation = useCallback((
        location: UnifiedPanelNavigationLocation,
        controller: EditorNavigationController,
    ) => {
        controller.restore({ selection: location.selection });
        pendingReplay.current = null;
        setNavigationHistory(finishNavigationReplay(navigationHistoryRef.current));
    }, [setNavigationHistory]);

    const handleFileNavigationMount = useCallback((
        tabId: string,
        controller: EditorNavigationController | null,
    ) => {
        if (controller === null) {
            navigationControllers.current.delete(tabId);
            return;
        }
        navigationControllers.current.set(tabId, controller);
        const replay = pendingReplay.current;
        if (replay?.tabId === tabId) restoreNavigationLocation(replay, controller);
    }, [restoreNavigationLocation]);

    const handleFileNavigationLocation = useCallback((
        tabId: string,
        snapshot: EditorNavigationSnapshot,
        reason: EditorNavigationReason,
    ) => {
        if (activeIdRef.current !== tabId) return;
        const pending = pendingNavigationReason.current;
        const effectiveReason = pending?.tabId === tabId ? pending.reason : reason;
        if (pending?.tabId === tabId) pendingNavigationReason.current = null;
        recordFileLocation(tabId, snapshot, effectiveReason);
    }, [recordFileLocation]);

    const activateWithNavigation = useCallback((tabId: string) => {
        const target = tabsRef.current.find(tab => tab.id === tabId);
        if (target?.kind === 'todo' && mode === 'explorer') tree.setOpen(false);
        if (tabId === activeIdRef.current) return;
        if (target?.kind === 'file') prepareFileNavigation(tabId, 'navigation');
        else captureActiveFileLocation('navigation');
        activate(tabId);
    }, [activate, captureActiveFileLocation, prepareFileNavigation, mode, tree.setOpen]);

    const openToSide = useCallback((tabId: string) => {
        const tab = tabsRef.current.find(candidate => candidate.id === tabId);
        if (!splitEnabled || !canSplitTab(tab)) return;
        const current = tabsRef.current.find(candidate => candidate.id === activeIdRef.current) ?? null;
        writeSourceSplit(splitKeyRef.current, sourceSplitForDrop(splitRef.current, current, tab));
        activateWithNavigation(tabId);
    }, [activateWithNavigation, splitEnabled]);

    const focusSourcePane = useCallback((pane: SourceSplitPane) => {
        const current = splitRef.current;
        if (current === null || current.focus === pane) return;
        writeSourceSplit(splitKeyRef.current, { ...current, focus: pane });
        activateWithNavigation(current[pane]);
    }, [activateWithNavigation]);

    // Closing a pane ends the split only; both files stay ordinary tabs.
    const closeSourcePane = useCallback((pane: SourceSplitPane) => {
        const current = splitRef.current;
        if (current === null) return;
        writeSourceSplit(splitKeyRef.current, null);
        activateWithNavigation(current[otherSourceSplitPane(pane)]);
    }, [activateWithNavigation]);

    const setSourceSplitRatio = useCallback((ratio: number) => {
        const current = splitRef.current;
        if (current === null) return;
        const next = clampSourceSplitRatio(ratio, viewsRef.current?.clientWidth ?? 0);
        if (next !== current.ratio) writeSourceSplit(splitKeyRef.current, { ...current, ratio: next });
    }, []);
    const splitResizeCleanup = useRef<(() => void) | null>(null);
    useEffect(() => () => splitResizeCleanup.current?.(), []);
    const startSourceSplitResize = useCallback((event: ReactMouseEvent) => {
        const container = viewsRef.current;
        if (event.button !== 0 || !container) return;
        event.preventDefault();
        splitResizeCleanup.current?.();
        const onMove = (move: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            const paneArea = rect.width - SOURCE_SPLIT_DIVIDER_WIDTH;
            if (paneArea > 0) setSourceSplitRatio((move.clientX - rect.left - SOURCE_SPLIT_DIVIDER_WIDTH / 2) / paneArea);
        };
        const stop = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', stop);
            splitResizeCleanup.current = null;
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', stop);
        splitResizeCleanup.current = stop;
    }, [setSourceSplitRatio]);

    const previousActiveId = useRef(activeId);
    useEffect(() => {
        const previous = previousActiveId.current;
        previousActiveId.current = activeId;
        if (previous === activeId) return;

        if (previous !== null && tabsRef.current.find(tab => tab.id === previous)?.kind === 'file') {
            const source = navigationControllers.current.get(previous)?.capture();
            if (source) recordFileLocation(previous, source, 'navigation');
        }
        if (activeId !== null && active?.kind === 'file') {
            const destination = navigationControllers.current.get(activeId)?.capture();
            if (destination) handleFileNavigationLocation(activeId, destination, 'navigation');
        }
    }, [active?.kind, activeId, handleFileNavigationLocation, recordFileLocation]);

    useEffect(() => {
        const replay = pendingReplay.current;
        if (replay === null || replay.tabId !== activeId) return;
        const controller = navigationControllers.current.get(replay.tabId);
        if (controller) restoreNavigationLocation(replay, controller);
    }, [activeId, restoreNavigationLocation]);

    // Per-tab dirty / error state, reported by the views. It lives here rather
    // than in each view because the strip has to show it for tabs that are not
    // the visible one — an unsaved buffer or a failed read behind another tab is
    // exactly the state a user cannot otherwise find.
    const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
    const [errorIds, setErrorIds] = useState<ReadonlySet<string>>(() => new Set());
    const dirtyIdsRef = useRef(dirtyIds);
    dirtyIdsRef.current = dirtyIds;
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
    // Each file tab's "Reload from disk" handler and busy state; the toolbar
    // shows the active tab's. A tab unregisters itself when it unmounts.
    const [reloadControls, setReloadControls] = useState<Readonly<Record<string, FileReloadControl>>>({});
    const handleReloadControl = useCallback((id: string, control: FileReloadControl | null) => {
        setReloadControls(prev => {
            if (control === null) {
                if (!(id in prev)) return prev;
                const next = { ...prev };
                delete next[id];
                return next;
            }
            return { ...prev, [id]: control };
        });
    }, []);
    const navigateBrowser = useCallback(
        (id: string, url: string) => updateBrowser(id, { url, label: browserLabelForUrl(url) }),
        [updateBrowser],
    );
    const followBrowserPage = useCallback(
        (id: string, page: { url: string; title: string }) =>
            updateBrowser(id, { url: page.url, label: page.title || browserLabelForUrl(page.url) }),
        [updateBrowser],
    );

    // A page's new-window link opens as another browser tab with the opener's owner
    // and conversation, so it shares the opener's site session even if the dock
    // target moved since. An opener hidden in another conversation still counts.
    // A page an AI turn drives unseen opens its tab unseen too: no selection change,
    // and the guest is created here because the tab does not mount.
    const workspaceTabsRef = useRef(state.workspaceTabs);
    workspaceTabsRef.current = state.workspaceTabs;
    useEffect(() => {
        const bridge = desktopBrowserBridge();
        if (!bridge) return;
        return bridge.onNewTab(({ openerViewId, viewId, url, engine, background }) => {
            const opener = workspaceTabsRef.current.find(tab => tab.kind === 'browser' && tab.resourceId === openerViewId);
            const normalized = normalizeBrowserUrl(url);
            if (!opener || !normalized.ok) return;
            const input = { ...browserOpenInput({
                ownerWorkspaceId: opener.ownerWorkspaceId,
                ownerRoutingRef: opener.ownerRoutingRef,
                chatId: opener.browserChatId ?? chatId,
                repoLabel: opener.repoLabel,
                browserChatId: opener.browserChatId ?? null,
            }, normalized.url), ...(viewId ? { resourceId: viewId } : {}), browserEngine: engine };
            if (background !== true) { open(input); return; }
            openUnifiedPanelTab(workspaceId, input, { reveal: false, activate: false });
            attachBrowserWebview(input.resourceId, normalized.url, browserSessionKey(opener), bridge, engine);
        });
    }, [chatId, open, workspaceId]);

    // A web link clicked in a chat opens as a new browser tab owned by the dock
    // target; a link in a resource (a canvas) names its own owner and scope.
    useEffect(() => {
        const onOpenUrl = (event: Event) => {
            const detail = (event as CustomEvent<OpenBrowserUrlDetail>).detail;
            if (!detail || detail.handled || !desktopBrowserBridge()) return;
            const owner = detail.owner;
            if (owner && owner.scopeWorkspaceId !== workspaceId) return;
            const normalized = normalizeBrowserUrl(detail.url);
            if (!normalized.ok) return;
            detail.handled = true;
            const ownerWorkspaceId = owner ? owner.workspaceId : target;
            const ownerRoutingRef = owner ? owner.routingRef : targetRoutingRef;
            const repoLabel = owner ? targetOptions.find(option => option.workspaceId === ownerWorkspaceId)?.label : targetLabel;
            open(browserOpenInput({
                ownerWorkspaceId,
                ...(ownerRoutingRef === undefined ? {} : { ownerRoutingRef }),
                chatId: owner ? owner.chatId : chatId,
                ...(ownerWorkspaceId !== workspaceId && repoLabel ? { repoLabel } : {}),
            }, normalized.url));
            setWorkspaceDockOpen(workspaceId, true);
        };
        window.addEventListener(OPEN_BROWSER_URL_EVENT, onOpenUrl);
        return () => window.removeEventListener(OPEN_BROWSER_URL_EVENT, onOpenUrl);
    }, [chatId, open, target, targetLabel, targetOptions, targetRoutingRef, workspaceId]);

    useEffect(() => {
        const onOpenPage = (event: Event) => {
            const detail = (event as CustomEvent<OpenHtmlPageDetail>).detail;
            if (!detail || detail.scopeWsId !== workspaceId || !desktopHtmlPageBridge()) return;
            if (detail.chatId && detail.chatId !== chatId) return;
            detail.handled = true;
            open({
                kind: 'html-page',
                ownerWorkspaceId: detail.wsId,
                ownerRoutingRef: null,
                chatId,
                resourceId: detail.filePath,
                label: fileNameOf(detail.filePath.replace(/\\/g, '/')),
                htmlPageId: detail.pageId,
            });
            setWorkspaceDockOpen(workspaceId, true);
        };
        window.addEventListener('coc-open-html-page', onOpenPage);
        return () => window.removeEventListener('coc-open-html-page', onOpenPage);
    }, [chatId, open, workspaceId]);

    // ------------------------------------------------------------------
    // Close guard (AC-05)
    // ------------------------------------------------------------------

    // What each terminal tab currently has running. The terminal view reports
    // it because the tab's ✕ lives in the strip, outside that view — without
    // this the panel would either kill PTYs silently or prompt about a tab that
    // holds nothing but tombstones.
    const [terminalSessions, setTerminalSessions] = useState<Record<string, readonly UnifiedTerminalSession[]>>({});
    const terminalSessionsRef = useRef(terminalSessions);
    terminalSessionsRef.current = terminalSessions;
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
    const pendingPreviewOpen = useRef<{ tabId: string; open: () => void } | null>(null);

    const closeTab = useCallback((id: string) => {
        const tab = tabsRef.current.find(candidate => candidate.id === id);
        if (tab?.kind === 'html-page' && tab.htmlPageId) {
            removeBrowserWebview(HTML_PAGE_VIEW_PREFIX + tab.htmlPageId);
            desktopHtmlPageBridge()?.close(tab.htmlPageId);
        } else if (tab?.kind === 'browser') {
            removeBrowserWebview(tab.resourceId);
            desktopBrowserBridge()?.close(tab.resourceId);
        }
        // Closing a pane's file ends the split and shows the other pane's file.
        const currentSplit = splitRef.current;
        const remainingPaneId = currentSplit === null || (currentSplit.left !== id && currentSplit.right !== id)
            ? null
            : currentSplit.left === id ? currentSplit.right : currentSplit.left;
        close(id);
        if (remainingPaneId !== null && remainingPaneId !== id) {
            writeSourceSplit(splitKeyRef.current, null);
            activate(remainingPaneId);
        }
        navigationControllers.current.delete(id);
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
            queued.open();
        }
        // No flag clearing here on purpose: closing unmounts the view, and the
        // views report clean/ready from their own unmount cleanup, so a second
        // reset would be dead code. Verified by removing the cleanup's effect in
        // the close/reopen case rather than assumed.
    }, [activate, close]);

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

    const bulkCloseQueue = useRef<string[]>([]);
    const drainBulkCloseRef = useRef<() => void>(() => undefined);
    const scheduleBulkCloseContinuation = useCallback(() => {
        if (bulkCloseQueue.current.length === 0) return;
        queueMicrotask(() => drainBulkCloseRef.current());
    }, []);

    // A user close that actually removed a tab, and finished any bulk queue,
    // asks the next render to decide whether the panel collapses. It is decided
    // after the tabs update rather than here because a bulk close only settles
    // once the last queued target is gone, and a cancelled guard never gets here.
    const collapseCheckPending = useRef(false);
    // Only this deliberate path feeds Ctrl/Cmd+Shift+T; cleanup closes call
    // `closeTab` directly and never become restorable.
    const closedTabScopeKey = closedBrowserTabScopeKey(workspaceId, chatId);
    const closedTabScopeKeyRef = useRef(closedTabScopeKey);
    closedTabScopeKeyRef.current = closedTabScopeKey;
    const closeTabByUser = useCallback((id: string) => {
        const tab = tabsRef.current.find(candidate => candidate.id === id);
        if (tab) recordClosedBrowserTab(closedTabScopeKeyRef.current, tab);
        closeTab(id);
        if (bulkCloseQueue.current.length === 0) collapseCheckPending.current = true;
    }, [closeTab]);

    // The strip's ✕ and the views' own close buttons both come through here. A
    // terminal tab with nothing running still closes immediately: an exited
    // session is a tombstone, and prompting to kill a process that already ended
    // is noise.
    const beginProtectedClose = useCallback((id: string): 'closed' | 'prompted' | 'missing' => {
        const tab = tabsRef.current.find(candidate => candidate.id === id);
        if (!tab) return 'missing';
        if (tab?.kind === 'terminal') {
            const sessionIds = liveTerminalSessionIds(terminalSessionsRef.current[id]);
            if (sessionIds.length > 0) {
                setPendingClose({ tabId: id, workspaceId: tab.ownerWorkspaceId, sessionIds });
                setCloseError(null);
                setCloseBusy(false);
                return 'prompted';
            }
        }
        if (needsDirtyCloseConfirm(tab, dirtyIdsRef.current.has(id))) {
            setPendingDirty({ tabId: id, label: dirtyCloseLabel(tab) });
            setDirtyError(null);
            setDirtySaving(false);
            return 'prompted';
        }
        closeTabByUser(id);
        return 'closed';
    }, [closeTabByUser]);

    const drainBulkClose = useCallback(() => {
        while (bulkCloseQueue.current.length > 0) {
            const id = bulkCloseQueue.current.shift()!;
            if (beginProtectedClose(id) === 'prompted') return;
        }
    }, [beginProtectedClose]);
    drainBulkCloseRef.current = drainBulkClose;

    const requestClose = useCallback((id: string) => {
        beginProtectedClose(id);
    }, [beginProtectedClose]);

    // Native pages own their keyboard. The bridge identifies the source view;
    // never use stale DOM focus or close a different active tab after a switch.
    useEffect(() => desktopBrowserBridge()?.onCloseRequested?.(({ viewId }) => {
        const root = panelRootRef.current;
        const activeViewId = active?.kind === 'browser' ? active.resourceId
            : active?.kind === 'html-page' ? `${HTML_PAGE_VIEW_PREFIX}${active.htmlPageId}` : null;
        if (!isOpen || !root || root.offsetParent === null || activeViewId !== viewId) return;
        if (active) requestClose(active.id);
    }), [isOpen, active, requestClose]);

    const requestBulkClose = useCallback((ids: readonly string[]) => {
        bulkCloseQueue.current = [...ids];
        drainBulkClose();
    }, [drainBulkClose]);

    useEffect(() => {
        if (!collapseCheckPending.current) return;
        collapseCheckPending.current = false;
        if (shouldCollapseAfterClose({ visibleTabCount: tabs.length, navigatorVisible: modeColumnVisible })) {
            setWorkspaceDockOpen(workspaceId, false);
        }
    }, [tabs, modeColumnVisible, workspaceId]);

    // "Reveal in Explorer" asks the tree to reveal a specific tab's file even when
    // the passive tracking above already points at it (and so would not re-fire).
    const [treeRevealRequest, setTreeRevealRequest] = useState<
        { ownerWorkspaceId: string; path: string; nonce: number; directory?: boolean } | null
    >(null);
    useEffect(() => {
        const onOpenDirectory = (event: Event) => {
            const detail = (event as CustomEvent<OpenPanelDirectoryDetail>).detail;
            if (!detail || detail.scopeWorkspaceId !== workspaceId || detail.chatId !== chatId) return;
            if ((detail.ownerRoutingRef ?? null) !== (routingRefForPanelOwner(routingRef, detail.ownerWorkspaceId) ?? null)) return;
            if (detail.ownerWorkspaceId !== target && !targetOptions.some(option =>
                option.workspaceId === detail.ownerWorkspaceId && !option.disabled)) return;
            if (!dock.setTarget(detail.ownerWorkspaceId)) {
                detail.handled = true; // A declined dirty-buffer prompt is not a routing error.
                return;
            }
            detail.handled = true;
            showExplorer();
            setTreeRevealRequest(prev => ({
                ownerWorkspaceId: detail.ownerWorkspaceId,
                path: detail.path,
                directory: true,
                nonce: (prev?.nonce ?? 0) + 1,
            }));
        };
        window.addEventListener(OPEN_PANEL_DIRECTORY_EVENT, onOpenDirectory);
        return () => window.removeEventListener(OPEN_PANEL_DIRECTORY_EVENT, onOpenDirectory);
    }, [workspaceId, chatId, routingRef, dock, showExplorer, target, targetOptions]);

    // A tab opened from a keyboard or menu gesture (a reopened or duplicated web
    // tab) takes focus in the strip once it renders.
    const [focusTabId, setFocusTabId] = useState<string | null>(null);
    useEffect(() => {
        if (focusTabId === null) return;
        setFocusTabId(null);
        Array.from(panelRootRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
            .find(tab => tab.getAttribute('data-testid') === `unified-panel-tab-${focusTabId}`)?.focus();
    }, [focusTabId, tabs]);

    const handleTabMenuAction = useCallback((action: UnifiedPanelTabMenuAction, tabId: string) => {
        const tab = tabs.find(candidate => candidate.id === tabId);
        if (!tab) return;
        if (action === 'keep-open') {
            promote(tabId);
            return;
        }
        if (action === 'close') {
            requestClose(tabId);
            return;
        }
        if (
            action === 'close-others'
            || action === 'close-right'
            || action === 'close-saved'
            || action === 'close-all'
            || action === 'close-group'
            || action === 'close-others-in-group'
        ) {
            requestBulkClose(unifiedPanelBulkCloseTargets(tabs, tabId, action, dirtyIds));
            return;
        }
        if (action === 'duplicate') {
            const input = duplicateBrowserTabInput(tab, chatId);
            if (!input) {
                addToast('This tab cannot be duplicated.', 'error');
                return;
            }
            openBeside(input, tabId);
            setFocusTabId(unifiedTabId(input));
            return;
        }
        if (action === 'copy-path') {
            const path = unifiedPanelAbsoluteFilePath(tab, rootPathForTab(tab));
            if (!path) {
                addToast('File path is unavailable.', 'error');
                return;
            }
            void copyToClipboard(path).then(
                () => addToast('Path copied.', 'success'),
                () => addToast('Failed to copy file path.', 'error'),
            );
            return;
        }
        if (tab.kind !== 'file') return;
        if (action === 'open-to-side') {
            openToSide(tabId);
            return;
        }
        if (action === 'copy-relative-path') {
            const path = unifiedPanelRelativeFilePath(tab);
            if (path) void copyToClipboard(path).catch(err => console.error('Failed to copy relative file path:', err));
            return;
        }
        if (action === 'reveal-in-explorer') {
            const path = unifiedPanelRelativeFilePath(tab);
            if (!path || !dock.setTarget(tab.ownerWorkspaceId)) return;
            if (mode !== 'explorer') dock.selectMode('explorer');
            tree.setOpen(true);
            setTreeRevealRequest(prev => ({
                ownerWorkspaceId: tab.ownerWorkspaceId,
                path,
                nonce: (prev?.nonce ?? 0) + 1,
            }));
        }
    }, [addToast, chatId, dirtyIds, dock, mode, openBeside, openToSide, promote, requestBulkClose, requestClose, rootPathForTab, tabs, tree]);

    // Reusing the preview slot destroys the outgoing buffer, so it goes through
    // the same unsaved-edits guard a close does. Cancel or a failed save leaves
    // the old buffer, and the queued open is dropped with the prompt.
    const openPreviewGuarded = useCallback((input: OpenUnifiedPreviewTabInput, openIt: () => void) => {
        const outgoing = previewToReplace(input);
        if (outgoing !== null && dirtyIds.has(outgoing.id)) {
            pendingPreviewOpen.current = { tabId: outgoing.id, open: openIt };
            requestClose(outgoing.id);
            return;
        }
        openIt();
    }, [dirtyIds, previewToReplace, requestClose]);

    // Back/Forward. A destination whose tab is still visible is activated; a
    // closed one reopens as a preview in the current chat's view (VS Code).
    const navigateFileHistory = useCallback((direction: NavigationDirection): boolean => {
        const destination = navigationHistoryDestination(navigationHistoryRef.current, direction, workspaceId);
        if (destination === null) return false;

        const replay = (tabId: string, reopen: OpenUnifiedPreviewTabInput | null) => {
            const step = stepNavigationHistory(navigationHistoryRef.current, direction, workspaceId);
            if (step === null) return;
            setNavigationHistory(step.history);
            pendingNavigationReason.current = null;
            const location = { ...step.location, tabId };
            const controller = navigationControllers.current.get(tabId);
            if (reopen === null && controller && activeIdRef.current === tabId) {
                restoreNavigationLocation(location, controller);
                return;
            }
            pendingReplay.current = { ...location, direction, reopened: reopen !== null };
            if (reopen === null) activate(tabId);
            else openPreview(reopen);
        };

        if (tabsRef.current.some(tab => tab.kind === 'file' && tab.id === destination.tabId)) {
            replay(destination.tabId, null);
            return true;
        }
        const reopen = navigationReopenInput(destination, chatId);
        const commit = (path: string, signal?: AbortSignal) => {
            const input = { ...reopen, resourceId: path,
                label: path === reopen.resourceId ? reopen.label : path.split('/').pop()! };
            openPreviewGuarded(input, () => {
                if (!signal?.aborted) replay(unifiedTabId({ kind: 'file', ...input }), input);
            });
        };
        if (reopen.resourceId.startsWith(TRUSTED_PATH_PREFIX) || reopen.resourceId.startsWith(WORKSPACE_PREVIEW_PREFIX)) {
            commit(reopen.resourceId);
        } else {
            fileIdentity.open({ workspaceId: reopen.ownerWorkspaceId, routingRef: reopen.ownerRoutingRef }, reopen.resourceId,
                () => tabsRef.current.filter(tab => tab.kind === 'file'
                    && tab.ownerWorkspaceId === reopen.ownerWorkspaceId
                    && (tab.ownerRoutingRef ?? null) === (reopen.ownerRoutingRef ?? null)
                    && tab.chatId === reopen.chatId).map(tab => tab.resourceId), commit);
        }
        return true;
    }, [
        activate, chatId, openPreview, openPreviewGuarded, restoreNavigationLocation,
        setNavigationHistory, workspaceId, fileIdentity.open,
    ]);

    // A replayed file that fails to read is gone: drop its entries and keep
    // stepping the same way. With nothing left the key has already been
    // taken — the read only fails after the keypress.
    useEffect(() => {
        const replay = pendingReplay.current;
        if (replay === null || replay.tabId !== activeId || !errorIds.has(replay.tabId)) return;
        pendingReplay.current = null;
        setNavigationHistory(dropReplayedNavigationEntry(navigationHistoryRef.current, replay.direction));
        if (replay.reopened) closeTab(replay.tabId);
        navigateFileHistory(replay.direction);
    }, [activeId, closeTab, errorIds, navigateFileHistory, setNavigationHistory]);

    // A file picked in the tree opens against the dock's target, exactly as an
    // Explorer navigator tab's selection does — same descriptor builder, so the
    // tree column and the `+` menu file the same kind of tab.
    const openFileForOwner = useCallback(
        (
            file: { path: string; name: string; line?: number; column?: number },
            options: { preview: boolean },
            ownerWorkspaceId: string,
            ownerRoutingRef?: string | null,
            ownerLabel?: string,
            reason: 'navigation' | 'jump' = 'navigation',
        ) => {
            const commit = (resolvedPath: string, signal?: AbortSignal) => {
                const input = explorerFileTabInput({ ...file, path: resolvedPath, name: resolvedPath === file.path ? file.name : resolvedPath.split('/').pop()! }, {
                    ownerWorkspaceId,
                    ownerRoutingRef,
                    scopeWorkspaceId: workspaceId,
                    ownerLabel,
                    chatId,
                });
                if (input === null) return;
                // A double click (or any other permanent entry point) opens a normal
                // tab; only the tree's single click takes the preview slot (AC-03).
                if (!options.preview) {
                    prepareFileNavigation(unifiedTabId(input), reason);
                    open(input);
                    return;
                }
                const { kind: _kind, ...previewInput } = input;
                // Reusing the slot destroys the outgoing buffer, so it goes through
                // the same unsaved-edits guard a close does. In practice an edit has
                // already promoted the tab (AC-04), so this is a safety net: cancel
                // or a failed save leaves the old buffer, and the queued open is
                // dropped with the prompt.
                openPreviewGuarded(previewInput, () => {
                    if (signal?.aborted) return;
                    prepareFileNavigation(unifiedTabId({ kind: 'file', ...previewInput }), reason);
                    openPreview(previewInput);
                });
            };
            if (file.path.startsWith(TRUSTED_PATH_PREFIX)) { commit(file.path); return; }
            fileIdentity.open({ workspaceId: ownerWorkspaceId, routingRef: ownerRoutingRef }, file.path,
                () => tabsRef.current.filter(tab => tab.kind === 'file'
                    && tab.ownerWorkspaceId === ownerWorkspaceId
                    && (tab.ownerRoutingRef ?? null) === (ownerRoutingRef ?? null)
                    && tab.chatId === chatId).map(tab => tab.resourceId), commit);
        },
        [workspaceId, chatId, open, openPreview, openPreviewGuarded, prepareFileNavigation, fileIdentity.open],
    );
    const openTreeFile = useCallback(
        (
            file: { path: string; name: string; line?: number },
            options: { preview: boolean },
        ) => openFileForOwner(file, options, target, targetRoutingRef, targetLabel),
        [openFileForOwner, target, targetRoutingRef, targetLabel],
    );
    const openBreadcrumbFile = useCallback((file: { path: string; name: string }) => {
        if (!active || active.kind !== 'file') {
            return;
        }
        openFileForOwner(
            file,
            { preview: true },
            active.ownerWorkspaceId,
            active.ownerRoutingRef,
            active.repoLabel,
        );
    }, [active, openFileForOwner]);
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
    /** Which question the palette opens on: Ctrl+P files, Ctrl+, symbols. */
    const [paletteMode, setPaletteMode] = useState<PaletteMode>('files');
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
            file: { path: string; name: string; line: number; column: number; symbolCandidate?: true },
            origin: { ownerWorkspaceId: string; ownerRoutingRef?: string | null; repoLabel?: string },
        ) => {
            openFileForOwner(file, { preview: false }, origin.ownerWorkspaceId,
                origin.ownerRoutingRef, origin.repoLabel ?? (origin.ownerWorkspaceId === target ? targetLabel : undefined), 'jump');
        },
        [openFileForOwner, target, targetLabel],
    );

    /**
     * A definition that landed outside every workspace — a standard-library
     * header, a dependency source. It opens as a pinned external tab owned by
     * the member and concrete clone whose language server produced it, because
     * that host is the only one holding the capability behind it.
     */
    const openNavigationExternal = useCallback(
        (
            source: { resourceId: string; name: string; line: number; column: number },
            origin: { ownerWorkspaceId: string; ownerRoutingRef?: string | null; repoLabel?: string },
        ) => {
            open({
                kind: 'external',
                ownerWorkspaceId: origin.ownerWorkspaceId,
                ...(origin.ownerRoutingRef === undefined ? {} : { ownerRoutingRef: origin.ownerRoutingRef }),
                chatId,
                resourceId: source.resourceId,
                label: source.name,
                ...(origin.repoLabel === undefined ? {} : { repoLabel: origin.repoLabel }),
                line: source.line,
                column: source.column,
            });
        },
        [open, chatId],
    );

    /**
     * A file picked in either dialog. Same shape as the Explorer's own
     * `handleQuickOpenSelect`: a trusted absolute path is deliberate and
     * unwritable, so it lands as a pinned tab, and everything else
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
            openTreeFile({ path: filePath, name }, { preview: false });
            return;
        }
        const name = filePath.includes('/') ? filePath.slice(filePath.lastIndexOf('/') + 1) : filePath;
        openTreeFile({ path: filePath, name }, { preview: true });
    }, [tree, openTreeFile]);

    /**
     * A row picked in the palette, file or symbol. `position` is what tells the
     * two apart: a file opens in the preview slot the way a tree click would,
     * a symbol opens pinned on its declaration the way a definition jump does.
     * Everything between — group liveness, routing, dock retargeting — is the
     * same question for both and is asked once, here.
     */
    const handleQuickOpenSelect = useCallback(async (
        result: QuickOpenResult,
        position?: { line: number; column: number },
    ) => {
        if (!('workspaceId' in result) || !repoGroup) {
            if (position) {
                openNavigationFile(
                    { path: result.path, name: fileNameOf(result.path), ...position },
                    { ownerWorkspaceId: target, ownerRoutingRef: targetRoutingRef, repoLabel: targetLabel },
                );
                setQuickOpenVisible(false);
                return;
            }
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
        // Past the liveness and routing guards this pick is going to open
        // something, so the palette is done — otherwise it stays stacked over
        // the file it just opened. The single-repo branch closes the same way.
        setQuickOpenVisible(false);
        tree.setOpen(true);
        const name = fileNameOf(result.path);
        if (position) {
            openNavigationFile({ path: result.path, name, ...position }, {
                ownerWorkspaceId: result.workspaceId,
                ownerRoutingRef: routingRefForPanelOwner(routingRef, result.workspaceId),
                repoLabel: result.repoName,
            });
            return;
        }
        openFileForOwner(
            { path: result.path, name },
            { preview: true },
            result.workspaceId,
            routingRefForPanelOwner(routingRef, result.workspaceId),
            result.repoName,
        );
    }, [
        openNavigationFile,
        targetRoutingRef,
        targetLabel,
        repoGroup,
        target,
        dock,
        isOpen,
        mode,
        tree,
        openFileForOwner,
        handlePanelFileSelect,
        routingRef,
    ]);

    const panelRootRef = useRef<HTMLDivElement | null>(null);
    const navigatorRef = useRef<HTMLDivElement | null>(null);
    const todoViewKey = active?.kind === 'todo' ? JSON.stringify([workspaceId, chatId, activeId]) : null;
    const focusedTodo = useRef<string | null>(null);
    const todoInteractions = useRef(new WeakSet<Event>());
    const navigatorMode = useRef(mode);
    navigatorMode.current = mode;
    const setNavigatorOpen = tree.setOpen;

    // Activation is a boundary, not a standing visibility rule: explicit
    // Explorer opens must survive renders, ledger refreshes and item selection.
    useEffect(() => {
        focusedTodo.current = todoViewKey;
        if (todoViewKey !== null && navigatorMode.current === 'explorer') {
            setNavigatorOpen(false);
        }
    }, [todoViewKey, setNavigatorOpen]);
    // External folder controls can also select Explorer from an open Search
    // navigator. Both that mode change and a reopen retain explicit user intent.
    useEffect(() => {
        if (tree.state.open) focusedTodo.current = todoViewKey;
    }, [tree.state.open, todoViewKey, mode]);

    const focusTodoView = (event: { nativeEvent: Event }) => {
        if (!isOpen || todoViewKey === null) return;
        // React capture includes this view's portaled menus and dialogs.
        todoInteractions.current.add(event.nativeEvent);
        if (focusedTodo.current !== todoViewKey && navigatorMode.current === 'explorer') {
            setNavigatorOpen(false);
        }
        focusedTodo.current = todoViewKey;
    };

    // Panel chrome (including the Explorer toggle) does not leave the current
    // content view. Track deliberate pointer/focus moves to another surface;
    // To-do's capture handlers admit both non-focusable content and keyboard use.
    useEffect(() => {
        if (!isOpen || todoViewKey === null) return;
        const onInteraction = (event: Event) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (todoInteractions.current.has(event)) return;
            if (!panelRootRef.current?.contains(target) || navigatorRef.current?.contains(target)) {
                focusedTodo.current = null;
            }
        };
        document.addEventListener('pointerdown', onInteraction);
        document.addEventListener('focusin', onInteraction);
        return () => {
            document.removeEventListener('pointerdown', onInteraction);
            document.removeEventListener('focusin', onInteraction);
        };
    }, [isOpen, todoViewKey]);

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
                panelEligibleWhenClosed: shortcut !== 'exact' && repoGroup !== undefined,
            });
            if (owner !== 'panel') return;
            event.preventDefault();
            event.stopPropagation();
            if (shortcut === 'exact') {
                setQuickOpenVisible(false);
                setExactOpenVisible(true);
            } else {
                setExactOpenVisible(false);
                setPaletteMode(shortcut === 'goto' ? 'symbols' : 'files');
                setQuickOpenVisible(true);
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [isOpen, quickOpenVisible, exactOpenVisible, repoGroup]);

    // The visible Explorer navigator owns Ctrl/Cmd+F only while focus is inside
    // that column. Capture beats ExplorerPanel's bubble listener without
    // taking the shortcut from Monaco, diffs, terminals, or panel chrome.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (findFilterShortcut(event) === null) return;
            const root = panelRootRef.current;
            const column = root?.querySelector<HTMLElement>(
                '[data-testid="unified-panel-explorer-mode"]',
            ) ?? null;
            const filter = column?.querySelector<HTMLInputElement>(
                '[data-testid="explorer-search-input"]',
            ) ?? null;
            const focused = document.activeElement;
            const outcome = findFilterOwner({
                panelOpen: isOpen,
                explorerNavigatorVisible: mode === 'explorer' && modeColumnVisible,
                focusInNavigatorColumn: column !== null
                    && focused !== null
                    && focused !== document.body
                    && column.contains(focused),
                filterPresent: filter !== null,
            });
            if (outcome === 'ignore') return;
            event.preventDefault();
            event.stopPropagation();
            filter?.focus();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [isOpen, mode, modeColumnVisible]);

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

    // Alt+Left/Right belongs to the panel only when focus is inside a visible
    // file view (a focused strip tab keeps Alt+Arrow for reordering) and the requested history destination can actually be restored.
    // Calling preventDefault after the successful step preserves browser
    // navigation at both boundaries and everywhere outside this panel.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const direction = keyboardNavigationDirection(event);
            if (direction === null) return;
            const root = panelRootRef.current;
            const focused = document.activeElement;
            if (tabStripClaimsKey(event, focused)) return;
            if (!panelOwnsFileNavigation({
                panelVisible: isOpen && root?.offsetParent !== null,
                interactionOwned: root !== null
                    && focused !== null
                    && focused !== document.body
                    && root.contains(focused),
                activeFile: active?.kind === 'file',
            })) return;
            // A file a diff's go to definition opened goes back to that diff first.
            const handled = (direction === 'back' && active !== null && returnToDiffDefinitionOrigin(workspaceId, active.id))
                || navigateFileHistory(direction);
            if (!handled) return;
            event.preventDefault();
            event.stopPropagation();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [active, isOpen, navigateFileHistory, workspaceId]);

    // Browser/Electron auxiliary buttons are 3 (Back) and 4 (Forward). A
    // successful mousedown performs the step and claims its matching mouseup;
    // an invalid destination never suppresses either native event.
    useEffect(() => {
        const claimedButtons = new Set<number>();
        const onMouseDown = (event: MouseEvent) => {
            const direction = mouseNavigationDirection(event);
            if (direction === null) return;
            const root = panelRootRef.current;
            if (!panelOwnsFileNavigation({
                panelVisible: isOpen && root?.offsetParent !== null,
                interactionOwned: root !== null
                    && event.target instanceof Node
                    && root.contains(event.target),
                activeFile: active?.kind === 'file',
            })) return;
            if (!navigateFileHistory(direction)) return;
            claimedButtons.add(event.button);
            event.preventDefault();
            event.stopPropagation();
        };
        const onMouseUp = (event: MouseEvent) => {
            if (!claimedButtons.delete(event.button)) return;
            event.preventDefault();
            event.stopPropagation();
        };
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('mouseup', onMouseUp, true);
        return () => {
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('mouseup', onMouseUp, true);
        };
    }, [active?.kind, isOpen, navigateFileHistory]);

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
        scheduleBulkCloseContinuation();
    }, [scheduleBulkCloseContinuation]);

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
                closeTabByUser(tabId);
                scheduleBulkCloseContinuation();
            })
            .catch(err => {
                console.error('Failed to terminate terminal session:', err);
                setCloseBusy(false);
                setCloseError('Could not terminate the terminal session. The tab is still open.');
            });
    }, [pendingClose, closeBusy, closeTabByUser, scheduleBulkCloseContinuation]);

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
        scheduleBulkCloseContinuation();
    }, [scheduleBulkCloseContinuation]);

    /** Don't Save: close the tab and let the buffer go with it. */
    const discardAndClose = useCallback(() => {
        const pending = pendingDirty;
        if (pending === null) return;
        setPendingDirty(null);
        setDirtyError(null);
        closeTabByUser(pending.tabId);
        scheduleBulkCloseContinuation();
    }, [pendingDirty, closeTabByUser, scheduleBulkCloseContinuation]);

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
                closeTabByUser(pending.tabId);
                scheduleBulkCloseContinuation();
            });
    }, [pendingDirty, dirtySaving, closeTabByUser, scheduleBulkCloseContinuation]);

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

    const openBrowserFromShortcut = useCallback((url?: string) => {
        setMenuOpen(false);
        open(browserOpenInput({
            ownerWorkspaceId: target,
            ...(targetRoutingRef === undefined ? {} : { ownerRoutingRef: targetRoutingRef }),
            chatId,
            ...(target !== workspaceId && targetLabel ? { repoLabel: targetLabel } : {}),
        }, url));
    }, [open, target, targetRoutingRef, chatId, workspaceId, targetLabel]);

    // Whether SPA focus hands browser-style tab shortcuts (Ctrl/Cmd+T, Ctrl/Cmd+1–9) to this panel.
    const ownsBrowserTabShortcut = useCallback((): boolean => {
        const root = panelRootRef.current;
        const focused = document.activeElement;
        if (!isOpen || !root || root.offsetParent === null || !focused) { return false; }
        if (focused === document.body) {
            // Empty panels have no focused resource. Claim neutral focus only
            // when there is one visible panel, never an arbitrary workspace.
            const visiblePanels = Array.from(document.querySelectorAll<HTMLElement>(
                '[data-testid="unified-right-panel"][data-open="true"]',
            )).filter(panel => panel.offsetParent !== null);
            return visiblePanels.length === 1 && visiblePanels[0] === root;
        }
        if (!root.contains(focused)) { return false; }
        const inBrowser = active?.kind === 'browser'
            && focused.closest('[data-testid^="unified-panel-view-"]')?.getAttribute('data-testid')
                === `unified-panel-view-${active.id}`;
        // Browser address editing uses browser shortcuts; other editors and
        // terminal inputs retain their own bindings.
        return inBrowser || !!menuRef.current?.contains(focused) || !(isEditableTarget(focused)
            || focused.closest('[contenteditable="true"], .monaco-editor, .xterm'));
    }, [isOpen, active]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing
                || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey
                || event.key.toLowerCase() !== 't') { return; }
            if (!ownsBrowserTabShortcut()) { return; }
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) { openBrowserFromShortcut(); }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [ownsBrowserTabShortcut, openBrowserFromShortcut]);

    // Ctrl/Cmd+1–9 (`features.browserTabShortcuts`): the digit picks a web tab
    // by the number its strip hint shows (9 is the last), read from the
    // rendered strip so reorder, close and folded groups never disagree with it.
    // Holding the modifier alone reveals the hints; release, another chord,
    // blur, a hidden page and any owner change hide them again.
    const [tabHintsVisible, setTabHintsVisible] = useState(false);
    const selectBrowserTabByDigit = useCallback((digit: number): boolean => {
        const browserTabs = Array.from(panelRootRef.current?.querySelectorAll<HTMLElement>(
            '[data-testid="unified-panel-tab-list"] [role="tab"][data-kind="browser"]',
        ) ?? []);
        const tab = browserTabForDigit(browserTabs, digit);
        const id = tab?.dataset.tabId;
        if (!tab || !id) return false;
        activateWithNavigation(id);
        tab.focus();
        return true;
    }, [activateWithNavigation]);
    // Latest values for the listeners below, so a tab switch mid-hold keeps the hints.
    const tabShortcutState = useRef({ active, owns: ownsBrowserTabShortcut, select: selectBrowserTabByDigit });
    tabShortcutState.current = { active, owns: ownsBrowserTabShortcut, select: selectBrowserTabByDigit };
    // Re-subscribing on an owner change (workspace, clone or chat) hides the hints.
    useEffect(() => {
        if (!browserTabShortcutsEnabled || !isOpen) return;
        const mac = browserTabShortcutsMac();
        let timer: ReturnType<typeof setTimeout> | null = null;
        const hide = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            setTabHintsVisible(false);
        };
        const reveal = () => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                setTabHintsVisible(true);
            }, BROWSER_TAB_HINT_DELAY_MS);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (isBrowserTabShortcutModifier(event, mac)) {
                if (!event.repeat && tabShortcutState.current.owns()) reveal();
                return;
            }
            const digit = browserTabShortcutDigit(event, mac);
            if (digit === null || event.defaultPrevented || event.isComposing || !tabShortcutState.current.owns()) {
                hide();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) tabShortcutState.current.select(digit);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (!browserTabShortcutModifierDown(event, mac)) hide();
        };
        const onVisibility = () => { if (document.visibilityState === 'hidden') hide(); };
        // A focused page cannot bubble keys here; only this panel's active,
        // visible web view is honoured, and its hold ends with its release.
        const offNative = desktopBrowserBridge()?.onTabShortcut?.(event => {
            const root = panelRootRef.current;
            const { active: current, select } = tabShortcutState.current;
            if (!root || root.offsetParent === null || current?.kind !== 'browser' || current.resourceId !== event.viewId) return;
            if (typeof event.digit === 'number') select(event.digit);
            else if (event.held === true) reveal();
            else if (event.held === false) hide();
        });
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', hide);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            offNative?.();
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', hide);
            document.removeEventListener('visibilitychange', onVisibility);
            hide();
        };
    }, [browserTabShortcutsEnabled, isOpen, workspaceId, routingRef, chatId]);
    // Native pages forward these keys only after this window opts in.
    useEffect(() => {
        desktopBrowserBridge()?.setTabShortcuts?.(browserTabShortcutsEnabled);
    }, [browserTabShortcutsEnabled]);

    // Native guests send this source-qualified event after returning host focus.
    useEffect(() => desktopBrowserBridge()?.onOpenMenuRequested?.(({ viewId }) => {
        const root = panelRootRef.current;
        if (!isOpen || !root || root.offsetParent === null
            || active?.kind !== 'browser' || active.resourceId !== viewId) { return; }
        openBrowserFromShortcut();
    }), [isOpen, active, openBrowserFromShortcut]);

    // Ctrl/Cmd+Shift+T restores this exact panel scope's newest closed web tab
    // through the ordinary open path (fresh view id), then focuses its strip tab.
    // An entry whose owner is no longer a target here is dropped, never retargeted.
    const reopenClosedBrowserTab = useCallback((): boolean => {
        const entry = popClosedBrowserTab(closedTabScopeKey);
        if (entry === null) return false;
        const ownerAvailable = entry.ownerWorkspaceId === workspaceId
            || targetOptions.some(option => option.workspaceId === entry.ownerWorkspaceId && !option.disabled);
        if (!ownerAvailable || (entry.ownerRoutingRef ?? null)
            !== (routingRefForPanelOwner(routingRef, entry.ownerWorkspaceId) ?? null)) { return false; }
        setMenuOpen(false);
        const input = reopenBrowserTabInput(entry);
        open(input);
        setFocusTabId(unifiedTabId(input));
        return true;
    }, [closedTabScopeKey, workspaceId, targetOptions, routingRef, open]);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || reopenClosedTabShortcut(event) === null) return;
            const root = panelRootRef.current;
            const focused = document.activeElement;
            if (!isOpen || !root || root.offsetParent === null || !focused
                || focused === document.body || !root.contains(focused)) { return; }
            // Focus is ours: an empty stack still keeps the outer browser's reopen.
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) reopenClosedBrowserTab();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [isOpen, reopenClosedBrowserTab]);
    // A focused native page cannot bubble keys here; only the event naming this
    // panel's active browser view is honoured. A restore makes that view
    // inactive, so `restored` drops requests that land before the re-render.
    useEffect(() => {
        let restored = false;
        return desktopBrowserBridge()?.onReopenClosedRequested?.(({ viewId }) => {
            const root = panelRootRef.current;
            if (restored || !isOpen || !root || root.offsetParent === null
                || active?.kind !== 'browser' || active.resourceId !== viewId) { return; }
            restored = reopenClosedBrowserTab();
        });
    }, [isOpen, active, reopenClosedBrowserTab]);

    // A concrete resource picked in the menu (a searched file, a chat canvas).
    // The menu decides the descriptor — owning clone, chat scope, normalized
    // identity — so the panel only has to file it.
    const openResource = useCallback((input: OpenUnifiedTabInput) => {
        setMenuOpen(false);
        if (input.kind === 'file' && !input.resourceId.startsWith(WORKSPACE_PREVIEW_PREFIX)) {
            openFileForOwner({ path: input.resourceId, name: input.label, line: input.line, column: input.column },
                { preview: false }, input.ownerWorkspaceId, input.ownerRoutingRef, input.repoLabel);
        } else open(input);
    }, [open, openFileForOwner]);

    // A hosted Sentinel chat's To-do tab. The owner is the chat's parent
    // workspace on the panel's server, including repo-group members.
    const sentinelChat = useSentinelTodoChat(workspaceId, chatId);
    const todoOwner = useMemo<SentinelTodoOwner | null>(() => {
        if (sentinelChat === null) return null;
        return {
            ownerWorkspaceId: sentinelChat.ownerWorkspaceId,
            processId: sentinelChat.processId,
            ownerRoutingRef: routingRefForPanelOwner(routingRef, sentinelChat.ownerWorkspaceId),
        };
    }, [sentinelChat, workspaceId, routingRef]);
    const todoInput = useMemo(
        () => (todoOwner !== null && chatId !== null ? sentinelTodoTabInput(todoOwner, chatId) : null),
        [todoOwner, chatId],
    );
    // First tracking use opens To-do only when the chat shows no tab at all, so
    // it never steals focus or reopens a tab the user closed.
    const panelStateRef = useRef(state);
    panelStateRef.current = state;
    useSentinelTodoEvents(todoOwner, event => {
        if (todoInput === null || chatId === null) return;
        if (!shouldAutoOpenSentinelTodoTab(panelStateRef.current, chatId, todoInput, event)) return;
        open(todoInput);
        setWorkspaceDockOpen(workspaceId, true);
    });

    // The strip's repo picker. A switch closes the "+" menu: its search results
    // are scoped to the repo that was current when they were fetched, so keeping
    // it open would list files from the repo the user just left.
    const selectTarget = useCallback((next: string) => {
        const switched = dock.setTarget(next);
        if (switched) setMenuOpen(false);
        return switched;
    }, [dock.setTarget]);

    const toggleMenu = useCallback(() => {
        menuTriggerRef.current = document.activeElement as HTMLElement | null;
        setMenuOpen(prev => !prev);
    }, []);

    return (
        <div
            ref={panelRootRef}
            className={cn(
                'unified-right-panel flex h-full border-l border-[#e5e5e5] dark:border-[#333]',
                expanded ? 'min-w-0 flex-1' : 'flex-shrink-0',
            )}
            // Collapsed hides the column without unmounting it: tabs, drafts,
            // and terminal sessions all survive a collapse/reopen cycle.
            style={{ display: isOpen ? undefined : 'none' }}
            data-testid="unified-right-panel"
            data-open={isOpen ? 'true' : 'false'}
            data-expanded={expanded ? 'true' : 'false'}
        >
            {/* Left-edge resize handle — drag left to widen the right-anchored panel.
                Hidden while expanded: there is nothing left of the panel to resize against. */}
            {!expanded && <div
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
            </div>}

            <div
                className={cn('relative flex min-h-0 flex-col overflow-hidden', expanded && 'min-w-0 flex-1')}
                style={expanded ? undefined : { width }}
                data-testid="unified-panel-body"
            >
                {fileIdentity.error}
                <UnifiedPanelTabStrip
                    hideBrowserRepoLabels={isRepoGroupWorkspaceId(workspaceId)}
                    tabs={tabs}
                    activeId={activeId}
                    dirtyIds={dirtyIds}
                    errorIds={errorIds}
                    onActivate={activateWithNavigation}
                    onClose={requestClose}
                    onCloseMany={requestBulkClose}
                    onMove={move}
                    reorderEnabled={reorderEnabled}
                    browserShortcuts={browserTabShortcutsEnabled ? { mac: browserTabShortcutsMac(), hintsVisible: tabHintsVisible } : null}
                    groupsEnabled={groupsEnabled}
                    foldedGroups={foldedGroups}
                    onToggleGroup={group => toggleGroupFolded(workspaceId, group)}
                    reorderScope={JSON.stringify([workspaceId, routingRef, chatId])}
                    pinnedId={pinnedId}
                    onPromote={promote}
                    fileActionAvailability={tab => ({
                        ...unifiedPanelFileActionAvailability(tab, rootPathForTab(tab)),
                        openToSide: splitEnabled,
                    })}
                    onMenuAction={handleTabMenuAction}
                    onTabDragChange={handleTabDragChange}
                    contextDragPayload={tab => tab.kind === 'file' && isSessionContextAttachmentsEnabled()
                        ? createWorkingTreeFileContextPayload(tab) : null}
                    onOpenMenu={toggleMenu}
                    leadingControls={(
                        <UnifiedPanelRepoPicker
                            target={target}
                            targets={targetOptions}
                            onSelectTarget={selectTarget}
                        />
                    )}
                    trailing={toolbar === null ? navigatorControls('strip') : undefined}
                />

                {menuOpen && (
                    <div ref={menuRef} className="contents">
                        <UnifiedPanelOpenMenu
                            settingsAvailable={settingsOwner === (routingRef ?? workspaceId)}
                            workspaceId={workspaceId}
                            chatId={chatId}
                            target={target}
                            targetRoutingRef={targetRoutingRef}
                            targets={targetOptions}
                            onOpenResource={openResource}
                            todoInput={todoInput}
                            onOpenWorkspaceResource={kind => {
                                setMenuOpen(false);
                                // Explorer is a panel mode, not a resource tab.
                                if (kind === 'explorer') {
                                    showExplorer();
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
                            workspaceId={active?.ownerWorkspaceId ?? target}
                            routingRef={active?.ownerRoutingRef}
                            onOpenFile={openBreadcrumbFile}
                            reload={active ? reloadControls[active.id] : undefined}
                            trailing={navigatorControls('toolbar')}
                        />
                    )}
                    {splitShown && split !== null && (
                        <div
                            className="flex h-[24px] flex-shrink-0 border-b border-[#e5e5e5] bg-[#f8f8f8] text-[11px] dark:border-[#333] dark:bg-[#252526]"
                            data-testid="unified-panel-split-header"
                        >
                            {(['left', 'right'] as const).map(pane => {
                                const paneTab = tabs.find(tab => tab.id === split[pane]);
                                const focused = split.focus === pane;
                                return (
                                    <div
                                        key={pane}
                                        className={cn(
                                            'flex min-w-0 items-center gap-1 border-t-2 px-2',
                                            focused ? 'border-[#0078d4] dark:border-[#3794ff]' : 'border-transparent',
                                        )}
                                        style={pane === 'left'
                                            ? { flex: `0 0 ${splitLeftBasis}`, marginRight: SOURCE_SPLIT_DIVIDER_WIDTH }
                                            : { flex: '1 1 0' }}
                                        data-testid={`unified-panel-split-pane-header-${pane}`}
                                        data-focused={focused ? 'true' : 'false'}
                                    >
                                        <button
                                            type="button"
                                            className="min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left text-[#3b3b3b] dark:text-[#cccccc]"
                                            aria-pressed={focused}
                                            title={paneTab ? dirtyCloseLabel(paneTab) : undefined}
                                            onClick={() => focusSourcePane(pane)}
                                            data-testid={`unified-panel-split-pane-label-${pane}`}
                                        >
                                            {paneTab?.label}
                                            {paneTab?.repoLabel ? <span className="sr-only"> — {paneTab.repoLabel}</span> : null}
                                            {paneTab && dirtyIds.has(paneTab.id) ? <span aria-label="Unsaved changes"> ●</span> : null}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Close ${pane} pane`}
                                            title={`Close ${pane} pane`}
                                            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-none bg-transparent p-0 text-[#616161] hover:bg-black/10 dark:text-[#9d9d9d] dark:hover:bg-white/10"
                                            onClick={() => closeSourcePane(pane)}
                                            data-testid={`unified-panel-split-close-${pane}`}
                                        >
                                            ×
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <div
                        ref={viewsRef}
                        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
                        data-testid="unified-panel-views"
                        data-split={splitShown ? 'true' : split !== null ? 'collapsed' : undefined}
                    >
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
                    ) : null}
                    {mountedTabs.map(tab => {
                            const pane = splitPaneOf(tab.id);
                            const visible = splitShown ? pane !== null : tab.id === activeId;
                            return (
                            <div
                                key={tab.id}
                                className={cn(
                                    'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                                    pane !== null && pane === split?.focus && 'ring-1 ring-inset ring-[#0078d4]/50 dark:ring-[#3794ff]/50',
                                )}
                                style={{
                                    display: visible ? undefined : 'none',
                                    ...(pane === 'left' ? { order: 0, flex: `0 0 ${splitLeftBasis}` } : {}),
                                    ...(pane === 'right' ? { order: 2 } : {}),
                                }}
                                data-testid={`unified-panel-view-${tab.id}`}
                                data-active={tab.id === activeId ? 'true' : 'false'}
                                data-split-pane={pane ?? undefined}
                                onPointerDownCapture={visible && tab.kind === 'todo' ? focusTodoView : undefined}
                                onMouseDownCapture={pane === null ? undefined : () => focusSourcePane(pane)}
                                onFocusCapture={visible && tab.kind === 'todo' ? focusTodoView
                                    : pane === null ? undefined : () => focusSourcePane(pane)}
                            >
                                {tab.kind === 'html-page' && tab.htmlPageId ? (
                                    <UnifiedHtmlPageTab
                                        tabId={tab.id}
                                        pageId={tab.htmlPageId}
                                        filePath={tab.resourceId}
                                        chatId={chatId}
                                        wsId={tab.ownerWorkspaceId}
                                        active={tab.id === activeId}
                                        visible={isOpen}
                                        nativeCovered={menuOpen || quickOpenVisible || exactOpenVisible || pendingClose !== null || pendingDirty !== null}
                                        onErrorChange={handleErrorChange}
                                    />
                                ) : tab.kind === 'browser' ? (
                                    <UnifiedBrowserTab
                                        workspaceId={tab.ownerWorkspaceId}
                                        routingRef={tab.ownerRoutingRef ?? null}
                                        tabId={tab.id}
                                        viewId={tab.resourceId}
                                        sessionKey={browserSessionKey(tab)}
                                        chatId={tab.browserChatId ?? (tab.ownerWorkspaceId === demoWorkspaceId && browserSessionKey(tab) === demoRoutingRef ? demoProcessId ?? null : null)}
                                        url={tab.browserUrl}
                                        relatedEngine={tab.browserEngine}
                                        active={tab.id === activeId}
                                        visible={isOpen}
                                        nativeCovered={menuOpen || quickOpenVisible || exactOpenVisible || pendingClose !== null || pendingDirty !== null}
                                        onOpenHistoryUrl={openBrowserFromShortcut}
                                        historyOwnerKey={JSON.stringify([target, targetRoutingRef])}
                                        onNavigate={navigateBrowser}
                                        onPageState={followBrowserPage}
                                    />
                                ) : <UnifiedTabView
                                    tab={tab}
                                    scopeWorkspaceId={workspaceId}
                                    definitionPreviewOwners={definitionPreviewOwners}
                                    onClose={requestClose}
                                    onDirtyChange={handleDirtyChange}
                                    onErrorChange={handleErrorChange}
                                    onRegisterSave={handleRegisterSave}
                                    onTerminalSessionsChange={handleTerminalSessions}
                                    terminalOpenRequest={terminalOpenRequests[tab.id]}
                                    isActive={isOpen && tab.id === activeId}
                                    onOpenFile={openNavigationFile}
                                    onOpenExternal={openNavigationExternal}
                                    onFileNavigationMount={handleFileNavigationMount}
                                    onFileNavigationLocation={handleFileNavigationLocation}
                                    onSourceModelChange={splitEnabled ? handleSourceModelChange : undefined}
                                    onReloadControlChange={handleReloadControl}
                                    onNotesSelectionChange={updateNotesSelection}
                                    canvasSwitcher={tab.id === activeId && stackedCanvasTabs.some(t => t.id === tab.id) ? (
                                        <UnifiedPanelCanvasStack
                                            tabs={stackedCanvasTabs}
                                            activeId={activeId}
                                            dirtyIds={dirtyIds}
                                            errorIds={errorIds}
                                            onActivate={activateWithNavigation}
                                            onClose={requestClose}
                                            onCloseMany={requestBulkClose}
                                            className="h-[22px]"
                                        />
                                    ) : undefined}
                                />}
                            </div>
                            );
                        })}

                    {splitShown && split !== null && (
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize source panes"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(splitRatio * 100)}
                            tabIndex={0}
                            className="flex-shrink-0 cursor-col-resize bg-[#e5e5e5] hover:bg-[#007acc]/40 focus-visible:bg-[#007acc]/60 focus-visible:outline-none dark:bg-[#333]"
                            style={{ order: 1, width: SOURCE_SPLIT_DIVIDER_WIDTH }}
                            data-testid="unified-panel-split-divider"
                            onMouseDown={startSourceSplitResize}
                            onKeyDown={event => {
                                const next = event.key === 'ArrowLeft' ? splitRatio - SOURCE_SPLIT_RATIO_STEP
                                    : event.key === 'ArrowRight' ? splitRatio + SOURCE_SPLIT_RATIO_STEP
                                        : event.key === 'Home' ? 0
                                            : event.key === 'End' ? 1 : null;
                                if (next === null) return;
                                event.preventDefault();
                                setSourceSplitRatio(next);
                            }}
                        />
                    )}
                    {/* One file in both panes: the right pane is a second editor
                        on the left pane's model, never a second buffer. */}
                    {splitShown && split !== null && split.left === split.right && (
                        <div
                            className={cn(
                                'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                                split.focus === 'right' && 'ring-1 ring-inset ring-[#0078d4]/50 dark:ring-[#3794ff]/50',
                            )}
                            style={{ order: 2 }}
                            data-split-pane="right"
                            onMouseDownCapture={() => focusSourcePane('right')}
                            onFocusCapture={() => focusSourcePane('right')}
                        >
                            <UnifiedSourceMirror
                                shared={sourceModels.get(split.left) ?? null}
                                onSave={() => saveHandlers.current.get(split.left)?.()}
                            />
                        </div>
                    )}

                    {/* A tab is selected but its view has not mounted yet (restored
                        while the panel was collapsed): show nothing rather than the
                        empty state, which would read as "no tabs". */}
                    {tabs.length > 0 && active !== null && !mountedIds.has(active.id) && (
                        <div className="min-h-0 flex-1" data-testid="unified-panel-pending" />
                    )}

                    {/* A source-file tab dragged from the strip can land on the
                        right half; other kinds never get a target. */}
                    {splitDropAvailable && (
                        <div
                            className={cn(
                                'absolute inset-y-0 right-0 z-20 flex w-1/2 items-center justify-center border-2 border-dashed text-xs',
                                splitDropHover
                                    ? 'border-[#0078d4] bg-[#0078d4]/15 text-[#0078d4] dark:border-[#3794ff] dark:text-[#3794ff]'
                                    : 'border-transparent bg-[#0078d4]/5 text-transparent',
                            )}
                            data-testid="unified-panel-split-drop-target"
                            data-hover={splitDropHover ? 'true' : 'false'}
                            onDragEnter={event => {
                                event.preventDefault();
                                setSplitDropHover(true);
                            }}
                            onDragOver={event => {
                                event.preventDefault();
                                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                                setSplitDropHover(true);
                            }}
                            onDragLeave={() => setSplitDropHover(false)}
                            onDrop={event => {
                                event.preventDefault();
                                const tabId = draggedTabId;
                                setDraggedTabId(null);
                                setSplitDropHover(false);
                                if (tabId !== null) openToSide(tabId);
                            }}
                        >
                            Open to the right
                        </div>
                    )}
                    </div>
                    </div>

                    {/* Search and Explorer share this one navigator slot and its
                        persisted width. A mode mounts on first use and then stays
                        mounted so switching never loses Search or tree state. */}
                    {mountedModes.size > 0 && (
                        <div
                            ref={navigatorRef}
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
                                            key={targetRoutingRef ?? target}
                                            workspaceId={target}
                                            routingRef={targetRoutingRef}
                                            // Same rule as an Explorer tab: only a column
                                            // pointed at the panel's own workspace may write
                                            // the explorer deep-link hash, or a group member's
                                            // file click would navigate out of the group.
                                            deepLink={target === workspaceId}
                                            mode="sidebar"
                                            activeFilePath={trackedTreeFile}
                                            revealRequest={
                                                treeRevealRequest?.ownerWorkspaceId === target
                                                    ? treeRevealRequest
                                                    : undefined
                                            }
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
                                            key={targetRoutingRef ?? target}
                                            workspaceId={target}
                                            routingRef={targetRoutingRef}
                                            stateKey={targetRoutingRef ?? target}
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
                        : { kind: 'repo', workspaceId: target, routingRef: targetRoutingRef }}
                    open={quickOpenVisible}
                    mode={paletteMode}
                    onClose={() => setQuickOpenVisible(false)}
                    onFileSelect={handleQuickOpenSelect}
                    onSymbolSelect={result => handleQuickOpenSelect(
                        {
                            path: result.path,
                            ...(result.workspaceId
                                ? { workspaceId: result.workspaceId, repoName: result.repoName ?? '' }
                                : {}),
                        } as QuickOpenResult,
                        { line: result.line, column: result.col },
                    )}
                />
                <ExactOpen
                    workspaceId={target}
                    routingRef={targetRoutingRef}
                    open={exactOpenVisible}
                    onClose={() => setExactOpenVisible(false)}
                    onFileSelect={handlePanelFileSelect}
                />

                <ToastContainer toasts={toasts} removeToast={removeToast} />

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
