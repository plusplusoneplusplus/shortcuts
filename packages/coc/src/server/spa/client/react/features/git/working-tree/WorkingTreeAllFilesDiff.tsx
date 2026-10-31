import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCocClient, useCloneBaseUrl } from '../../../repos/cloneRouting';
import { WorkspaceOwnerContext } from '../../../repos/workspaceOwnerContext';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { ReviewFiles } from '../diff/ReviewFiles';
import { reviewFileKey } from '../diff/gitReviewFiles';
import { useDirtyDetailGuard } from '../repoGitTab/useDirtyDetailGuard';
import { WorkingTreeFileDiff, type WorkingTreeFileDiffProps } from './WorkingTreeFileDiff';
import { workingTreeCommentContext } from './workingTreeCommentContext';
import { hasMultipleRepos, relDisplayPath, repoRelative, type WorkingTreeChange } from './WorkingTree';
import { useUnifiedPanelHost } from '../../repo-detail/unified-right-panel/unifiedPanelHost';
import { openChangedFileSource, openFileMenuItem } from '../diff/changedFileSource';
import { useFileCommentComposer } from '../diff/fileCommentComposer';

type Stage = WorkingTreeChange['stage'];
const STAGE_LABEL: Record<Stage, string> = { staged: 'Staged', unstaged: 'Unstaged', untracked: 'Untracked' };

export interface WorkingTreeAllFilesDiffProps extends Pick<WorkingTreeFileDiffProps,
    'workspaceId' | 'attachmentDestinationId' | 'repoRoot' | 'refreshKey' | 'onFileMissing' |
    'onDirtyChange' | 'onRegisterSave' | 'onSaved' | 'createDiffEditor'> {
    onFileSelect: (filePath: string, stage: Stage) => void;
}

/** Paths identify disk documents; stage + repository + path identify comparisons. */
function changeKey(change: WorkingTreeChange): string {
    return JSON.stringify([change.repositoryRoot, change.stage, change.filePath]);
}

export function WorkingTreeAllFilesDiff(props: WorkingTreeAllFilesDiffProps) {
    const owner = props.attachmentDestinationId ?? props.workspaceId;
    const routingTarget = props.attachmentDestinationId === props.workspaceId ? undefined : owner;
    const endpoint = useCloneBaseUrl(routingTarget);
    const client = useCocClient(routingTarget);
    if (resolveCloneRoute(routingTarget).kind === 'unresolved-remote') {
        return <div role="alert" className="git-review-empty">Git review owner is unavailable</div>;
    }
    return <WorkspaceOwnerContext.Provider value={{ workspaceId: props.workspaceId, selectionId: owner, baseUrl: endpoint, client, rootPath: props.repoRoot }}>
        <WorkingChangesReview key={JSON.stringify([owner, endpoint, props.workspaceId])} {...props} />
    </WorkspaceOwnerContext.Provider>;
}

