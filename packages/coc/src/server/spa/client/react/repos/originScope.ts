import { resolveCanonicalOriginId as resolveForgeCanonicalOriginId } from '@plusplusoneplusplus/forge/git/origin-id';
import type { RepoData } from './repoGrouping';

export interface OriginScopeInput {
    workspaceId: string;
    remoteUrl?: string | null;
}

export interface OriginScope {
    originId: string;
    workspaceId: string;
}

/**
 * Canonical origin ID for a workspace, shared with the server through
 * `@plusplusoneplusplus/forge/git/origin-id` so persisted origin keys agree.
 *
 * One deliberate deviation from the forge API: forge throws for a local origin
 * with no workspace ID, because a server-side caller that reaches that state has
 * a bug. The SPA renders during the pre-load window where the workspace ID is
 * still empty, so it keeps the historical `local_` placeholder rather than
 * throwing inside a render. Callers that must not act on a placeholder should
 * gate on {@link resolveWorkspaceRemoteUrl} returning `undefined` instead.
 */
export function resolveCanonicalOriginId(input: OriginScopeInput): string {
    const workspaceId = input.workspaceId.trim();
    const remoteUrl = typeof input.remoteUrl === 'string' ? input.remoteUrl.trim() : '';

    if (!remoteUrl && !workspaceId) {
        return 'local_';
    }

    return resolveForgeCanonicalOriginId({ workspaceId, remoteUrl });
}

export function resolveOriginScope(input: OriginScopeInput): OriginScope {
    return {
        originId: resolveCanonicalOriginId(input),
        workspaceId: input.workspaceId,
    };
}

export function resolveRepoOriginScope(repo: RepoData): OriginScope {
    const workspaceId = String(repo.workspace?.id ?? '');
    const remoteUrl = repo.gitInfo?.remoteUrl ?? repo.workspace?.remoteUrl ?? null;
    return resolveOriginScope({ workspaceId, remoteUrl });
}

/**
 * Resolves a chat workspace's remote URL from the loaded workspace list, keeping
 * "not known yet" distinct from "known to have no remote":
 *
 *   • `undefined` — the workspace list has not loaded, so the remote identity is
 *     UNKNOWN. Callers must hold off on origin-scoped work rather than resolve
 *     an origin from a missing remote.
 *   • `null` — the list is loaded and this workspace genuinely has no remote, so
 *     `local_<workspaceId>` is the correct origin.
 *   • `string` — the workspace's remote URL.
 *
 * Collapsing the first two cases is what makes {@link resolveCanonicalOriginId}
 * hand back `local_<workspaceId>` during the pre-load window, which silently
 * scopes reads and writes to an origin no data lives under.
 *
 * Mirrors the `workspaces.length > 0` idiom already used to decide whether a
 * workspace id can be judged non-local.
 */
export function resolveWorkspaceRemoteUrl(
    workspaces: ReadonlyArray<{ id?: string; remoteUrl?: unknown }> | undefined,
    workspaceId: string | undefined,
): string | null | undefined {
    if (!workspaceId) return undefined;
    if (!workspaces || workspaces.length === 0) return undefined;
    const workspace = workspaces.find(ws => ws?.id === workspaceId);
    if (!workspace) return undefined;
    return typeof workspace.remoteUrl === 'string' ? workspace.remoteUrl : null;
}
