import { useCallback, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../ui';

/**
 * Light-weight open/mode plumbing, sizing constants and storage keys for the
 * workspace right panel, kept apart from `UnifiedRightPanel` so consumers that
 * only need the toggle — notably the global TopBar — don't transitively pull in
 * the heavy TerminalView / ExplorerPanel (xterm / Monaco) dependency graph.
 *
 * Open and selected mode are backed by cross-tree stores so controls in
 * RepoDetail's chrome header or the remote-first TopBar stay in sync with the
 * panel body across separate component subtrees.
 */

/** localStorage key for whether the dock is open, per workspace. */
export function workspaceDockOpenStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:dock-open`;
}

/** localStorage key for the dock's width, per workspace. */
export function workspaceDockWidthStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:dock-width`;
}

/**
 * localStorage key for the dock's *target* — which workspace the Terminal and
 * Explorer are pointed at — scoped by the dock's own workspace. Only meaningful
 * when the caller supplies a `targets` list (a repo group offering its member
 * repos); a plain repo dock always targets itself and never writes this key.
 */
export function workspaceDockTargetStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:dock-target`;
}

export type WorkspaceDockMode = 'explorer' | 'search';

/** localStorage key for the selected dock mode, per panel scope. */
export function workspaceDockModeStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:dock-mode`;
}

/**
 * One option in the dock's target picker: a workspace the Terminal and Explorer
 * can be pointed at, with the label to show for it. `disabled` marks an option
 * that exists but cannot be used (a stale repo-group member whose workspace was
 * removed, or whose root path is gone) — it is listed, greyed, and never
 * auto-selected.
 */
export interface DockTarget {
    workspaceId: string;
    label: string;
    disabled?: boolean;
    /**
     * Listed and selectable, but never chosen automatically. Set on a repo
     * group's own root: it stays offered so a terminal can match the chat's cwd,
     * but `~/.coc/repos/group-<slug>/` holds only `group.json`, so defaulting
     * there would make the Explorer look broken on first open (D-07). The dock
     * falls back to it only when there is no other enabled option.
     */
    deprioritized?: boolean;
}

export const DOCK_MIN_WIDTH = 280;
export const DOCK_INITIAL_WIDTH = 420;
/**
 * px reserved for the left/chat column. The dock's max-width is computed as
 * `viewportWidth − DOCK_MIN_CHAT_WIDTH` (floored at `DOCK_MIN_WIDTH`), so the dock
 * scales with the monitor while never crushing the chat pane below this width.
 */
export const DOCK_MIN_CHAT_WIDTH = 360;

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
const dockModeListeners = new Map<string, Set<() => void>>();

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

function readDockMode(storageKey: string): WorkspaceDockMode {
    try {
        return localStorage.getItem(storageKey) === 'search' ? 'search' : 'explorer';
    } catch {
        return 'explorer';
    }
}

function writeDockMode(storageKey: string, mode: WorkspaceDockMode): void {
    try {
        localStorage.setItem(storageKey, mode);
    } catch {
        /* ignore */
    }
    dockModeListeners.get(storageKey)?.forEach(listener => listener());
}

function subscribeDockMode(storageKey: string, listener: () => void): () => void {
    let listeners = dockModeListeners.get(storageKey);
    if (!listeners) {
        listeners = new Set();
        dockModeListeners.set(storageKey, listeners);
    }
    listeners.add(listener);
    return () => {
        listeners!.delete(listener);
        if (listeners!.size === 0) dockModeListeners.delete(storageKey);
    };
}

/**
 * Reveal a workspace's dock from outside React — a chat source link, a canvas
 * event, or a diff action that opens a resource while the panel is collapsed
 * (AC-04/AC-06: "reopen the panel if it was closed").
 *
 * Deliberately one-way. Nothing outside an explicit user toggle may *close* the
 * dock, and an already-open dock is left alone rather than rewritten, so a
 * stream of canvas updates does not notify every subscriber per event.
 */
export function openWorkspaceDock(workspaceId: string): void {
    const storageKey = workspaceDockOpenStorageKey(workspaceId);
    if (readDockOpen(storageKey)) return;
    writeDockOpen(storageKey, true);
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
 * Lightweight controller for dock visibility and selected mode — for controls
 * that live apart from the panel (the global TopBar in the remote-first shell).
 * It shares the same cross-tree stores as `useWorkspaceDock`, without pulling in
 * the view/width machinery.
 */
export function useWorkspaceDockToggle(workspaceId: string): {
    isOpen: boolean;
    mode: WorkspaceDockMode;
    toggleOpen: () => void;
    selectMode: (mode: WorkspaceDockMode) => void;
} {
    const openStorageKey = workspaceDockOpenStorageKey(workspaceId);
    const modeStorageKey = workspaceDockModeStorageKey(workspaceId);
    const [isOpen, toggleOpen] = useDockOpen(openStorageKey);
    const mode = useSyncExternalStore(
        useCallback(listener => subscribeDockMode(modeStorageKey, listener), [modeStorageKey]),
        () => readDockMode(modeStorageKey),
        () => 'explorer',
    );
    const selectMode = useCallback((nextMode: WorkspaceDockMode) => {
        const currentMode = readDockMode(modeStorageKey);
        const currentlyOpen = readDockOpen(openStorageKey);
        if (currentlyOpen && currentMode === nextMode) {
            writeDockOpen(openStorageKey, false);
            return;
        }
        if (currentMode !== nextMode) writeDockMode(modeStorageKey, nextMode);
        if (!currentlyOpen) writeDockOpen(openStorageKey, true);
    }, [modeStorageKey, openStorageKey]);
    return { isOpen, mode, toggleOpen, selectMode };
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

function SearchIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16l4 4" />
        </svg>
    );
}

const DOCK_MODE_CONTROLS: ReadonlyArray<{
    mode: WorkspaceDockMode;
    label: string;
    icon: ReactNode;
}> = [
    { mode: 'search', label: 'Search', icon: <SearchIcon /> },
    { mode: 'explorer', label: 'Explorer', icon: <DockToggleIcon /> },
];

/** Peer Search and Explorer controls shared by classic and remote desktop headers. */
export function WorkspaceDockModeControls({ workspaceId }: { workspaceId: string }) {
    const { isOpen, mode, selectMode } = useWorkspaceDockToggle(workspaceId);
    return (
        <div
            role="group"
            aria-label="Workspace panel mode"
            data-testid="workspace-dock-mode-controls"
            className="hidden items-center gap-1 md:flex"
        >
            {DOCK_MODE_CONTROLS.map(control => {
                const active = isOpen && mode === control.mode;
                return (
                    <button
                        key={control.mode}
                        type="button"
                        data-testid={`workspace-dock-${control.mode}-toggle`}
                        onClick={() => selectMode(control.mode)}
                        aria-label={control.label}
                        aria-pressed={active}
                        title={`${control.label} panel`}
                        className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da]',
                            active
                                ? 'border-[#0969da]/40 bg-[#ddf4ff] text-[#0969da] dark:bg-[#3794ff]/20 dark:text-[#79c0ff]'
                                : 'border-[#d0d7de] bg-white text-[#656d76] hover:bg-[#f6f8fa] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#999] dark:hover:bg-[#2a2a2a]',
                        )}
                    >
                        {control.icon}
                    </button>
                );
            })}
        </div>
    );
}
