import type { GitInfoResponse, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { normalizeRemoteUrl, remoteUrlLabel } from '../../repos/repoGrouping';

export type CrossCloneRemoteStatus = 'same-remote' | 'cross-remote' | 'unknown';

export interface CrossCloneCherryPickTarget {
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
    const normalizedSourceRemoteUrl = sourceRemoteUrl ? normalizeRemoteUrl(sourceRemoteUrl) || null : null;
    const groupMap = new Map<string, CrossCloneCherryPickTargetGroup>();

    for (const workspace of workspaces) {
        if (workspace.id === sourceWorkspaceId || workspace.virtual) continue;

        const gitInfo = gitInfoResults[workspace.id] ?? null;
        const normalizedRemoteUrl = normalizeWorkspaceRemoteUrl(workspace, gitInfo);
        const remoteStatus = getRemoteStatus(normalizedSourceRemoteUrl, normalizedRemoteUrl);
        const remoteLabel = normalizedRemoteUrl ? remoteUrlLabel(normalizedRemoteUrl) : 'No remote detected';
        const target: CrossCloneCherryPickTarget = {
            workspace,
            gitInfo,
            normalizedRemoteUrl,
            remoteStatus,
            remoteLabel,
            recommended: remoteStatus === 'same-remote',
            disabledReason: gitInfo && gitInfo.isGitRepo === false ? 'Not a Git repository' : undefined,
        };
        const groupKey = normalizedRemoteUrl ?? `workspace:${workspace.id}`;
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

    return [...groupMap.values()]
        .map(group => ({
            ...group,
            targets: [...group.targets].sort(compareTargets),
        }))
        .sort(compareGroups);
}

function getRemoteStatus(
    normalizedSourceRemoteUrl: string | null,
    normalizedTargetRemoteUrl: string | null,
): CrossCloneRemoteStatus {
    if (!normalizedSourceRemoteUrl || !normalizedTargetRemoteUrl) return 'unknown';
    return normalizedSourceRemoteUrl === normalizedTargetRemoteUrl ? 'same-remote' : 'cross-remote';
}

function compareGroups(a: CrossCloneCherryPickTargetGroup, b: CrossCloneCherryPickTargetGroup): number {
    const byStatus = statusRank(a.remoteStatus) - statusRank(b.remoteStatus);
    if (byStatus !== 0) return byStatus;
    return a.label.localeCompare(b.label);
}

function compareTargets(a: CrossCloneCherryPickTarget, b: CrossCloneCherryPickTarget): number {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    return String(a.workspace.name || a.workspace.id).localeCompare(String(b.workspace.name || b.workspace.id));
}

function statusRank(status: CrossCloneRemoteStatus): number {
    if (status === 'same-remote') return 0;
    if (status === 'cross-remote') return 1;
    return 2;
}
