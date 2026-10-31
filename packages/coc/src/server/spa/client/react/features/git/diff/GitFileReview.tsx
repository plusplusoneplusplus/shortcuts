import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitFileChange } from '@plusplusoneplusplus/coc-client';
import { FileDiffPanel, type FileDiffPanelProps, type ReviewContentSearchTarget } from './FileDiffPanel';
import { ReviewFiles, type ReviewFileRenderContext } from './ReviewFiles';
export { NAV_DEFAULT_WIDTH, NAV_MIN_WIDTH, NAV_MAX_WIDTH, NAV_CONTENT_MIN, NAV_KEY_STEP, NAV_WIDTH_STORAGE_KEY } from './ReviewFiles';
import type { GitReviewHeader } from './GitReviewToolbar';
import { reviewFileKey, reviewFileStatus } from './gitReviewFiles';
import { ReviewContentSearchController } from './reviewContentSearchController';
import { useCommitContextOwner } from '../../chat/gitCommitContext';
import { createGitFileContextPayload } from '../../chat/gitFileContext';
import { GIT_FILE_CONTEXT_DRAG_KIND } from '../../chat/sessionContextDrag';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';
import { useCloneBaseUrl } from '../../../repos/cloneRouting';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { useUnifiedPanelHost } from '../../repo-detail/unified-right-panel/unifiedPanelHost';
import { openChangedFileSource, openFileMenuItem } from './changedFileSource';
import { useFileCommentComposer } from './fileCommentComposer';

type Props = Pick<FileDiffPanelProps, 'workspaceId' | 'attachmentDestinationId' | 'source' | 'reviewChat' | 'getHunkClassification' | 'hunkActiveFilters' | 'onDiffEngineChange' | 'focusComment' | 'createDiffEditor'> & {
    comparisonKey: string;
    files: GitFileChange[];
    selectedPath?: string | null;
    onSelect?: (path: string, target: 'first' | 'last') => void;
    initialHunkTarget?: 'first' | 'last';
    loading?: boolean;
    error?: string;
    onRetry?: () => void;
    reviewedFiles?: ReadonlySet<string>;
    onToggleReviewed?: (path: string) => void | Promise<void>;
    /** Context identity, classification and actions merged into the single toolbar row. */
    header?: GitReviewHeader;
};

/** Git owns revision context and transport; ReviewFiles owns the navigator. */
export function GitFileReview(props: Props) {
    const endpoint = useCloneBaseUrl(props.source.routingTarget === null ? undefined : props.source.routingTarget ?? props.workspaceId);
    const identity = JSON.stringify([props.attachmentDestinationId ?? props.workspaceId, props.workspaceId, props.comparisonKey,
        props.source.cacheKey, props.source.fileContextRefs, props.source.routingTarget, endpoint,
        !!props.source.fetchFileContent]);
    if (props.source.routingTarget && resolveCloneRoute(props.source.routingTarget).kind === 'unresolved-remote') {
        return <div role="alert" className="git-review-empty">Git review owner is unavailable</div>;
    }
    return <GitFileReviewContent key={identity} {...props} identity={identity} />;
}

function GitFileReviewContent({ identity, ...props }: Props & { identity: string }) {
    const sourceRef = useRef(props.source);
    sourceRef.current = props.source;
    const filesRef = useRef(props.files);
    filesRef.current = props.files;
    const fileIdentity = JSON.stringify(props.files.map(reviewFileKey));
    const [controller, setController] = useState<ReviewContentSearchController | null>(null);
    const [contentSearchTarget, setContentSearchTarget] = useState<ReviewContentSearchTarget>();
    useEffect(() => {
        if (!sourceRef.current.fetchFileContent) return;
        setContentSearchTarget(undefined);
        const next = new ReviewContentSearchController(filesRef.current.map(file => ({ id: reviewFileKey(file), path: file.path })), file => {
            const source = sourceRef.current;
            if (!source.fetchFileContent) throw new Error('Review content loader is unavailable');
            return source.fetchFileContent(file.path);
        });
        setController(next);
        return () => next.dispose();
    }, [fileIdentity]);
    useEffect(() => {
        setContentSearchTarget(current => props.selectedPath && props.selectedPath !== current?.filePath ? undefined : current);
    }, [props.selectedPath]);
    const sourceOwner = useCommitContextOwner(props.workspaceId, props.attachmentDestinationId);
    const panelHost = useUnifiedPanelHost();
    const fileComment = useFileCommentComposer();
    // Same owner route as FileDiffPanel's path link and definition jumps.
    const ownerRoutingRef = props.source.routingTarget === undefined
        ? (props.attachmentDestinationId === props.workspaceId ? null : props.attachmentDestinationId) : props.source.routingTarget;
    return <><ReviewFiles {...props} key={identity} identity={identity}
        onSelect={(path, target) => { setContentSearchTarget(undefined); props.onSelect?.(path, target); }}
        contentSearch={controller ? { controller, onOpenMatch: (file, match) => setContentSearchTarget({ ...match, filePath: file.path }) } : undefined}
        rowDrag={file => {
            const side = reviewFileStatus(file.status) === 'D' ? 'base' : 'head';
            const refs = props.source.fileContextRefs;
            const routingRef = sourceOwner === undefined ? props.source.routingTarget : sourceOwner;
            const ownerKnown = routingRef !== undefined || resolveCloneRoute(props.workspaceId).kind === 'local';
            return isSessionContextAttachmentsEnabled() && ownerKnown && refs ? createGitFileContextPayload({
                kind: GIT_FILE_CONTEXT_DRAG_KIND, version: 1, sourceWorkspaceId: props.workspaceId,
                sourceRoutingRef: routingRef ?? null,
                filePath: side === 'base' ? file.oldPath ?? file.path : file.path,
                revision: side === 'base' ? refs.baseRef : refs.headRef, side,
            }) : null;
        }}
        rowMenu={(file, anchor) => [openFileMenuItem(file, () => openChangedFileSource({
            path: file.path, workspaceId: props.workspaceId, ownerRoutingRef, panelHost,
        })), fileComment.menuItem(anchor, {
            // The same context and owner route FileDiffPanel uses for this file's comments.
            workspaceId: props.workspaceId, routingTarget: props.source.routingTarget, context: props.source.commentContext(file.path),
        })]}
        renderFile={context => <GitReviewDiff {...props} context={context} contentSearchTarget={contentSearchTarget} />} />{fileComment.composer}</>;
}

function GitReviewDiff({ context, contentSearchTarget, ...props }: Props & { context: ReviewFileRenderContext; contentSearchTarget?: ReviewContentSearchTarget }) {
    const { file, paths, select, target } = context;
    const source = useMemo(() => ({ ...props.source, files: paths, fetchFileList: undefined }), [props.source, paths]);
    return <FileDiffPanel workspaceId={props.workspaceId} attachmentDestinationId={props.attachmentDestinationId}
        reviewChat={props.reviewChat} getHunkClassification={props.getHunkClassification} hunkActiveFilters={props.hunkActiveFilters}
        onDiffEngineChange={props.onDiffEngineChange} focusComment={props.focusComment} createDiffEditor={props.createDiffEditor} source={source} filePath={file.path} onNavigateToFile={select}
        initialHunkTarget={target} contentSearchTarget={contentSearchTarget} showSourceLabel={false} showChatToggle={!props.reviewChat} />;
}