/** The shared navigator owns layout; the working-tree pane owns mutable file behavior. */
function WorkingChangesReview(props: WorkingTreeAllFilesDiffProps) {
    const { workspaceId, attachmentDestinationId, refreshKey, onFileSelect } = props;
    const client = useCocClient(attachmentDestinationId ?? workspaceId);
    const [changes, setChanges] = useState<WorkingTreeChange[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string>();
    const [attempt, setAttempt] = useState(0);
    const [selected, setSelected] = useState<WorkingTreeChange>();
    const [dirty, setDirty] = useState(false);
    const guard = useDirtyDetailGuard(selected?.filePath ?? null);
    const panelHost = useUnifiedPanelHost();
    const fileComment = useFileCommentComposer();
    const onDirtyChange = useCallback((value: boolean) => {
        setDirty(value);
        guard.onDirtyChange(value);
        props.onDirtyChange?.(value);
    }, [guard.onDirtyChange, props.onDirtyChange]);
    const onRegisterSave = useCallback((save: (() => Promise<boolean>) | null) => {
        guard.onRegisterSave(save);
        props.onRegisterSave?.(save);
    }, [guard.onRegisterSave, props.onRegisterSave]);
    useEffect(() => {
        let cancelled = false;
        setError(undefined);
        client.git.getWorkingTreeChanges(workspaceId)
            .then(data => { if (!cancelled) { setChanges(data.changes ?? []); setLoaded(true); } })
            .catch(err => { if (!cancelled) setError(err.message || 'Failed to load changes'); });
        return () => { cancelled = true; };
    }, [client, workspaceId, refreshKey, attempt]);

    // A refresh may remove a file while it has unsaved text. Keep that editor alive.
    const retainedChanges = useMemo(() => dirty && selected && !changes.some(c => changeKey(c) === changeKey(selected))
        ? [...changes, selected] : changes, [changes, dirty, selected]);
    const multiRepo = hasMultipleRepos(retainedChanges);
    const files = useMemo(() => retainedChanges.map(change => ({
        id: changeKey(change), path: relDisplayPath(change, multiRepo), label: STAGE_LABEL[change.stage],
        status: change.stage === 'untracked' ? 'A' : change.status,
        additions: change.additions, deletions: change.deletions,
    })), [retainedChanges, multiRepo]);
    const byKey = useMemo(() => new Map(retainedChanges.map(c => [changeKey(c), c])), [retainedChanges]);
    const retry = () => setAttempt(value => value + 1);
    return <>
        <ReviewFiles identity={JSON.stringify([attachmentDestinationId ?? workspaceId, workspaceId, 'working-tree'])}
            files={files} reviewEnabled={false} retainSelection={dirty}
            beforeNavigate={proceed => guard.guard(proceed)()}
            onSelect={key => setSelected(byKey.get(key))}
            loading={!loaded && !error} error={!loaded ? error : undefined} onRetry={retry}
            header={{ identity: <strong className="git-review-title">All Working Changes</strong>,
                actions: selected ? [{ id: 'open-file', label: 'Open full diff', icon: '↗',
                    onClick: guard.guard(() => onFileSelect(selected.filePath, selected.stage)) }] : [], below: loaded && error
                ? <div role="alert">{error} <button type="button" onClick={retry}>Retry</button></div> : undefined }}
            rowDetails={file => <span className="git-review-muted">{file.label}</span>}
            rowMenu={(file, anchor) => {
                const change = byKey.get(reviewFileKey(file));
                const ownerRoute = attachmentDestinationId && attachmentDestinationId !== workspaceId ? attachmentDestinationId : null;
                return change ? [openFileMenuItem(file, () => openChangedFileSource({
                    path: props.repoRoot ? repoRelative(change.filePath, props.repoRoot) : change.filePath, workspaceId,
                    ownerRoutingRef: ownerRoute, panelHost,
                })), fileComment.menuItem(anchor, {
                    // The same context and owner route WorkingTreeFileDiff uses for this file's comments.
                    workspaceId, routingTarget: attachmentDestinationId === undefined ? undefined : ownerRoute,
                    context: workingTreeCommentContext(workspaceId, change.filePath, change.stage),
                    unavailableReason: 'Untracked files have no comments',
                    displayPath: file.path,
                })] : [];
            }}
            renderEmpty={<div className="git-review-empty" data-testid="working-tree-all-files-empty">{files.length ? 'No matching files.' : 'No working-tree changes'}</div>}
            renderFile={({ file, paths, select, target }) => {
                const change = byKey.get(reviewFileKey(file))!;
                // Cross-file hunk navigation stays within this stage. The shell navigates all stages.
                const stageChanges = paths.map(key => byKey.get(key)!).filter(c => c.stage === change.stage);
                return <WorkingTreeFileDiff {...props} key={changeKey(change)}
                    filePath={change.filePath} stage={change.stage} untrackedAsDiff initialHunkTarget={target}
                    refreshKey={(refreshKey ?? 0) + attempt}
                    workingTreeFiles={stageChanges.map(c => c.filePath)}
                    onNavigateToFile={(path, hunk) => {
                        const next = stageChanges.find(c => c.filePath === path);
                        if (next) select(changeKey(next), hunk);
                    }}
                    onDirtyChange={onDirtyChange} onRegisterSave={onRegisterSave} />;
            }}
        />
        {fileComment.composer}
        {guard.dialog}
    </>;
}
