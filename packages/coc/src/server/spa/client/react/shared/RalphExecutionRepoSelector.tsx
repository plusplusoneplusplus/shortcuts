import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { useRepos } from '../contexts/ReposContext';
import { isRemoteWorkspace } from '../repos/remoteWorkspaceAggregation';
import type { RepoData } from '../repos/repoGrouping';
import { parseRemoteCloneKey } from '../repos/cloneIdentity';
import { getApiBase } from '../utils/config';

const LOCAL_SERVER_ID = 'local';
const LOCAL_SERVER_LABEL = 'Current CoC';

export interface RalphExecutionRepoTarget {
    key: string;
    workspaceId: string;
    workspaceName: string;
    workspacePath?: string;
    serverId: string;
    serverLabel: string;
    local: boolean;
    baseUrl?: string;
    /** Whether the target workspace is a Git repository (gates worktree mode). */
    isGitRepo?: boolean;
}

export interface RalphExecutionRepoTargetGroup {
    key: string;
    label: string;
    local: boolean;
    targets: RalphExecutionRepoTarget[];
}

/**
 * Transient identity for the workspace that opened a Ralph launch surface.
 * `selectionId` is clone-qualified when the source belongs to a registered
 * remote server; `baseUrl` is a pop-out/legacy fallback and is never persisted.
 */
export interface RalphExecutionRepoSource {
    workspaceId?: string;
    selectionId?: string;
    baseUrl?: string;
}

export type RalphExecutionRepoSourceResolutionStatus =
    | 'none'
    | 'resolved'
    | 'unresolved'
    | 'ambiguous';

export interface RalphExecutionRepoSourceResolution {
    status: RalphExecutionRepoSourceResolutionStatus;
    target: RalphExecutionRepoTarget | null;
}

export interface UseRalphExecutionRepoTargetsOptions {
    open: boolean;
    source?: RalphExecutionRepoSource;
}

export interface UseRalphExecutionRepoTargetsResult {
    loading: boolean;
    loadError: string | null;
    warnings: string[];
    sourceWarning: string | null;
    groups: RalphExecutionRepoTargetGroup[];
    targets: RalphExecutionRepoTarget[];
    sourceTarget: RalphExecutionRepoTarget | null;
    sourceResolution: RalphExecutionRepoSourceResolution;
    selectedKey: string;
    setSelectedKey: (key: string) => void;
    selectedTarget: RalphExecutionRepoTarget | null;
}

export interface RalphExecutionRepoSelectorProps {
    groups: RalphExecutionRepoTargetGroup[];
    loading: boolean;
    loadError: string | null;
    warnings: string[];
    sourceWarning?: string | null;
    selectedKey: string;
    onSelectedKeyChange: (key: string) => void;
    disabled?: boolean;
    testIdPrefix: string;
}

export function getRalphExecutionRepoTargetKey(serverId: string, workspaceId: string): string {
    return `${encodeURIComponent(serverId)}:${encodeURIComponent(workspaceId)}`;
}

export function getRalphExecutionRepoApiBase(target: RalphExecutionRepoTarget): string {
    if (target.local || !target.baseUrl) {
        return getApiBase();
    }
    return getRemoteApiBase(target.baseUrl);
}

export function getRalphExecutionRepoSourceApiBase(
    source: RalphExecutionRepoSource | undefined,
    sourceTarget: RalphExecutionRepoTarget | null,
): string | null {
    if (sourceTarget) {
        return getRalphExecutionRepoApiBase(sourceTarget);
    }
    return source?.baseUrl ? getRemoteApiBase(source.baseUrl) : null;
}

function getRemoteApiBase(baseUrl: string): string {
    const apiBasePath = (globalThis as { window?: { __DASHBOARD_CONFIG__?: { apiBasePath?: string } } })
        .window?.__DASHBOARD_CONFIG__?.apiBasePath ?? '/api';
    return baseUrl.replace(/\/+$/, '') + apiBasePath;
}

/** Compare already-resolved execution identities. No clone-registry inference. */
export function isSameRalphExecutionTarget(
    sourceTarget: RalphExecutionRepoTarget | null,
    selectedTarget: RalphExecutionRepoTarget | null,
): boolean {
    return !!sourceTarget && !!selectedTarget && sourceTarget.key === selectedTarget.key;
}

/**
 * Resolve a transient source reference to one exact `(serverId, workspaceId)`
 * target. Missing clone-registry state is never treated as proof of locality.
 */
