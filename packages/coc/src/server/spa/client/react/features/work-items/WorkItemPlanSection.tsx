/**
 * WorkItemPlanSection — plan viewer with version tabs, inline editing,
 * inline review (text-selection + right-click comments), and AI-assisted resolve.
 *
 * Version tabs let users browse all historical plan versions (read-only).
 * The current version is editable. Users can select any part of the rendered
 * plan, right-click to add inline comments, and use AI to resolve them —
 * matching the same inline review behavior as the Tasks tab.
 *
 * Inline comments are stored via the existing task-comments API using a
 * synthetic file path `__wi-plan__/<workItemId>`, keeping the work item store
 * decoupled from comment storage.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button, cn } from '../../ui';
import { Dialog } from '../../ui/Dialog';
import { fetchApi } from '../../hooks/useApi';
import { useCocClient } from '../../repos/cloneRouting';
import { formatRelativeTime } from '../../utils/format';
import { useMarkdownPreview } from '../../hooks/ui/useMarkdownPreview';
import { SourceEditor } from '../../shared/SourceEditor';
import { ModeToggleToolbar } from '../../ui/ModeToggleToolbar';
import type { ModeOption } from '../../ui/ModeToggleToolbar';
import { useTaskComments } from '../../tasks/hooks/useTaskComments';
import type { RenderCommentInfo } from '../../../diff/markdown-renderer';
import { ContextMenu } from '../../tasks/comments/ContextMenu';
import { InlineCommentPopup } from '../../tasks/comments/InlineCommentPopup';
import { CommentSidebar } from '../../tasks/comments/CommentSidebar';
import { CommentPopover } from '../../tasks/comments/CommentPopover';
import type { TaskComment, CommentSelection, TaskCommentCategory } from '../../../comments/task-comments-types';
import {
    createAnchorData,
    DEFAULT_ANCHOR_MATCH_CONFIG,
} from '@plusplusoneplusplus/forge/editor/anchor';
import type { WorkItemPlanVersionComparison } from '@plusplusoneplusplus/coc-client';
import { selectionToSourcePosition } from '../../utils/selection-position';
import { extractDocumentContext } from '../../utils/document-context';
import { DASHBOARD_AI_COMMANDS } from '../../shared/ai-commands';
import { resolveWorkItemOriginId } from './workItemOriginScope';

interface PlanVersionMeta {
    version: number;
    createdAt: string;
    resolvedBy?: string;
    summary?: string;
}

interface PlanVersionFull extends PlanVersionMeta {
    content: string;
}

interface WorkItemPlanSectionProps {
    workspaceId: string;
    /** Canonical origin scope used for Work Item plan/version persistence. */
    originId?: string;
    workItemId: string;
    /** Current plan attached to the work item (already loaded). */
    plan?: { version: number; content: string; updatedAt?: string; resolvedBy?: string };
    /** Whether the user can edit / refine the plan (based on work item status). */
    canEdit: boolean;
    /**
     * Lifted plan draft from the parent's unified dirty batch. `null` until the
     * parent has initialized it from the loaded plan content. When the user
     * edits in source mode, changes flow up via `onDraftChange` and are persisted
     * only when the parent's Ctrl+S save runs — no instant standalone save here.
     */
    draftContent: string | null;
    /** Push edited plan content into the parent's unified dirty batch. */
    onDraftChange: (content: string) => void;
    /** Called after any plan mutation (e.g. AI resolve) so the parent can refresh. */
    onUpdated: () => void;
    onError: (msg: string) => void;
    /** Called when a batch-resolve task is enqueued so the parent can navigate. */
    onNavigateToTasksTab?: (taskId: string) => void;
    /** Controlled view mode (lifted to parent so the toggle can live in the panel header). */
    viewMode?: PlanViewMode;
    /** Callback when the view mode changes. */
    onViewModeChange?: (mode: PlanViewMode) => void;
    /** Enables workflow-only immutable version compare and restore actions. */
    enableVersionActions?: boolean;
    /** Parent-level dirty state; restore must not clobber unsaved metadata or plan edits. */
    hasUnsavedChanges?: boolean;
}

export type PlanViewMode = 'preview' | 'source';

