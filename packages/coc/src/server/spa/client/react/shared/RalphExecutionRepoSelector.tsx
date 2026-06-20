import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { listRemoteWorkspaceTargetSources, listWorkspaces } from '../repos/repositoryService';
import { lookupCloneBaseUrl } from '../repos/cloneRegistry';
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
}

export interface RalphExecutionRepoTargetGroup {
    key: string;
    label: string;
    local: boolean;
    targets: RalphExecutionRepoTarget[];
}

export interface UseRalphExecutionRepoTargetsOptions {
    open: boolean;
    sourceWorkspaceId?: string;
}

export interface UseRalphExecutionRepoTargetsResult {
    loading: boolean;
    loadError: string | null;
    warnings: string[];
    groups: RalphExecutionRepoTargetGroup[];
    targets: RalphExecutionRepoTarget[];
    selectedKey: string;
    setSelectedKey: (key: string) => void;
    selectedTarget: RalphExecutionRepoTarget | null;
}

export interface RalphExecutionRepoSelectorProps {
    groups: RalphExecutionRepoTargetGroup[];
    loading: boolean;
    loadError: string | null;
    warnings: string[];
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
    const apiBasePath = (globalThis as { window?: { __DASHBOARD_CONFIG__?: { apiBasePath?: string } } })
        .window?.__DASHBOARD_CONFIG__?.apiBasePath ?? '/api';
    return target.baseUrl.replace(/\/+$/, '') + apiBasePath;
}

export function isSameRalphExecutionTarget(
    sourceWorkspaceId: string | undefined,
    target: RalphExecutionRepoTarget | null,
): boolean {
    if (!sourceWorkspaceId || !target || target.workspaceId !== sourceWorkspaceId) {
        return false;
    }
    const sourceBaseUrl = lookupCloneBaseUrl(sourceWorkspaceId);
    if (!sourceBaseUrl) {
        return target.local;
    }
    return !target.local && normalizeBaseUrl(sourceBaseUrl) === normalizeBaseUrl(target.baseUrl);
}

export function useRalphExecutionRepoTargets({
    open,
    sourceWorkspaceId,
}: UseRalphExecutionRepoTargetsOptions): UseRalphExecutionRepoTargetsResult {
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [groups, setGroups] = useState<RalphExecutionRepoTargetGroup[]>([]);
    const [selectedKey, setSelectedKey] = useState('');

    const targets = useMemo(() => groups.flatMap(group => group.targets), [groups]);
    const selectedTarget = targets.find(target => target.key === selectedKey) ?? null;

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        setWarnings([]);

        Promise.all([
            listWorkspaces(),
            listRemoteWorkspaceTargetSources().catch(error => ({
                sources: [],
                warnings: [error instanceof Error ? error.message : 'Failed to load remote CoC workspaces'],
            })),
        ])
            .then(([workspaces, remoteResult]) => {
                if (cancelled) return;
                const nextGroups = buildRalphExecutionRepoTargetGroups(
                    workspaces,
                    remoteResult.sources,
                );
                setGroups(nextGroups);
                setWarnings(remoteResult.warnings);
                setSelectedKey(prev => resolveSelectedKey(prev, sourceWorkspaceId, nextGroups));
            })
            .catch(error => {
                if (cancelled) return;
                setGroups([]);
                setWarnings([]);
                setLoadError(error instanceof Error ? error.message : 'Failed to load registered workspaces');
                setSelectedKey('');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open, sourceWorkspaceId]);

    return {
        loading,
        loadError,
        warnings,
        groups,
        targets,
        selectedKey,
        setSelectedKey,
        selectedTarget,
    };
}

export function RalphExecutionRepoSelector({
    groups,
    loading,
    loadError,
    warnings,
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
            {warnings.length > 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400" data-testid={`${testIdPrefix}-execution-repo-warning`}>
                    Some remote CoC workspaces were skipped: {warnings.join('; ')}
                </p>
            )}
        </div>
    );
}

function buildRalphExecutionRepoTargetGroups(
    localWorkspaces: WorkspaceInfo[],
    remoteSources: Array<{
        server: { id: string; label?: string; effectiveUrl?: string };
        workspaces: WorkspaceInfo[];
    }>,
): RalphExecutionRepoTargetGroup[] {
    const groups: RalphExecutionRepoTargetGroup[] = [];
    const localTargets = localWorkspaces
        .filter(workspace => !workspace.virtual)
        .map(workspaceToLocalTarget);
    if (localTargets.length > 0) {
        groups.push({
            key: LOCAL_SERVER_ID,
            label: LOCAL_SERVER_LABEL,
            local: true,
            targets: localTargets,
        });
    }

    for (const source of remoteSources) {
        const baseUrl = source.server.effectiveUrl;
        if (!baseUrl) {
            continue;
        }
        const targets = source.workspaces
            .filter(workspace => !workspace.virtual)
            .map(workspace => workspaceToRemoteTarget(workspace, source.server, baseUrl));
        if (targets.length > 0) {
            groups.push({
                key: source.server.id,
                label: source.server.label || source.server.id,
                local: false,
                targets,
            });
        }
    }

    return groups;
}

function workspaceToLocalTarget(workspace: WorkspaceInfo): RalphExecutionRepoTarget {
    return {
        key: getRalphExecutionRepoTargetKey(LOCAL_SERVER_ID, workspace.id),
        workspaceId: workspace.id,
        workspaceName: String(workspace.name || workspace.id),
        workspacePath: getWorkspaceDisplayPath(workspace),
        serverId: LOCAL_SERVER_ID,
        serverLabel: LOCAL_SERVER_LABEL,
        local: true,
    };
}

function workspaceToRemoteTarget(
    workspace: WorkspaceInfo,
    server: { id: string; label?: string },
    baseUrl: string,
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
    };
}

function resolveSelectedKey(
    currentKey: string,
    sourceWorkspaceId: string | undefined,
    groups: RalphExecutionRepoTargetGroup[],
): string {
    const targets = groups.flatMap(group => group.targets);
    if (currentKey && targets.some(target => target.key === currentKey)) {
        return currentKey;
    }
    const sourceTarget = targets.find(target => isSameRalphExecutionTarget(sourceWorkspaceId, target));
    return sourceTarget?.key ?? targets[0]?.key ?? '';
}

function getWorkspaceDisplayPath(workspace: WorkspaceInfo): string | undefined {
    return String(workspace.alias || workspace.path || workspace.rootPath || '') || undefined;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
    return (baseUrl ?? '').replace(/\/+$/, '');
}