export function resolveRalphExecutionRepoSource(
    source: RalphExecutionRepoSource | undefined,
    targets: readonly RalphExecutionRepoTarget[],
): RalphExecutionRepoSourceResolution {
    const workspaceId = source?.workspaceId || undefined;
    const selectionId = source?.selectionId || undefined;
    const baseUrl = source?.baseUrl || undefined;
    if (!workspaceId && !selectionId && !baseUrl) {
        return { status: 'none', target: null };
    }

    if (selectionId) {
        const remote = parseRemoteCloneKey(selectionId);
        if (remote) {
            const match = targets.find(target => (
                target.serverId === remote.serverId
                && target.workspaceId === remote.workspaceId
            ));
            return match
                ? { status: 'resolved', target: match }
                : { status: 'unresolved', target: null };
        }

        // A bare dashboard selection id is local only when that exact local
        // workspace is currently registered. Never fall through to a remote
        // target that happens to share the same physical workspace id.
        const localMatch = targets.find(target => (
            target.serverId === LOCAL_SERVER_ID
            && target.workspaceId === selectionId
        ));
        return localMatch
            ? { status: 'resolved', target: localMatch }
            : { status: 'unresolved', target: null };
    }

    const workspaceMatches = workspaceId
        ? targets.filter(target => target.workspaceId === workspaceId)
        : [...targets];
    if (workspaceMatches.length === 1) {
        return { status: 'resolved', target: workspaceMatches[0] };
    }

    if (baseUrl) {
        const normalizedSourceUrl = normalizeBaseUrl(baseUrl);
        const urlMatches = workspaceMatches.filter(target => (
            !target.local
            && normalizeBaseUrl(target.baseUrl) === normalizedSourceUrl
        ));
        if (urlMatches.length === 1) {
            return { status: 'resolved', target: urlMatches[0] };
        }
        if (urlMatches.length > 1) {
            return { status: 'ambiguous', target: null };
        }
    }

    return {
        status: workspaceMatches.length > 1 ? 'ambiguous' : 'unresolved',
        target: null,
    };
}

export function useRalphExecutionRepoTargets({
    open,
    source,
}: UseRalphExecutionRepoTargetsOptions): UseRalphExecutionRepoTargetsResult {
    const { repos, loading, remoteWarnings = [] } = useRepos();
    const [selectedKey, setSelectedKey] = useState('');
    const userOwnedSelectionRef = useRef(false);
    const openSourceKeyRef = useRef<string | null>(null);

    const groups = useMemo(() => buildRalphExecutionRepoTargetGroups(repos), [repos]);
    const targets = useMemo(() => groups.flatMap(g => g.targets), [groups]);
    const sourceResolution = useMemo(
        () => resolveRalphExecutionRepoSource(source, targets),
        [source?.baseUrl, source?.selectionId, source?.workspaceId, targets],
    );
    const sourceTarget = sourceResolution.target;
    const sourceWarning = useMemo(
        () => getRalphExecutionRepoSourceWarning(source, sourceResolution, repos, loading),
        [loading, repos, source?.baseUrl, source?.selectionId, source?.workspaceId, sourceResolution],
    );
    const selectedTarget = targets.find(t => t.key === selectedKey) ?? null;
    const sourceKey = getSourceStateKey(source);

    useEffect(() => {
        if (!open) {
            openSourceKeyRef.current = null;
            return;
        }

        const newOpening = openSourceKeyRef.current !== sourceKey;
        if (newOpening) {
            openSourceKeyRef.current = sourceKey;
            userOwnedSelectionRef.current = false;
        }
        if (userOwnedSelectionRef.current) return;

        setSelectedKey(resolveAutomaticSelectedKey(sourceResolution, targets));
    }, [open, sourceKey, sourceResolution, targets]);

    const handleSelectedKeyChange = useCallback((key: string) => {
        userOwnedSelectionRef.current = true;
        setSelectedKey(key);
    }, []);

    return {
        loading,
        loadError: null,
        warnings: remoteWarnings,
        sourceWarning,
        groups,
        targets,
        sourceTarget,
        sourceResolution,
        selectedKey,
        setSelectedKey: handleSelectedKeyChange,
        selectedTarget,
    };
}

