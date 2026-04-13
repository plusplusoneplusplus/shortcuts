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
import { Button, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { formatRelativeTime } from '../utils/format';
import { useMarkdownPreview } from '../hooks/useMarkdownPreview';
import { useTaskComments } from '../hooks/useTaskComments';
import type { RenderCommentInfo } from '../../markdown-renderer';
import { ContextMenu } from '../tasks/comments/ContextMenu';
import { InlineCommentPopup } from '../tasks/comments/InlineCommentPopup';
import { CommentSidebar } from '../tasks/comments/CommentSidebar';
import { CommentPopover } from '../tasks/comments/CommentPopover';
import type { TaskComment, CommentSelection, TaskCommentCategory } from '../../task-comments-types';
import {
    createAnchorData,
    DEFAULT_ANCHOR_MATCH_CONFIG,
} from '@plusplusoneplusplus/forge/editor/anchor';
import { selectionToSourcePosition } from '../utils/selection-position';
import { extractDocumentContext } from '../utils/document-context';
import { DASHBOARD_AI_COMMANDS } from '../shared/ai-commands';

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
    workItemId: string;
    /** Current plan attached to the work item (already loaded). */
    plan?: { version: number; content: string; updatedAt: string; resolvedBy?: string };
    /** Whether the user can edit / refine the plan (based on work item status). */
    canEdit: boolean;
    /** Called after any plan mutation so the parent can refresh. */
    onUpdated: () => void;
    onError: (msg: string) => void;
    /** Called when a batch-resolve task is enqueued so the parent can navigate. */
    onNavigateToTasksTab?: (taskId: string) => void;
}

/** Minimum characters selected to activate the comment toolbar. */
const MIN_SELECTION_LENGTH = 3;

