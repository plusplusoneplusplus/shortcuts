import type { GitInfoResponse, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import {
    isSameNormalizedOrigin,
    isSameRepoClone,
    resolveRepoIdentity,
} from '@plusplusoneplusplus/forge/git/repo-identity';
import { normalizeRemoteUrl, remoteUrlLabel } from '../../repos/repoGrouping';

export type CrossCloneRemoteStatus = 'same-remote' | 'cross-remote' | 'unknown';

export const LOCAL_COC_SERVER_ID = 'local';
export const LOCAL_COC_SERVER_LABEL = 'Current CoC';

/** Identity of the workspace the commits are being cherry-picked *from*. */
export interface CrossCloneCherryPickSource {
    serverId: string;
    workspaceId: string;
    remoteUrl: string | null | undefined;
    name?: string | null;
    rootPath?: string | null;
}

export interface CrossCloneCherryPickServerRef {
    id: string;
    label: string;
    local: boolean;
}

export interface CrossCloneCherryPickWorkspaceSource {
    server: CrossCloneCherryPickServerRef;
    workspaces: WorkspaceInfo[];
    gitInfoResults: Record<string, GitInfoResponse | null | undefined>;
}

export interface CrossCloneCherryPickTarget {
    key: string;
    server: CrossCloneCherryPickServerRef;
    workspace: WorkspaceInfo;
    gitInfo: GitInfoResponse | null;
    normalizedRemoteUrl: string | null;
    remoteStatus: CrossCloneRemoteStatus;
    remoteLabel: string;
    recommended: boolean;
    disabledReason?: string;
}

export interface CrossCloneCherryPickTargetGroup {
    key: string;
    label: string;
    normalizedRemoteUrl: string | null;
    remoteStatus: CrossCloneRemoteStatus;
    targets: CrossCloneCherryPickTarget[];
}

export function getWorkspaceRemoteUrl(workspace: WorkspaceInfo | undefined, gitInfo?: GitInfoResponse | null): string | null {
    return workspace?.remoteUrl || gitInfo?.remoteUrl || null;
}

export function normalizeWorkspaceRemoteUrl(workspace: WorkspaceInfo | undefined, gitInfo?: GitInfoResponse | null): string | null {
    const raw = getWorkspaceRemoteUrl(workspace, gitInfo);
    if (!raw) return null;
    return normalizeRemoteUrl(raw) || null;
}

export function buildCrossCloneCherryPickTargetGroups(
    sourceWorkspaceId: string,
    sourceRemoteUrl: string | null | undefined,
    workspaces: WorkspaceInfo[],
    gitInfoResults: Record<string, GitInfoResponse | null | undefined>,
): CrossCloneCherryPickTargetGroup[] {
    const sourceWorkspace = workspaces.find(candidate => candidate.id === sourceWorkspaceId);
    return buildCrossCloneCherryPickTargetGroupsFromSources(
        {
            serverId: LOCAL_COC_SERVER_ID,
            workspaceId: sourceWorkspaceId,
            remoteUrl: sourceRemoteUrl,
            name: sourceWorkspace?.name,
            rootPath: sourceWorkspace?.rootPath,
        },
        [{
            server: {
                id: LOCAL_COC_SERVER_ID,
                label: LOCAL_COC_SERVER_LABEL,
                local: true,
            },
            workspaces,
            gitInfoResults,
        }],
    );
}

export function buildCrossCloneCherryPickTargetGroupsFromSources(
    source: CrossCloneCherryPickSource,
    sources: CrossCloneCherryPickWorkspaceSource[],
): CrossCloneCherryPickTargetGroup[] {
    const sourceIdentity = resolveRepoIdentity(source);
    const normalizedSourceRemoteUrl = sourceIdentity.normalizedOrigin;
    const groupMap = new Map<string, CrossCloneCherryPickTargetGroup>();

    for (const workspaceSource of sources) {
        for (const workspace of workspaceSource.workspaces) {
            if (
                workspaceSource.server.id === source.serverId
                && workspace.id === source.workspaceId
            ) {
                continue;
            }
            if (workspace.virtual) continue;

            const gitInfo = workspaceSource.gitInfoResults[workspace.id] ?? null;
            const targetIdentity = resolveRepoIdentity({
                remoteUrl: getWorkspaceRemoteUrl(workspace, gitInfo),
                name: workspace.name,
                rootPath: workspace.rootPath,
            });
            // Only clones of the source repository are offered as targets; everything
            // else is hidden outright (no greyed-out rows, no reveal toggle).
            if (!isSameRepoClone(sourceIdentity, targetIdentity)) continue;

            const normalizedRemoteUrl = targetIdentity.normalizedOrigin;
            const remoteStatus = getRemoteStatus(normalizedSourceRemoteUrl, normalizedRemoteUrl);
            const remoteLabel = normalizedRemoteUrl ? remoteUrlLabel(normalizedRemoteUrl) : 'No remote detected';
            const target: CrossCloneCherryPickTarget = {
                key: getCrossCloneCherryPickTargetKey(workspaceSource.server.id, workspace.id),
                server: workspaceSource.server,
                workspace,
                gitInfo,
                normalizedRemoteUrl,
                remoteStatus,
                remoteLabel,
                recommended: remoteStatus === 'same-remote',
                disabledReason: gitInfo && gitInfo.isGitRepo === false ? 'Not a Git repository' : undefined,
            };
            // Group on the lowercased origin so clones that differ only by case land together.
            const groupKey = normalizedRemoteUrl?.toLowerCase() ?? `${workspaceSource.server.id}:workspace:${workspace.id}`;
            const existing = groupMap.get(groupKey);
            if (existing) {
                existing.targets.push(target);
            } else {
                groupMap.set(groupKey, {
                    key: groupKey,
                    label: remoteLabel,
                    normalizedRemoteUrl,
                    remoteStatus,
                    targets: [target],
                });
            }
        }
    }

    return [...groupMap.values()]
        .map(group => ({
            ...group,
            targets: [...group.targets].sort(compareTargets),
        }))
        .sort(compareGroups);
}

export function getCrossCloneCherryPickTargetKey(serverId: string, workspaceId: string): string {
    return `${encodeURIComponent(serverId)}:${encodeURIComponent(workspaceId)}`;
}

function getRemoteStatus(
    normalizedSourceRemoteUrl: string | null,
    normalizedTargetRemoteUrl: string | null,
): CrossCloneRemoteStatus {
    if (!normalizedSourceRemoteUrl || !normalizedTargetRemoteUrl) return 'unknown';
    return isSameNormalizedOrigin(normalizedSourceRemoteUrl, normalizedTargetRemoteUrl) ? 'same-remote' : 'cross-remote';
}

function compareGroups(a: CrossCloneCherryPickTargetGroup, b: CrossCloneCherryPickTargetGroup): number {
    const byStatus = statusRank(a.remoteStatus) - statusRank(b.remoteStatus);
    if (byStatus !== 0) return byStatus;
    return a.label.localeCompare(b.label);
}

function compareTargets(a: CrossCloneCherryPickTarget, b: CrossCloneCherryPickTarget): number {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    const byServer = a.server.label.localeCompare(b.server.label);
    if (byServer !== 0) return byServer;
    return String(a.workspace.name || a.workspace.id).localeCompare(String(b.workspace.name || b.workspace.id));
}

function statusRank(status: CrossCloneRemoteStatus): number {
    if (status === 'same-remote') return 0;
    if (status === 'cross-remote') return 1;
    return 2;
}
