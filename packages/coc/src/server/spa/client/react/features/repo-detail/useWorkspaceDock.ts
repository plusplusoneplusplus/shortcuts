import { useCallback, useEffect, useRef, useState } from 'react';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { useViewportWidth } from '../../hooks/ui/useViewportWidth';
import { confirmDiscardExplorerEditsOnSwitch } from './explorer/explorerDirtyStore';
import {
    DOCK_INITIAL_WIDTH,
    DOCK_MIN_CHAT_WIDTH,
    DOCK_MIN_WIDTH,
    workspaceDockTargetStorageKey,
    workspaceDockWidthStorageKey,
    type DockTarget,
    type WorkspaceDockMode,
    useWorkspaceDockToggle,
} from './WorkspaceDockToggle';

/**
 * `useWorkspaceDock` — the workspace right panel's state controller: whether the
 * panel is open, its selected Search/Explorer mode, how wide it is, and which
 * workspace its contents are pointed at.
 * The body it drives is `UnifiedRightPanel`; this hook holds no DOM of its own.
 *
 * Call it once per workspace view (RepoDetail, RepoGroupView) and hand the
 * returned controller to the panel. The open flag comes from the cross-tree store
 * in `WorkspaceDockToggle` rather than local state, because the toggle button
 * lives in a different subtree — RepoDetail's chrome header in the classic shell,
 * the global TopBar in the remote-first one.
 *
 * Scope vs. target. `workspaceId` is the panel's SCOPE: it owns the open / mode /
 * width / target persistence, and it is the workspace Notes belongs to. The TARGET is the
 * workspace new terminals and file resources open against; it equals the scope
 * unless the caller passes `targets`. A repo group passes its group root plus its
 * member repos, so the panel gains a picker and its own state (open, tabs, width)
 * survives switching between members — only new content follows the picker.
 *
 * Open, mode, width and target each persist per-scope to localStorage; see the
 * `workspaceDock*StorageKey` helpers for the key formats.
 */

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
 * Resolve the panel's target from storage: the persisted value when it is still
 * an enabled option, otherwise the first enabled option that is not
 * `deprioritized` (the first live repo-group member, rather than the group's
 * near-empty own root — D-07). With no usable options (none supplied, or every
 * one disabled) the panel targets its own scope, which is exactly today's
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
 * Persisted target selector — which workspace the panel's terminals and file
 * resources are pointed at. Only an explicit user pick writes, and the value
 * re-resolves from storage whenever the scope or the option list changes (so a
 * group whose members are still loading starts on the scope and lands on the
 * first live member once they arrive).
 *
 * Switching goes through `confirmDiscardExplorerEditsOnSwitch`, the same guard a
 * whole-workspace switch gets — without it, picking another member repo would
 * silently drop a dirty Monaco buffer in an open file tab.
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
    /** Whether the panel is currently open (persisted, default closed). */
    isOpen: boolean;
    /** Flip the open/closed state (wired to the header toggle button). */
    toggleOpen: () => void;
    /** Selected peer mode, persisted by panel scope. */
    mode: WorkspaceDockMode;
    /** Open/switch to a mode, or close the panel when that mode is already active. */
    selectMode: (mode: WorkspaceDockMode) => void;
    /**
     * The workspace new terminals and file resources open against. Equal to the
     * panel's scope (`workspaceId`) unless the caller supplied `targets` and the
     * user picked another one — a repo group pointing the panel at a member repo.
     */
    target: string;
    /**
     * Point the panel at another target (persisted). No-ops when the current
     * target has unsaved edits and the user declines to discard them.
     */
    setTarget: (target: string) => void;
    /** The target options, in picker order; empty when the caller supplied none. */
    targets: readonly DockTarget[];
    /**
     * Current panel width in px (persisted, default ~420). Clamped between
     * `DOCK_MIN_WIDTH` and the live viewport-relative `maxWidth`.
     */
    width: number;
    /**
     * Current max panel width in px — `max(DOCK_MIN_WIDTH, viewportWidth −
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
 * Owns the per-workspace panel state (open / mode / width / target) so the header
 * controls and the panel body share one source of truth. Call once per RepoDetail
 * (or RepoGroupView) render and pass the returned controller to
 * `UnifiedRightPanel` and the header toggle.
 */
export function useWorkspaceDock(workspaceId: string, targets?: readonly DockTarget[]): WorkspaceDockController {
    const { isOpen, mode, toggleOpen, selectMode } = useWorkspaceDockToggle(workspaceId);
    const targetOptions = targets ?? EMPTY_TARGETS;
    const [target, setTarget] = useDockTarget(workspaceDockTargetStorageKey(workspaceId), targetOptions, workspaceId);
    // Cap the panel relative to the live window so it can be dragged as wide as the
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
        isOpen, toggleOpen, mode, selectMode, target, setTarget, targets: targetOptions,
        width, maxWidth, isDragging, handleMouseDown, handleTouchStart,
    };
}