export const PLAN_MODE_OPTIONS: readonly ModeOption<PlanViewMode>[] = [
    { value: 'preview', label: 'Preview' },
    { value: 'source', label: 'Source', testId: 'work-item-plan-mode-source' },
] as const;

/** Minimum characters selected to activate the comment toolbar. */
const MIN_SELECTION_LENGTH = 3;

/** Synthetic task-comments path for work item plan inline comments. */
function planCommentPath(workItemId: string): string {
    return `__wi-plan__/${workItemId}`;
}

function diffChunkClass(type: WorkItemPlanVersionComparison['diff'][number]['type']): string {
    if (type === 'added') return 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200';
    if (type === 'removed') return 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200';
    return 'bg-transparent text-[#656d76] dark:text-[#999]';
}

function diffLinePrefix(type: WorkItemPlanVersionComparison['diff'][number]['type']): string {
    if (type === 'added') return '+';
    if (type === 'removed') return '-';
    return ' ';
}

/** Build anchor data for a plan selection, returning undefined on failure. */
function buildPlanAnchor(
    rawContent: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
) {
    try {
        return createAnchorData(rawContent, startLine, endLine, startColumn, endColumn, DEFAULT_ANCHOR_MATCH_CONFIG);
    } catch {
        return undefined;
    }
}

