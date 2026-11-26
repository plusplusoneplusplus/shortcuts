import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCocClient, useCloneBaseUrl } from '../../../repos/cloneRouting';
import { useCommitContextOwner } from '../../chat/gitCommitContext';
import { WorkspaceOwnerContext } from '../../../repos/workspaceOwnerContext';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { ReviewFiles } from '../diff/ReviewFiles';
import { reviewFileKey } from '../diff/gitReviewFiles';
import { useDirtyDetailGuard } from '../repoGitTab/useDirtyDetailGuard';
import { WorkingTreeFileDiff, type WorkingTreeFileDiffProps } from './WorkingTreeFileDiff';
import { workingTreeCommentContext } from './workingTreeCommentContext';
import { hasMultipleRepos, relDisplayPath, repoRelative, workingChangeContextPayload, type WorkingTreeChange } from './WorkingTree';
import { useUnifiedPanelHost } from '../../repo-detail/unified-right-panel/unifiedPanelHost';
import { openChangedFileSource, openFileMenuItem } from '../diff/changedFileSource';
import { useFileCommentComposer } from '../diff/fileCommentComposer';
import { useCopyChangedFilePath } from '../diff/copyChangedFilePath';
import { useReviewContentSearchController } from '../diff/useReviewContentSearchController';
import type { ReviewContentSearchTarget } from '../diff/FileDiffPanel';
import { ReviewViewIdentity, type CommitPickerOptions } from '../commits/CommitHashPicker';
import type { DiffEditorPosition } from '../diff/monacoDiffController';
import { explorerApi } from '../../repo-detail/explorer/explorerApi';
import { locateWorkingTreeDefinition } from './workingTreeDefinitionTarget';

type Stage = WorkingTreeChange['stage'];
const STAGE_LABEL: Record<Stage, string> = { staged: 'Staged', unstaged: 'Unstaged', untracked: 'Untracked' };

