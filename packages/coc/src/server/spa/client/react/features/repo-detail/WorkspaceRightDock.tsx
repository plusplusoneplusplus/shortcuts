import { useCallback, useEffect, useRef, useState } from 'react';
import { cn, SegmentedControl } from '../../ui';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { TerminalView } from '../terminal/TerminalView';
import { ExplorerPanel } from './explorer/ExplorerPanel';
import { useCollapsedState } from './SplitWorkspacePanel';

/**
 * WorkspaceRightDock — a VS Code-style right-side dock at the workspace level
 * (behind the `splitWorkspacePanel` flag) that hosts the existing Terminal and
 * File Explorer, switchable via a segmented Terminal|Explorer control. It lives
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
 * localStorage via `useCollapsedState` and `useResizablePanel` (AC-06). The
 * header open/close toggle is owned by the caller (RepoDetail's header cluster)
 * and drives this same controller — see `useWorkspaceDock`.
 */

export type WorkspaceDockView = 'terminal' | 'explorer';

/** localStorage key for whether the dock is open, per workspace. */
export function workspaceDockOpenStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:dock-open`;
}

/** localStorage key for the active dock view (terminal|explorer), per workspace. */
export function workspaceDockViewStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:dock-view`;
}

/** localStorage key for the dock's width, per workspace. */
export function workspaceDockWidthStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:dock-width`;
}

export const DOCK_MIN_WIDTH = 280;
export const DOCK_MAX_WIDTH = 800;
export const DOCK_INITIAL_WIDTH = 420;

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
    const [isOpen, toggleOpen] = useCollapsedState(workspaceDockOpenStorageKey(workspaceId));
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

const DOCK_VIEW_OPTIONS: readonly { value: WorkspaceDockView; label: string; testId: string }[] = [
    { value: 'terminal', label: 'Terminal', testId: 'workspace-dock-view-terminal' },
    { value: 'explorer', label: 'Explorer', testId: 'workspace-dock-view-explorer' },
];

export interface WorkspaceRightDockProps {
    workspaceId: string;
    dock: WorkspaceDockController;
}

/**
 * The dock body (right column). Rendered as the outermost-right column at the
 * workspace level. When closed the whole column is hidden with `display:none`,
 * which keeps the mounted views (and their live sessions) alive without taking
 * layout space. Callers gate this on `splitWorkspacePanel` + desktop breakpoint.
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

            {/* Dock body: segmented switcher header + the two (keep-alive) views. */}
            <div
                className="flex min-h-0 flex-col overflow-hidden"
                style={{ width }}
                data-testid="workspace-dock-body"
            >
                <div
                    className="flex h-[30px] flex-shrink-0 items-center border-b border-[#e5e5e5] px-2 dark:border-[#333]"
                    data-testid="workspace-dock-header"
                >
                    <SegmentedControl
                        options={DOCK_VIEW_OPTIONS}
                        value={view}
                        onChange={setView}
                        data-testid="workspace-dock-view-switcher"
                    />
                </div>

                {everOpened && (
                    <>
                        <div
                            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                            style={{ display: view === 'terminal' ? undefined : 'none' }}
                            data-testid="workspace-dock-terminal"
                        >
                            <TerminalView key={workspaceId} workspaceId={workspaceId} />
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
