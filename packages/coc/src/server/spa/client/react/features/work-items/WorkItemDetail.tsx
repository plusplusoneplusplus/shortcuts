/**
 * WorkItemDetail — right-pane detail view for a selected work item.
 * Shows title, description, status, plan (with version tabs + comments),
 * execution history, and action buttons.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, cn } from '../../ui';
import { fetchApi } from '../../hooks/useApi';
import { getSpaCocClient } from '../../api/cocClient';
import { formatRelativeTime } from '../../utils/format';
import { WorkItemPlanSection } from './WorkItemPlanSection';
import { WorkItemExecuteDialog } from './WorkItemExecuteDialog';
import { useWorkItems } from '../../contexts/WorkItemContext';
import { useCommitCommentTotals } from '../git/hooks/useCommitCommentTotals';
import type { DiffComment } from '../../../comments/diff-comment-types';
import { computeStorageKey, patchDiffComment } from '../../utils/diffCommentApi';
import { isWorkItemsHierarchyEnabled } from '../../utils/config';
import { WorkItemParentPicker } from './WorkItemParentPicker';
import { ALLOWED_CHILD_TYPES } from '@plusplusoneplusplus/coc-client';
import type { WorkItemTypeLabel } from './WorkItemHierarchyNode';
import { TYPE_LABELS } from './WorkItemHierarchyNode';
import { WorkItemAiComposer } from './WorkItemAiComposer';
import { isWorkItemsAiAuthoringEnabled } from '../../utils/config';

const STATUS_LABELS: Record<string, { label: string; badgeStatus: string }> = {
    created:          { label: 'Created',          badgeStatus: 'queued' },
    drafting:         { label: 'Drafting',          badgeStatus: 'warning' },
    planning:         { label: 'Planning',          badgeStatus: 'warning' },
    readyToExecute:   { label: 'Ready to Execute',  badgeStatus: 'completed' },
    executing:        { label: 'Executing',         badgeStatus: 'running' },
    aiDone:           { label: 'AI Done',           badgeStatus: 'warning' },
    aiFailed:         { label: 'AI Failed',         badgeStatus: 'failed' },
    done:             { label: 'Done',              badgeStatus: 'completed' },
    failed:           { label: 'Failed',            badgeStatus: 'failed' },
};

const VALID_TRANSITIONS: Record<string, string[]> = {
    created:        ['drafting', 'planning', 'readyToExecute', 'done', 'failed'],
    drafting:       ['planning', 'readyToExecute', 'created', 'failed'],
    planning:       ['readyToExecute', 'drafting', 'created', 'done', 'failed'],
    readyToExecute: ['executing', 'planning', 'done', 'failed'],
    executing:      ['aiDone', 'aiFailed', 'failed', 'readyToExecute'],
    aiDone:         ['readyToExecute', 'done', 'failed'],
    aiFailed:       ['readyToExecute', 'created', 'failed'],
    done:           ['created'],
    failed:         ['created'],
};

interface WorkItemDetailProps {
    workItemId: string;
    workspaceId: string;
    onBack?: () => void;
    onExecuted?: () => void;
    /** Called when the user clicks the execution session entry for a task. */
    onViewTask?: (taskId: string) => void;
    /** Called when the user clicks a commit SHA to view its diff inline. */
    onViewCommit?: (sha: string) => void;
    /** Called when the user wants to view a completed task in the Tasks tab. */
    onNavigateToTasksTab?: (taskId: string) => void;
    /** When true, renders the mobile 'Add Child' button for container items. */
    isMobile?: boolean;
    /** Open the create dialog for a given child type with this item as parent. */
    onCreateChild?: (type: WorkItemTypeLabel, parentId: string) => void;
}

interface WorkItemFull {
    id: string; workItemNumber?: number; title: string; description: string; status: string;
    type?: string;
    parentId?: string;
    successCriteria?: string;
    grillSessionId?: string;
    priority?: string; source?: string; sourceId?: string;
    createdAt: string; updatedAt: string; completedAt?: string;
    pinnedAt?: string; archivedAt?: string;
    plan?: { version: number; content: string; updatedAt?: string; resolvedBy?: string };
    taskId?: string; processId?: string;
    executionHistory?: Array<{ taskId: string; processId?: string; startedAt: string; completedAt?: string; status: string; error?: string; autoReExecuted?: boolean; title?: string; sessionCategory?: string }>;
    tags?: string[];
    autoExecute?: boolean;
    autoResolveAndReExecute?: boolean;
    autoReExecuteCycles?: number;
    reviewComments?: Array<{ id: string; text: string; createdAt: string; resolved?: boolean }>;
    changes?: Array<{
        id: string;
        planVersion: number;
        commits: Array<{ sha: string; message: string; author?: string; date?: string }>;
        startedAt: string;
        completedAt?: string;
        taskId?: string;
        status: 'open' | 'closed';
    }>;
}

