import { useMemo } from 'react';
import type { GitFileChange } from '@plusplusoneplusplus/coc-client';
import { FileDiffPanel, type FileDiffPanelProps } from './FileDiffPanel';
import { ReviewFiles, type ReviewFileRenderContext } from './ReviewFiles';
export { NAV_DEFAULT_WIDTH, NAV_MIN_WIDTH, NAV_MAX_WIDTH, NAV_CONTENT_MIN, NAV_KEY_STEP, NAV_WIDTH_STORAGE_KEY } from './ReviewFiles';
import type { GitReviewHeader } from './GitReviewToolbar';
import { reviewFileStatus } from './gitReviewFiles';
import { useCommitContextOwner } from '../../chat/gitCommitContext';
import { createGitFileContextPayload } from '../../chat/gitFileContext';
import { GIT_FILE_CONTEXT_DRAG_KIND } from '../../chat/sessionContextDrag';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';
import { useCloneBaseUrl } from '../../../repos/cloneRouting';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { useUnifiedPanelHost } from '../../repo-detail/unified-right-panel/unifiedPanelHost';
import { openChangedFileSource, openFileMenuItem } from './changedFileSource';

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
    const sourceOwner = useCommitContextOwner(props.workspaceId, props.attachmentDestinationId);
    const panelHost = useUnifiedPanelHost();
    // Same owner route as FileDiffPanel's path link and definition jumps.
    const ownerRoutingRef = props.source.routingTarget === undefined
        ? (props.attachmentDestinationId === props.workspaceId ? null : props.attachmentDestinationId) : props.source.routingTarget;
    const identity = JSON.stringify([props.attachmentDestinationId ?? props.workspaceId, props.workspaceId, props.comparisonKey, props.source.cacheKey, props.source.routingTarget, endpoint]);
    if (props.source.routingTarget && resolveCloneRoute(props.source.routingTarget).kind === 'unresolved-remote') {
        return <div role="alert" className="git-review-empty">Git review owner is unavailable</div>;
    }
    return <ReviewFiles {...props} key={identity} identity={identity}
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
        rowMenu={file => [openFileMenuItem(file, () => openChangedFileSource({
            path: file.path, workspaceId: props.workspaceId, ownerRoutingRef, panelHost,
        }))]}
        renderFile={context => <GitReviewDiff {...props} context={context} />} />;
}

function GitReviewDiff({ context, ...props }: Props & { context: ReviewFileRenderContext }) {
    const { file, paths, select, target } = context;
    const source = useMemo(() => ({ ...props.source, files: paths, fetchFileList: undefined }), [props.source, paths]);
    return <FileDiffPanel workspaceId={props.workspaceId} attachmentDestinationId={props.attachmentDestinationId}
        reviewChat={props.reviewChat} getHunkClassification={props.getHunkClassification} hunkActiveFilters={props.hunkActiveFilters}
        onDiffEngineChange={props.onDiffEngineChange} focusComment={props.focusComment} createDiffEditor={props.createDiffEditor} source={source} filePath={file.path} onNavigateToFile={select}
        initialHunkTarget={target} showSourceLabel={false} showChatToggle={!props.reviewChat} />;
}
