import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../ui';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { TerminalView } from '../terminal/TerminalView';
import { ExplorerPanel } from './explorer/ExplorerPanel';
import {
    DOCK_INITIAL_WIDTH,
    DOCK_MAX_WIDTH,
    DOCK_MIN_WIDTH,
    useDockOpen,
    workspaceDockOpenStorageKey,
    workspaceDockViewStorageKey,
    workspaceDockWidthStorageKey,
    type WorkspaceDockView,
} from './WorkspaceDockToggle';

// Re-export the light toggle/store API so existing importers of this module keep
// working (RepoDetail, tests). The TopBar imports `WorkspaceDockToggleButton`
// straight from './WorkspaceDockToggle' to stay clear of the TerminalView /
// ExplorerPanel (xterm / Monaco) graph that this module pulls in.
export {
    DOCK_INITIAL_WIDTH,
    DOCK_MAX_WIDTH,
    DOCK_MIN_WIDTH,
    WorkspaceDockToggleButton,
    useWorkspaceDockToggle,
    workspaceDockOpenStorageKey,
    workspaceDockViewStorageKey,
    workspaceDockWidthStorageKey,
} from './WorkspaceDockToggle';
export type { WorkspaceDockView } from './WorkspaceDockToggle';

/**
 * WorkspaceRightDock — a VS Code-style right-side dock at the workspace level
 * (behind the `splitWorkspacePanel` flag) that hosts the existing Terminal and
 * File Explorer, switchable via compact Terminal|Explorer tabs in a single-row
 * header. The active terminal's toolbar (picker + new-terminal action) portals
 * into that same header row so the whole bar reads as one control. It lives
 * to the right of everything and stays mounted across every sub-tab (chat, git,
 * notes, work-items, …) so the running PTY session and explorer state survive a
 * sub-tab change, a dock close, or a view switch.
 *
 * The dock reuses `TerminalView` / `ExplorerPanel` unchanged (`{ workspaceId }`
 * only). Both views stay mounted once the dock has been opened; the inactive one
 * is hidden with `display:none` (the same keep-alive pattern RepoDetail uses for
 * its secondary sub-tabs) rather than unmounted, so switching views — or closing
 * and reopening the dock — never tears down the server-side terminal session.
 *
 * Open/closed state, the active view, and the dock width persist per-workspace to
 * localStorage (AC-06). The open/close toggle lives outside the dock body: the
 * classic chrome header owns it (RepoDetail), while the remote-first shell puts it
 * in the global TopBar (`WorkspaceDockToggleButton`). Because those toggles sit in
 * separate component subtrees from the body, the open flag is backed by a
 * cross-tree store (`useDockOpen`, in `WorkspaceDockToggle`) so every consumer
 * stays in sync — see `useWorkspaceDock` / `useWorkspaceDockToggle`.
 */

function readView(storageKey: string): WorkspaceDockView {
    try {
        return localStorage.getItem(storageKey) === 'explorer' ? 'explorer' : 'terminal';
    } catch {
        return 'terminal';
    }
}

/**
 * Persisted active-view selector, scoped by `storageKey`. Mirrors
 * `useCollapsedState`: only writes on an explicit user switch (never on mount or
 * on a workspace switch) and re-syncs when the key changes. Defaults to
 * `terminal` when unset.
 */
function useDockView(storageKey: string): [WorkspaceDockView, (view: WorkspaceDockView) => void] {
    const [view, setViewState] = useState<WorkspaceDockView>(() => readView(storageKey));
    const skipPersistRef = useRef(true);

    useEffect(() => {
        skipPersistRef.current = true;
        setViewState(readView(storageKey));
    }, [storageKey]);

    useEffect(() => {
        if (skipPersistRef.current) {
            skipPersistRef.current = false;
            return;
        }
        try {
            localStorage.setItem(storageKey, view);
        } catch {
            /* ignore */
        }
    }, [view, storageKey]);

    const setView = useCallback((next: WorkspaceDockView) => setViewState(next), []);
    return [view, setView];
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
    /** Current dock width in px (persisted, default ~420, clamped 280–800). */
    width: number;
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
export function useWorkspaceDock(workspaceId: string): WorkspaceDockController {
    const [isOpen, toggleOpen] = useDockOpen(workspaceDockOpenStorageKey(workspaceId));
    const [view, setView] = useDockView(workspaceDockViewStorageKey(workspaceId));
    const { width, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        direction: 'right',
        initialWidth: DOCK_INITIAL_WIDTH,
        minWidth: DOCK_MIN_WIDTH,
        maxWidth: DOCK_MAX_WIDTH,
        storageKey: workspaceDockWidthStorageKey(workspaceId),
    });

    return { isOpen, toggleOpen, view, setView, width, isDragging, handleMouseDown, handleTouchStart };
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
];

/**
 * Compact Terminal | Explorer tabs for the dock's single-row header. Underline
 * marks the active view; the terminal picker + new-terminal action portal into
 * the same row to the right (see WorkspaceRightDock), so the header reads as one
 * bar rather than a stack of a pill switcher over a separate terminal toolbar.
 */
function DockViewTabs({
    view,
    onChange,
}: {
    view: WorkspaceDockView;
    onChange: (value: WorkspaceDockView) => void;
}) {
    return (
        <div className="flex h-full flex-shrink-0 items-stretch" role="tablist" data-testid="workspace-dock-view-switcher">
            {DOCK_VIEW_TABS.map(tab => {
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

export interface WorkspaceRightDockProps {
    workspaceId: string;
    dock: WorkspaceDockController;
}

/**
 * The dock body (right column). Rendered as the outermost-right column at the
 * workspace level. When closed the whole column is hidden with `display:none`,
 * which keeps the mounted views (and their live sessions) alive without taking
 * layout space. The open/close toggle lives outside the body (see
 * `WorkspaceDockToggleButton` / RepoDetail's header) and shares one cross-tree
 * store. Callers gate this on `splitWorkspacePanel` + desktop breakpoint.
 */
export function WorkspaceRightDock({ workspaceId, dock }: WorkspaceRightDockProps) {
    const { isOpen, view, setView, width, isDragging, handleMouseDown, handleTouchStart } = dock;

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
                aria-label="Resize terminal / explorer dock"
                aria-valuemin={DOCK_MIN_WIDTH}
                aria-valuemax={DOCK_MAX_WIDTH}
                aria-valuenow={width}
                tabIndex={0}
            >
                <span className="h-full w-px bg-[#c8c8c8] dark:bg-[#5a5a5a] group-hover:w-[2px] group-hover:bg-[#007acc] transition-all" />
            </div>

            {/* Dock body: single-row header (view tabs + portaled terminal toolbar)
                + the two (keep-alive) views. */}
            <div
                className="flex min-h-0 flex-col overflow-hidden"
                style={{ width }}
                data-testid="workspace-dock-body"
            >
                <div
                    className="flex h-[35px] flex-shrink-0 items-center gap-1 border-b border-[#e5e5e5] pr-1 dark:border-[#333]"
                    data-testid="workspace-dock-header"
                >
                    <DockViewTabs view={view} onChange={setView} />
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
                                key={workspaceId}
                                workspaceId={workspaceId}
                                toolbarPortalTarget={view === 'terminal' ? pickerSlot : null}
                            />
                        </div>
                        <div
                            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                            style={{ display: view === 'explorer' ? undefined : 'none' }}
                            data-testid="workspace-dock-explorer"
                        >
                            <ExplorerPanel key={workspaceId} workspaceId={workspaceId} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
