import type { DashboardVisibleWorkspace, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { getWorkspaceSelectionId } from '../../repos/cloneIdentity';
import { isRemoteWorkspace, type RemoteWorkspaceInfo } from '../../repos/remoteWorkspaceAggregation';
import { isRepoGroupWorkspaceId } from '../../repos/virtualWorkspaceIds';

interface VisibleRoute {
    selectionId: string;
    baseUrl?: string;
    row: DashboardVisibleWorkspace;
}
interface DashboardTopology {
    selectedRef: string | null;
    localWorkspaceIds: string[];
    routes: VisibleRoute[];
    revision: string;
}
let serial = 0;
let fingerprint = '';
let topology: DashboardTopology = { selectedRef: null, localWorkspaceIds: [], routes: [], revision: '0' };
const listeners = new Set<() => void>();

/** Publish dashboard observations only; routes and endpoints never enter tool results. */
export function publishDashboardTopology(
    selectedRef: string | null,
    workspaces: readonly (WorkspaceInfo | RemoteWorkspaceInfo)[],
    pageOriginIdentity?: string,
): void {
    const routes: VisibleRoute[] = [];
    const localWorkspaceIds: string[] = [];
    const selections = new Set<string>();
    for (const workspace of workspaces) {
        const remote = isRemoteWorkspace(workspace) ? workspace.remote : undefined;
        if (!remote) localWorkspaceIds.push(workspace.id);
        const group = isRepoGroupWorkspaceId(workspace.id);
        if (workspace.virtual && !group) continue;
        const selectionId = getWorkspaceSelectionId(workspace);
        if (selections.has(selectionId)) continue;
        selections.add(selectionId);
        const serverIdentity = remote ? remote.serverIdentity : pageOriginIdentity;
        routes.push({
            selectionId,
            ...(remote ? { baseUrl: remote.baseUrl } : {}),
            row: {
                ...(serverIdentity ? { serverIdentity } : {}),
                serverLabel: remote?.serverLabel ?? 'Local server',
                serverKind: remote?.serverKind ?? (remote ? 'url' : 'local'),
                workspaceId: workspace.id,
                workspaceLabel: workspace.name || workspace.id,
                type: group ? 'group' : 'repo',
                online: remote ? !remote.offline && remote.connection === 'online' : true,
            },
        });
    }
    routes.sort((a, b) => a.selectionId.localeCompare(b.selectionId));
    localWorkspaceIds.sort();
    const next = JSON.stringify([selectedRef, localWorkspaceIds, routes]);
    if (fingerprint === next) return;
    fingerprint = next;
    topology = { selectedRef, localWorkspaceIds, routes, revision: String(++serial) };
    for (const listener of listeners) listener();
}

export function getDashboardTopology(): DashboardTopology { return topology; }
export function subscribeDashboardTopology(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
