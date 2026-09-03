import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../ui';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { useViewportWidth } from '../../hooks/ui/useViewportWidth';
import { TerminalView } from '../terminal/TerminalView';
import { DockNotesPanel } from '../notes/dock/DockNotesPanel';
import { ExplorerPanel } from './explorer/ExplorerPanel';
import { confirmDiscardExplorerEditsOnSwitch } from './explorer/explorerDirtyStore';
import {
    DOCK_INITIAL_WIDTH,
    DOCK_MIN_CHAT_WIDTH,
    DOCK_MIN_WIDTH,
    dockViewsForWorkspace,
    useDockOpen,
    workspaceDockOpenStorageKey,
    workspaceDockTargetStorageKey,
    workspaceDockViewStorageKey,
    workspaceDockWidthStorageKey,
    type DockTarget,
    type WorkspaceDockView,
} from './WorkspaceDockToggle';

// Re-export the light toggle/store API so existing importers of this module keep
// working (RepoDetail, tests). The TopBar imports `WorkspaceDockToggleButton`
// straight from './WorkspaceDockToggle' to stay clear of the TerminalView /
// ExplorerPanel (xterm / Monaco) graph that this module pulls in.
export {
    ALL_WORKSPACE_DOCK_VIEWS,
    DOCK_INITIAL_WIDTH,
    DOCK_MIN_CHAT_WIDTH,
    DOCK_MIN_WIDTH,
    WorkspaceDockToggleButton,
    dockViewsForWorkspace,
    useWorkspaceDockToggle,
    workspaceDockOpenStorageKey,
    workspaceDockTargetStorageKey,
    workspaceDockViewStorageKey,
    workspaceDockWidthStorageKey,
} from './WorkspaceDockToggle';
export type { DockTarget, WorkspaceDockView } from './WorkspaceDockToggle';

/**
 * WorkspaceRightDock — a VS Code-style right-side dock at the workspace level
 * (behind the `splitWorkspacePanel` flag) that hosts the existing Terminal, the
 * File Explorer, and a compact read-only Notes panel, switchable via compact
 * tabs in a single-row header. Which tabs appear depends on the workspace: a
 * repo group has no single repository root, so it drops Explorer and shows
 * Terminal|Notes (see `dockViewsForWorkspace`). The active terminal's toolbar
 * (picker + new-terminal action) portals into that same header row so the whole
 * bar reads as one control. It lives to the right of everything and stays
 * mounted across every sub-tab (chat, git, notes, work-items, …) so the running
 * PTY session and explorer state survive a sub-tab change, a dock close, or a
 * view switch.
 *
 * The dock reuses `TerminalView` / `ExplorerPanel` / `DockNotesPanel` unchanged
 * (`{ workspaceId }` only). Every available view stays mounted once the dock has
 * been opened; the inactive ones are hidden with `display:none` (the same
 * keep-alive pattern RepoDetail uses for its secondary sub-tabs) rather than
 * unmounted, so switching views — or closing and reopening the dock — never
 * tears down the server-side terminal session or loses the selected note.
 * Explorer is not mounted at all when the target has no repository root, so a
 * repo group pointed at its own root never pays for loading Monaco.
 *
 * Scope vs. target. `workspaceId` is the dock's SCOPE: it owns the open / view /
 * width / target persistence, and it is what Notes belongs to. The dock also has
 * a TARGET — the workspace Terminal and Explorer are pointed at — which equals
 * the scope unless the caller passes `targets`. A repo group passes its group
 * root plus its member repos, so the header gains a picker and the panel's own
 * state (open, active view, width) survives switching between members: only the
 * content follows the picker. Switching targets remounts Terminal and Explorer
 * exactly as a workspace switch already does; explorer state and pinned terminal
 * sessions rehydrate through their existing per-workspace stores.
 *
 * Open/closed state, the active view, and the dock width persist per-workspace to
 * localStorage (AC-06). The open/close toggle lives outside the dock body: the
 * classic chrome header owns it (RepoDetail), while the remote-first shell puts it
 * in the global TopBar (`WorkspaceDockToggleButton`). Because those toggles sit in
 * separate component subtrees from the body, the open flag is backed by a
 * cross-tree store (`useDockOpen`, in `WorkspaceDockToggle`) so every consumer
 * stays in sync — see `useWorkspaceDock` / `useWorkspaceDockToggle`.
 */

/**
 * Read the persisted view, falling back to the first available view when the
 * stored value is absent or names a view this workspace does not offer. Without
 * the membership check, a user with `explorer` persisted would land on a hidden
 * tab (and an empty dock) the moment they open a repo-group workspace.
 */
