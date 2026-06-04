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
import { WorkItemDescriptionEditor } from './WorkItemDescriptionEditor';
import { WorkItemExecuteDialog } from './WorkItemExecuteDialog';
import { useWorkItems } from '../../contexts/WorkItemContext';
import { useCommitCommentTotals } from '../git/hooks/useCommitCommentTotals';
import type { DiffComment } from '../../../comments/diff-comment-types';
import { computeStorageKey, patchDiffComment } from '../../utils/diffCommentApi';
import { isWorkItemsHierarchyEnabled } from '../../utils/config';
import { WorkItemParentPicker } from './WorkItemParentPicker';
import { ALLOWED_CHILD_TYPES, type UpdateWorkItemRequest, type WorkItemAzureBoardsMirrorMetadata, type WorkItemGitHubMirrorMetadata } from '@plusplusoneplusplus/coc-client';
import type { WorkItemTypeLabel } from './WorkItemHierarchyNode';
import { TYPE_LABELS } from './WorkItemHierarchyNode';
import { WorkItemAiComposer } from './WorkItemAiComposer';
import { isWorkItemsAiAuthoringEnabled } from '../../utils/config';
import { WorkItemRemoteMirrorBadge } from './WorkItemGitHubMirrorBadge';

const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Leave without saving?';

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
    githubMirror?: WorkItemGitHubMirrorMetadata;
    azureBoardsMirror?: WorkItemAzureBoardsMirrorMetadata;
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

interface WorkItemDraft {
    title: string;
    description: string;
    priority: 'high' | 'normal' | 'low';
    tags: string;
    status: string;
    parentId?: string;
    successCriteria: string;
}

/** Build the editable draft baseline from a loaded work item. */
function draftFromItem(item: WorkItemFull): WorkItemDraft {
    return {
        title: item.title ?? '',
        description: item.description ?? '',
        priority: (item.priority ?? 'normal') as 'high' | 'normal' | 'low',
        tags: (item.tags ?? []).join(', '),
        status: item.status,
        parentId: item.parentId,
        successCriteria: item.successCriteria ?? '',
    };
}

