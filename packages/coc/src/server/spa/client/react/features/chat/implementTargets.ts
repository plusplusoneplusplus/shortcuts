/**
 * buildImplementTargets — derive the ImplementPlanCard target list from the
 * dashboard repo list (AC-02).
 *
 * Pure (no React, no I/O) so it is unit-testable and reusable. The list includes
 * the current repo and every LOCAL repo known to the dashboard, plus ONLINE,
 * reachable remote clones; offline / unreachable remote clones are excluded so
 * they can never be selected as a run target. The current repo is always present
 * and placed first, so it remains the default selection and the one-click local
 * behavior is unchanged (AC-01).
 */

import { isRemoteWorkspace } from '../../repos/remoteWorkspaceAggregation';
import type { RepoData } from '../../repos/repoGrouping';
import type { ImplementTarget } from './ImplementPlanCard';

/** Minimal identity for the current (source) repo, used to guarantee its presence. */
export interface CurrentRepoRef {
    workspaceId?: string;
    label?: string;
    workingDirectory?: string;
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

    for (const repo of repos ?? []) {
        const ws = repo?.workspace;
        if (!ws || typeof ws.id !== 'string') continue;
        if (ws.virtual) continue; // hide virtual workspaces (e.g. global)
        if (seen.has(ws.id)) continue;

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
