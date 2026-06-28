/**
 * Canonical origin-scope resolver — the single source of truth for mapping a
 * caller-facing workspace/repo id to the canonical git-origin id that
 * origin-scoped persistent state is stored under.
 *
 * Work Item storage, Work Item route scope, Pull Request storage scope, and PR
 * classification cleanup all resolve multi-repo storage identity the same way:
 *
 *   1. Detect whether an id already looks canonical (`gh_`/`ado_`/`git_`/`local_`).
 *   2. Resolve a workspace's remote URL, detecting it from the checkout and
 *      backfilling the stored record when the workspace has none.
 *   3. Map every registered workspace to its canonical origin id.
 *   4. Enumerate the workspaces that resolve to the same origin.
 *
 * Centralizing these primitives keeps two clones of the same upstream repo from
 * resolving to different storage directories.
 *
 * Pure Node.js; uses forge git helpers.
 */

import {
    detectRemoteUrl,
    resolveCanonicalOriginId,
    type ProcessStore,
} from '@plusplusoneplusplus/forge';

/** Process-store surface needed to read workspaces and backfill remote URLs. */
export type OriginScopeProcessStore = Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'>;

/**
 * Workspace fields the origin-scope resolver reads. Kept structural (and
 * `null`-tolerant) so both `WorkspaceInfo` records and caller-supplied
 * remote/root tuples satisfy it.
 */
export interface OriginScopeWorkspace {
    id: string;
    remoteUrl?: string | null;
    rootPath?: string | null;
}

const CANONICAL_ORIGIN_PREFIX = /^(gh|ado|git|local)_/;

/**
 * True when `value` already looks like a canonical origin id
 * (`gh_`/`ado_`/`git_`/`local_`) rather than a clone-specific workspace id.
 */
export function isCanonicalOriginId(value: string): boolean {
    return CANONICAL_ORIGIN_PREFIX.test(value);
}

function trimNonEmpty(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
}

/**
 * Resolve the remote URL for a workspace, detecting it from the checkout when
 * the stored record has none and backfilling the detected value via the process
 * store. Returns `undefined` when no remote can be resolved.
 */
export async function resolveWorkspaceRemoteUrl(
    workspace: OriginScopeWorkspace,
    processStore?: Pick<ProcessStore, 'updateWorkspace'>,
): Promise<string | undefined> {
    const existing = trimNonEmpty(workspace.remoteUrl);
    if (existing) return existing;
    const root = trimNonEmpty(workspace.rootPath);
    if (!root) return undefined;
    const detected = trimNonEmpty(await detectRemoteUrl(root));
    if (detected && typeof processStore?.updateWorkspace === 'function') {
        await processStore.updateWorkspace(workspace.id, { remoteUrl: detected });
    }
    return detected;
}

/**
 * Resolve the canonical origin id for a workspace record, detecting and
 * backfilling its remote URL first. Falls back to a `local_<workspaceId>`
 * canonical id when no remote is available.
 */
export async function resolveWorkspaceOriginId(
    workspace: OriginScopeWorkspace,
    processStore?: Pick<ProcessStore, 'updateWorkspace'>,
): Promise<string> {
    const remoteUrl = await resolveWorkspaceRemoteUrl(workspace, processStore);
    return resolveCanonicalOriginId({ remoteUrl, workspaceId: workspace.id });
}

/**
 * Build a map of registered `workspaceId` → canonical origin id, resolving (and
 * backfilling) each workspace's remote exactly once. Insertion order matches
 * `processStore.getWorkspaces()` so downstream enumeration stays deterministic.
 */
export async function mapWorkspaceOriginIds(
    processStore: OriginScopeProcessStore,
): Promise<Map<string, string>> {
    const originIds = new Map<string, string>();
    for (const workspace of await processStore.getWorkspaces()) {
        originIds.set(workspace.id, await resolveWorkspaceOriginId(workspace, processStore));
    }
    return originIds;
}

/**
 * Resolve the canonical origin id for a caller-facing id that may be either a
 * registered workspace id or an already-canonical origin id. Returns
 * `undefined` when the id is neither registered nor canonical.
 */
export async function resolveOriginIdForId(
    processStore: OriginScopeProcessStore,
    id: string,
): Promise<string | undefined> {
    const originIds = await mapWorkspaceOriginIds(processStore);
    return originIds.get(id) ?? (isCanonicalOriginId(id) ? id : undefined);
}

/**
 * List the registered workspace ids whose canonical origin id equals
 * `originId`, in `getWorkspaces()` order. These are the clone-specific scopes
 * that share one canonical origin.
 */
export async function sameOriginWorkspaceIds(
    processStore: OriginScopeProcessStore,
    originId: string,
): Promise<string[]> {
    const originIds = await mapWorkspaceOriginIds(processStore);
    const workspaceIds: string[] = [];
    for (const [workspaceId, resolved] of originIds) {
        if (resolved === originId) workspaceIds.push(workspaceId);
    }
    return workspaceIds;
}
