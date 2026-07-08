import { useCallback, useSyncExternalStore } from 'react';
import { cn } from '../../ui';

/**
 * Light-weight open/close plumbing for the workspace right dock (Terminal +
 * Explorer), split out from `WorkspaceRightDock` so consumers that only need the
 * toggle — notably the global TopBar — don't transitively pull in the heavy
 * TerminalView / ExplorerPanel (xterm / Monaco) dependency graph.
 *
 * The open flag is backed by a cross-tree store so the toggle (RepoDetail's chrome
 * header, or the TopBar in the remote-first shell) and the dock body (RepoDetail)
 * stay in sync across separate component subtrees. See `useDockOpen`.
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

/**
 * Cross-tree open/closed store for the dock, keyed by its localStorage key.
 * The dock body (rendered by RepoDetail) and the toggle button (RepoDetail's
 * header in the classic shell, or the global TopBar in the remote-first shell)
 * live in separate component subtrees, so a plain `useState` in each would drift.
 * A tiny module-level pub/sub over localStorage — surfaced via
 * `useSyncExternalStore` — keeps every consumer of the same workspace in sync and
 * still persists across reloads. Only an explicit toggle writes (never mount or a
 * workspace switch), matching the old `useCollapsedState` semantics.
 */
const dockOpenListeners = new Map<string, Set<() => void>>();

function readDockOpen(storageKey: string): boolean {
    try {
        return localStorage.getItem(storageKey) === '1';
    } catch {
        return false;
    }
}

function writeDockOpen(storageKey: string, open: boolean): void {
    try {
        localStorage.setItem(storageKey, open ? '1' : '0');
    } catch {
        /* ignore */
    }
    dockOpenListeners.get(storageKey)?.forEach(listener => listener());
}

function subscribeDockOpen(storageKey: string, listener: () => void): () => void {
    let listeners = dockOpenListeners.get(storageKey);
    if (!listeners) {
        listeners = new Set();
        dockOpenListeners.set(storageKey, listeners);
    }
    listeners.add(listener);
    return () => {
        listeners!.delete(listener);
        if (listeners!.size === 0) dockOpenListeners.delete(storageKey);
    };
}

/** Persisted, cross-tree open/closed flag for a dock, scoped by `storageKey`. */
export function useDockOpen(storageKey: string): [boolean, () => void] {
    const isOpen = useSyncExternalStore(
        useCallback(listener => subscribeDockOpen(storageKey, listener), [storageKey]),
        () => readDockOpen(storageKey),
        () => false,
    );
    const toggle = useCallback(() => writeDockOpen(storageKey, !readDockOpen(storageKey)), [storageKey]);
    return [isOpen, toggle];
}

/**
 * Lightweight controller for just the dock's open/close flag — for a toggle that
 * lives apart from the dock body (the global TopBar in the remote-first shell). It
 * shares the same cross-tree store as `useWorkspaceDock`, so toggling here opens
 * the body rendered by RepoDetail, without pulling in the view/width machinery.
 */
export function useWorkspaceDockToggle(workspaceId: string): { isOpen: boolean; toggleOpen: () => void } {
    const [isOpen, toggleOpen] = useDockOpen(workspaceDockOpenStorageKey(workspaceId));
    return { isOpen, toggleOpen };
}

/** VS Code-style split-panel glyph, shared by the header and TopBar toggles. */
export function DockToggleIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <line x1="10" y1="2.5" x2="10" y2="13.5" />
            <rect x="10.2" y="2.7" width="4.1" height="10.6" rx="1" fill="currentColor" stroke="none" opacity="0.35" />
        </svg>
    );
}

/**
 * The dock open/close toggle for shells whose header lives outside RepoDetail —
 * i.e. the remote-first shell's global TopBar (placed next to "+ New"). Shares the
 * cross-tree open store with the dock body via `useWorkspaceDockToggle`, styled to
 * sit in the TopBar action cluster. RepoDetail's classic chrome header renders its
 * own equivalent button inline; both use the `workspace-dock-toggle` test id, and
 * only one is on screen at a time (chromeless XOR classic).
 */
export function WorkspaceDockToggleButton({ workspaceId }: { workspaceId: string }) {
    const { isOpen, toggleOpen } = useWorkspaceDockToggle(workspaceId);
    return (
        <button
            type="button"
            data-testid="workspace-dock-toggle"
            onClick={toggleOpen}
            aria-label={isOpen ? 'Close terminal and explorer dock' : 'Open terminal and explorer dock'}
            aria-pressed={isOpen}
            title={isOpen ? 'Close panel' : 'Open panel'}
            className={cn(
                'hidden h-7 w-9 items-center justify-center rounded-md border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da] md:inline-flex',
                isOpen
                    ? 'border-[#0969da]/40 bg-[#ddf4ff] text-[#0969da] dark:bg-[#3794ff]/20 dark:text-[#79c0ff]'
                    : 'border-[#d0d7de] bg-white text-[#656d76] hover:bg-[#f6f8fa] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#999] dark:hover:bg-[#2a2a2a]',
            )}
        >
            <DockToggleIcon />
        </button>
    );
}
