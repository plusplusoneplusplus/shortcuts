import type { SentinelTodoJobLink, SentinelTodoTargetRepo } from '@plusplusoneplusplus/coc-client';
import { buildRemoteCloneKey, getWorkspaceSelectionId, parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { getRepoGroupServerName, resolveRepoGroupName } from '../../../repos/repoGroupName';
import type { SentinelTodoOwner } from './sentinelTodoPanelModel';

export interface SentinelTodoOwnerWorkspace {
    id?: unknown;
    name?: unknown;
    remote?: { serverId?: string; serverLabel?: string; cloneKey?: string; offline?: boolean; connection?: string } | null;
}

function displayLabel(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const label = value.trim();
    return label && !/^(?:[\\/]|[a-z][a-z\d+.-]*:)|[\r\n]|[^\s]+@[^\s]+/i.test(label) ? label : undefined;
}

function identityDetail(kind: string, value: string | undefined): string {
    return value && /^[\w.:-]+$/.test(value) ? ` (${kind}: ${value})` : '';
}

/** Jobs without an explicit remote destination belong to the ledger's server. */
export function resolveSentinelTodoJobOwner({
    job, owner, currentWorkspaceId, workspaces = [], targetRepo,
}: {
    job: SentinelTodoJobLink;
    owner: SentinelTodoOwner;
    currentWorkspaceId?: string;
    workspaces?: readonly SentinelTodoOwnerWorkspace[];
    targetRepo?: SentinelTodoTargetRepo;
}) {
    const ledgerServerId = parseRemoteCloneKey(owner.ownerRoutingRef)?.serverId;
    const unknownServer = job.kind === 'remote' && !job.serverId;
    const serverId = job.serverId ?? (unknownServer ? undefined : ledgerServerId);
    const selectionId = unknownServer ? undefined : serverId
        ? buildRemoteCloneKey(serverId, job.workspaceId) : job.workspaceId;
    const workspace = selectionId ? workspaces.find(ws => getWorkspaceSelectionId(ws) === selectionId) : undefined;
    const targetMatches = !unknownServer && targetRepo?.workspaceId === job.workspaceId
        && (targetRepo.serverId ?? ledgerServerId) === serverId;
    const registeredName = workspace && selectionId && displayLabel(workspace.name)
        ? displayLabel(resolveRepoGroupName(selectionId, workspaces, [])) : undefined;
    const resolvedName = registeredName || (targetMatches && displayLabel(targetRepo?.label)) || undefined;
    const repoName = resolvedName !== job.workspaceId ? resolvedName : undefined;
    // Other cached workspaces on this server can supply its configured display name.
    const serverWorkspace = serverId && !displayLabel(workspace?.remote?.serverLabel)
        ? workspaces.find(ws => parseRemoteCloneKey(getWorkspaceSelectionId(ws))?.serverId === serverId
            && displayLabel(ws.remote?.serverLabel)) ?? workspace
        : workspace;
    const configuredServerName = serverWorkspace && (!serverId || displayLabel(serverWorkspace.remote?.serverLabel))
        ? displayLabel(getRepoGroupServerName(serverWorkspace)) : undefined;
    const serverName = configuredServerName !== serverId ? configuredServerName : undefined;
    const remote = !!serverId || unknownServer;
    const label = remote ? `${serverName ?? 'Unknown server'} / ${repoName ?? 'Unknown repo'}` : repoName ?? 'Unknown repo';
    const details = [
        `Job owner: ${remote ? label : `${serverName ?? 'Local workstation'} / ${label}`}`,
        ...(!repoName ? [`Workspace metadata unavailable${identityDetail('workspace', job.workspaceId)}`] : []),
        ...(remote && !serverName ? [`Server metadata unavailable${identityDetail('server', serverId)}`] : []),
        ...(serverWorkspace?.remote?.offline || ['offline', 'failed'].includes(serverWorkspace?.remote?.connection ?? '')
            ? ['Server offline; showing last-known metadata'] : []),
    ];
    return {
        label,
        description: details.join('. '),
        showBadge: !selectionId || selectionId !== (currentWorkspaceId ?? owner.ownerRoutingRef ?? owner.ownerWorkspaceId),
    };
}