function readView(storageKey: string, available: readonly WorkspaceDockView[]): WorkspaceDockView {
    const fallback = available[0] ?? 'terminal';
    try {
        const stored = localStorage.getItem(storageKey);
        return available.includes(stored as WorkspaceDockView) ? (stored as WorkspaceDockView) : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Persisted active-view selector, scoped by `storageKey` and constrained to the
 * views `available` in this workspace. Only an explicit user switch persists
 * (never mount, and never a workspace switch — otherwise arriving at a repo
 * group would rewrite its stored preference with the fallback); the view
 * re-resolves from storage whenever the workspace changes. Defaults to the first
 * available view when unset or when the persisted view is unavailable here.
 */
function useDockView(
    storageKey: string,
    available: readonly WorkspaceDockView[],
): [WorkspaceDockView, (view: WorkspaceDockView) => void] {
    const [view, setViewState] = useState<WorkspaceDockView>(() => readView(storageKey, available));

    useEffect(() => {
        setViewState(readView(storageKey, available));
    }, [storageKey, available]);

    const setView = useCallback((next: WorkspaceDockView) => {
        setViewState(next);
        try {
            localStorage.setItem(storageKey, next);
        } catch {
            /* ignore */
        }
    }, [storageKey]);

    return [view, setView];
}

/**
 * Stable identity for a target list, so effects can depend on "the options
 * changed" rather than on the array reference. Includes the disabled flag —
 * a member going stale must be able to knock the current selection off it.
 */
const EMPTY_TARGETS: readonly DockTarget[] = [];

function targetsKeyOf(targets: readonly DockTarget[]): string {
    return targets.map(t => `${t.workspaceId}:${t.disabled ? '1' : '0'}${t.deprioritized ? 'd' : ''}`).join(',');
}

/**
 * Resolve the dock's target from storage: the persisted value when it is still
 * an enabled option, otherwise the first enabled option that is not
 * `deprioritized` (the first live repo-group member, rather than the group's
 * near-empty own root — D-07). With no usable options (none supplied, or every
 * one disabled) the dock targets its own scope, which is exactly today's
 * behavior for a plain repo.
 */
function readTarget(storageKey: string, targets: readonly DockTarget[], scopeWorkspaceId: string): string {
    const enabled = targets.filter(t => !t.disabled);
    if (enabled.length === 0) return scopeWorkspaceId;
    try {
        const stored = localStorage.getItem(storageKey);
        if (stored && enabled.some(t => t.workspaceId === stored)) return stored;
    } catch {
        /* ignore */
    }
    return (enabled.find(t => !t.deprioritized) ?? enabled[0]).workspaceId;
}

/**
 * Persisted target selector — which workspace the Terminal and Explorer are
 * pointed at. Mirrors `useDockView`: only an explicit user pick writes, and the
 * value re-resolves from storage whenever the scope or the option list changes
 * (so a group whose members are still loading starts on the scope and lands on
 * the first live member once they arrive).
 *
 * Switching goes through `confirmDiscardExplorerEditsOnSwitch`, the same guard a
 * whole-workspace switch gets — without it, picking another member repo would
 * silently drop a dirty Monaco buffer in the Explorer.
 */
function useDockTarget(
    storageKey: string,
    targets: readonly DockTarget[],
    scopeWorkspaceId: string,
): [string, (next: string) => void] {
    const targetsKey = targetsKeyOf(targets);
    const [target, setTargetState] = useState<string>(() => readTarget(storageKey, targets, scopeWorkspaceId));
    // Latest target, so `setTarget` can consult it without the confirm prompt
    // living inside a state updater (React may call those twice).
    const targetRef = useRef(target);
    targetRef.current = target;

    useEffect(() => {
        const resolved = readTarget(storageKey, targets, scopeWorkspaceId);
        targetRef.current = resolved;
        setTargetState(resolved);
        // `targets` is intentionally tracked via its stable key: the array is
        // rebuilt on every render by callers that map a fetch result, and
        // depending on the reference would re-resolve forever.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey, targetsKey, scopeWorkspaceId]);

    const setTarget = useCallback((next: string) => {
        if (next === targetRef.current) return;
        if (!confirmDiscardExplorerEditsOnSwitch(targetRef.current, next)) return;
        try {
            localStorage.setItem(storageKey, next);
        } catch {
            /* ignore */
        }
        targetRef.current = next;
        setTargetState(next);
    }, [storageKey]);

    return [target, setTarget];
}

export interface WorkspaceDockController {
    /** Whether the dock is currently open (persisted, default closed). */
    isOpen: boolean;
    /** Flip the open/closed state (wired to the header toggle button). */
    toggleOpen: () => void;
    /** Active view; persisted, default `terminal`. */
    view: WorkspaceDockView;
    /** Switch the active view (persisted). */
    setView: (view: WorkspaceDockView) => void;
    /**
     * Views the current *target* offers, in header-tab order —
     * `terminal|explorer|notes` for a concrete repo, `terminal|notes` when the
     * target is a repo group's own root.
     */
    views: readonly WorkspaceDockView[];
    /**
     * The workspace the Terminal and Explorer are pointed at. Equal to the dock's
     * scope (`workspaceId`) unless the caller supplied `targets` and the user
     * picked another one — a repo group pointing the dock at a member repo.
     */
    target: string;
    /**
     * Point the dock at another target (persisted). No-ops when the current
     * target has unsaved Explorer edits and the user declines to discard them.
     */
    setTarget: (target: string) => void;
    /** The target options, in picker order; empty when the caller supplied none. */
    targets: readonly DockTarget[];
    /**
     * Current dock width in px (persisted, default ~420). Clamped between
     * `DOCK_MIN_WIDTH` and the live viewport-relative `maxWidth`.
     */
    width: number;
    /**
     * Current max dock width in px — `max(DOCK_MIN_WIDTH, viewportWidth −
     * DOCK_MIN_CHAT_WIDTH)`. Recomputed as the window resizes; feeds the resize
     * handle's `aria-valuemax`.
     */
    maxWidth: number;
    /** Whether the resize handle is being dragged. */
    isDragging: boolean;
    /** Attach to the resize handle for mouse drags. */
    handleMouseDown: (e: React.MouseEvent) => void;
    /** Attach to the resize handle for touch drags. */
    handleTouchStart: (e: React.TouchEvent) => void;
}

/**
 * Owns the per-workspace dock state (open/view/width) so the header toggle button
 * (in RepoDetail) and the dock body share one source of truth. Call once per
 * RepoDetail render and pass the returned controller to `WorkspaceRightDock` and
 * the header toggle.
 */
export function useWorkspaceDock(workspaceId: string, targets?: readonly DockTarget[]): WorkspaceDockController {
    const [isOpen, toggleOpen] = useDockOpen(workspaceDockOpenStorageKey(workspaceId));
    const targetOptions = targets ?? EMPTY_TARGETS;
    const [target, setTarget] = useDockTarget(workspaceDockTargetStorageKey(workspaceId), targetOptions, workspaceId);
    // Views follow the TARGET, not the scope: pointing a group's dock at a member
    // repo brings Explorer back, pointing it at the group root drops it again —
    // all from the one existing rule. Memoized on the target string so
    // `useDockView`'s effect does not re-resolve on every render.
    const views = useMemo(() => dockViewsForWorkspace(target), [target]);
    const [view, setView] = useDockView(workspaceDockViewStorageKey(workspaceId), views);
    // Cap the dock relative to the live window so it can be dragged as wide as the
    // monitor allows, while always reserving DOCK_MIN_CHAT_WIDTH for the chat pane.
    // The floor at DOCK_MIN_WIDTH guards the min > max inversion on narrow windows.
    const viewportWidth = useViewportWidth();
    const maxWidth = Math.max(DOCK_MIN_WIDTH, viewportWidth - DOCK_MIN_CHAT_WIDTH);
    const { width, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        direction: 'right',
        initialWidth: DOCK_INITIAL_WIDTH,
        minWidth: DOCK_MIN_WIDTH,
        maxWidth,
        storageKey: workspaceDockWidthStorageKey(workspaceId),
    });

    return {
        isOpen, toggleOpen, view, setView, views, target, setTarget, targets: targetOptions,
        width, maxWidth, isDragging, handleMouseDown, handleTouchStart,
    };
}

const DOCK_VIEW_TABS: readonly {
    value: WorkspaceDockView;
    label: string;
    testId: string;
    icon: JSX.Element;
}[] = [
    {
        value: 'terminal',
        label: 'Terminal',
        testId: 'workspace-dock-view-terminal',
        icon: (
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3,4 6,8 3,12" />
                <line x1="8" y1="12" x2="13" y2="12" />
            </svg>
        ),
    },
    {
        value: 'explorer',
        label: 'Explorer',
        testId: 'workspace-dock-view-explorer',
        icon: (
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 4.2h4l1.2 1.6H14v6.9H2z" />
            </svg>
        ),
    },
    {
        value: 'notes',
        label: 'Notes',
        testId: 'workspace-dock-view-notes',
        icon: (
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 2.2h5.4L12.5 5.3v8.5H4z" />
                <polyline points="9.2,2.4 9.2,5.5 12.3,5.5" />
                <line x1="6" y1="8.2" x2="10.5" y2="8.2" />
                <line x1="6" y1="10.6" x2="10.5" y2="10.6" />
            </svg>
        ),
    },
];

/**
 * Compact view tabs for the dock's single-row header, limited to the views this
 * workspace offers (`views`). Underline marks the active view; the terminal
 * picker + new-terminal action portal into the same row to the right (see
 * WorkspaceRightDock), so the header reads as one bar rather than a stack of a
 * pill switcher over a separate terminal toolbar.
 */
function DockViewTabs({
    view,
    views,
    onChange,
}: {
    view: WorkspaceDockView;
    views: readonly WorkspaceDockView[];
    onChange: (value: WorkspaceDockView) => void;
}) {
    return (
        <div className="flex h-full flex-shrink-0 items-stretch" role="tablist" data-testid="workspace-dock-view-switcher">
            {DOCK_VIEW_TABS.filter(tab => views.includes(tab.value)).map(tab => {
                const active = view === tab.value;
                return (
                    <button
                        key={tab.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(tab.value)}
                        data-testid={tab.testId}
                        className={cn(
                            'flex items-center gap-1.5 px-2.5 text-xs border-b-2 -mb-px transition-colors',
                            active
                                ? 'border-[#0078d4] text-[#1f1f1f] dark:text-white'
                                : 'border-transparent text-[#616161] hover:text-[#1f1f1f] dark:text-[#9d9d9d] dark:hover:text-white',
                        )}
                    >
                        <span className="opacity-80">{tab.icon}</span>
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * The dock's target picker — "which repo are the Terminal and the Explorer
 * pointed at". Rendered in the header row between the view tabs and the portaled
 * terminal toolbar, and only when the caller supplied target options at all (a
 * repo group); a plain repo dock has exactly one possible target and shows
 * nothing. Disabled options (stale group members) stay listed so the reason is
 * visible, but cannot be selected.
 *
 * A native `<select>` keeps this a single 35px-tall control with keyboard and
 * screen-reader behavior for free; the label truncates rather than wrapping the
 * header row.
 */
function DockTargetPicker({
    target,
    targets,
    onChange,
}: {
    target: string;
    targets: readonly DockTarget[];
    onChange: (next: string) => void;
}) {
    return (
        <select
            data-testid="workspace-dock-target-picker"
            aria-label="Terminal and explorer target repository"
            title="Repository the terminal and explorer are pointed at"
            value={target}
            onChange={e => onChange(e.target.value)}
            className={cn(
                'ml-1 h-[22px] max-w-[160px] min-w-0 flex-shrink truncate rounded border border-transparent bg-transparent',
                'px-1 text-[11px] text-[#616161] hover:border-[#c8c8c8] hover:text-[#1f1f1f]',
                'focus:border-[#0078d4] focus:outline-none dark:text-[#9d9d9d] dark:hover:border-[#3c3c3c] dark:hover:text-white',
            )}
        >
            {targets.map(option => (
                <option key={option.workspaceId} value={option.workspaceId} disabled={option.disabled}>
                    {option.label}
                </option>
            ))}
        </select>
    );
}

export interface WorkspaceRightDockProps {
    /**
     * The dock's *scope*: which workspace owns its open/view/width/target
     * persistence, and which workspace Notes belongs to.
     */
    workspaceId: string;
    dock: WorkspaceDockController;
    /**
     * Optional target options for the header picker. Omit for a plain repo — the
     * dock then has no picker and targets its own scope. A repo group passes
     * `[{ group root }, ...members]`; pass the same array to `useWorkspaceDock`
     * so the selection resolves against it.
     */
    targets?: readonly DockTarget[];
}

/**
 * The dock body (right column). Rendered as the outermost-right column at the
 * workspace level. When closed the whole column is hidden with `display:none`,
 * which keeps the mounted views (and their live sessions) alive without taking
 * layout space. The open/close toggle lives outside the body (see
 * `WorkspaceDockToggleButton` / RepoDetail's header) and shares one cross-tree
 * store. Callers gate this on `splitWorkspacePanel` + desktop breakpoint.
 */
export function WorkspaceRightDock({ workspaceId, dock, targets }: WorkspaceRightDockProps) {
    const {
        isOpen, view, setView, views, target, setTarget,
        width, maxWidth, isDragging, handleMouseDown, handleTouchStart,
    } = dock;
    // A target with no single repository root (a repo group's own root) has no
    // meaningful file tree, so Explorer is neither tabbed nor mounted there —
    // such a dock never loads Monaco.
    const explorerAvailable = views.includes('explorer');
    // Options come from the prop when given, else from the controller, so a
    // caller may pass them to either (RepoGroupView passes the same array to
    // both). Absent on a plain repo → no picker at all.
    const targetOptions = targets ?? dock.targets;

    // Lazily mount the views on first open so opening a workspace never eagerly
    // spawns a terminal session for a dock the user never touches. Once opened,
    // both views stay mounted (inactive hidden) for the rest of the session.
    const [everOpened, setEverOpened] = useState(isOpen);
    useEffect(() => {
        if (isOpen) setEverOpened(true);
    }, [isOpen]);

    // The terminal toolbar portals into this header slot so the Terminal/Explorer
    // tabs and the terminal picker share one row. Only target it while the
    // terminal view is active; on Explorer the toolbar falls back to rendering
    // inline (hidden inside its display:none container).
    const [pickerSlot, setPickerSlot] = useState<HTMLDivElement | null>(null);

    return (
        <div
            className="workspace-right-dock flex h-full flex-shrink-0 border-l border-[#e5e5e5] dark:border-[#333]"
            style={{ display: isOpen ? undefined : 'none' }}
            data-testid="workspace-right-dock"
            data-open={isOpen ? 'true' : 'false'}
        >
            {/* Left-edge resize handle — drag left to widen the right-anchored dock. */}
            <div
                className={cn(
                    'group relative flex w-2 flex-shrink-0 cursor-col-resize items-center justify-center border-x border-[#e0e0e0] dark:border-[#333]',
                    'hover:bg-[#007acc]/15 active:bg-[#007acc]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/40 transition-colors',
                    isDragging && 'bg-[#007acc]/20',
                )}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                data-testid="workspace-dock-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize workspace dock"
                aria-valuemin={DOCK_MIN_WIDTH}
                aria-valuemax={maxWidth}
                aria-valuenow={width}
                tabIndex={0}
            >
                <span className="h-full w-px bg-[#c8c8c8] dark:bg-[#5a5a5a] group-hover:w-[2px] group-hover:bg-[#007acc] transition-all" />
            </div>

            {/* Dock body: single-row header (view tabs + portaled terminal toolbar)
                + the (keep-alive) views. */}
            <div
                className="flex min-h-0 flex-col overflow-hidden"
                style={{ width }}
                data-testid="workspace-dock-body"
            >
                <div
                    className="flex h-[35px] flex-shrink-0 items-center gap-1 border-b border-[#e5e5e5] pr-1 dark:border-[#333]"
                    data-testid="workspace-dock-header"
                >
                    <DockViewTabs view={view} views={views} onChange={setView} />
                    {targetOptions.length > 0 && (
                        <DockTargetPicker target={target} targets={targetOptions} onChange={setTarget} />
                    )}
                    {/* Portal target for the active terminal's toolbar (picker + new). */}
                    <div ref={setPickerSlot} className="flex min-w-0 flex-1 items-center" />
                </div>

                {everOpened && (
                    <>
                        <div
                            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                            style={{ display: view === 'terminal' ? undefined : 'none' }}
                            data-testid="workspace-dock-terminal"
                        >
                            <TerminalView
                                key={target}
                                workspaceId={target}
                                toolbarPortalTarget={view === 'terminal' ? pickerSlot : null}
                            />
                        </div>
                        {explorerAvailable && (
                            <div
                                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                                style={{ display: view === 'explorer' ? undefined : 'none' }}
                                data-testid="workspace-dock-explorer"
                            >
                                {/* Deep-linking only when the dock targets its own
                                    scope. A repo group's dock points Explorer at a
                                    MEMBER repo, and the hash it would write reads as
                                    "select that repo" — navigating the user out of
                                    the group on every file click. */}
                                <ExplorerPanel key={target} workspaceId={target} deepLink={target === workspaceId} />
                            </div>
                        )}
                        <div
                            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                            style={{ display: view === 'notes' ? undefined : 'none' }}
                            data-testid="workspace-dock-notes"
                        >
                            <DockNotesPanel key={workspaceId} workspaceId={workspaceId} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