export interface WorkingTreeAllFilesDiffProps extends Pick<WorkingTreeFileDiffProps,
    'workspaceId' | 'attachmentDestinationId' | 'repoRoot' | 'refreshKey' | 'onFileMissing' |
    'onDirtyChange' | 'onRegisterSave' | 'onSaved' | 'createDiffEditor' | 'initialHunkTarget'> {
    /** The file to show, with `stage`; a change re-selects it. */
    filePath?: string;
    stage?: Stage;
    /** Reports every file the review moves to, so the host can track it. */
    onNavigateToFile?: (filePath: string, stage: Stage, target: 'first' | 'last') => void;
    /** The commit/view switcher every Git review header shows. */
    switcher?: CommitPickerOptions;
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
    const { workspaceId, attachmentDestinationId, refreshKey, filePath, stage, initialHunkTarget, onNavigateToFile, ...fileProps } = props;
    const client = useCocClient(attachmentDestinationId ?? workspaceId);
    const [changes, setChanges] = useState<WorkingTreeChange[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string>();
    const [attempt, setAttempt] = useState(0);
    const [selected, setSelected] = useState<WorkingTreeChange>();
    const [dirty, setDirty] = useState(false);
    const guard = useDirtyDetailGuard(selected?.filePath ?? null);
    const panelHost = useUnifiedPanelHost();
    const sourceOwner = useCommitContextOwner(workspaceId, attachmentDestinationId);
    const fileComment = useFileCommentComposer();
    const copyPath = useCopyChangedFilePath();
    const onDirtyChange = useCallback((value: boolean) => {
        setDirty(value);
        guard.onDirtyChange(value);
        props.onDirtyChange?.(value);
    }, [guard.onDirtyChange, props.onDirtyChange]);
    const onRegisterSave = useCallback((save: (() => Promise<boolean>) | null) => {
        guard.onRegisterSave(save);
        props.onRegisterSave?.(save);
    }, [guard.onRegisterSave, props.onRegisterSave]);
    const [mountRefreshKey] = useState(refreshKey);
    useEffect(() => {
        let cancelled = false;
        setError(undefined);
        // A refresh or Retry reads strictly, so a failed status shows as an error, not "no changes".
        const strict = refreshKey !== mountRefreshKey || attempt > 0;
        (strict ? client.git.getWorkingTreeChanges(workspaceId, { refresh: true }) : client.git.getWorkingTreeChanges(workspaceId))
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
    const requested = retainedChanges.find(c => c.filePath === filePath && c.stage === stage);
    const identity = JSON.stringify([attachmentDestinationId ?? workspaceId, workspaceId, 'working-tree']);
    const searchFiles = useMemo(() => files.map(({ id, path, label }) => ({ id, path, label })), [files]);
    const controller = useReviewContentSearchController(identity, searchFiles, file => {
        const change = byKey.get(file.id)!;
        return client.git.getWorkingTreeFileContent(workspaceId, change.filePath, change.stage);
    }, JSON.stringify([refreshKey, attempt]));
    const [contentSearchTarget, setContentSearchTarget] = useState<ReviewContentSearchTarget>();
    useEffect(() => { setContentSearchTarget(undefined); }, [controller]);

    // Go to Definition into another entry: the whole inventory, whatever the navigator filters show.
    const workspacePath = useCallback((change: WorkingTreeChange) => props.repoRoot ? repoRelative(change.filePath, props.repoRoot) : change.filePath, [props.repoRoot]);
    const definitionFiles = useMemo(() => [...new Set(retainedChanges.map(workspacePath))], [retainedChanges, workspacePath]);
    const [definitionTarget, setDefinitionTarget] = useState<{ key: string; position: DiffEditorPosition }>();
    const definitionSelectRef = useRef<string | null>(null);
    const byKeyRef = useRef(byKey);
    byKeyRef.current = byKey;
    const readRouting = attachmentDestinationId === undefined ? undefined
        : attachmentDestinationId !== workspaceId ? attachmentDestinationId : null;
    const navigateDefinitionFile = useCallback(async (request: DiffEditorPosition & { path: string }, signal: AbortSignal, select: (key: string) => void) => {
        const found = await locateWorkingTreeDefinition(
            retainedChanges.filter(change => workspacePath(change) === request.path),
            change => client.git.getWorkingTreeFileContent(workspaceId, change.filePath, change.stage),
            async () => {
                const blob = await explorerApi.readBlob(workspaceId, request.path, { signal }, readRouting);
                return blob.encoding === 'utf-8' ? blob.content : null;
            },
            request,
        );
        if (signal.aborted) return true;
        const key = found && changeKey(found.change);
        // A refresh may have dropped the entry while it was being read.
        if (!found || !key || !byKeyRef.current.has(key)) return false;
        // Asks first while the diff has unsaved edits; Cancel leaves everything as it was.
        guard.guard(() => {
            definitionSelectRef.current = key;
            setDefinitionTarget({ key, position: { side: request.side, ...found.location } });
            select(key);
            definitionSelectRef.current = null;
        })();
        return true;
    }, [retainedChanges, workspacePath, client, workspaceId, readRouting, guard.guard]);
    const retry = () => setAttempt(value => value + 1);
    return <>
        {/* Mounts again once loaded, so the requested file wins over the default first file. */}
        <ReviewFiles key={String(loaded)} identity={identity}
            files={files} compactNavigator reviewEnabled={false} retainSelection={dirty}
            selectedPath={requested ? changeKey(requested) : null} initialHunkTarget={initialHunkTarget}
            beforeNavigate={proceed => guard.guard(proceed)()}
            onSelect={(key, target) => {
                setContentSearchTarget(undefined);
                if (definitionSelectRef.current !== key) setDefinitionTarget(undefined);
                const change = byKey.get(key);
                setSelected(change);
                if (change) onNavigateToFile?.(change.filePath, change.stage, target);
            }}
            contentSearch={controller ? { controller, onOpenMatch: (file, match) => {
                const change = byKey.get(file.id);
                if (change) setContentSearchTarget({ ...match, filePath: change.filePath });
            } } : undefined}
            loading={!loaded && !error} error={!loaded ? error : undefined} onRetry={retry}
            header={{ identity: <ReviewViewIdentity title="Uncommitted changes" viewId="working-changes" picker={props.switcher} />,
                below: loaded && error
                ? <div role="alert">{error} <button type="button" onClick={retry}>Retry</button></div> : undefined }}
            rowDrag={file => {
                const change = byKey.get(reviewFileKey(file));
                // A retained dirty editor may outlive its entry in the refreshed status.
                return change && changes.some(current => changeKey(current) === changeKey(change))
                    ? workingChangeContextPayload(change, workspaceId, sourceOwner, props.repoRoot) : null;
            }}
            rowDetails={file => <span className="git-review-stage" data-stage={file.label?.toLowerCase()}>{file.label}</span>}
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
                }), copyPath.menuItem(repoRelative(change.filePath, change.repositoryRoot))] : [];
            }}
            renderEmpty={<div className="git-review-empty" data-testid="working-tree-all-files-empty">{files.length ? 'No matching files.' : 'No working-tree changes'}</div>}
            renderFile={({ file, paths, select, target }) => {
                const change = byKey.get(reviewFileKey(file))!;
                // Cross-file hunk navigation stays within this stage. The shell navigates all stages.
                const stageChanges = paths.map(key => byKey.get(key)!).filter(c => c.stage === change.stage);
                return <WorkingTreeFileDiff {...fileProps} workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId} key={changeKey(change)}
                    filePath={change.filePath} stage={change.stage} initialHunkTarget={target}
                    contentSearchTarget={contentSearchTarget}
                    refreshKey={(refreshKey ?? 0) + attempt}
                    workingTreeFiles={stageChanges.map(c => c.filePath)}
                    definitionFiles={definitionFiles}
                    onNavigateDefinitionFile={(request, signal) => navigateDefinitionFile(request, signal, select)}
                    definitionTarget={definitionTarget?.key === changeKey(change) ? definitionTarget.position : undefined}
                    onNavigateToFile={(path, hunk) => {
                        const next = stageChanges.find(c => c.filePath === path);
                        if (next) select(changeKey(next), hunk);
                    }}
                    onDirtyChange={onDirtyChange} onRegisterSave={onRegisterSave} />;
            }}
        />
        {fileComment.composer}
        {copyPath.feedback}
        {guard.dialog}
    </>;
}
