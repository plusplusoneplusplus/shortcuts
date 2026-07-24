/**
 * Canonical ids for the client-side virtual scopes (My Work / My Life).
 *
 * Kept in a dependency-free module so low-level modules — e.g. the AppContext
 * reducer, which cannot import `MyWorkView`/`MyLifeView` without a cycle (those
 * views import `useApp` from AppContext) — can test whether a selection is a
 * virtual scope. `MyWorkView`/`MyLifeView` re-export these ids so there is a
 * single source of truth.
 */

export const MY_WORK_WORKSPACE_ID = 'my_work';
export const MY_LIFE_WORKSPACE_ID = 'my_life';

export const VIRTUAL_WORKSPACE_IDS: ReadonlySet<string> = new Set([
    MY_WORK_WORKSPACE_ID,
    MY_LIFE_WORKSPACE_ID,
]);

/** True when the id is one of the virtual scopes (My Work / My Life). */
export function isVirtualWorkspaceId(id: string | null | undefined): boolean {
    return typeof id === 'string' && VIRTUAL_WORKSPACE_IDS.has(id);
}
