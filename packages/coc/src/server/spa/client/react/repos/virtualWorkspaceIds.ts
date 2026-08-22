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

/**
 * Repo-group virtual workspaces are recognizable by id shape alone — the server
 * mints them as `group-<slug>` (see `server/workspaces/repo-group-workspace.ts`,
 * the single source of truth for the pattern) — so no registry lookup is needed
 * client-side.
 */
export const REPO_GROUP_WORKSPACE_ID_PREFIX = 'group-';

const REPO_GROUP_ID_PATTERN = /^group-[a-z0-9][a-z0-9-]*$/;

/** True when the id names a repo-group virtual workspace. */
export function isRepoGroupWorkspaceId(id: string | null | undefined): boolean {
    return typeof id === 'string' && REPO_GROUP_ID_PATTERN.test(id);
}
