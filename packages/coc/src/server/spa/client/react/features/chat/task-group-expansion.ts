/**
 * task-group-expansion — workspace-scoped expand/collapse state for
 * hierarchical task-group rows in the chat list (Ralph sessions, For Each
 * runs, Map Reduce runs, future group types).
 *
 * One state object keyed by group kind replaces per-feature useState
 * triplets. The pure helpers are unit-testable; `useTaskGroupExpansion`
 * wraps them for ChatListPane. Expansion is cleared when the workspace
 * changes, and per-kind set identity is preserved when another kind is
 * toggled so memoized consumers do not recompute.
 */

import { useCallback, useEffect, useState } from 'react';

export interface TaskGroupExpansionState {
    workspaceId?: string;
    byKind: Record<string, ReadonlySet<string>>;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export function createTaskGroupExpansionState(workspaceId?: string): TaskGroupExpansionState {
    return { workspaceId, byKind: {} };
}

/** Expanded group ids for a kind; empty when the state belongs to another workspace. */
export function getExpandedTaskGroupIds(
    state: TaskGroupExpansionState,
    workspaceId: string | undefined,
    kind: string,
): ReadonlySet<string> {
    if (state.workspaceId !== workspaceId) return EMPTY_SET;
    return state.byKind[kind] ?? EMPTY_SET;
}

/** Toggle one group id; discards state carried over from another workspace. */
export function toggleExpandedTaskGroupId(
    state: TaskGroupExpansionState,
    workspaceId: string | undefined,
    kind: string,
    groupId: string,
): TaskGroupExpansionState {
    const sameWorkspace = state.workspaceId === workspaceId;
    const current = sameWorkspace ? state.byKind[kind] ?? EMPTY_SET : EMPTY_SET;
    const next = new Set(current);
    if (next.has(groupId)) {
        next.delete(groupId);
    } else {
        next.add(groupId);
    }
    return {
        workspaceId,
        byKind: sameWorkspace ? { ...state.byKind, [kind]: next } : { [kind]: next },
    };
}

/** Clear expansion when the workspace changes; keeps identity when already clean. */
export function resetTaskGroupExpansionForWorkspace(
    state: TaskGroupExpansionState,
    workspaceId: string | undefined,
): TaskGroupExpansionState {
    const isClean = state.workspaceId === workspaceId
        && Object.values(state.byKind).every(ids => ids.size === 0);
    if (isClean) return state;
    return createTaskGroupExpansionState(workspaceId);
}

export interface TaskGroupExpansion {
    expandedIds: (kind: string) => ReadonlySet<string>;
    toggle: (kind: string, groupId: string) => void;
}

export function useTaskGroupExpansion(workspaceId: string | undefined): TaskGroupExpansion {
    const [state, setState] = useState<TaskGroupExpansionState>(() => createTaskGroupExpansionState(workspaceId));

    useEffect(() => {
        setState(prev => resetTaskGroupExpansionForWorkspace(prev, workspaceId));
    }, [workspaceId]);

    const expandedIds = useCallback(
        (kind: string) => getExpandedTaskGroupIds(state, workspaceId, kind),
        [state, workspaceId],
    );
    const toggle = useCallback(
        (kind: string, groupId: string) => setState(prev => toggleExpandedTaskGroupId(prev, workspaceId, kind, groupId)),
        [workspaceId],
    );

    return { expandedIds, toggle };
}
