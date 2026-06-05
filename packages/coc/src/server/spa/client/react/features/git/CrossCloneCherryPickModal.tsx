import { useCallback, useEffect, useMemo, useState } from 'react';
import { CocApiError, type GitInfoResponse, type GitPatchApplyResponse, type WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { listWorkspaces, getWorkspaceGitInfoBatch, listRemoteWorkspaceTargetSources } from '../../repos/repositoryService';
import { Dialog } from '../../ui/Dialog';
import type { GitCommitItem } from './commits/CommitList';
import {
    buildCrossCloneCherryPickTargetGroupsFromSources,
    LOCAL_COC_SERVER_ID,
    LOCAL_COC_SERVER_LABEL,
    normalizeWorkspaceRemoteUrl,
    type CrossCloneCherryPickTarget,
    type CrossCloneCherryPickWorkspaceSource,
} from './crossCloneCherryPickTargets';

interface CrossCloneCherryPickModalProps {
    open: boolean;
    sourceWorkspaceId: string;
    sourceWorkspace?: WorkspaceInfo;
    sourceBranch?: string;
    commit: GitCommitItem | null;
    onClose: () => void;
    onApplied?: (result: GitPatchApplyResponse) => void;
}

export function CrossCloneCherryPickModal({
    open,
    sourceWorkspaceId,
    sourceWorkspace,
    sourceBranch,
    commit,
    onClose,
    onApplied,
}: CrossCloneCherryPickModalProps) {
    const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
    const [gitInfoResults, setGitInfoResults] = useState<Record<string, GitInfoResponse | null>>({});
    const [remoteTargetSources, setRemoteTargetSources] = useState<CrossCloneCherryPickWorkspaceSource[]>([]);
    const [remoteLoadWarnings, setRemoteLoadWarnings] = useState<string[]>([]);
    const [loadingTargets, setLoadingTargets] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedTargetKey, setSelectedTargetKey] = useState<string>('');
    const [crossRemoteConfirmed, setCrossRemoteConfirmed] = useState(false);
    const [stashAndContinue, setStashAndContinue] = useState(false);
    const [applying, setApplying] = useState(false);
    const [applyError, setApplyError] = useState<string | null>(null);
    const [result, setResult] = useState<GitPatchApplyResponse | null>(null);
    const [resultServerLabel, setResultServerLabel] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoadingTargets(true);
        setLoadError(null);
        setApplyError(null);
        setResult(null);
        setResultServerLabel(null);
        setSelectedTargetKey('');
        setCrossRemoteConfirmed(false);
        setStashAndContinue(false);
        setRemoteTargetSources([]);
        setRemoteLoadWarnings([]);

        listWorkspaces()
            .then(async workspaceList => {
                const [response, remoteTargetResult] = await Promise.all([
                    workspaceList.length > 0
                        ? getWorkspaceGitInfoBatch(workspaceList.map(workspace => workspace.id))
                        : Promise.resolve({ results: {} }),
                    listRemoteWorkspaceTargetSources().catch(error => ({
                        sources: [],
                        warnings: [getSpaCocClientErrorMessage(error, 'Failed to load remote CoC workspaces')],
                    })),
                ]);
                if (cancelled) return;
                setWorkspaces(workspaceList);
                setGitInfoResults(response.results ?? {});
                setRemoteTargetSources(remoteTargetResult.sources.map(source => ({
                    server: {
                        id: source.server.id,
                        label: source.server.label || source.server.id,
                        local: false,
                    },
                    workspaces: source.workspaces,
                    gitInfoResults: source.gitInfoResults,
                })));
                setRemoteLoadWarnings(remoteTargetResult.warnings);
            })
            .catch(error => {
                if (cancelled) return;
                setLoadError(getSpaCocClientErrorMessage(error, 'Failed to load registered workspaces'));
                setWorkspaces([]);
                setGitInfoResults({});
                setRemoteTargetSources([]);
                setRemoteLoadWarnings([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingTargets(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open]);

    const resolvedSourceWorkspace = useMemo(
        () => workspaces.find(workspace => workspace.id === sourceWorkspaceId) ?? sourceWorkspace,
        [sourceWorkspace, sourceWorkspaceId, workspaces],
    );
    const sourceGitInfo = gitInfoResults[sourceWorkspaceId] ?? null;
    const sourceRemoteUrl = normalizeWorkspaceRemoteUrl(resolvedSourceWorkspace, sourceGitInfo);
    const targetSources = useMemo<CrossCloneCherryPickWorkspaceSource[]>(() => [
        {
            server: {
                id: LOCAL_COC_SERVER_ID,
                label: LOCAL_COC_SERVER_LABEL,
                local: true,
            },
            workspaces,
            gitInfoResults,
        },
        ...remoteTargetSources,
    ], [gitInfoResults, remoteTargetSources, workspaces]);
    const targetGroups = useMemo(
        () => buildCrossCloneCherryPickTargetGroupsFromSources(
            {
                serverId: LOCAL_COC_SERVER_ID,
                workspaceId: sourceWorkspaceId,
                remoteUrl: sourceRemoteUrl,
            },
            targetSources,
        ),
        [sourceRemoteUrl, sourceWorkspaceId, targetSources],
    );
    const targets = useMemo(() => targetGroups.flatMap(group => group.targets), [targetGroups]);
    const selectedTarget = targets.find(target => target.key === selectedTargetKey) ?? null;

    useEffect(() => {
        if (!open || selectedTargetKey) return;
        const defaultTarget = targets.find(target => target.recommended && !target.disabledReason)
            ?? targets.find(target => !target.disabledReason)
            ?? targets[0];
        if (defaultTarget) setSelectedTargetKey(defaultTarget.key);
    }, [open, selectedTargetKey, targets]);

    useEffect(() => {
        setCrossRemoteConfirmed(false);
        setStashAndContinue(false);
        setApplyError(null);
        setResult(null);
        setResultServerLabel(null);
    }, [selectedTargetKey]);

    const handleApply = useCallback(async () => {
        if (!commit || !selectedTarget || selectedTarget.disabledReason) return;
        setApplying(true);
        setApplyError(null);
        setResult(null);
        setResultServerLabel(null);
        try {
            if (selectedTarget.server.local) {
                const exported = await getSpaCocClient().git.exportCommitPatch(sourceWorkspaceId, commit.hash);
                const response = await getSpaCocClient().git.applyCommitPatch(selectedTarget.workspace.id, {
                    patch: exported.patch,
                    stashAndContinue,
                    sourceWorkspace: exported.sourceWorkspace,
                    sourceCommit: exported.sourceCommit,
                    normalizedSourceRemoteUrl: exported.normalizedSourceRemoteUrl,
                });
                setResultServerLabel(selectedTarget.server.label);
                setResult(response);
                onApplied?.(response);
            } else {
                const response = await getSpaCocClient().servers.cherryPickTransfer({
                    source: {
                        serverId: LOCAL_COC_SERVER_ID,
                        workspaceId: sourceWorkspaceId,
                        commitHash: commit.hash,
                    },
                    target: {
                        serverId: selectedTarget.server.id,
                        workspaceId: selectedTarget.workspace.id,
                        stashAndContinue,
                    },
                });
                setResultServerLabel(response.target.server.label || selectedTarget.server.label);
                setResult(response.result);
                onApplied?.(response.result);
            }
        } catch (error) {
            setApplyError(getApplyErrorMessage(error));
        } finally {
            setApplying(false);
        }
    }, [commit, onApplied, selectedTarget, sourceWorkspaceId, stashAndContinue]);

    if (!commit) return null;

    const sourceName = resolvedSourceWorkspace?.name || sourceWorkspaceId;
    const sourceBranchLabel = sourceGitInfo?.branch ?? sourceBranch ?? 'unknown';
    const selectedIsCrossRemote = selectedTarget?.remoteStatus === 'cross-remote';
    const selectedIsDirty = selectedTarget?.gitInfo?.dirty === true;
    const canApply = Boolean(selectedTarget)
        && !selectedTarget?.disabledReason
        && !applying
        && (!selectedIsCrossRemote || crossRemoteConfirmed)
        && (!selectedIsDirty || stashAndContinue);

    return (
        <Dialog
            open={open}
            onClose={applying ? () => {} : onClose}
            title="Cherry-pick to another clone"
            className="max-w-[760px]"
            disableClose={applying}
            footer={(
                <>
                    <button
                        type="button"
                        className="px-3 py-1.5 text-xs rounded border border-[#c8c8c8] dark:border-[#555] text-[#333] dark:text-[#ddd] hover:bg-[#f3f3f3] dark:hover:bg-[#333]"
                        onClick={onClose}
                        disabled={applying}
                    >
                        Close
                    </button>
                    <button
                        type="button"
                        className="px-3 py-1.5 text-xs rounded bg-[#0078d4] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#106ebe]"
                        onClick={() => { void handleApply(); }}
                        disabled={!canApply}
                    >
                        {applying ? 'Applying...' : 'Apply patch'}
                    </button>
                </>
            )}
        >
            <div className="flex flex-col gap-4" data-testid="cross-clone-cherry-pick-modal">
                <section className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#1f1f1f] p-3">
                    <div className="text-xs uppercase tracking-[0.07em] text-[#616161] dark:text-[#999] mb-2">Source</div>
                    <div className="grid gap-1 text-sm">
                        <div><span className="font-medium">Workspace:</span> {sourceName}</div>
                        <div><span className="font-medium">Server:</span> {LOCAL_COC_SERVER_LABEL}</div>
                        <div><span className="font-medium">Branch:</span> {sourceBranchLabel}</div>
                        <div><span className="font-medium">Commit:</span> {commit.shortHash} - {commit.subject}</div>
                        <div><span className="font-medium">Remote:</span> {sourceRemoteUrl || 'No remote detected'}</div>
                    </div>
                </section>

                <section>
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <div>
                            <div className="text-xs uppercase tracking-[0.07em] text-[#616161] dark:text-[#999]">Target workspace</div>
                            <div className="text-xs text-[#616161] dark:text-[#999]">Registered workspaces on the current CoC server and online remote CoC servers.</div>
                        </div>
                    </div>

                    {remoteLoadWarnings.length > 0 && (
                        <div className="mb-2 rounded border border-[#f1d18a] dark:border-[#5a4218] bg-[#fff8e1] dark:bg-[#2a210f] p-2 text-xs text-[#5f4200] dark:text-[#ffdf91]">
                            Some remote CoC targets were skipped: {remoteLoadWarnings.join('; ')}
                        </div>
                    )}

                    {loadingTargets ? (
                        <div className="text-sm text-[#616161] dark:text-[#999]">Loading registered workspaces and remote CoC targets...</div>
                    ) : loadError ? (
                        <div className="rounded border border-[#f2c8c8] dark:border-[#5a2a2a] bg-[#fff5f5] dark:bg-[#2a1717] p-3 text-sm text-[#b00020] dark:text-[#f48771]">
                            {loadError}
                        </div>
                    ) : targets.length === 0 ? (
                        <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 text-sm text-[#616161] dark:text-[#999]">
                            No other registered workspaces are available.
                        </div>
                    ) : (
                        <div className="max-h-[320px] overflow-y-auto rounded border border-[#e0e0e0] dark:border-[#3c3c3c]" role="radiogroup" aria-label="Target workspace">
                            {targetGroups.map(group => (
                                <div key={group.key}>
                                    <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#252526] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[#616161] dark:text-[#999]">
                                        <span>{group.label}</span>
                                        <span className={remoteBadgeClass(group.remoteStatus)}>{remoteStatusLabel(group.remoteStatus)}</span>
                                    </div>
                                    {group.targets.map(target => (
                                        <label
                                            key={target.key}
                                            className={`flex cursor-pointer items-start gap-3 border-b border-[#eeeeee] dark:border-[#333] px-3 py-2 last:border-b-0 ${target.disabledReason ? 'opacity-60 cursor-not-allowed' : 'hover:bg-[#f8fbff] dark:hover:bg-[#1b2733]'}`}
                                        >
                                            <input
                                                type="radio"
                                                className="mt-1"
                                                name="cross-clone-cherry-pick-target"
                                                value={target.key}
                                                checked={selectedTargetKey === target.key}
                                                disabled={Boolean(target.disabledReason)}
                                                onChange={() => setSelectedTargetKey(target.key)}
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex flex-wrap items-center gap-2">
                                                    <span className="font-medium text-[#1e1e1e] dark:text-[#ddd]">{target.workspace.name || target.workspace.id}</span>
                                                    <span className="rounded bg-[#eeeeee] dark:bg-[#333] px-1.5 py-0.5 text-[10px] text-[#616161] dark:text-[#aaa]">{target.server.label}</span>
                                                    {target.recommended && <span className="rounded bg-[#e6f4ea] dark:bg-[#183a24] px-1.5 py-0.5 text-[10px] text-[#16825d] dark:text-[#7ee787]">Recommended</span>}
                                                    <span className={dirtyStateClass(target.gitInfo)}>
                                                        {dirtyStateLabel(target.gitInfo)}
                                                    </span>
                                                </span>
                                                <span className="mt-0.5 block text-xs text-[#616161] dark:text-[#999]">
                                                    Branch: {target.gitInfo?.branch ?? 'unknown'} · {getWorkspaceDisplayPath(target.workspace)}
                                                </span>
                                                <span className="mt-0.5 block text-xs text-[#616161] dark:text-[#999]">
                                                    Remote: {target.normalizedRemoteUrl || 'No remote detected'}
                                                </span>
                                                {target.disabledReason && (
                                                    <span className="mt-1 block text-xs text-[#b00020] dark:text-[#f48771]">{target.disabledReason}</span>
                                                )}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {selectedTarget && (
                    <section className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 text-sm">
                        <div className="font-medium mb-1">Selected target</div>
                        <div className="grid gap-1 text-xs text-[#616161] dark:text-[#999]">
                            <div>Server: {selectedTarget.server.label}</div>
                            <div>Workspace: {selectedTarget.workspace.name || selectedTarget.workspace.id}</div>
                            <div>Branch: {selectedTarget.gitInfo?.branch ?? 'unknown'}</div>
                            <div>Dirty state: {dirtyStateLabel(selectedTarget.gitInfo).toLowerCase()}</div>
                            <div>Remote status: {remoteStatusLabel(selectedTarget.remoteStatus)}</div>
                        </div>
                    </section>
                )}

                {selectedTarget?.remoteStatus === 'cross-remote' && (
                    <label className="rounded border border-[#f1d18a] dark:border-[#5a4218] bg-[#fff8e1] dark:bg-[#2a210f] p-3 text-sm text-[#5f4200] dark:text-[#ffdf91] flex gap-2">
                        <input
                            type="checkbox"
                            checked={crossRemoteConfirmed}
                            onChange={event => setCrossRemoteConfirmed(event.target.checked)}
                        />
                        <span>
                            I understand the source and target remotes differ, and I want to apply this patch to the selected cross-remote workspace.
                        </span>
                    </label>
                )}

                {selectedTarget?.gitInfo?.dirty && (
                    <label className="rounded border border-[#f1d18a] dark:border-[#5a4218] bg-[#fff8e1] dark:bg-[#2a210f] p-3 text-sm text-[#5f4200] dark:text-[#ffdf91] flex gap-2">
                        <input
                            type="checkbox"
                            checked={stashAndContinue}
                            onChange={event => setStashAndContinue(event.target.checked)}
                        />
                        <span>
                            Stash target workspace changes before applying. CoC will not auto-stash unless this is checked.
                        </span>
                    </label>
                )}

                {applyError && (
                    <div className="rounded border border-[#f2c8c8] dark:border-[#5a2a2a] bg-[#fff5f5] dark:bg-[#2a1717] p-3 text-sm text-[#b00020] dark:text-[#f48771]" data-testid="cross-clone-cherry-pick-error">
                        {applyError}
                    </div>
                )}

                {result && (
                    <div className="rounded border border-[#b7dfc4] dark:border-[#285a35] bg-[#f1fff4] dark:bg-[#122518] p-3 text-sm text-[#1a5e2b] dark:text-[#7ee787]" data-testid="cross-clone-cherry-pick-success">
                        Applied to {resultServerLabel ? `${resultServerLabel} / ` : ''}{result.targetWorkspace.name || result.targetWorkspace.id} on {result.targetBranch || 'unknown branch'}.
                        {result.newCommitHash || result.targetHead ? ` New commit: ${result.newCommitHash || result.targetHead}.` : ''}
                    </div>
                )}
            </div>
        </Dialog>
    );
}

function remoteStatusLabel(status: CrossCloneCherryPickTarget['remoteStatus']): string {
    if (status === 'same-remote') return 'Same remote';
    if (status === 'cross-remote') return 'Cross remote';
    return 'Remote unknown';
}

function remoteBadgeClass(status: CrossCloneCherryPickTarget['remoteStatus']): string {
    if (status === 'same-remote') return 'rounded bg-[#e6f4ea] dark:bg-[#183a24] px-1.5 py-0.5 text-[10px] text-[#16825d] dark:text-[#7ee787]';
    if (status === 'cross-remote') return 'rounded bg-[#fff4ce] dark:bg-[#332a12] px-1.5 py-0.5 text-[10px] text-[#8a5a00] dark:text-[#ffdf91]';
    return 'rounded bg-[#eeeeee] dark:bg-[#333] px-1.5 py-0.5 text-[10px] text-[#616161] dark:text-[#aaa]';
}

function getWorkspaceDisplayPath(workspace: WorkspaceInfo): string {
    return String(workspace.alias || workspace.path || workspace.rootPath || workspace.id);
}

function dirtyStateLabel(gitInfo: GitInfoResponse | null): string {
    if (!gitInfo) return 'Unknown';
    return gitInfo.dirty ? 'Dirty' : 'Clean';
}

function dirtyStateClass(gitInfo: GitInfoResponse | null): string {
    if (!gitInfo) return 'text-[11px] text-[#616161] dark:text-[#999]';
    return gitInfo.dirty
        ? 'text-[11px] text-[#b26a00] dark:text-[#ffb74d]'
        : 'text-[11px] text-[#16825d] dark:text-[#7ee787]';
}

function getApplyErrorMessage(error: unknown): string {
    if (error instanceof CocApiError && error.body && typeof error.body === 'object') {
        const body = error.body as Record<string, unknown>;
        if (body.conflicts === true) {
            return 'Cherry-pick transfer has conflicts in the target workspace. Resolve locally, then continue or abort the in-progress git am operation.';
        }
        if (body.dirty === true) {
            return 'The target workspace has uncommitted changes. Check "Stash target workspace changes before applying" to continue explicitly.';
        }
    }
    return getSpaCocClientErrorMessage(error, 'Cherry-pick transfer failed');
}