/** Normalize a comma-separated tag string to unique, trimmed, non-empty tags. */
function parseTags(tags: string): string[] {
    return [...new Set(tags.split(',').map(t => t.trim()).filter(Boolean))];
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
    // ── Always-on inline edit draft (unified Ctrl+S batch) ──
    const [draft, setDraft] = useState<WorkItemDraft | null>(null);
    const [editError, setEditError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [showParentPicker, setShowParentPicker] = useState(false);
    // ── Mobile add-child type picker state ──
    const [showChildTypePicker, setShowChildTypePicker] = useState(false);
    /** Plan content draft, lifted from WorkItemPlanSection into the unified batch. */
    const [planDraft, setPlanDraft] = useState<string | null>(null);

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

    // ── Unified dirty tracking ──────────────────────────────────────────────
    const baseline = useMemo(() => (item ? draftFromItem(item) : null), [item]);
    const planBaseline = item?.plan?.content ?? '';
    const isMetaDirty = !!(draft && baseline && (
        draft.title !== baseline.title ||
        draft.description !== baseline.description ||
        draft.priority !== baseline.priority ||
        draft.tags !== baseline.tags ||
        draft.status !== baseline.status ||
        (draft.parentId ?? undefined) !== (baseline.parentId ?? undefined) ||
        draft.successCriteria !== baseline.successCriteria
    ));
    const isPlanDirty = planDraft !== null && planDraft !== planBaseline;
    const isDirty = isMetaDirty || isPlanDirty;

    // Reset drafts when navigating to a different work item.
    useEffect(() => {
        setDraft(null);
        setPlanDraft(null);
        setEditError(null);
    }, [workItemId]);

    // Initialize drafts once the item loads.
    useEffect(() => {
        if (!item) return;
        if (draft === null) {
            setDraft(draftFromItem(item));
            setPlanDraft(item.plan?.content ?? '');
        }
    }, [item, draft]);

    // Resync drafts from external updates only when there are no unsaved edits.
    useEffect(() => {
        if (!item || draft === null) return;
        if (!isDirty) {
            setDraft(draftFromItem(item));
            setPlanDraft(item.plan?.content ?? '');
        }
        // Intentionally keyed on the item identity so external refreshes resync a
        // clean draft without clobbering in-progress edits.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item]);

    const updateDraft = useCallback(<K extends keyof WorkItemDraft>(key: K, value: WorkItemDraft[K]) => {
        setDraft(prev => {
            const base = prev ?? (item ? draftFromItem(item) : null);
            return base ? { ...base, [key]: value } : prev;
        });
    }, [item]);

    const handleExecuteDialogDone = useCallback(async () => {
        setShowExecuteDialog(false);
        await fetchItem();
        onExecuted?.();
    }, [fetchItem, onExecuted]);

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

    const handleSave = useCallback(async () => {
        if (!item || !draft) return;
        const trimmedTitle = draft.title.trim();
        if (!trimmedTitle) {
            setEditError('Title is required');
            return;
        }
        const base = draftFromItem(item);
        const type = item.type ?? 'work-item';
        setSaving(true);
        setEditError(null);
        try {
            const updates: UpdateWorkItemRequest = {};
            if (trimmedTitle !== base.title) updates.title = trimmedTitle;
            if (draft.description !== base.description) updates.description = draft.description;
            if (draft.priority !== base.priority) updates.priority = draft.priority;
            if (draft.tags !== base.tags) updates.tags = parseTags(draft.tags);
            if (draft.status !== base.status) updates.status = draft.status;
            if ((draft.parentId ?? undefined) !== (base.parentId ?? undefined) && draft.parentId !== undefined) {
                updates.parentId = draft.parentId;
            }
            if (type === 'goal' && draft.successCriteria !== base.successCriteria) {
                updates.successCriteria = draft.successCriteria;
            }
            const planChanged = planDraft !== null && planDraft !== (item.plan?.content ?? '');
            if (planChanged) {
                updates.plan = {
                    content: planDraft as string,
                    resolvedBy: 'user',
                    summary: 'Updated from inline editing',
                };
            }

            let updated: WorkItemFull = item;
            if (Object.keys(updates).length > 0) {
                updated = await getSpaCocClient().workItems.update(workspaceId, workItemId, updates) as any;
            }
            dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workspaceId, item: updated as any });
            await fetchItem();
        } catch (err: any) {
            setEditError(err.message || 'Failed to save changes');
        } finally {
            setSaving(false);
        }
    }, [item, draft, planDraft, workspaceId, workItemId, dispatch, fetchItem]);

    // Ctrl+S / Cmd+S saves the unified dirty batch.
    const handleSaveRef = useRef(handleSave);
    handleSaveRef.current = handleSave;
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                if (isDirty && !saving) handleSaveRef.current();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isDirty, saving]);

    // Warn before unloading the page while there are unsaved changes.
    useEffect(() => {
        if (!isDirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [isDirty]);

    const lastAllowedHashRef = useRef(window.location.hash);
    const revertingHashRef = useRef(false);

    useEffect(() => {
        if (!isDirty) {
            lastAllowedHashRef.current = window.location.hash;
            return;
        }
        const onHashChange = () => {
            if (revertingHashRef.current) {
                revertingHashRef.current = false;
                return;
            }
            const nextHash = window.location.hash;
            if (nextHash === lastAllowedHashRef.current) return;
            if (window.confirm(UNSAVED_CHANGES_MESSAGE)) {
                lastAllowedHashRef.current = nextHash;
                return;
            }
            revertingHashRef.current = true;
            window.location.hash = lastAllowedHashRef.current;
        };
        const onDocumentClick = (event: MouseEvent) => {
            const anchor = (event.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
            if (!anchor) return;
            const nextHash = new URL(anchor.href, window.location.href).hash;
            if (!nextHash || nextHash === window.location.hash) return;
            if (window.confirm(UNSAVED_CHANGES_MESSAGE)) {
                lastAllowedHashRef.current = nextHash;
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener('hashchange', onHashChange);
        document.addEventListener('click', onDocumentClick, true);
        return () => {
            window.removeEventListener('hashchange', onHashChange);
            document.removeEventListener('click', onDocumentClick, true);
        };
    }, [isDirty]);

    // Guard in-app back navigation while there are unsaved changes.
    const guardedBack = useCallback(() => {
        if (isDirty && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return;
        onBack?.();
    }, [isDirty, onBack]);

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

    const d: WorkItemDraft = draft ?? draftFromItem(item);

    const effectiveType = item.type ?? 'work-item';
    const isContainer = ['epic', 'feature', 'pbi'].includes(effectiveType);
    const statusCfg = STATUS_LABELS[item.status] || STATUS_LABELS.created;
    const canExecute = !isContainer && item.status === 'readyToExecute';
    const canEditPlan = !isContainer && ['created', 'planning', 'readyToExecute'].includes(item.status);
    const isAiDone = !isContainer && item.status === 'aiDone';
    const validNextStatuses = VALID_TRANSITIONS[item.status] ?? [];
    const hierarchyEnabled = isWorkItemsHierarchyEnabled();

    const typePrefix = effectiveType === 'epic' ? 'E'
        : effectiveType === 'feature' ? 'F'
        : effectiveType === 'pbi' ? 'PBI'
        : effectiveType === 'bug' ? 'BUG'
        : effectiveType === 'goal' ? 'GOAL'
        : 'WI';

    const typePillClass = effectiveType === 'epic' ? 'text-[#8250df] bg-[color-mix(in_srgb,#8250df_10%,white)] border-[color-mix(in_srgb,#8250df_20%,white)] dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700/30'
        : effectiveType === 'feature' ? 'text-[#0969da] bg-[#ddf4ff] border-[color-mix(in_srgb,#0969da_20%,white)] dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700/30'
        : effectiveType === 'pbi' ? 'text-[#9a6700] bg-[#fff8c5] border-[color-mix(in_srgb,#9a6700_20%,white)] dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700/30'
        : effectiveType === 'bug' ? 'text-[#cf222e] bg-[#ffebe9] border-transparent dark:bg-red-900/30 dark:text-red-400'
        : 'text-[#656d76] bg-[#f6f8fa] border-[#d0d7de] dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';

    const statusPillClass = item.status === 'readyToExecute' ? 'bg-[#dafbe1] text-[#1a7f37] border-[color-mix(in_srgb,#1a7f37_30%,#d0d7de)]'
        : item.status === 'executing' ? 'bg-[#ddf4ff] text-[#0969da] border-[color-mix(in_srgb,#0969da_30%,#d0d7de)]'
        : item.status === 'aiDone' ? 'bg-[color-mix(in_srgb,#8250df_10%,white)] text-[#8250df] border-[color-mix(in_srgb,#8250df_25%,white)]'
        : item.status === 'done' ? 'bg-[#1f883d] text-white border-transparent'
        : 'bg-[#fff8c5] text-[#9a6700] border-[color-mix(in_srgb,#9a6700_30%,#d0d7de)]';

    return (
        <div className="flex flex-col h-full" data-testid="work-item-detail">
            {/* ── Detail header ── */}
            <div className="border-b border-[#d0d7de] dark:border-[#474749] px-4 py-3 bg-white dark:bg-[#1e1e1e] grid gap-2 shrink-0">
                {/* Breadcrumbs */}
                <div className="flex items-center gap-1.5 text-[12px] text-[#656d76] dark:text-[#999] min-w-0" id="crumbs">
                    {onBack && (
                        <button onClick={guardedBack} className="text-[#656d76] hover:text-[#1f2328] dark:hover:text-[#ccc] shrink-0" data-testid="work-item-back-btn" aria-label="Back">
                            ←
                        </button>
                    )}
                    {item.workItemNumber != null && (
                        <span className="font-mono text-[#656d76] dark:text-[#999]" data-testid="work-item-detail-number">
                            {typePrefix}-{item.workItemNumber}
                        </span>
                    )}
                    {isDirty && (
                        <span className="inline-flex items-center rounded-full px-2 py-px text-[11px] leading-[1.4] border border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400 whitespace-nowrap" data-testid="wi-dirty-indicator">
                            unsaved
                        </span>
                    )}
                </div>

                {/* Title row with Save button */}
                <div className="grid gap-2 items-start" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                    <input
                        type="text"
                        className="w-full border border-[#d0d7de] dark:border-[#555] rounded-md bg-white dark:bg-[#1e1e1e] text-[#1f2328] dark:text-[#cccccc] px-2 py-[5px] text-[18px] leading-[1.25] font-semibold tracking-[-0.01em] outline-none focus:border-[#0969da] focus:shadow-[0_0_0_3px_rgba(9,105,218,0.16)]"
                        value={d.title}
                        onChange={e => updateDraft('title', e.target.value)}
                        disabled={saving}
                        data-testid="wi-title-input"
                        aria-label="Title"
                    />
                    <button
                        className="inline-flex items-center justify-center gap-[5px] min-h-7 border border-[rgba(31,35,40,0.15)] rounded-md bg-[#1f883d] text-white px-2 text-[12px] font-semibold tracking-[0.02em] whitespace-nowrap hover:bg-[#1a7f37] disabled:opacity-50 dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                        onClick={handleSave}
                        disabled={!isDirty || saving}
                        data-testid="wi-save-btn"
                        title="Save changes (Ctrl+S)"
                        type="button"
                    >
                        Save
                    </button>
                </div>

                {/* Meta grid */}
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('inline-flex items-center rounded-full text-[11px] leading-[1.25] px-[7px] py-px border whitespace-nowrap', typePillClass)}>
                        {TYPE_LABELS[effectiveType as WorkItemTypeLabel] ?? effectiveType}
                    </span>
                    <select
                        value={d.status}
                        onChange={e => updateDraft('status', e.target.value)}
                        className={cn(
                            'h-[26px] rounded-full border px-2 text-[11px] font-semibold cursor-pointer appearance-none outline-none',
                            statusPillClass,
                        )}
                        data-testid="work-item-status-select"
                    >
                        <option value={item.status}>{statusCfg.label}</option>
                        {validNextStatuses.map(s => (
                            <option key={s} value={s}>{STATUS_LABELS[s]?.label ?? s}</option>
                        ))}
                    </select>
                    <WorkItemRemoteMirrorBadge
                        githubMirror={item.githubMirror}
                        azureBoardsMirror={item.azureBoardsMirror}
                        asLink
                        data-testid={item.githubMirror ? 'work-item-github-mirror-badge' : 'work-item-azure-boards-mirror-badge'}
                    />
                    {item.plan && (
                        <span className="inline-flex items-center rounded-full h-6 px-2 border border-[#d0d7de] dark:border-[#555] bg-[#f6f8fa] dark:bg-transparent text-[11px] text-[#656d76] dark:text-[#999] whitespace-nowrap">
                            Plan v{item.plan.version}
                        </span>
                    )}
                    <span className="inline-flex items-center rounded-full h-6 px-2 border border-[#d0d7de] dark:border-[#555] bg-[#f6f8fa] dark:bg-transparent text-[11px] text-[#656d76] dark:text-[#999] whitespace-nowrap">
                        {d.priority}
                    </span>
                    <span className="text-[11px] leading-[1.35] text-[#656d76] dark:text-[#999] truncate">
                        Updated {formatRelativeTime(item.updatedAt)}
                    </span>
                </div>
                {/* Action row */}
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {!isContainer && (
                        <button
                            className="inline-flex items-center justify-center gap-[5px] min-h-7 border border-[#0969da] rounded-md bg-[#0969da] text-white px-2 text-[12px] font-semibold tracking-[0.02em] whitespace-nowrap hover:bg-[#0550ae] disabled:opacity-50"
                            onClick={() => setShowExecuteDialog(true)}
                            disabled={!canExecute}
                            data-testid="work-item-execute-btn"
                            type="button"
                        >
                            Run
                        </button>
                    )}
                    {isMobile && isContainer && (
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
                    {!isMobile && (
                        <Button variant="ghost" size="sm" onClick={() => {
                            const childTypes = ALLOWED_CHILD_TYPES[effectiveType as WorkItemTypeLabel] ?? [];
                            if (childTypes.length === 0) return;
                            if (childTypes.length === 1) {
                                onCreateChild?.(childTypes[0] as WorkItemTypeLabel, item.id);
                            } else {
                                setShowChildTypePicker(true);
                            }
                        }} data-testid="wi-new-child-btn">
                            + New child
                        </Button>
                    )}
                    {aiAuthoringEnabled && (
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
                        📌
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
                        🗄️
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
            <div className="flex-1 overflow-y-auto min-h-0">
                <div className="grid gap-3 px-4 py-3 items-start" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
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

                {/* Description */}
                <article className="border border-[#d0d7de] dark:border-[#474749] rounded-md overflow-hidden">
                    <div className="min-h-[34px] px-2.5 py-[7px] border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] flex items-center justify-between gap-2">
                        <h3 className="text-[13px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc] m-0">Description</h3>
                    </div>
                    <div className="p-2.5">
                        <WorkItemDescriptionEditor
                            value={d.description}
                            onChange={v => updateDraft('description', v)}
                            dirty={!!(baseline && d.description !== baseline.description)}
                            disabled={saving}
                        />
                    </div>
                </article>

                {/* Plan — leaf items only */}
                {!isContainer && (
                <article className="border border-[#d0d7de] dark:border-[#474749] rounded-md overflow-hidden">
                    <div className="min-h-[34px] px-2.5 py-[7px] border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] flex items-center justify-between gap-2">
                        <h3 className="text-[13px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc] m-0">
                            Plan {item.plan ? `v${item.plan.version}` : ''}
                        </h3>
                    </div>
                    <div className="p-2.5">
                        <WorkItemPlanSection
                            workspaceId={workspaceId}
                            workItemId={workItemId}
                            plan={item.plan}
                            canEdit={canEditPlan}
                            draftContent={planDraft}
                            onDraftChange={setPlanDraft}
                            onUpdated={fetchItem}
                            onError={setError}
                            onNavigateToTasksTab={onNavigateToTasksTab}
                        />
                    </div>
                </article>
                )}

                {/* Success Criteria — goal items only */}
                {effectiveType === 'goal' && (
                    <article className="border border-[#d0d7de] dark:border-[#474749] rounded-md overflow-hidden" data-testid="wi-success-criteria">
                        <div className="min-h-[34px] px-2.5 py-[7px] border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] flex items-center">
                            <h3 className="text-[13px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc] m-0">Success Criteria</h3>
                        </div>
                        <div className="p-2.5">
                            <textarea
                                className="w-full min-h-[96px] resize-y border border-[#d0d7de] dark:border-[#555] rounded-md p-2 text-[13px] leading-[1.45] text-[#1f2328] dark:text-[#cccccc] bg-white dark:bg-[#1e1e1e] outline-none focus:border-[#0969da] focus:shadow-[0_0_0_3px_rgba(9,105,218,0.16)]"
                                value={d.successCriteria}
                                onChange={e => updateDraft('successCriteria', e.target.value)}
                                disabled={saving}
                                placeholder="What defines this goal as achieved?"
                                data-testid="wi-success-criteria-input"
                                aria-label="Success criteria"
                            />
                        </div>
                    </article>
                )}

                {/* Compact Metadata panel */}
                <article className="border border-[#d0d7de] dark:border-[#474749] rounded-md overflow-hidden">
                    <div className="min-h-[34px] px-2.5 py-[7px] border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] flex items-center justify-between gap-2">
                        <h3 className="text-[13px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc] m-0">Compact Metadata</h3>
                    </div>
                    <div className="p-2.5">
                        <ul className="m-0 p-0 list-none grid">
                            {/* Parent */}
                            {hierarchyEnabled && effectiveType !== 'epic' ? (
                                <li className="grid gap-0.5 py-2 border-b border-[#eaeef2] dark:border-[#3c3c3c] text-[12px] leading-[1.35]" data-testid="work-item-parent-edit">
                                    <strong className="text-[#1f2328] dark:text-[#cccccc]">Parent</strong>
                                    <span className="text-[#656d76] dark:text-[#999] flex items-center gap-2">
                                        {d.parentId
                                            ? <span className="font-mono">{d.parentId.slice(0, 12)}…</span>
                                            : <span className="italic">No parent</span>
                                        }
                                        <button className="text-[#0969da] hover:underline text-[11px] bg-transparent border-0 cursor-pointer p-0" onClick={() => setShowParentPicker(true)} disabled={saving} data-testid="wi-edit-parent-btn" type="button">
                                            {d.parentId ? 'Change' : 'Set'}
                                        </button>
                                    </span>
                                </li>
                            ) : item.parentId ? (
                                <li className="grid gap-0.5 py-2 border-b border-[#eaeef2] dark:border-[#3c3c3c] text-[12px] leading-[1.35]" data-testid="work-item-parent-info">
                                    <strong className="text-[#1f2328] dark:text-[#cccccc]">Parent</strong>
                                    <span className="text-[#656d76] dark:text-[#999] font-mono">{item.parentId.slice(0, 12)}…</span>
                                </li>
                            ) : null}
                            {/* Priority */}
                            <li className="grid gap-0.5 py-2 border-b border-[#eaeef2] dark:border-[#3c3c3c] text-[12px] leading-[1.35]" data-testid="wi-edit-fields">
                                <strong className="text-[#1f2328] dark:text-[#cccccc]">Priority</strong>
                                <span>
                                    <select
                                        className="text-[12px] px-1 py-0 rounded border border-[#d0d7de] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-[#1f2328] dark:text-[#cccccc] outline-none"
                                        value={d.priority}
                                        onChange={e => updateDraft('priority', e.target.value as 'high' | 'normal' | 'low')}
                                        disabled={saving}
                                        data-testid="wi-priority-select"
                                        aria-label="Priority"
                                    >
                                        <option value="high">High</option>
                                        <option value="normal">Normal</option>
                                        <option value="low">Low</option>
                                    </select>
                                </span>
                            </li>
                            {/* Tags */}
                            <li className="grid gap-0.5 py-2 border-b border-[#eaeef2] dark:border-[#3c3c3c] text-[12px] leading-[1.35]">
                                <strong className="text-[#1f2328] dark:text-[#cccccc]">Tags</strong>
                                <span className="flex gap-1 flex-wrap items-center">
                                    {parseTags(d.tags).length > 0 ? (
                                        parseTags(d.tags).map(tag => (
                                            <span key={tag} className="inline-flex items-center justify-center h-6 px-2 rounded-full border border-[#d0d7de] dark:border-[#555] bg-[#f6f8fa] dark:bg-transparent text-[11px] text-[#656d76] dark:text-[#999]">{tag}</span>
                                        ))
                                    ) : (
                                        <span className="text-[#656d76] dark:text-[#999] italic text-[11px]">No tags</span>
                                    )}
                                    <input
                                        type="text"
                                        className="flex-1 min-w-[100px] text-[12px] px-1 py-0 border-0 outline-none bg-transparent text-[#1f2328] dark:text-[#cccccc] placeholder-[#656d76]"
                                        value={d.tags}
                                        onChange={e => updateDraft('tags', e.target.value)}
                                        disabled={saving}
                                        placeholder="comma-separated"
                                        data-testid="wi-tags-input"
                                        aria-label="Tags"
                                    />
                                </span>
                            </li>
                            {/* Auto-execute toggle (leaf items only) */}
                            {!isContainer && (
                                <li className="grid gap-0.5 py-2 border-b border-[#eaeef2] dark:border-[#3c3c3c] text-[12px] leading-[1.35]">
                                    <strong className="text-[#1f2328] dark:text-[#cccccc]">Execution</strong>
                                    <span className="text-[#656d76] dark:text-[#999] flex items-center gap-2">
                                        <label className="flex items-center gap-1 text-[11px] cursor-pointer" title="Auto-execute when status reaches Ready to Execute" data-testid="work-item-auto-execute-toggle">
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
                                            Auto-execute
                                        </label>
                                    </span>
                                </li>
                            )}
                            {/* Source */}
                            <li className="grid gap-0.5 py-2 text-[12px] leading-[1.35]">
                                <strong className="text-[#1f2328] dark:text-[#cccccc]">Source</strong>
                                <span className="text-[#656d76] dark:text-[#999]">
                                    {item.source === 'manual' ? 'Manual' : item.source === 'chat' ? 'From chat' : 'From schedule'}
                                </span>
                            </li>
                        </ul>
                    </div>
                </article>

                {/* Remote mirror section */}
                {(item.githubMirror || item.azureBoardsMirror) && (
                    <section className="text-[12px]" data-testid={item.githubMirror ? 'work-item-github-mirror' : 'work-item-azure-boards-mirror'}>
                        <div className="flex flex-wrap gap-2">
                            <WorkItemRemoteMirrorBadge
                                githubMirror={item.githubMirror}
                                azureBoardsMirror={item.azureBoardsMirror}
                                asLink
                                data-testid={item.githubMirror ? 'work-item-github-mirror-link' : 'work-item-azure-boards-mirror-link'}
                            />
                        </div>
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
                    <article className="border border-[#d0d7de] dark:border-[#474749] rounded-md overflow-hidden">
                        <div className="min-h-[34px] px-2.5 py-[7px] border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] flex items-center justify-between gap-2">
                            <h3 className="text-[13px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc] m-0">Execution History</h3>
                        </div>
                        <div className="p-2.5 space-y-2">
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
                    </article>
                )}

                </div>
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
                    currentParentId={d.parentId}
                    onlyPick={true}
                    onParentChanged={(newParentId) => updateDraft('parentId', newParentId ?? undefined)}
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