export function WorkItemDetail({ workItemId, workspaceId, onBack, onExecuted, onViewTask, onViewCommit, onNavigateToTasksTab, isMobile = false, onCreateChild }: WorkItemDetailProps) {
    const [item, setItem] = useState<WorkItemFull | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showExecuteDialog, setShowExecuteDialog] = useState(false);
    const [reviewComment, setReviewComment] = useState('');
    const [requestingChanges, setRequestingChanges] = useState(false);
    const [acceptingDone, setAcceptingDone] = useState(false);
    const [resolvingDiffComments, setResolvingDiffComments] = useState(false);
    const [resolvingCommitSha, setResolvingCommitSha] = useState<string | null>(null);
    const [resolvingChangeIdx, setResolvingChangeIdx] = useState<number | null>(null);
    // ── Inline edit state (container items only) ──
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editPriority, setEditPriority] = useState<'high' | 'normal' | 'low'>('normal');
    const [editTags, setEditTags] = useState('');
    const [editParentId, setEditParentId] = useState<string | undefined>(undefined);
    const [editError, setEditError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [showParentPicker, setShowParentPicker] = useState(false);
    // ── Mobile add-child type picker state ──
    const [showChildTypePicker, setShowChildTypePicker] = useState(false);
    // ── Success criteria edit state (goal items only) ──
    const [editingCriteria, setEditingCriteria] = useState(false);
    const [criteriaDraft, setCriteriaDraft] = useState('');
    const [savingCriteria, setSavingCriteria] = useState(false);

    const [showAiComposer, setShowAiComposer] = useState(false);
    const aiAuthoringEnabled = isWorkItemsAiAuthoringEnabled();

    const fetchItem = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getSpaCocClient().workItems.get(workspaceId, workItemId);
            setItem(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load work item');
        } finally {
            setLoading(false);
        }
    }, [workspaceId, workItemId]);

    useEffect(() => { fetchItem(); }, [fetchItem]);

    /* ── Collect all commit SHAs for comment count badges ── */
    const allCommitShas = useMemo(() => {
        if (!item) return [];
        const shas = new Set<string>();
        for (const change of item.changes ?? []) {
            for (const c of change.commits) shas.add(c.sha);
        }
        return [...shas];
    }, [item]);

    const commentTotals = useCommitCommentTotals(workspaceId, allCommitShas);

    /* ── Auto-refresh via WorkItemContext (WebSocket events) ── */
    const { state: workItemState, dispatch } = useWorkItems();
    const contextItems = workItemState.workItemsByRepo[workspaceId] || [];
    const contextItem = contextItems.find(i => i.id === workItemId);

    const lastContextUpdatedAt = useRef<string | undefined>();
    const contextItemWasPresent = useRef(false);

    // Re-fetch full detail when the context item updates (work-item-updated)
    useEffect(() => {
        if (!contextItem) return;

        contextItemWasPresent.current = true;
        const prev = lastContextUpdatedAt.current;
        lastContextUpdatedAt.current = contextItem.updatedAt;

        // Only re-fetch when updatedAt actually changes (skip initial observation)
        if (prev !== undefined && prev !== contextItem.updatedAt) {
            fetchItem();
        }
    }, [contextItem?.updatedAt, fetchItem]);

    // Navigate back when the item is deleted externally (work-item-removed)
    useEffect(() => {
        if (contextItemWasPresent.current && !contextItem) {
            onBack?.();
        }
    }, [contextItem, onBack]);

    // Reset edit mode when navigating to a different work item
    useEffect(() => {
        setIsEditing(false);
        setEditError(null);
    }, [workItemId]);

    const handleExecuteDialogDone = useCallback(async () => {
        setShowExecuteDialog(false);
        await fetchItem();
        onExecuted?.();
    }, [fetchItem, onExecuted]);

    const handleStatusChange = async (newStatus: string) => {
        try {
            await getSpaCocClient().workItems.updateStatus(workspaceId, workItemId, newStatus);
            await fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to update status');
        }
    };

    const handleAcceptDone = async () => {
        setAcceptingDone(true);
        try {
            await getSpaCocClient().workItems.updateStatus(workspaceId, workItemId, 'done', { completedAt: new Date().toISOString() });
            await fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to accept');
        } finally {
            setAcceptingDone(false);
        }
    };

    const handleRequestChanges = async () => {
        const comments = reviewComment.trim() ? [reviewComment.trim()] : [];
        if (comments.length === 0) {
            setError('Add a comment to describe the needed changes');
            return;
        }
        setRequestingChanges(true);
        try {
            await getSpaCocClient().workItems.requestChanges(workspaceId, workItemId, { comments });
            setReviewComment('');
            await fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to request changes');
        } finally {
            setRequestingChanges(false);
        }
    };

    /** Collect open diff comments from commits, feed into plan, batch-resolve them. */
    const handleResolveDiffComments = async (commitShas: string[]) => {
        if (!item || commitShas.length === 0) return;
        setResolvingDiffComments(true);
        try {
            // Fetch open diff comments for each commit
            const allComments: DiffComment[] = [];
            for (const sha of commitShas) {
                const params = new URLSearchParams({ oldRef: `${sha}^`, newRef: sha });
                const data = await fetchApi(`/diff-comments/${encodeURIComponent(workspaceId)}?${params}`);
                const comments: DiffComment[] = data.comments ?? [];
                allComments.push(...comments.filter(c => c.status === 'open'));
            }

            if (allComments.length === 0) {
                setError('No open comments to resolve');
                return;
            }

            // Format comments as review feedback
            const byFile = new Map<string, DiffComment[]>();
            for (const c of allComments) {
                const fp = c.context.filePath;
                if (!byFile.has(fp)) byFile.set(fp, []);
                byFile.get(fp)!.push(c);
            }

            const formatted = [...byFile.entries()].flatMap(([filePath, cs]) =>
                cs.map(c =>
                    `[${filePath}:${c.selection.diffLineStart}] ${c.comment}`
                    + (c.selectedText ? ` (code: \`${c.selectedText.slice(0, 100)}\`)` : '')
                )
            );

            // Call request-changes with diff-comments source
            await getSpaCocClient().workItems.requestChanges(workspaceId, workItemId, { comments: formatted, source: 'diff-comments' });

            // Batch-resolve the open diff comments
            await Promise.all(
                allComments.map(async (c) => {
                    const storageKey = await computeStorageKey(c.context);
                    await patchDiffComment(workspaceId, storageKey, c.id, { status: 'resolved' });
                })
            );

            await fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to resolve diff comments');
        } finally {
            setResolvingDiffComments(false);
        }
    };

    /** Resolve commit diff comments as a Run# execution session. */
    const handlePerCommitResolve = async (sha: string, sourceRunIndex?: number) => {
        if (!item) return;
        setResolvingCommitSha(sha);
        try {
            const result = await getSpaCocClient().workItems.resolveComments(workspaceId, workItemId, {
                type: 'commit',
                commitSha: sha,
                ...(sourceRunIndex != null ? { sourceRunIndex } : {}),
            });
            if (result?.taskId && onViewTask) {
                onViewTask(result.taskId);
            }
            fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to enqueue resolve task');
        } finally {
            setResolvingCommitSha(null);
        }
    };

    /** Resolve all open diff comments for a change's commits via Run# sessions. */
    const handleAutoResolveChange = async (idx: number, commits: Array<{ sha: string }>) => {
        if (!item) return;
        setResolvingChangeIdx(idx);
        const sourceRunIndex = idx + 1;
        try {
            for (const commit of commits) {
                const ct = commentTotals.get(commit.sha);
                if (!ct || ct.open === 0) continue;
                await getSpaCocClient().workItems.resolveComments(workspaceId, workItemId, {
                    type: 'commit',
                    commitSha: commit.sha,
                    sourceRunIndex,
                });
            }
            fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to enqueue resolve tasks');
        } finally {
            setResolvingChangeIdx(null);
        }
    };

    const handleEditStart = useCallback(() => {
        if (!item) return;
        setEditTitle(item.title);
        setEditDescription(item.description || '');
        setEditPriority((item.priority ?? 'normal') as 'high' | 'normal' | 'low');
        setEditTags((item.tags ?? []).join(', '));
        setEditParentId(item.parentId);
        setEditError(null);
        setIsEditing(true);
    }, [item]);

    const handleEditCancel = useCallback(() => {
        setIsEditing(false);
        setEditError(null);
    }, []);

    const handleEditSave = useCallback(async () => {
        const trimmedTitle = editTitle.trim();
        if (!trimmedTitle) {
            setEditError('Title is required');
            return;
        }
        setSaving(true);
        setEditError(null);
        try {
            const parsedTags = editTags.split(',').map((t: string) => t.trim()).filter(Boolean);
            const uniqueTags = [...new Set(parsedTags)];
            const updates: Record<string, unknown> = {
                title: trimmedTitle,
                description: editDescription,
                priority: editPriority,
                tags: uniqueTags,
            };
            if (editParentId !== undefined) {
                updates.parentId = editParentId;
            }
            const updated = await getSpaCocClient().workItems.update(workspaceId, workItemId, updates as any);
            dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workspaceId, item: updated as any });
            await fetchItem();
            setIsEditing(false);
        } catch (err: any) {
            setEditError(err.message || 'Failed to save changes');
        } finally {
            setSaving(false);
        }
    }, [editTitle, editDescription, editPriority, editTags, editParentId, workspaceId, workItemId, dispatch, fetchItem]);

    const handleCriteriaSave = useCallback(async () => {
        setSavingCriteria(true);
        try {
            const updated = await getSpaCocClient().workItems.update(workspaceId, workItemId, {
                successCriteria: criteriaDraft,
            } as any);
            dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workspaceId, item: updated as any });
            await fetchItem();
            setEditingCriteria(false);
        } catch {
            // Keep the editor open on failure; the next fetch surfaces detail-level errors.
        } finally {
            setSavingCriteria(false);
        }
    }, [criteriaDraft, workspaceId, workItemId, dispatch, fetchItem]);

    if (loading) {
        return <div className="flex items-center justify-center h-full text-sm text-[#848484]">Loading…</div>;
    }

    if (error && !item) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-red-500">
                <div className="text-center space-y-2">
                    <div>{error}</div>
                    <Button variant="ghost" size="sm" onClick={fetchItem}>Retry</Button>
                </div>
            </div>
        );
    }

    if (!item) return null;

    const effectiveType = item.type ?? 'work-item';
    const isContainer = ['epic', 'feature', 'pbi'].includes(effectiveType);
    const statusCfg = STATUS_LABELS[item.status] || STATUS_LABELS.created;
    const canExecute = !isContainer && item.status === 'readyToExecute';
    const canEditPlan = !isContainer && ['created', 'planning', 'readyToExecute'].includes(item.status);
    const isAiDone = !isContainer && item.status === 'aiDone';
    const validNextStatuses = VALID_TRANSITIONS[item.status] ?? [];
    const hierarchyEnabled = isWorkItemsHierarchyEnabled();

    return (
        <div className="flex flex-col h-full" data-testid="work-item-detail">
            {/* ── Header ── */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#474749] flex items-start gap-2">
                {onBack && (
                    <button onClick={onBack} className="text-sm text-[#848484] hover:text-[#333] dark:hover:text-[#ccc] mt-0.5 shrink-0" data-testid="work-item-back-btn">
                        ←
                    </button>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        {item.workItemNumber != null && (
                            <span className="text-xs text-[#848484] dark:text-[#999] font-mono shrink-0" data-testid="work-item-detail-number">
                                {effectiveType === 'epic' ? 'E'
                                    : effectiveType === 'feature' ? 'F'
                                    : effectiveType === 'pbi' ? 'PBI'
                                    : effectiveType === 'bug' ? 'BUG'
                                    : effectiveType === 'goal' ? 'GOAL'
                                    : 'WI'}-{item.workItemNumber}
                            </span>
                        )}
                        {isContainer && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-medium">
                                {effectiveType === 'epic' ? 'Epic' : effectiveType === 'feature' ? 'Feature' : 'PBI / Story'}
                            </span>
                        )}
                        {isEditing ? (
                            <input
                                type="text"
                                className="text-sm font-semibold flex-1 min-w-0 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                value={editTitle}
                                onChange={e => setEditTitle(e.target.value)}
                                disabled={saving}
                                data-testid="wi-edit-title-input"
                            />
                        ) : (
                            <h2 className="text-sm font-semibold truncate" title={item.title}>{item.title}</h2>
                        )}
                    </div>
                    <div className="flex items-center flex-wrap gap-1.5 text-[10px] text-[#848484] dark:text-[#999] mt-1">
                        {/* Status dropdown */}
                        <select
                            value={item.status}
                            onChange={e => handleStatusChange(e.target.value)}
                            className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded border cursor-pointer appearance-none',
                                'bg-[#fafafa] dark:bg-[#2d2d2d]',
                                'border-[#d0d0d0] dark:border-[#555]',
                                'text-[#3c3c3c] dark:text-[#ccc]',
                                item.status === 'done'          && '!border-green-500 !text-green-700 dark:!text-green-400',
                                item.status === 'failed'        && '!border-red-400 !text-red-600 dark:!text-red-400',
                                item.status === 'executing'     && '!border-blue-400 !text-blue-600 dark:!text-blue-400',
                                item.status === 'aiDone'        && '!border-purple-400 !text-purple-700 dark:!text-purple-400',
                                item.status === 'readyToExecute' && '!border-emerald-500 !text-emerald-700 dark:!text-emerald-400',
                            )}
                            data-testid="work-item-status-select"
                        >
                            {/* Show current status (always) */}
                            <option value={item.status}>{statusCfg.label}</option>
                            {/* Show valid next statuses */}
                            {validNextStatuses.map(s => (
                                <option key={s} value={s}>{STATUS_LABELS[s]?.label ?? s}</option>
                            ))}
                        </select>
                        {!isEditing && item.priority && item.priority !== 'normal' && (
                            <span className={cn('px-1.5 py-0.5 rounded text-[10px]',
                                item.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            )}>{item.priority}</span>
                        )}
                        {item.plan && <span className="text-[#848484]">plan v{item.plan.version}</span>}
                        <span>·</span>
                        <span>{formatRelativeTime(item.updatedAt)}</span>
                    </div>
                </div>
                {/* Execute + Actions in header — leaf items only */}
                <div className="flex items-center gap-2 shrink-0">
                    {/* Edit / Save+Cancel for container items with hierarchy enabled */}
                    {isContainer && hierarchyEnabled && (
                        isEditing ? (
                            <>
                                <Button variant="primary" size="sm" onClick={handleEditSave} disabled={saving} loading={saving} data-testid="wi-edit-save-btn">
                                    Save
                                </Button>
                                <Button variant="ghost" size="sm" onClick={handleEditCancel} disabled={saving} data-testid="wi-edit-cancel-btn">
                                    Cancel
                                </Button>
                            </>
                        ) : (
                            <Button variant="ghost" size="sm" onClick={handleEditStart} data-testid="wi-edit-btn">
                                Edit
                            </Button>
                        )
                    )}
                    {/* Mobile add-child button — container items, not gated by hierarchyEnabled */}
                    {isMobile && isContainer && !isEditing && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                const childTypes = ALLOWED_CHILD_TYPES[effectiveType as WorkItemTypeLabel] ?? [];
                                if (childTypes.length === 0) return;
                                if (childTypes.length === 1) {
                                    onCreateChild?.(childTypes[0] as WorkItemTypeLabel, item.id);
                                } else {
                                    setShowChildTypePicker(true);
                                }
                            }}
                            data-testid="wi-add-child-btn"
                        >
                            + Add Child
                        </Button>
                    )}
                    {!isContainer && (
                        <>
                            <label className="flex items-center gap-1 text-[10px] cursor-pointer" title="Auto-execute when status reaches Ready to Execute" data-testid="work-item-auto-execute-toggle">
                                <input
                                    type="checkbox"
                                    checked={item.autoExecute ?? false}
                                    onChange={async (e) => {
                                        try {
                                            await getSpaCocClient().workItems.update(workspaceId, workItemId, { autoExecute: e.target.checked });
                                            await fetchItem();
                                        } catch (err: any) {
                                            setError(err.message || 'Failed to update');
                                        }
                                    }}
                                    className="rounded"
                                />
                                Auto
                            </label>
                            <Button
                                variant="primary" size="sm"
                                onClick={() => setShowExecuteDialog(true)}
                                disabled={!canExecute}
                                data-testid="work-item-execute-btn"
                            >
                                ⚡ Start Implementing
                            </Button>
                        </>
                    )}
                    {/* AI Improve button */}
                    {aiAuthoringEnabled && !isEditing && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowAiComposer(true)}
                            data-testid="work-item-improve-with-ai-btn"
                            title="Improve with AI"
                        >
                            ✨
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" data-testid="work-item-pin-btn"
                        title={item.pinnedAt ? 'Unpin' : 'Pin'}
                        onClick={async () => {
                            try {
                                await getSpaCocClient().workItems.pin(workspaceId, workItemId, !item.pinnedAt);
                                await fetchItem();
                            } catch (err: any) {
                                setError(err.message || 'Failed to update pin');
                            }
                        }}>
                        {item.pinnedAt ? '📌' : '📌'}
                    </Button>
                    <Button variant="ghost" size="sm" data-testid="work-item-archive-btn"
                        title={item.archivedAt ? 'Unarchive' : 'Archive'}
                        onClick={async () => {
                            try {
                                await getSpaCocClient().workItems.archive(workspaceId, workItemId, !item.archivedAt);
                                await fetchItem();
                            } catch (err: any) {
                                setError(err.message || 'Failed to update archive');
                            }
                        }}>
                        {item.archivedAt ? '📂' : '🗄️'}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-500" data-testid="work-item-delete-btn"
                        onClick={async () => {
                            if (confirm('Delete this work item?')) {
                                await getSpaCocClient().workItems.delete(workspaceId, workItemId);
                                onBack?.();
                            }
                        }}>
                        🗑
                    </Button>
                </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {error && (
                    <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-2 flex items-start justify-between gap-2">
                        <span>{error}</span>
                        <button className="text-[10px] shrink-0" onClick={() => setError(null)}>✕</button>
                    </div>
                )}
                {editError && (
                    <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-2" data-testid="wi-edit-error">
                        {editError}
                    </div>
                )}

                {/* Parent info row */}
                {isEditing && isContainer && effectiveType !== 'epic' ? (
                    <section data-testid="work-item-parent-edit">
                        <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Parent</h3>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-[#3c3c3c] dark:text-[#cccccc] flex-1">
                                {editParentId
                                    ? <span className="font-mono text-[#848484]">{editParentId}</span>
                                    : <span className="italic text-[#848484]">No parent</span>
                                }
                            </span>
                            <Button variant="ghost" size="sm" onClick={() => setShowParentPicker(true)} disabled={saving} data-testid="wi-edit-parent-btn">
                                {editParentId ? 'Change Parent' : 'Set Parent'}
                            </Button>
                        </div>
                    </section>
                ) : item.parentId ? (
                    <section data-testid="work-item-parent-info">
                        <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Part Of</h3>
                        <div className="text-xs text-[#3c3c3c] dark:text-[#cccccc]">
                            <span className="font-mono text-[#848484]">{item.parentId}</span>
                        </div>
                    </section>
                ) : null}

                {/* Description */}
                <section>
                    <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Description</h3>
                    {isEditing && isContainer ? (
                        <textarea
                            className="w-full min-h-[80px] text-sm p-2 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] resize-y focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                            value={editDescription}
                            onChange={e => setEditDescription(e.target.value)}
                            disabled={saving}
                            data-testid="wi-edit-description-input"
                        />
                    ) : (
                        <div className="text-sm whitespace-pre-wrap text-[#3c3c3c] dark:text-[#cccccc]">
                            {item.description || <span className="italic text-[#848484]">No description</span>}
                        </div>
                    )}
                </section>

                {/* Success Criteria — goal items only */}
                {effectiveType === 'goal' && (
                    <section data-testid="wi-success-criteria">
                        <div className="flex items-center justify-between mb-1">
                            <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase">Success Criteria</h3>
                            {!editingCriteria && (
                                <button
                                    className="text-[11px] text-[#0078d4] dark:text-[#3794ff] hover:underline"
                                    onClick={() => { setCriteriaDraft(item.successCriteria || ''); setEditingCriteria(true); }}
                                    data-testid="wi-success-criteria-edit-btn"
                                >
                                    Edit
                                </button>
                            )}
                        </div>
                        {editingCriteria ? (
                            <div className="space-y-2">
                                <textarea
                                    className="w-full min-h-[80px] text-sm p-2 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] resize-y focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                    value={criteriaDraft}
                                    onChange={e => setCriteriaDraft(e.target.value)}
                                    disabled={savingCriteria}
                                    placeholder="What defines this goal as achieved?"
                                    data-testid="wi-success-criteria-input"
                                />
                                <div className="flex items-center gap-2">
                                    <Button variant="primary" size="sm" onClick={handleCriteriaSave} disabled={savingCriteria} loading={savingCriteria} data-testid="wi-success-criteria-save-btn">
                                        Save
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => setEditingCriteria(false)} disabled={savingCriteria}>
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm whitespace-pre-wrap text-[#3c3c3c] dark:text-[#cccccc]">
                                {item.successCriteria || <span className="italic text-[#848484]">No success criteria defined</span>}
                            </div>
                        )}
                    </section>
                )}
                {isEditing && isContainer && (
                    <section className="space-y-3" data-testid="wi-edit-fields">
                        <div>
                            <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Priority</h3>
                            <select
                                className="text-sm px-2 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                value={editPriority}
                                onChange={e => setEditPriority(e.target.value as 'high' | 'normal' | 'low')}
                                disabled={saving}
                                data-testid="wi-edit-priority-select"
                            >
                                <option value="high">High</option>
                                <option value="normal">Normal</option>
                                <option value="low">Low</option>
                            </select>
                        </div>
                        <div>
                            <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Tags (comma-separated)</h3>
                            <input
                                type="text"
                                className="w-full text-sm px-2 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                value={editTags}
                                onChange={e => setEditTags(e.target.value)}
                                disabled={saving}
                                placeholder="e.g. frontend, critical"
                                data-testid="wi-edit-tags-input"
                            />
                        </div>
                    </section>
                )}

                {/* Plan — leaf items only */}
                {!isContainer && (
                <section>
                    <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-2">
                        Detail Plan {item.plan ? <span className="text-[#848484] normal-case">(v{item.plan.version})</span> : ''}
                    </h3>
                    <WorkItemPlanSection
                        workspaceId={workspaceId}
                        workItemId={workItemId}
                        plan={item.plan}
                        canEdit={canEditPlan}
                        onUpdated={fetchItem}
                        onError={setError}
                        onNavigateToTasksTab={onNavigateToTasksTab}
                    />
                </section>
                )}

                {/* AI Review section (aiDone only) */}
                {isAiDone && (
                    <section className="bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800 rounded-lg p-3" data-testid="work-item-review-section">
                        <h3 className="text-xs font-medium text-purple-700 dark:text-purple-400 uppercase mb-2">🔄 AI Done — Review Required</h3>
                        {item.executionHistory && item.executionHistory.length > 0 && (
                            <div className="text-xs text-[#606060] dark:text-[#aaa] mb-2">
                                Run #{item.executionHistory.length}
                                {item.processId && (
                                    <a href={`#process/${item.processId}`} className="ml-2 text-[#0078d4] hover:underline">
                                        View session →
                                    </a>
                                )}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-xs text-[#606060] dark:text-[#aaa]">📝 Leave a comment on the result:</label>
                            <textarea
                                className="w-full h-20 text-xs p-2 rounded border border-purple-200 dark:border-purple-700 bg-white dark:bg-[#1e1e1e] resize-y"
                                placeholder="Describe what needs to change…"
                                value={reviewComment}
                                onChange={e => setReviewComment(e.target.value)}
                                data-testid="work-item-review-comment"
                            />
                            <div className="flex gap-2">
                                <Button variant="primary" size="sm" onClick={handleAcceptDone} disabled={acceptingDone} loading={acceptingDone} data-testid="work-item-accept-done-btn">
                                    ✅ Accept &amp; Done
                                </Button>
                                <Button variant="ghost" size="sm" onClick={handleRequestChanges} disabled={requestingChanges} loading={requestingChanges} data-testid="work-item-request-changes-btn">
                                    🔄 Request Changes
                                </Button>
                            </div>
                            <div className="text-[10px] text-[#848484] italic">
                                "Request Changes" incorporates your comments into the plan and moves back to Ready to Execute.
                            </div>
                        </div>
                    </section>
                )}

                {/* Execution session entry — shown when a task has been queued/run (leaf items only) */}
                {!isContainer && item.taskId && (onViewTask || onNavigateToTasksTab) && ['executing', 'aiDone', 'aiFailed'].includes(item.status) && (
                    <section>
                        <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Execution Session</h3>
                        {item.status === 'aiDone' && onNavigateToTasksTab ? (
                            <button
                                onClick={() => onNavigateToTasksTab(item.taskId!)}
                                className={cn(
                                    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-left transition-colors',
                                    'border-purple-200 dark:border-purple-800',
                                    'bg-purple-50 dark:bg-purple-900/10',
                                    'hover:bg-purple-100 dark:hover:bg-purple-900/20',
                                )}
                                data-testid="view-task-in-tasks-tab-btn"
                            >
                                <span className="text-base select-none" aria-hidden="true">✅</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-[#3c3c3c] dark:text-[#cccccc]">
                                        AI Completed — Running Session
                                    </div>
                                    <div className="text-[10px] text-[#848484] truncate" title={item.taskId}>
                                        Task: {item.taskId}
                                    </div>
                                </div>
                                <span className="text-xs text-[#0078d4] shrink-0">Open in Tasks →</span>
                            </button>
                        ) : onViewTask ? (
                            <button
                                onClick={() => onViewTask(item.taskId!)}
                                className={cn(
                                    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-left transition-colors',
                                    'border-[#e0e0e0] dark:border-[#3c3c3c]',
                                    'bg-[#fafafa] dark:bg-[#252526]',
                                    'hover:bg-[#f0f0f0] dark:hover:bg-[#2d2d2d]',
                                )}
                                data-testid="view-execution-session-btn"
                            >
                                <span className="text-base select-none" aria-hidden="true">
                                    {item.status === 'executing' ? '⚡' : '❌'}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-[#3c3c3c] dark:text-[#cccccc]">
                                        {item.status === 'executing' ? 'Executing…' : 'AI Failed'}
                                    </div>
                                    <div className="text-[10px] text-[#848484] truncate" title={item.taskId}>
                                        Task: {item.taskId}
                                    </div>
                                </div>
                                <span className="text-xs text-[#0078d4] shrink-0">View Session →</span>
                            </button>
                        ) : null}
                    </section>
                )}

                {/* Execution history */}
                {!isContainer && ((item.executionHistory && item.executionHistory.length > 0) || (item.changes && item.changes.some(c => !c.taskId || !item.executionHistory?.some(e => e.taskId === c.taskId)))) && (
                    <section>
                        <h3 className="text-xs font-medium text-[#848484] dark:text-[#999] uppercase mb-1">Execution History</h3><div className="space-y-2">
                            {item.executionHistory?.map((exec, i) => {
                                const matchingChange = item.changes?.find(c => c.taskId === exec.taskId);
                                const commits = matchingChange?.commits ?? [];
                                const execOpenCommentCount = commits.reduce((sum, c) => sum + (commentTotals.get(c.sha)?.open ?? 0), 0);
                                return (
                                    <div key={i} className="rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] text-xs" data-testid={`exec-entry-${i}`}>
                                        <div className="flex items-center gap-2 px-3 py-2">
                                            <span>{exec.status === 'running' ? '🔵' : exec.status === 'completed' ? '🟢' : exec.status === 'failed' ? '🔴' : '⚪'}</span>
                                            <span className="font-medium text-[#3c3c3c] dark:text-[#cccccc]">Run #{i + 1}{exec.title ? `: ${exec.title}` : ''}</span>
                                            {exec.autoReExecuted && (
                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[9px]" data-testid={`exec-auto-reexecute-badge-${i}`}>
                                                    🔄 Auto re-executed
                                                </span>
                                            )}
                                            {(exec.sessionCategory === 'resolve-plan-comments' || exec.sessionCategory === 'resolve-commit-comments') && (
                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-[9px]" data-testid={`exec-comment-resolve-badge-${i}`}>
                                                    💬 {exec.sessionCategory === 'resolve-plan-comments' ? 'Plan' : 'Code'} comment resolve
                                                </span>
                                            )}
                                            <span className="text-[#848484]">{formatRelativeTime(exec.startedAt)}</span>
                                            {exec.completedAt && <span className="text-[#848484]">· {formatRelativeTime(exec.completedAt)}</span>}
                                        </div>
                                        <div className="px-3 pb-1.5 flex items-center gap-2 flex-wrap">
                                            {onViewTask ? (
                                                <button onClick={() => onViewTask(exec.taskId)} className="text-[#0078d4] hover:underline bg-transparent border-none cursor-pointer p-0 text-[10px]" data-testid={`exec-view-session-${i}`}>View Session →</button>
                                            ) : exec.processId ? (
                                                <a href={`#process/${exec.processId}`} className="text-[#0078d4] hover:underline text-[10px]" data-testid={`exec-view-session-${i}`}>View Session →</a>
                                            ) : null}
                                            {exec.status === 'completed' && execOpenCommentCount > 0 && (
                                                <button
                                                    onClick={() => handleAutoResolveChange(i, commits)}
                                                    disabled={resolvingChangeIdx === i}
                                                    className={cn(
                                                        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors',
                                                        'border-violet-300 dark:border-violet-700',
                                                        'bg-violet-50 dark:bg-violet-900/20',
                                                        'text-violet-800 dark:text-violet-300',
                                                        'hover:bg-violet-100 dark:hover:bg-violet-900/40',
                                                        'disabled:opacity-50 disabled:cursor-not-allowed',
                                                    )}
                                                    data-testid={`exec-auto-resolve-btn-${i}`}
                                                    title="Resolve all open diff comments"
                                                >
                                                    {resolvingChangeIdx === i ? '⏳ Resolving…' : `Resolve all (${execOpenCommentCount})`}
                                                </button>
                                            )}
                                        </div>
                                        {exec.error && (
                                            <div className="px-3 pb-2 text-[10px] text-red-500 truncate">{exec.error}</div>
                                        )}
                                        {exec.status === 'completed' && commits.length > 0 ? (
                                            <div className="px-3 pb-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-1.5 space-y-0.5" data-testid={`exec-commits-${i}`}>
                                                {commits.map(c => {
                                                    const ct = commentTotals.get(c.sha);
                                                    const openCount = ct?.open ?? 0;
                                                    const resolvedCount = ct?.resolved ?? 0;
                                                    return (
                                                        <div key={c.sha} className="flex items-start gap-1.5 text-[10px]">
                                                            {onViewCommit ? (
                                                                <button onClick={() => onViewCommit(c.sha)} className="text-[#0078d4] hover:underline shrink-0 font-mono bg-transparent border-none cursor-pointer p-0" title={c.message} data-testid={`exec-commit-${c.sha.slice(0, 7)}`}>
                                                                    {c.sha.slice(0, 7)}
                                                                </button>
                                                            ) : (
                                                                <a href={`#commit/${c.sha}`} className="text-[#0078d4] hover:underline font-mono shrink-0" title={c.message}>
                                                                    {c.sha.slice(0, 7)}
                                                                </a>
                                                            )}
                                                            {resolvedCount > 0 && (
                                                                <span className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[9px] shrink-0" data-testid={`commit-resolved-badge-${c.sha.slice(0, 7)}`}>
                                                                    ✅ {resolvedCount}
                                                                </span>
                                                            )}
                                                            {openCount > 0 && (
                                                                <span className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[9px] shrink-0" data-testid={`commit-comment-badge-${c.sha.slice(0, 7)}`}>
                                                                    💬 {openCount}
                                                                </span>
                                                            )}
                                                            {openCount > 0 && (
                                                                <button
                                                                    onClick={() => handlePerCommitResolve(c.sha, i + 1)}
                                                                    disabled={resolvingCommitSha === c.sha}
                                                                    className={cn(
                                                                        'inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] border transition-colors shrink-0',
                                                                        'border-violet-300 dark:border-violet-700',
                                                                        'bg-violet-50 dark:bg-violet-900/20',
                                                                        'text-violet-700 dark:text-violet-400',
                                                                        'hover:bg-violet-100 dark:hover:bg-violet-900/40',
                                                                        'disabled:opacity-50 disabled:cursor-not-allowed',
                                                                    )}
                                                                    data-testid={`commit-resolve-btn-${c.sha.slice(0, 7)}`}
                                                                    title="Resolve open diff comments for this commit"
                                                                >
                                                                    {resolvingCommitSha === c.sha ? '⏳ ' : ''}Resolve with agent
                                                                </button>
                                                            )}
                                                            <span className="text-[#3c3c3c] dark:text-[#cccccc] truncate" title={c.message}>{c.message}</span>
                                                            {c.author && <span className="text-[#848484] shrink-0">— {c.author}</span>}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : exec.status === 'completed' ? (
                                            <div className="px-3 pb-2 text-[10px] text-[#848484] italic" data-testid={`exec-commits-${i}`}>No commits</div>
                                        ) : (
                                            <div className="px-3 pb-2 text-[10px]" data-testid={`exec-commits-${i}`}>
                                                <span className="text-[#848484]">—</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Orphaned changes — plan edits not linked to any execution */}
                            {item.changes?.filter(c => !c.taskId || !item.executionHistory?.some(e => e.taskId === c.taskId)).map(change => (
                                <div key={change.id} className={cn(
                                    'rounded-md border text-xs',
                                    change.status === 'open'
                                        ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10'
                                        : 'border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]',
                                )} data-testid={`orphaned-change-${change.id}`}>
                                    <div className="flex items-center gap-2 px-3 py-2">
                                        <span>{change.status === 'open' ? '🔵' : '🟢'}</span>
                                        <span className="font-medium text-[#3c3c3c] dark:text-[#cccccc]">Plan Change</span>
                                        <span className="text-[#848484]">v{change.planVersion}</span>
                                        <span className="text-[#848484]">{formatRelativeTime(change.startedAt)}</span>
                                        {change.status === 'open' && !change.completedAt && (
                                            <span className="ml-auto text-blue-600 dark:text-blue-400">In progress</span>
                                        )}
                                    </div>
                                    {change.commits.length > 0 ? (
                                        <div className="px-3 pb-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-1.5 space-y-0.5">
                                            {change.commits.map(commit => {
                                                const ct = commentTotals.get(commit.sha);
                                                const openCount = ct?.open ?? 0;
                                                const resolvedCount = ct?.resolved ?? 0;
                                                return (
                                                    <div key={commit.sha} className="flex items-start gap-1.5 text-[10px]">
                                                        {onViewCommit ? (
                                                            <button onClick={() => onViewCommit(commit.sha)} className="text-[#0078d4] hover:underline shrink-0 font-mono bg-transparent border-none cursor-pointer p-0" title={commit.message} data-testid={`change-commit-${commit.sha.slice(0, 7)}`}>
                                                                {commit.sha.slice(0, 7)}
                                                            </button>
                                                        ) : (
                                                            <code className="text-[#848484] shrink-0 font-mono">{commit.sha.slice(0, 7)}</code>
                                                        )}
                                                        {resolvedCount > 0 && (
                                                            <span className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[9px] shrink-0" data-testid={`commit-resolved-badge-${commit.sha.slice(0, 7)}`}>
                                                                ✅ {resolvedCount}
                                                            </span>
                                                        )}
                                                        {openCount > 0 && (
                                                            <span className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[9px] shrink-0" data-testid={`commit-comment-badge-${commit.sha.slice(0, 7)}`}>
                                                                💬 {openCount}
                                                            </span>
                                                        )}
                                                        {openCount > 0 && (
                                                            <button
                                                                onClick={() => handlePerCommitResolve(commit.sha)}
                                                                disabled={resolvingCommitSha === commit.sha}
                                                                className={cn(
                                                                    'inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] border transition-colors shrink-0',
                                                                    'border-violet-300 dark:border-violet-700',
                                                                    'bg-violet-50 dark:bg-violet-900/20',
                                                                    'text-violet-700 dark:text-violet-400',
                                                                    'hover:bg-violet-100 dark:hover:bg-violet-900/40',
                                                                    'disabled:opacity-50 disabled:cursor-not-allowed',
                                                                )}
                                                                data-testid={`commit-resolve-btn-${commit.sha.slice(0, 7)}`}
                                                                title="Resolve open diff comments for this commit"
                                                            >
                                                                {resolvingCommitSha === commit.sha ? '⏳ ' : ''}Resolve with agent
                                                            </button>
                                                        )}
                                                        <span className="text-[#3c3c3c] dark:text-[#cccccc] truncate" title={commit.message}>{commit.message}</span>
                                                        {commit.author && <span className="text-[#848484] shrink-0">— {commit.author}</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="px-3 pb-2 text-[10px] italic text-[#848484]">No commits recorded</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Source + Tags */}
                <section>
                    <div className="flex flex-wrap gap-3 text-[10px] text-[#848484]">
                        <span>
                            {item.source === 'manual' ? '✍️ Manual' :
                             item.source === 'chat' ? '💬 From chat' :
                             '📅 From schedule'}
                        </span>
                        {item.tags && item.tags.length > 0 && (
                            <div className="flex gap-1 flex-wrap">
                                {item.tags.map(tag => (
                                    <span key={tag} className="px-1.5 py-0.5 rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#606060] dark:text-[#aaa]">{tag}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {showExecuteDialog && (
                <WorkItemExecuteDialog
                    open={showExecuteDialog}
                    workspaceId={workspaceId}
                    workItemId={workItemId}
                    workItemTitle={item.title}
                    onClose={() => setShowExecuteDialog(false)}
                    onExecuted={handleExecuteDialogDone}
                />
            )}
            <WorkItemAiComposer
                open={showAiComposer}
                onClose={() => setShowAiComposer(false)}
                workspaceId={workspaceId}
                mode="improve"
                existingItem={{
                    id: item.id,
                    title: item.title,
                    description: item.description,
                    type: item.type,
                    plan: item.plan,
                }}
                onImproved={fetchItem}
            />
            {showParentPicker && (
                <WorkItemParentPicker
                    workspaceId={workspaceId}
                    workItemId={workItemId}
                    workItemType={effectiveType as any}
                    currentParentId={editParentId}
                    onlyPick={true}
                    onParentChanged={(newParentId) => setEditParentId(newParentId)}
                    onClose={() => setShowParentPicker(false)}
                />
            )}
            {/* ── Mobile child type picker ── */}
            {showChildTypePicker && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
                    onClick={() => setShowChildTypePicker(false)}
                    data-testid="wi-child-type-picker-overlay"
                >
                    <div
                        className="w-full max-w-sm bg-white dark:bg-[#1e1e1e] rounded-t-xl p-4 pb-8 shadow-2xl"
                        onClick={e => e.stopPropagation()}
                        data-testid="wi-child-type-picker-modal"
                    >
                        <p className="text-xs font-medium text-[#848484] dark:text-[#999] mb-3 uppercase tracking-wide">
                            Add child to "{item.title}"
                        </p>
                        <div className="flex flex-col gap-2">
                            {(ALLOWED_CHILD_TYPES[effectiveType as WorkItemTypeLabel] ?? []).map(childType => (
                                <button
                                    key={childType}
                                    className="w-full text-left px-3 py-2.5 rounded-lg border border-[#e0e0e0] dark:border-[#444] text-sm text-[#3c3c3c] dark:text-[#cccccc] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e] active:bg-[#e8e8e8] dark:active:bg-[#333]"
                                    onClick={() => { onCreateChild?.(childType as WorkItemTypeLabel, item.id); setShowChildTypePicker(false); }}
                                    data-testid={`wi-child-type-option-${childType}`}
                                >
                                    {TYPE_LABELS[childType as WorkItemTypeLabel] ?? childType}
                                </button>
                            ))}
                        </div>
                        <button
                            className="mt-3 w-full text-center text-xs text-[#848484] py-2"
                            onClick={() => setShowChildTypePicker(false)}
                            data-testid="wi-child-type-picker-cancel"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}


