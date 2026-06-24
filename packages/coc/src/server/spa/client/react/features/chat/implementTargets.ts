/**
 * buildImplementTargets — derive the ImplementPlanCard target list from the
 * dashboard repo list (AC-02).
 *
 * Pure (no React, no I/O) so it is unit-testable and reusable. The list is
 * scoped to the current repo's git origin: when the current repo has a known
 * remote URL, only repos sharing that canonical origin (sibling local clones +
 * ONLINE remote clones of the same repo) are runnable targets, so unrelated
 * repos never appear in the dropdown. The current origin is taken from the
 * caller-supplied `remoteUrl`, falling back to the current repo's own entry in
 * the dashboard list (the same `gitInfo.remoteUrl` source the candidates are
 * compared against) — this keeps the comparison symmetric so the filter still
 * engages when the caller cannot supply a remote URL (e.g. a remote-clone
 * current workspace whose appState entry lacks one). When no origin can be
 * resolved from either source, no origin filter is applied and every local repo
 * plus every online remote clone is included. Offline / unreachable remote
 * clones are always excluded. The current repo is always present and placed
 * first, so it remains the default selection and the one-click local behavior
 * is unchanged.
 */

import { resolveCanonicalOriginId, resolveRepoOriginScope } from '../../repos/originScope';
import { isRemoteWorkspace } from '../../repos/remoteWorkspaceAggregation';
import type { RepoData } from '../../repos/repoGrouping';
import type { ImplementTarget } from './ImplementPlanCard';

/** Minimal identity for the current (source) repo, used to guarantee its presence. */
export interface CurrentRepoRef {
    workspaceId?: string;
    label?: string;
    workingDirectory?: string;
    /** Git remote URL of the current repo; drives the same-origin scoping. */
    remoteUrl?: string | null;
}

/** True when an aggregated remote clone is currently online and reachable (AC-02). */
function isOnlineRemote(workspace: unknown): boolean {
    return (
        isRemoteWorkspace(workspace) &&
        workspace.remote.offline === false &&
        workspace.remote.connection === 'online'
    );
}

export function buildImplementTargets(
    repos: RepoData[] | undefined,
    current: CurrentRepoRef = {},
): ImplementTarget[] {
    const targets: ImplementTarget[] = [];
    const seen = new Set<string>();

    // Same-origin scoping: only active when the current repo's git origin can be
    // resolved. Prefer the caller-supplied remoteUrl; otherwise fall back to the
    // current repo's own entry in the dashboard list, which carries the same
    // gitInfo.remoteUrl the candidates resolve their origin from. This makes the
    // comparison symmetric so the filter engages even when the caller could not
    // supply a remoteUrl (e.g. a remote-clone current workspace). Computed once
    // so every candidate is compared against a stable canonical origin id. When
    // no origin can be resolved, no filter applies.
    const currentRepoEntry = current.workspaceId
        ? (repos ?? []).find(repo => String(repo?.workspace?.id ?? '') === current.workspaceId)
        : undefined;
    const currentRemoteUrl =
        typeof current.remoteUrl === 'string' && current.remoteUrl.trim()
            ? current.remoteUrl
            : currentRepoEntry?.gitInfo?.remoteUrl ?? currentRepoEntry?.workspace?.remoteUrl ?? null;
    const currentOriginId =
        current.workspaceId && typeof currentRemoteUrl === 'string' && currentRemoteUrl.trim()
            ? resolveCanonicalOriginId({ workspaceId: current.workspaceId, remoteUrl: currentRemoteUrl })
            : null;

    for (const repo of repos ?? []) {
        const ws = repo?.workspace;
        if (!ws || typeof ws.id !== 'string') continue;
        if (ws.virtual) continue; // hide virtual workspaces (e.g. global)
        if (seen.has(ws.id)) continue;

        // Drop repos that do not share the current repo's canonical origin. The
        // current repo itself is never filtered out (it stays the default), even
        // if its list entry happens to lack remote metadata.
        if (currentOriginId && ws.id !== current.workspaceId) {
            if (resolveRepoOriginScope(repo).originId !== currentOriginId) continue;
        }

        if (isRemoteWorkspace(ws)) {
            // Only online, reachable remote clones are runnable targets (AC-02).
            if (!isOnlineRemote(ws)) continue;
            seen.add(ws.id);
            targets.push({
                workspaceId: ws.id,
                label: ws.name || ws.id,
                serverLabel: ws.remote.serverLabel,
                workingDirectory: typeof ws.rootPath === 'string' ? ws.rootPath : undefined,
                baseUrl: ws.baseUrl,
                isRemote: true,
            });
        } else {
            seen.add(ws.id);
            targets.push({
                workspaceId: ws.id,
                label: ws.name || ws.id,
                workingDirectory: typeof ws.rootPath === 'string' ? ws.rootPath : undefined,
                isRemote: false,
            });
        }
    }

    // Guarantee the current repo is present (it may be missing while repos are
    // still loading) and ordered first so it stays the default selection (AC-01).
    if (current.workspaceId) {
        const idx = targets.findIndex(t => t.workspaceId === current.workspaceId);
        if (idx === -1) {
            targets.unshift({
                workspaceId: current.workspaceId,
                label: current.label || current.workspaceId,
                workingDirectory: current.workingDirectory,
                isRemote: false,
            });
        } else if (idx > 0) {
            const [cur] = targets.splice(idx, 1);
            targets.unshift(cur);
        }
    }

    return targets;
}