/** Synthetic task-comments path for work item plan inline comments. */
function planCommentPath(workItemId: string): string {
    return `__wi-plan__/${workItemId}`;
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
    workspaceId, workItemId, plan, canEdit, onUpdated, onError, onNavigateToTasksTab,
}: WorkItemPlanSectionProps) {
    const basePath = `/workspaces/${encodeURIComponent(workspaceId)}/work-items/${encodeURIComponent(workItemId)}/plan`;

    // ── Plan version state ──────────────────────────────────────────────────
    const [versions, setVersions] = useState<PlanVersionMeta[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
    const [selectedContent, setSelectedContent] = useState<string | null>(null);
    const [loadingVersion, setLoadingVersion] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [planDraft, setPlanDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [resolving, setResolving] = useState(false);
    const [batchResolving, setBatchResolving] = useState(false);
    const [resolvePreview, setResolvePreview] = useState<string | null>(null);
    const [accepting, setAccepting] = useState(false);

    const currentVersion = plan?.version ?? null;

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
            const data: PlanVersionMeta[] = await fetchApi(basePath + '/versions');
            setVersions(data || []);
        } catch { /* ignore */ }
    }, [basePath, plan]);

    useEffect(() => { loadVersions(); }, [loadVersions]);

    // When plan changes externally, reset to current version
    useEffect(() => {
        setSelectedVersion(null);
        setSelectedContent(null);
        setEditMode(false);
        setResolvePreview(null);
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
            const data: PlanVersionFull = await fetchApi(`${basePath}/versions/${v}`);
            setSelectedContent(data.content ?? '');
        } catch {
            onError('Failed to load plan version');
        } finally {
            setLoadingVersion(false);
        }
    };

    const displayedContent = selectedVersion !== null ? (selectedContent ?? '') : (plan?.content ?? '');
    const isCurrentSelected = selectedVersion === null || selectedVersion === currentVersion;

    // Save edited plan
    const handleSave = async () => {
        setSaving(true);
        try {
            await fetchApi(basePath, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: planDraft }),
            });
            setEditMode(false);
            onUpdated();
            loadVersions();
        } catch (err: any) {
            onError(err.message || 'Failed to save plan');
        } finally {
            setSaving(false);
        }
    };

    // Resolve inline comments with AI — creates a new plan version
    const handleResolveAllWithAI = useCallback(async () => {
        const open = planComments.filter(c => c.status === 'open');
        if (open.length === 0) return;
        const instructions = open
            .map((c, i) => `${i + 1}. [Line ${c.selection.startLine}] ${c.comment}`)
            .join('\n');
        setResolving(true);
        try {
            const data = await fetchApi(basePath + '/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instructions,
                    summary: `Resolved ${open.length} inline comment(s)`,
                }),
            });
            setResolvePreview(data.plan?.content ?? data.content ?? '');
        } catch (err: any) {
            onError(err.message || 'Failed to refine plan');
        } finally {
            setResolving(false);
        }
    }, [planComments, basePath, onError]);

    const handleAcceptResolve = async () => {
        setAccepting(true);
        setResolvePreview(null);
        await onUpdated();
        await loadVersions();
        setAccepting(false);
    };

    // Enqueue a batch-resolve task through the queue (creates a categorized session)
    const handleBatchResolve = useCallback(async () => {
        const open = planComments.filter(c => c.status === 'open');
        if (open.length === 0) return;
        setBatchResolving(true);
        try {
            const taskPath = planCommentPath(workItemId);
            const result = await fetchApi(
                `/comments/${encodeURIComponent(workspaceId)}/${encodeURIComponent(taskPath)}/batch-resolve`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ documentContent: plan?.content ?? '' }),
                },
            );
            if (result?.taskId && onNavigateToTasksTab) {
                onNavigateToTasksTab(result.taskId);
            }
        } catch (err: any) {
            onError(err.message || 'Failed to enqueue plan comment resolve task');
        } finally {
            setBatchResolving(false);
        }
    }, [planComments, workspaceId, workItemId, plan?.content, onNavigateToTasksTab, onError]);

    // ── Inline selection handling ──────────────────────────────────────────

    // Capture text selections in the preview div
    useEffect(() => {
        const handleMouseUp = () => {
            if (editMode) return;
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
    }, [editMode, displayedContent]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        if (editMode) return;
        e.preventDefault();
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        setContextMenuVisible(true);
    }, [editMode]);

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
            <div className="space-y-2">
                <div className="text-xs text-[#848484] italic">No plan yet.</div>
                {canEdit && (
                    <Button variant="ghost" size="sm"
                        onClick={() => { setPlanDraft(''); setEditMode(true); }}
                        data-testid="work-item-plan-add-btn">
                        ✏️ Add Plan
                    </Button>
                )}
                {editMode && (
                    <PlanEditor
                        draft={planDraft}
                        onChange={setPlanDraft}
                        onSave={handleSave}
                        onCancel={() => setEditMode(false)}
                        saving={saving}
                    />
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
                            {versions.find(v => v.version === selectedVersion)?.summary
                                ? `"${versions.find(v => v.version === selectedVersion)!.summary}"`
                                : 'Read-only snapshot'}
                        </span>
                    )}
                </div>
            )}

            {/* Plan content — edit mode or inline review mode */}
            {editMode && isCurrentSelected ? (
                <PlanEditor
                    draft={planDraft}
                    onChange={setPlanDraft}
                    onSave={handleSave}
                    onCancel={() => setEditMode(false)}
                    saving={saving}
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
                    {/* Edit button (current version only) */}
                    {isCurrentSelected && canEdit && !resolvePreview && (
                        <div className="flex items-center gap-2 mt-1.5">
                            <Button variant="ghost" size="sm"
                                onClick={() => { setPlanDraft(plan?.content || ''); setEditMode(true); }}
                                data-testid="work-item-plan-edit-btn">
                                ✏️ Edit
                            </Button>
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
                            {openCommentCount > 0 && (
                                <Button
                                    variant="ghost" size="sm"
                                    onClick={handleBatchResolve}
                                    disabled={batchResolving}
                                    loading={batchResolving}
                                    data-testid="work-item-plan-batch-resolve-btn"
                                >
                                    🔧 Resolve via task
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* AI-resolved preview — show before accepting */}
            {resolvePreview !== null && (
                <div className="space-y-2" data-testid="work-item-resolve-preview">
                    <div className="text-[10px] font-semibold text-green-700 dark:text-green-400 uppercase">
                        ✅ AI resolved — new version preview
                    </div>
                    <div className="text-xs whitespace-pre-wrap font-mono bg-green-50 dark:bg-green-900/20 rounded p-3 border border-green-300 dark:border-green-700 max-h-64 overflow-y-auto">
                        {resolvePreview}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="primary" size="sm" onClick={handleAcceptResolve} disabled={accepting} loading={accepting} data-testid="work-item-resolve-accept-btn">
                            ✅ Accept new version
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setResolvePreview(null)} data-testid="work-item-resolve-reject-btn">
                            ✕ Discard
                        </Button>
                    </div>
                </div>
            )}

            {/* Inline comment sidebar — shown when comments exist */}
            {planComments.length > 0 && !editMode && (
                <div className="border-t border-[#e0e0e0] dark:border-[#474749] pt-2" data-testid="work-item-plan-comment-sidebar">
                    <CommentSidebar
                        taskId={commentPath}
                        filePath={commentPath}
                        comments={planComments}
                        loading={commentsLoading}
                        compact
                        showHeader
                        showFilters={false}
                        onResolve={resolveComment}
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
                    onResolve={(id) => { resolveComment(id); setActivePopoverComment(null); }}
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
        </div>
    );
}

// ── Internal editor sub-component ────────────────────────────────────────────

interface PlanEditorProps {
    draft: string;
    onChange: (v: string) => void;
    onSave: () => void;
    onCancel: () => void;
    saving: boolean;
}

function PlanEditor({ draft, onChange, onSave, onCancel, saving }: PlanEditorProps) {
    return (
        <div className="space-y-2" data-testid="work-item-plan-editor-section">
            <textarea
                className="w-full h-48 text-xs p-2 rounded border border-[#e0e0e0] dark:border-[#474749] bg-[#fafafa] dark:bg-[#1e1e1e] resize-y font-mono"
                value={draft}
                onChange={e => onChange(e.target.value)}
                placeholder="Write your plan here…"
                data-testid="work-item-plan-editor"
            />
            <div className="flex gap-1">
                <Button variant="primary" size="sm" onClick={onSave} disabled={saving} loading={saving}>
                    Save
                </Button>
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}