export function RalphExecutionRepoSelector({
    groups,
    loading,
    loadError,
    warnings,
    sourceWarning,
    selectedKey,
    onSelectedKeyChange,
    disabled = false,
    testIdPrefix,
}: RalphExecutionRepoSelectorProps) {
    const targets = groups.flatMap(group => group.targets);
    const selectedTarget = targets.find(target => target.key === selectedKey) ?? null;
    const hasOptions = targets.length > 0;

    return (
        <div data-testid={`${testIdPrefix}-execution-repo-selector`}>
            <label className="block text-xs text-[#848484] mb-1" htmlFor={`${testIdPrefix}-execution-repo-select`}>
                Run Ralph in:
            </label>
            {loading ? (
                <div className="text-xs rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#1f1f1f] px-2 py-1 text-[#5a5a5a] dark:text-[#cccccc]">
                    Loading repositories...
                </div>
            ) : loadError ? (
                <p className="text-xs text-[#f14c4c]" data-testid={`${testIdPrefix}-execution-repo-error`}>
                    {loadError}
                </p>
            ) : hasOptions ? (
                <>
                    <select
                        id={`${testIdPrefix}-execution-repo-select`}
                        data-testid={`${testIdPrefix}-execution-repo-select`}
                        value={selectedKey}
                        onChange={event => onSelectedKeyChange(event.target.value)}
                        disabled={disabled}
                        className="w-full rounded border border-[#d0d0d0] dark:border-[#4a4a4a] bg-white dark:bg-[#1e1e1e] text-xs text-[#1e1e1e] dark:text-[#cccccc] px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {!selectedKey && (
                            <option value="" disabled>
                                Choose a repository…
                            </option>
                        )}
                        {groups.map(group => (
                            <optgroup key={group.key} label={group.label}>
                                {group.targets.map(target => (
                                    <option key={target.key} value={target.key}>
                                        {target.workspaceName || target.workspaceId}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                    {selectedTarget && (
                        <p className="mt-1 text-[11px] text-[#848484]" data-testid={`${testIdPrefix}-execution-repo-summary`}>
                            Ralph will run in {selectedTarget.workspaceName || selectedTarget.workspaceId} on {selectedTarget.serverLabel}.
                        </p>
                    )}
                </>
            ) : (
                <p className="text-xs text-[#f14c4c]" data-testid={`${testIdPrefix}-execution-repo-empty`}>
                    Register a workspace or bring a remote CoC server online before starting Ralph.
                </p>
            )}
            {sourceWarning && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400" data-testid={`${testIdPrefix}-execution-repo-source-warning`}>
                    {sourceWarning}
                </p>
            )}
            {warnings.length > 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400" data-testid={`${testIdPrefix}-execution-repo-warning`}>
                    Some remote CoC workspaces were skipped: {warnings.join('; ')}
                </p>
            )}
        </div>
    );
}

export function buildRalphExecutionRepoTargetGroups(repos: RepoData[]): RalphExecutionRepoTargetGroup[] {
    const groups: RalphExecutionRepoTargetGroup[] = [];

    const localTargets = repos
        .filter(r => !isRemoteWorkspace(r.workspace) && !r.workspace.virtual)
        .map(r => workspaceToLocalTarget(r.workspace, resolveIsGitRepo(r)));
    if (localTargets.length > 0) {
        groups.push({ key: LOCAL_SERVER_ID, label: LOCAL_SERVER_LABEL, local: true, targets: localTargets });
    }

    const byServer = new Map<string, { label: string; targets: RalphExecutionRepoTarget[] }>();
    for (const r of repos) {
        const ws = r.workspace;
        if (!isRemoteWorkspace(ws) || ws.virtual) continue;
        if (ws.remote.offline) continue;
        const { serverId, serverLabel, baseUrl } = ws.remote;
        if (!byServer.has(serverId)) byServer.set(serverId, { label: serverLabel, targets: [] });
        byServer.get(serverId)!.targets.push(
            workspaceToRemoteTarget(ws, { id: serverId, label: serverLabel }, baseUrl, resolveIsGitRepo(r)),
        );
    }
    for (const [key, g] of byServer) {
        if (g.targets.length > 0) {
            groups.push({ key, label: g.label, local: false, targets: g.targets });
        }
    }
    return groups;
}

/** Resolve whether a repo row is a Git repository from git info or the workspace flag. */
function resolveIsGitRepo(repo: RepoData): boolean | undefined {
    if (typeof repo.gitInfo?.isGitRepo === 'boolean') return repo.gitInfo.isGitRepo;
    const flag = (repo.workspace as { isGitRepo?: unknown }).isGitRepo;
    return typeof flag === 'boolean' ? flag : undefined;
}

function workspaceToLocalTarget(workspace: WorkspaceInfo, isGitRepo?: boolean): RalphExecutionRepoTarget {
    return {
        key: getRalphExecutionRepoTargetKey(LOCAL_SERVER_ID, workspace.id),
        workspaceId: workspace.id,
        workspaceName: String(workspace.name || workspace.id),
        workspacePath: getWorkspaceDisplayPath(workspace),
        serverId: LOCAL_SERVER_ID,
        serverLabel: LOCAL_SERVER_LABEL,
        local: true,
        isGitRepo,
    };
}

function workspaceToRemoteTarget(
    workspace: WorkspaceInfo,
    server: { id: string; label?: string },
    baseUrl: string,
    isGitRepo?: boolean,
): RalphExecutionRepoTarget {
    const serverLabel = server.label || server.id;
    return {
        key: getRalphExecutionRepoTargetKey(server.id, workspace.id),
        workspaceId: workspace.id,
        workspaceName: String(workspace.name || workspace.id),
        workspacePath: getWorkspaceDisplayPath(workspace),
        serverId: server.id,
        serverLabel,
        local: false,
        baseUrl,
        isGitRepo,
    };
}

function resolveAutomaticSelectedKey(
    sourceResolution: RalphExecutionRepoSourceResolution,
    targets: readonly RalphExecutionRepoTarget[],
): string {
    if (sourceResolution.status === 'resolved') {
        return sourceResolution.target?.key ?? '';
    }
    if (sourceResolution.status === 'none') {
        return targets[0]?.key ?? '';
    }
    return '';
}

function getWorkspaceDisplayPath(workspace: WorkspaceInfo): string | undefined {
    return String(workspace.alias || workspace.path || workspace.rootPath || '') || undefined;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
    return (baseUrl ?? '').replace(/\/+$/, '');
}

function getSourceStateKey(source: RalphExecutionRepoSource | undefined): string {
    return [
        source?.selectionId ?? '',
        source?.workspaceId ?? '',
        normalizeBaseUrl(source?.baseUrl),
    ].join('\0');
}

function getRalphExecutionRepoSourceWarning(
    source: RalphExecutionRepoSource | undefined,
    resolution: RalphExecutionRepoSourceResolution,
    repos: RepoData[],
    loading: boolean,
): string | null {
    if (resolution.status === 'none' || resolution.status === 'resolved') {
        return null;
    }
    if (loading) {
        return 'Loading the source workspace…';
    }
    if (resolution.status === 'ambiguous') {
        return 'The source workspace matches multiple repositories. Choose a repository explicitly.';
    }

    const offlineSource = findOfflineSourceRepo(source, repos);
    const parsedSelection = parseRemoteCloneKey(source?.selectionId);
    if (offlineSource && isRemoteWorkspace(offlineSource.workspace)) {
        const { serverLabel, connection } = offlineSource.workspace.remote;
        if (connection === 'connecting' || connection === 'idle') {
            return `The source workspace on ${serverLabel} is connecting. Wait for it or choose another repository.`;
        }
        return `The source workspace on ${serverLabel} is offline. Reconnect it or choose another repository.`;
    }
    if (parsedSelection) {
        return `The source workspace on ${parsedSelection.serverId} is unavailable. Reconnect it or choose another repository.`;
    }
    return 'The source workspace is unavailable. Refresh repositories or choose another repository.';
}

function findOfflineSourceRepo(
    source: RalphExecutionRepoSource | undefined,
    repos: RepoData[],
): RepoData | null {
    const offlineRepos = repos.filter(repo => (
        isRemoteWorkspace(repo.workspace)
        && repo.workspace.remote.offline
    ));
    const parsedSelection = parseRemoteCloneKey(source?.selectionId);
    if (parsedSelection) {
        return offlineRepos.find(repo => (
            repo.workspace.remote.serverId === parsedSelection.serverId
            && repo.workspace.id === parsedSelection.workspaceId
        )) ?? null;
    }
    if (source?.selectionId) {
        // A bare selection id explicitly identifies a local source.
        return null;
    }

    let candidates = source?.workspaceId
        ? offlineRepos.filter(repo => repo.workspace.id === source.workspaceId)
        : offlineRepos;
    if (source?.baseUrl) {
        const baseUrl = normalizeBaseUrl(source.baseUrl);
        candidates = candidates.filter(repo => normalizeBaseUrl(repo.workspace.remote.baseUrl) === baseUrl);
    }
    return candidates.length === 1 ? candidates[0] : null;
}