export function WorkItemPlanSection({
    workspaceId, originId, workItemId, plan, canEdit, draftContent, onDraftChange, onUpdated, onError, onNavigateToTasksTab,
    viewMode: controlledMode, onViewModeChange, enableVersionActions = false, hasUnsavedChanges = false,
}: WorkItemPlanSectionProps) {
    const cloneClient = useCocClient(workspaceId); // AC-07: plan versions/updates on the selected clone's server.
    const workItemOriginId = useMemo(
        () => originId ?? resolveWorkItemOriginId({ workspaceId }),
        [originId, workspaceId],
    );
    const originOptions = useMemo(() => ({ workspaceId }), [workspaceId]);
    // ── Plan version state ──────────────────────────────────────────────────
    const [versions, setVersions] = useState<PlanVersionMeta[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
    const [selectedContent, setSelectedContent] = useState<string | null>(null);
    const [loadingVersion, setLoadingVersion] = useState(false);
    const [internalMode, setInternalMode] = useState<PlanViewMode>('preview');
    const viewMode = controlledMode ?? internalMode;
    const setViewMode = onViewModeChange ?? setInternalMode;
    const [resolving, setResolving] = useState(false);
    const [comparison, setComparison] = useState<WorkItemPlanVersionComparison | null>(null);
    const [comparisonOpen, setComparisonOpen] = useState(false);
    const [comparisonLoading, setComparisonLoading] = useState(false);
    const [comparisonError, setComparisonError] = useState<string | null>(null);
    const [restoreLoading, setRestoreLoading] = useState(false);

    const currentVersion = plan?.version ?? null;

    // Plan content for the current version, sourced from the parent's unified
    // dirty batch (falling back to the loaded plan content until initialized).
    const currentDraft = draftContent ?? plan?.content ?? '';
    const planBaseline = plan?.content ?? '';
    const isPlanDirty = currentDraft !== planBaseline;

    // ── Inline review state ────────────────────────────────────────────────
    const previewRef = useRef<HTMLDivElement>(null);

    const [savedSelection, setSavedSelection] = useState<{
        text: string;
        range: Range;
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    } | null>(null);
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
    const [popupVisible, setPopupVisible] = useState(false);
    const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
    const [pendingSelection, setPendingSelection] = useState<{
        text: string;
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    } | null>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<TaskComment | null>(null);
    const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

    // ── Task comments (inline review) ──────────────────────────────────────
    const commentPath = planCommentPath(workItemId);
    const {
        comments: planComments,
        loading: commentsLoading,
        addComment,
        updateComment,
        deleteComment,
        resolveComment,
        unresolveComment,
        askAI,
        aiLoadingIds,
        aiErrors,
        clearAiError,
        resolvingIds,
        deletingIds,
    } = useTaskComments(workspaceId, commentPath);

    // Load version metadata list
    const loadVersions = useCallback(async () => {
        if (!plan) return;
        try {
            const data: PlanVersionMeta[] = await cloneClient.workItems.planVersionsForOrigin(workItemOriginId, workItemId, originOptions);
            setVersions(data || []);
        } catch { /* ignore */ }
    }, [workItemOriginId, workItemId, originOptions, plan, cloneClient]);

    useEffect(() => { loadVersions(); }, [loadVersions]);

    // When plan changes externally, reset to current version
    useEffect(() => {
        setSelectedVersion(null);
        setSelectedContent(null);
        setViewMode('preview');
    }, [plan?.version]);

    const handleSelectVersion = async (v: number) => {
        if (v === currentVersion) {
            setSelectedVersion(null);
            setSelectedContent(null);
            return;
        }
        setSelectedVersion(v);
        setLoadingVersion(true);
        try {
            const data: PlanVersionFull = await cloneClient.workItems.getPlanVersionForOrigin(workItemOriginId, workItemId, v, originOptions);
            setSelectedContent(data.content ?? '');
        } catch {
            onError('Failed to load plan version');
        } finally {
            setLoadingVersion(false);
        }
    };

    const isCurrentSelected = selectedVersion === null || selectedVersion === currentVersion;
    // Current version reflects the live draft so edits preview instantly; older
    // versions are read-only snapshots fetched on demand.
    const displayedContent = isCurrentSelected ? currentDraft : (selectedContent ?? '');
    const canEditNow = canEdit && isCurrentSelected;
    const selectedVersionMeta = versions.find(v => v.version === selectedVersion);
    const canActOnSelectedVersion = enableVersionActions && !isCurrentSelected && selectedVersion !== null && currentVersion !== null;
    const hasBlockingUnsavedChanges = hasUnsavedChanges || isPlanDirty;
    const restoreDisabled = restoreLoading || hasBlockingUnsavedChanges;

    const handleCompareSelectedToCurrent = useCallback(async () => {
        if (!canActOnSelectedVersion || selectedVersion === null || currentVersion === null) return;
        setComparisonOpen(true);
        setComparisonLoading(true);
        setComparison(null);
        setComparisonError(null);
        try {
            const data = await cloneClient.workItems.comparePlanVersionsForOrigin(workItemOriginId, workItemId, selectedVersion, currentVersion, originOptions);
            setComparison(data);
        } catch (err: any) {
            setComparison(null);
            setComparisonError(err.message || 'Failed to compare plan versions');
        } finally {
            setComparisonLoading(false);
        }
    }, [canActOnSelectedVersion, currentVersion, selectedVersion, workItemOriginId, workItemId, originOptions, cloneClient]);

    const handleRestoreSelectedVersion = useCallback(async () => {
        if (!canActOnSelectedVersion || selectedVersion === null || restoreDisabled) return;
        if (!window.confirm(`Restore plan v${selectedVersion} as a new current version?`)) return;
        setRestoreLoading(true);
        try {
            await cloneClient.workItems.restorePlanVersionForOrigin(workItemOriginId, workItemId, selectedVersion, {
                reason: `Restored plan v${selectedVersion} from version history`,
                summary: `Restored plan v${selectedVersion}`,
            }, originOptions);
            setSelectedVersion(null);
            setSelectedContent(null);
            await onUpdated();
        } catch (err: any) {
            onError(err.message || 'Failed to restore plan version');
        } finally {
            setRestoreLoading(false);
        }
    }, [canActOnSelectedVersion, onError, onUpdated, restoreDisabled, selectedVersion, workItemOriginId, workItemId, originOptions, cloneClient]);

    // Resolve inline comments with AI — creates a Run# execution session
    const handleResolveAllWithAI = useCallback(async () => {
        const open = planComments.filter(c => c.status === 'open');
        if (open.length === 0) return;
        setResolving(true);
        try {
            await cloneClient.workItems.resolveComments(workspaceId, workItemId, { type: 'plan' });
            onUpdated();
        } catch (err: any) {
            onError(err.message || 'Failed to resolve plan comments');
        } finally {
            setResolving(false);
        }
    }, [planComments, workspaceId, workItemId, onUpdated, onError, cloneClient]);

    // Enqueue an AI run session to resolve a single plan comment.
    // Intentionally does NOT call onNavigateToTasksTab — user stays on the work item page.
    const handleResolveSingleComment = useCallback(async (commentId: string) => {
        const taskPath = planCommentPath(workItemId);
        try {
            await fetchApi(
                `/comments/${encodeURIComponent(workspaceId)}/${encodeURIComponent(taskPath)}/batch-resolve`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ documentContent: plan?.content ?? '', singleCommentId: commentId }),
                },
            );
        } catch (err: any) {
            onError(err.message || 'Failed to enqueue plan comment resolve task');
        }
    }, [workspaceId, workItemId, plan?.content, onError]);

    // ── Inline selection handling ──────────────────────────────────────────

    // Capture text selections in the preview div
    useEffect(() => {
        const handleMouseUp = () => {
            if (viewMode !== 'preview') return;
            const sel = window.getSelection();
            if (
                sel && !sel.isCollapsed && sel.rangeCount &&
                sel.toString().trim().length >= MIN_SELECTION_LENGTH &&
                previewRef.current?.contains(sel.anchorNode)
            ) {
                const range = sel.getRangeAt(0);
                const text = sel.toString().trim();
                const pos = previewRef.current
                    ? selectionToSourcePosition(displayedContent, previewRef.current, range)
                    : null;
                if (pos) {
                    setSavedSelection({ text, range: range.cloneRange(), ...pos });
                    return;
                }
            }
            setSavedSelection(null);
        };
        document.addEventListener('mouseup', handleMouseUp);
        return () => document.removeEventListener('mouseup', handleMouseUp);
    }, [viewMode, displayedContent]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        if (viewMode !== 'preview') return;
        e.preventDefault();
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        setContextMenuVisible(true);
    }, [viewMode]);

    const handleAddCommentFromMenu = useCallback(() => {
        if (!savedSelection) return;
        const rect = savedSelection.range.getBoundingClientRect();
        setPopupPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
        setPendingSelection({
            text: savedSelection.text,
            startLine: savedSelection.startLine,
            startColumn: savedSelection.startColumn,
            endLine: savedSelection.endLine,
            endColumn: savedSelection.endColumn,
        });
        setContextMenuVisible(false);
        setPopupVisible(true);
    }, [savedSelection]);

    const handlePopupSubmit = useCallback(async (text: string, category: TaskCommentCategory) => {
        if (!pendingSelection) return;
        const selection: CommentSelection = {
            startLine: pendingSelection.startLine,
            startColumn: pendingSelection.startColumn,
            endLine: pendingSelection.endLine,
            endColumn: pendingSelection.endColumn,
        };
        const anchor = buildPlanAnchor(
            displayedContent,
            pendingSelection.startLine,
            pendingSelection.endLine,
            pendingSelection.startColumn,
            pendingSelection.endColumn,
        );
        await addComment({
            filePath: commentPath,
            selection,
            selectedText: pendingSelection.text,
            comment: text,
            category,
            anchor,
        });
        setPopupVisible(false);
        setPendingSelection(null);
    }, [pendingSelection, displayedContent, commentPath, addComment]);

    const handleAskAIFromMenu = useCallback(async (commandId: string) => {
        if (!savedSelection) return;
        setContextMenuVisible(false);
        const selection: CommentSelection = {
            startLine: savedSelection.startLine,
            startColumn: savedSelection.startColumn,
            endLine: savedSelection.endLine,
            endColumn: savedSelection.endColumn,
        };
        const anchor = buildPlanAnchor(
            displayedContent,
            savedSelection.startLine,
            savedSelection.endLine,
            savedSelection.startColumn,
            savedSelection.endColumn,
        );
        const cmd = DASHBOARD_AI_COMMANDS.find(c => c.id === commandId);
        const newComment = await addComment({
            filePath: commentPath,
            selection,
            selectedText: savedSelection.text,
            comment: cmd?.label ?? commandId,
            category: 'question',
            anchor,
        });
        const context = extractDocumentContext(displayedContent, newComment);
        await askAI(newComment.id, { commandId, documentContext: context });
    }, [savedSelection, displayedContent, commentPath, addComment, askAI]);

    const handleCommentClick = useCallback((comment: TaskComment) => {
        if (!previewRef.current) return;
        const span = previewRef.current.querySelector(`[data-comment-id="${comment.id}"]`);
        if (!span) return;
        const rect = span.getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
        setActivePopoverComment(comment);
    }, []);

    const handleHighlightClick = useCallback((e: React.MouseEvent) => {
        const span = (e.target as HTMLElement).closest('[data-comment-id]');
        if (!span) return;
        const id = span.getAttribute('data-comment-id');
        const comment = planComments.find(c => c.id === id);
        if (comment) handleCommentClick(comment as TaskComment);
    }, [planComments, handleCommentClick]);

    // ── Markdown rendering ────────────────────────────────────────────────

    const renderComments: RenderCommentInfo[] = useMemo(
        () => planComments.map(c => ({ id: c.id, selection: c.selection, status: c.status })),
        [planComments],
    );

    const { html } = useMarkdownPreview({
        content: displayedContent,
        containerRef: previewRef,
        loading: loadingVersion,
        comments: renderComments,
    });

    const openCommentCount = planComments.filter(c => c.status === 'open').length;

    // ─────────────────────────────────────────────────────────────────────────

    if (!plan) {
        return (
            <div className="space-y-2" data-testid="work-item-plan-section">
                {canEdit ? (
                    <>
                        {viewMode === 'source' ? (
                            <SourceEditor
                                content={currentDraft}
                                onChange={onDraftChange}
                                className="w-full h-48 text-xs p-2 rounded border border-[#e0e0e0] dark:border-[#474749] bg-[#fafafa] dark:bg-[#1e1e1e] resize-y font-mono"
                            />
                        ) : (
                            <div
                                ref={previewRef}
                                className="markdown-body text-xs rounded border max-h-72 overflow-y-auto p-3 bg-[#fafafa] dark:bg-[#1e1e1e] border-[#e0e0e0] dark:border-[#474749]"
                                data-testid="work-item-plan-content"
                                dangerouslySetInnerHTML={{ __html: html || `<span class="italic text-[#848484]">No plan yet. Switch to Source to write one.</span>` }}
                            />
                        )}
                    </>
                ) : (
                    <div className="text-xs text-[#848484] italic">No plan yet.</div>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-3" data-testid="work-item-plan-section">
            {/* Version tabs */}
            {versions.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                    {versions.map(v => {
                        const isCurrent = v.version === currentVersion;
                        const isSelected = selectedVersion === null ? isCurrent : selectedVersion === v.version;
                        return (
                            <button
                                key={v.version}
                                onClick={() => handleSelectVersion(v.version)}
                                title={[
                                    isCurrent ? 'Current' : '',
                                    v.resolvedBy ? `by ${v.resolvedBy}` : '',
                                    v.createdAt ? formatRelativeTime(v.createdAt) : '',
                                    v.summary ? `— ${v.summary}` : '',
                                ].filter(Boolean).join(' ')}
                                className={cn(
                                    'text-[10px] px-2 py-0.5 rounded border transition-colors',
                                    isSelected
                                        ? 'bg-[#0078d4] text-white border-[#0078d4]'
                                        : 'border-[#d0d0d0] dark:border-[#555] text-[#606060] dark:text-[#aaa] hover:border-[#0078d4] hover:text-[#0078d4]'
                                )}
                                data-testid={`plan-version-tab-${v.version}`}
                            >
                                v{v.version}{isCurrent ? ' ·' : ''}
                                {v.resolvedBy === 'ai' ? ' 🤖' : ''}
                            </button>
                        );
                    })}
                    {versions.length > 0 && !isCurrentSelected && (
                        <span className="text-[10px] text-[#848484] italic ml-1">
                            {selectedVersionMeta?.summary
                                ? `"${selectedVersionMeta.summary}"`
                                : 'Read-only snapshot'}
                        </span>
                    )}
                    {canActOnSelectedVersion && (
                        <div className="flex items-center gap-1 ml-auto">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCompareSelectedToCurrent}
                                disabled={comparisonLoading}
                                loading={comparisonLoading}
                                data-testid="plan-version-compare-btn"
                            >
                                Compare to current
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleRestoreSelectedVersion}
                                disabled={restoreDisabled}
                                loading={restoreLoading}
                                title={hasBlockingUnsavedChanges ? 'Save or discard unsaved edits before restoring a version' : `Restore v${selectedVersion} as a new current version`}
                                data-testid="plan-version-restore-btn"
                            >
                                Restore as latest
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* Plan content — always-editable source or inline-review preview */}
            {canEditNow && viewMode === 'source' ? (
                <SourceEditor
                    content={currentDraft}
                    onChange={onDraftChange}
                    className="w-full h-48 text-xs p-2 rounded border border-[#e0e0e0] dark:border-[#474749] bg-[#fafafa] dark:bg-[#1e1e1e] resize-y font-mono"
                />
            ) : (
                <div className="relative">
                    {loadingVersion ? (
                        <div className="text-xs text-[#848484] py-4 text-center">Loading version…</div>
                    ) : (
                        <div
                            ref={previewRef}
                            className={cn(
                                'markdown-body text-xs rounded border max-h-72 overflow-y-auto p-3 select-text',
                                isCurrentSelected
                                    ? 'bg-[#fafafa] dark:bg-[#1e1e1e] border-[#e0e0e0] dark:border-[#474749]'
                                    : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                            )}
                            data-testid="work-item-plan-content"
                            dangerouslySetInnerHTML={{ __html: html || `<span class="italic text-[#848484]">Empty plan</span>` }}
                            onContextMenu={handleContextMenu}
                            onClick={handleHighlightClick}
                        />
                    )}
                    {/* Resolve-comments action (current version, preview only) */}
                    {isCurrentSelected && canEdit && openCommentCount > 0 && (
                        <div className="flex items-center gap-2 mt-1.5">
                            {openCommentCount > 0 && (
                                <Button
                                    variant="ghost" size="sm"
                                    onClick={handleResolveAllWithAI}
                                    disabled={resolving}
                                    loading={resolving}
                                    data-testid="work-item-plan-resolve-all-btn"
                                >
                                    🤖 Resolve {openCommentCount} comment{openCommentCount !== 1 ? 's' : ''} with AI
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Inline comment sidebar — shown when comments exist (preview only) */}
            {planComments.length > 0 && viewMode === 'preview' && (
                <div className="border-t border-[#e0e0e0] dark:border-[#474749] pt-2" data-testid="work-item-plan-comment-sidebar">
                    <CommentSidebar
                        taskId={commentPath}
                        filePath={commentPath}
                        comments={planComments}
                        loading={commentsLoading}
                        compact
                        showHeader
                        showFilters={false}
                        onResolve={handleResolveSingleComment}
                        onUnresolve={unresolveComment}
                        onDelete={deleteComment}
                        onEdit={(id, text) => updateComment(id, { comment: text })}
                        onAskAI={(id, commandId, customQuestion) => {
                            const comment = planComments.find(c => c.id === id);
                            const context = extractDocumentContext(displayedContent, comment as TaskComment | undefined);
                            askAI(id, { commandId, customQuestion, documentContext: context });
                        }}
                        onCommentClick={(c) => handleCommentClick(c as TaskComment)}
                        aiLoadingIds={aiLoadingIds}
                        aiErrors={aiErrors}
                        onClearAiError={clearAiError}
                        resolvingIds={resolvingIds}
                        deletingIds={deletingIds}
                        onResolveAllWithAI={openCommentCount > 0 ? handleResolveAllWithAI : undefined}
                    />
                </div>
            )}

            {/* Right-click context menu */}
            {contextMenuVisible && (
                <ContextMenu
                    position={contextMenuPos}
                    items={[
                        {
                            label: 'Add comment',
                            icon: '💬',
                            disabled: !savedSelection,
                            onClick: handleAddCommentFromMenu,
                        },
                        { label: '', separator: true, onClick: () => {} },
                        {
                            label: 'Ask AI',
                            icon: '🤖',
                            disabled: !savedSelection,
                            children: DASHBOARD_AI_COMMANDS.filter(c => !c.isCustomInput).map(cmd => ({
                                label: `${cmd.icon ?? ''} ${cmd.label}`.trim(),
                                onClick: () => handleAskAIFromMenu(cmd.id),
                            })),
                        },
                    ]}
                    onClose={() => setContextMenuVisible(false)}
                />
            )}

            {/* Inline comment composition popup */}
            {popupVisible && (
                <InlineCommentPopup
                    position={popupPos}
                    onSubmit={handlePopupSubmit}
                    onCancel={() => { setPopupVisible(false); setPendingSelection(null); }}
                />
            )}

            {/* Popover for clicking a highlighted comment span */}
            {activePopoverComment && (
                <CommentPopover
                    comment={activePopoverComment}
                    position={popoverPos}
                    onClose={() => setActivePopoverComment(null)}
                    onResolve={(id) => { handleResolveSingleComment(id); setActivePopoverComment(null); }}
                    onUnresolve={(id) => { unresolveComment(id); setActivePopoverComment(null); }}
                    onDelete={(id) => { deleteComment(id); setActivePopoverComment(null); }}
                    onEdit={(id, text) => { updateComment(id, { comment: text }); setActivePopoverComment(null); }}
                    onAskAI={(id, commandId, customQuestion) => {
                        const comment = planComments.find(c => c.id === id);
                        const context = extractDocumentContext(displayedContent, comment as TaskComment | undefined);
                        askAI(id, { commandId, customQuestion, documentContext: context });
                    }}
                    aiLoading={aiLoadingIds.has(activePopoverComment.id)}
                    aiError={aiErrors.get(activePopoverComment.id)}
                    onClearAiError={clearAiError}
                    isResolving={resolvingIds.has(activePopoverComment.id)}
                    isDeleting={deletingIds.has(activePopoverComment.id)}
                />
            )}

            <Dialog
                open={comparisonOpen}
                onClose={() => setComparisonOpen(false)}
                title={comparison ? `Compare v${comparison.base.version} → v${comparison.target.version}` : 'Compare versions'}
                className="max-w-[760px]"
                id="plan-version-compare-dialog"
                footer={
                    <Button variant="secondary" onClick={() => setComparisonOpen(false)} data-testid="plan-version-compare-close-btn">
                        Close
                    </Button>
                }
            >
                <div className="space-y-3" data-testid="plan-version-compare-body">
                    {comparisonLoading && (
                        <div className="text-xs text-[#848484] py-4 text-center">Comparing versions…</div>
                    )}
                    {comparisonError && (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300" data-testid="plan-version-compare-error">
                            {comparisonError}
                        </div>
                    )}
                    {comparison && !comparisonLoading && (
                        <>
                            <div className="grid gap-2 text-xs sm:grid-cols-2">
                                <div className="rounded-md border border-[#d0d7de] dark:border-[#474749] p-2">
                                    <div className="font-semibold text-[#1f2328] dark:text-[#cccccc]">Base v{comparison.base.version}</div>
                                    <div className="text-[#656d76] dark:text-[#999]">
                                        {comparison.base.summary || comparison.base.reason || 'Historical version'}
                                    </div>
                                </div>
                                <div className="rounded-md border border-[#d0d7de] dark:border-[#474749] p-2">
                                    <div className="font-semibold text-[#1f2328] dark:text-[#cccccc]">Current v{comparison.target.version}</div>
                                    <div className="text-[#656d76] dark:text-[#999]">
                                        {comparison.target.summary || comparison.target.reason || 'Current version'}
                                    </div>
                                </div>
                            </div>
                            <pre className="max-h-[52vh] overflow-auto rounded-md border border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#1e1e1e] p-0 text-[11px] leading-[1.45]" data-testid="plan-version-compare-diff">
                                {comparison.diff.map((chunk, chunkIndex) => (
                                    <span key={`${chunk.type}-${chunkIndex}`}>
                                        {chunk.lines.map((line, lineIndex) => (
                                            <span
                                                key={`${chunk.type}-${chunkIndex}-${lineIndex}`}
                                                className={cn('block px-3 whitespace-pre-wrap', diffChunkClass(chunk.type))}
                                            >
                                                {diffLinePrefix(chunk.type)} {line || ' '}
                                            </span>
                                        ))}
                                    </span>
                                ))}
                            </pre>
                        </>
                    )}
                </div>
            </Dialog>
        </div>
    );
}
