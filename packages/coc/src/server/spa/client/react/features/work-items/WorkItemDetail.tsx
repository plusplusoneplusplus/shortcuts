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
import { WorkItemPlanSection, PLAN_MODE_OPTIONS } from './WorkItemPlanSection';
import type { PlanViewMode } from './WorkItemPlanSection';
import { WorkItemDescriptionEditor, DESCRIPTION_MODE_OPTIONS } from './WorkItemDescriptionEditor';
import type { DescriptionViewMode } from './WorkItemDescriptionEditor';
import { ModeToggleToolbar } from '../../ui/ModeToggleToolbar';
import { WorkItemExecuteDialog } from './WorkItemExecuteDialog';
import { useWorkItems } from '../../contexts/WorkItemContext';
import { useCommitCommentTotals } from '../git/hooks/useCommitCommentTotals';
import type { DiffComment } from '../../../comments/diff-comment-types';
import { computeStorageKey, patchDiffComment } from '../../utils/diffCommentApi';
import { isWorkItemsHierarchyEnabled } from '../../utils/config';
import { WorkItemParentPicker } from './WorkItemParentPicker';
import {
    ALLOWED_CHILD_TYPES,
    WORK_ITEM_SYNC_CONFLICT_CODE,
    type UpdateWorkItemRequest,
    type WorkItemAzureBoardsMirrorMetadata,
    type WorkItemGitHubMirrorMetadata,
    type WorkItemSyncConflictDetails,
    type WorkItemSyncConflictField,
    type WorkItemSyncConflictResolution,
} from '@plusplusoneplusplus/coc-client';
import type { WorkItemTypeLabel } from './WorkItemHierarchyNode';
import { TYPE_LABELS } from './WorkItemHierarchyNode';
import { WorkItemAiComposer } from './WorkItemAiComposer';
import { isWorkItemsAiAuthoringEnabled } from '../../utils/config';
import { WorkItemRemoteMirrorBadge } from './WorkItemGitHubMirrorBadge';
import { useReviewChatPresentation } from '../git/hooks/useReviewChatPresentation';
import type { ReviewChatTarget } from '../git/commits/commitChatPlacement';
import { WorkItemChatPanel } from './WorkItemChatPanel';
import { WorkItemChatPlacementFrame } from './WorkItemChatPlacementFrame';

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
    parentId?: string | null;
    successCriteria: string;
}

type ConflictChoice = 'draft' | 'remote';
type ConflictChoices = Partial<Record<WorkItemSyncConflictField, ConflictChoice>>;

/** Build the editable draft baseline from a loaded work item. */
function draftFromItem(item: WorkItemFull): WorkItemDraft {
    return {
        title: item.title ?? '',
        description: item.description ?? '',
        priority: (item.priority ?? 'normal') as 'high' | 'normal' | 'low',
        tags: (item.tags ?? []).join(', '),
        status: item.status,
        parentId: item.parentId ?? null,
        successCriteria: item.successCriteria ?? '',
    };
}

/** Normalize a comma-separated tag string to unique, trimmed, non-empty tags. */
function parseTags(tags: string): string[] {
    return [...new Set(tags.split(',').map(t => t.trim()).filter(Boolean))];
}

function isSyncConflictDetails(value: unknown): value is WorkItemSyncConflictDetails {
    if (!value || typeof value !== 'object') return false;
    const details = value as WorkItemSyncConflictDetails;
    return details.kind === 'work-item-sync-conflict' && Array.isArray(details.fields);
}

function getSyncConflictDetails(error: unknown): WorkItemSyncConflictDetails | null {
    const maybeError = error as { code?: unknown; details?: unknown; body?: unknown } | null;
    if (maybeError?.code === WORK_ITEM_SYNC_CONFLICT_CODE && isSyncConflictDetails(maybeError.details)) {
        return maybeError.details;
    }
    const body = maybeError?.body;
    if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        const nested = record.error && typeof record.error === 'object'
            ? record.error as Record<string, unknown>
            : undefined;
        const details = nested?.details ?? record.details;
        if ((nested?.code ?? record.code) === WORK_ITEM_SYNC_CONFLICT_CODE && isSyncConflictDetails(details)) {
            return details;
        }
    }
    return null;
}

function buildInitialConflictChoices(conflict: WorkItemSyncConflictDetails): ConflictChoices {
    return Object.fromEntries(conflict.fields.map(field => [field.field, 'draft'])) as ConflictChoices;
}

function applyConflictChoices(draft: WorkItemDraft, conflict: WorkItemSyncConflictDetails, choices: ConflictChoices): WorkItemDraft {
    const next = { ...draft };
    for (const field of conflict.fields) {
        if (choices[field.field] !== 'remote') continue;
        const value = field.remote ?? '';
        if (field.field === 'title') next.title = value;
        if (field.field === 'description') next.description = value;
        if (field.field === 'status' && value) next.status = value;
        if (field.field === 'priority' && ['high', 'normal', 'low'].includes(value)) {
            next.priority = value as WorkItemDraft['priority'];
        }
        if (field.field === 'tags') next.tags = value;
        if (field.field === 'parent') next.parentId = field.remote;
    }
    return next;
}

function conflictResolutionFor(conflict: WorkItemSyncConflictDetails): WorkItemSyncConflictResolution {
    return {
        provider: conflict.provider,
        ...(conflict.remoteUpdatedAt ? { acknowledgedRemoteUpdatedAt: conflict.remoteUpdatedAt } : {}),
        ...(conflict.remoteRevision !== undefined ? { acknowledgedRemoteRevision: conflict.remoteRevision } : {}),
    };
}

function conflictFieldLabel(field: WorkItemSyncConflictField): string {
    if (field === 'description') return 'Description';
    if (field === 'status') return 'Status';
    if (field === 'priority') return 'Priority';
    if (field === 'tags') return 'Tags';
    if (field === 'parent') return 'Parent';
    return 'Title';
}

function ConflictValueCard({ label, value, selected, onSelect }: { label: string; value: string | null; selected: boolean; onSelect: () => void }) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                'text-left rounded-md border p-2 min-h-[64px] bg-white dark:bg-[#1e1e1e]',
                selected
                    ? 'border-amber-500 shadow-[0_0_0_2px_rgba(245,158,11,0.22)]'
                    : 'border-[#d0d7de] dark:border-[#555] hover:border-amber-300',
            )}
        >
            <span className="block text-[10px] uppercase tracking-wide text-[#656d76] dark:text-[#999] mb-1">{label}</span>
            <span className="block text-[12px] leading-[1.4] text-[#1f2328] dark:text-[#cccccc] whitespace-pre-wrap break-words">
                {value && value.trim() ? value : <span className="italic text-[#656d76] dark:text-[#999]">empty</span>}
            </span>
        </button>
    );
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
    const [syncConflict, setSyncConflict] = useState<WorkItemSyncConflictDetails | null>(null);
    const [syncConflictChoices, setSyncConflictChoices] = useState<ConflictChoices>({});
    const [showParentPicker, setShowParentPicker] = useState(false);
    // ── Mobile add-child type picker state ──
    const [showChildTypePicker, setShowChildTypePicker] = useState(false);
    /** Plan content draft, lifted from WorkItemPlanSection into the unified batch. */
    const [planDraft, setPlanDraft] = useState<string | null>(null);
    const [descViewMode, setDescViewMode] = useState<DescriptionViewMode>('source');
    const [planViewMode, setPlanViewMode] = useState<PlanViewMode>('preview');

    const [showAiComposer, setShowAiComposer] = useState(false);
    const aiAuthoringEnabled = isWorkItemsAiAuthoringEnabled();
    const workItemChatTarget = useMemo<ReviewChatTarget>(() => ({
        type: 'work-item',
        workspaceId,
        workItemId,
    }), [workspaceId, workItemId]);
    const {
        chatOpen: workItemChatOpen,
        toggleChat: toggleWorkItemChat,
        closeChat: closeWorkItemChat,
        minimizeChat: minimizeWorkItemChat,
        restoreChat: restoreWorkItemChat,
        pinChat: pinWorkItemChat,
        unpinChat: unpinWorkItemChat,
        isPinned: workItemChatPinned,
        isMinimized: workItemChatMinimized,
        presentation: workItemChatPresentation,
        lensEnabled: workItemChatLensEnabled,
    } = useReviewChatPresentation({
        target: workItemChatTarget,
        forceLensOnNonDesktop: true,
    });
    const currentSelectionRef = useRef({ workspaceId, workItemId });
    const previousSelectionRef = useRef({ workspaceId, workItemId });
    const fetchRequestSeqRef = useRef(0);
    currentSelectionRef.current = { workspaceId, workItemId };

    const fetchItem = useCallback(async () => {
        const requestSeq = ++fetchRequestSeqRef.current;
        const requestedWorkspaceId = workspaceId;
        const requestedWorkItemId = workItemId;
        setLoading(true);
        setError(null);
        try {
            const data = await getSpaCocClient().workItems.get(requestedWorkspaceId, requestedWorkItemId);
            const current = currentSelectionRef.current;
            if (
                requestSeq !== fetchRequestSeqRef.current ||
                current.workspaceId !== requestedWorkspaceId ||
                current.workItemId !== requestedWorkItemId
            ) {
                return;
            }
            setItem(data);
        } catch (err: any) {
            const current = currentSelectionRef.current;
            if (
                requestSeq !== fetchRequestSeqRef.current ||
                current.workspaceId !== requestedWorkspaceId ||
                current.workItemId !== requestedWorkItemId
            ) {
                return;
            }
            setError(err.message || 'Failed to load work item');
        } finally {
            const current = currentSelectionRef.current;
            if (
                requestSeq === fetchRequestSeqRef.current &&
                current.workspaceId === requestedWorkspaceId &&
                current.workItemId === requestedWorkItemId
            ) {
                setLoading(false);
            }
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
        (draft.parentId ?? null) !== (baseline.parentId ?? null) ||
        draft.successCriteria !== baseline.successCriteria
    ));
    const isPlanDirty = planDraft !== null && planDraft !== planBaseline;
    const isDirty = isMetaDirty || isPlanDirty;

    // Reset drafts when navigating to a different work item.
    useEffect(() => {
        const previous = previousSelectionRef.current;
        if (previous.workspaceId === workspaceId && previous.workItemId === workItemId) return;
        previousSelectionRef.current = { workspaceId, workItemId };
        setItem(null);
        setDraft(null);
        setPlanDraft(null);
        setEditError(null);
        setSyncConflict(null);
        setSyncConflictChoices({});
    }, [workspaceId, workItemId]);

    // Initialize drafts once the item loads.
    useEffect(() => {
        if (!item || item.id !== workItemId) return;
        if (draft === null) {
            setDraft(draftFromItem(item));
            setPlanDraft(item.plan?.content ?? '');
        }
    }, [item, draft, workItemId]);

    // Resync drafts from external updates only when there are no unsaved edits.
    useEffect(() => {
        if (!item || item.id !== workItemId || draft === null) return;
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
            const base = prev ?? (item && item.id === workItemId ? draftFromItem(item) : null);
            return base ? { ...base, [key]: value } : prev;
        });
    }, [item, workItemId]);

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

    const saveDraft = useCallback(async (draftToSave: WorkItemDraft, resolution?: WorkItemSyncConflictResolution) => {
        if (!item || item.id !== workItemId) return;
        const trimmedTitle = draftToSave.title.trim();
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
            if (draftToSave.description !== base.description) updates.description = draftToSave.description;
            if (draftToSave.priority !== base.priority) updates.priority = draftToSave.priority;
            if (draftToSave.tags !== base.tags) updates.tags = parseTags(draftToSave.tags);
            if (draftToSave.status !== base.status) updates.status = draftToSave.status;
            if ((draftToSave.parentId ?? null) !== (base.parentId ?? null)) {
                updates.parentId = draftToSave.parentId ?? null;
            }
            if (type === 'goal' && draftToSave.successCriteria !== base.successCriteria) {
                updates.successCriteria = draftToSave.successCriteria;
            }
            const planChanged = planDraft !== null && planDraft !== (item.plan?.content ?? '');
            if (planChanged) {
                updates.plan = {
                    content: planDraft as string,
                    resolvedBy: 'user',
                    summary: 'Updated from inline editing',
                };
            }
            if (resolution) {
                updates.syncConflictResolution = resolution;
            }

            let updated: WorkItemFull = item;
            if (Object.keys(updates).length > 0) {
                updated = await getSpaCocClient().workItems.update(workspaceId, workItemId, updates) as any;
            }
            setDraft(draftToSave);
            setSyncConflict(null);
            setSyncConflictChoices({});
            dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workspaceId, item: updated as any });
            await fetchItem();
        } catch (err: any) {
            const conflict = getSyncConflictDetails(err);
            if (conflict) {
                setSyncConflict(conflict);
                setSyncConflictChoices(buildInitialConflictChoices(conflict));
                setEditError(null);
                return;
            }
            setEditError(err.message || 'Failed to save changes');
        } finally {
            setSaving(false);
        }
    }, [item, planDraft, workspaceId, workItemId, dispatch, fetchItem]);

    const handleSave = useCallback(async () => {
        if (!draft) return;
        await saveDraft(draft);
    }, [draft, saveDraft]);

    const handleApplyConflictResolution = useCallback(async () => {
        if (!draft || !syncConflict) return;
        const resolvedDraft = applyConflictChoices(draft, syncConflict, syncConflictChoices);
        setDraft(resolvedDraft);
        await saveDraft(resolvedDraft, conflictResolutionFor(syncConflict));
    }, [draft, saveDraft, syncConflict, syncConflictChoices]);

    const handleDismissConflict = useCallback(() => {
        setSyncConflict(null);
        setSyncConflictChoices({});
    }, []);

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

    const openWorkItemChat = useCallback(() => {
        if (workItemChatOpen) {
            restoreWorkItemChat();
            return;
        }
        toggleWorkItemChat();
    }, [restoreWorkItemChat, toggleWorkItemChat, workItemChatOpen]);

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

    if (!item || item.id !== workItemId) return null;

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

    const chatPanelProps = {
        workspaceId,
        workItemId,
        workItemNumber: item.workItemNumber,
        title: item.title,
        status: item.status,
        type: effectiveType,
        hasUnsavedChanges: isDirty,
        onClose: closeWorkItemChat,
    };
    const workItemChatSurface = !workItemChatOpen ? null
        : workItemChatPresentation === 'side-panel' && !workItemChatLensEnabled ? (
            <WorkItemChatPanel {...chatPanelProps} />
        ) : (
            <WorkItemChatPlacementFrame
                {...chatPanelProps}
                presentation={workItemChatPresentation}
                isMinimized={workItemChatMinimized}
                onMinimize={minimizeWorkItemChat}
                onRestore={restoreWorkItemChat}
                onPin={workItemChatPresentation === 'lens' ? pinWorkItemChat : undefined}
                onUnpin={workItemChatLensEnabled && workItemChatPinned ? unpinWorkItemChat : undefined}
            />
        );

    return (
        <div className="relative flex flex-col h-full overflow-hidden" data-testid="work-item-detail">
            {/* ── Detail header ── */}
            <div className="border-b border-[#d0d7de] dark:border-[#474749] bg-white dark:bg-[#1e1e1e] grid gap-2 shrink-0" style={{ padding: '12px 16px' }}>
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

                {/* Title row with Save + Run */}
                <div className="grid gap-2 items-start" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto' }}>
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
                    <span />
                </div>

                {/* Meta grid + inline actions */}
                <div className="flex items-center gap-1.5 flex-wrap">
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
                    <select
                        value={d.priority}
                        onChange={e => updateDraft('priority', e.target.value as 'high' | 'normal' | 'low')}
                        className="h-[24px] rounded-full border border-[#d0d7de] dark:border-[#555] bg-[#f6f8fa] dark:bg-transparent px-2 text-[11px] text-[#656d76] dark:text-[#999] cursor-pointer appearance-none outline-none whitespace-nowrap"
                        disabled={saving}
                        data-testid="wi-priority-select"
                        aria-label="Priority"
                    >
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                    </select>
                    <span className="text-[11px] leading-[1.35] text-[#656d76] dark:text-[#999] truncate min-w-0 flex-1">
                        Updated {formatRelativeTime(item.updatedAt)}
                    </span>
                    {/* Inline action icons — compact, right-aligned */}
                    <div className="flex items-center gap-2 shrink-0">
                        {!isContainer && (
                            <button
                                className="inline-flex items-center justify-center min-h-[22px] border border-[#0969da] rounded-[4px] bg-[#0969da] text-white px-[6px] text-[10px] font-semibold whitespace-nowrap hover:bg-[#0550ae] disabled:opacity-40"
                                onClick={() => setShowExecuteDialog(true)}
                                disabled={!canExecute}
                                data-testid="work-item-execute-btn"
                                type="button"
                            >
                                Run
                            </button>
                        )}
                        <button
                            className="inline-flex items-center justify-center min-h-[22px] rounded-[4px] border border-purple-300 bg-purple-50 px-[6px] text-[10px] font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-200 dark:hover:bg-purple-900/50"
                            onClick={openWorkItemChat}
                            data-testid="work-item-ask-ai-btn"
                            aria-pressed={workItemChatOpen}
                            title={isDirty ? 'Ask AI about the saved Work Item; unsaved edits are not included' : 'Ask AI about this Work Item'}
                            type="button"
                        >
                            Ask AI
                        </button>
                        {isMobile && isContainer && (
                            <button
                                className="text-[#656d76] hover:text-[#1f2328] dark:text-[#999] dark:hover:text-[#ccc] text-[11px] bg-transparent border-0 cursor-pointer p-0 whitespace-nowrap"
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
                                type="button"
                            >
                                + Add Child
                            </button>
                        )}
                        {!isMobile && (
                            <button
                                className="text-[#656d76] hover:text-[#1f2328] dark:text-[#999] dark:hover:text-[#ccc] text-[11px] bg-transparent border-0 cursor-pointer p-0 whitespace-nowrap"
                                onClick={() => {
                                    const childTypes = ALLOWED_CHILD_TYPES[effectiveType as WorkItemTypeLabel] ?? [];
                                    if (childTypes.length === 0) return;
                                    if (childTypes.length === 1) {
                                        onCreateChild?.(childTypes[0] as WorkItemTypeLabel, item.id);
                                    } else {
                                        setShowChildTypePicker(true);
                                    }
                                }}
                                data-testid="wi-new-child-btn"
                                type="button"
                            >
                                + child
                            </button>
                        )}
                        {aiAuthoringEnabled && (
                            <button
                                className="text-[#656d76] hover:text-[#1f2328] dark:text-[#999] dark:hover:text-[#ccc] text-[12px] bg-transparent border-0 cursor-pointer p-0 leading-none"
                                onClick={() => setShowAiComposer(true)}
                                data-testid="work-item-improve-with-ai-btn"
                                title="Improve with AI"
                                type="button"
                            >
                                ✨
                            </button>
                        )}
                        <button className="text-[#656d76] hover:text-[#1f2328] dark:text-[#999] dark:hover:text-[#ccc] text-[12px] bg-transparent border-0 cursor-pointer p-0 leading-none" data-testid="work-item-pin-btn"
                            title={item.pinnedAt ? 'Unpin' : 'Pin'}
                            type="button"
                            onClick={async () => {
                                try {
                                    await getSpaCocClient().workItems.pin(workspaceId, workItemId, !item.pinnedAt);
                                    await fetchItem();
                                } catch (err: any) {
                                    setError(err.message || 'Failed to update pin');
                                }
                            }}>
                            📌
                        </button>
                        <button className="text-[#656d76] hover:text-[#1f2328] dark:text-[#999] dark:hover:text-[#ccc] text-[12px] bg-transparent border-0 cursor-pointer p-0 leading-none" data-testid="work-item-archive-btn"
                            title={item.archivedAt ? 'Unarchive' : 'Archive'}
                            type="button"
                            onClick={async () => {
                                try {
                                    await getSpaCocClient().workItems.archive(workspaceId, workItemId, !item.archivedAt);
                                    await fetchItem();
                                } catch (err: any) {
                                    setError(err.message || 'Failed to update archive');
                                }
                            }}>
                            🗄️
                        </button>
                        <button className="text-[#cf222e] hover:text-[#a40e26] dark:text-red-400 dark:hover:text-red-300 text-[12px] bg-transparent border-0 cursor-pointer p-0 leading-none" data-testid="work-item-delete-btn"
                            type="button"
                            onClick={async () => {
                                if (confirm('Delete this work item?')) {
                                    await getSpaCocClient().workItems.delete(workspaceId, workItemId);
                                    onBack?.();
                                }
                            }}>
                            🗑
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto min-h-0 bg-white dark:bg-[#1e1e1e]">
                <div className="grid gap-3 items-start" style={{ gridTemplateColumns: 'minmax(0, 1fr)', padding: '12px 16px 18px' }}>
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
                {syncConflict && (
                    <section
                        className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[12px] text-[#1f2328] shadow-sm dark:border-amber-700/70 dark:bg-amber-900/20 dark:text-[#cccccc]"
                        data-testid="wi-sync-conflict-panel"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="m-0 text-[13px] font-semibold text-amber-900 dark:text-amber-200">
                                    Remote changes found on {syncConflict.providerLabel}
                                </h3>
                                <p className="m-0 mt-1 text-[12px] leading-[1.45] text-amber-800 dark:text-amber-100/90">
                                    Choose the value to keep for each provider-owned field, then retry the normal Save.
                                </p>
                            </div>
                            <span className="shrink-0 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-[#1e1e1e] dark:text-amber-200">
                                {syncConflict.provider === 'github' ? 'GitHub' : 'Azure Boards'}
                            </span>
                        </div>
                        <div className="mt-3 grid gap-2">
                            {syncConflict.fields.map(field => {
                                const choice = syncConflictChoices[field.field] ?? 'draft';
                                return (
                                    <div key={field.field} className="rounded-md border border-amber-200 bg-white/70 p-2 dark:border-amber-800/70 dark:bg-[#1e1e1e]/60" data-testid={`wi-sync-conflict-field-${field.field}`}>
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <strong className="text-[12px] text-[#1f2328] dark:text-[#cccccc]">{conflictFieldLabel(field.field)}</strong>
                                            {field.base !== null && (
                                                <span className="truncate text-[11px] text-[#656d76] dark:text-[#999]" title={field.base}>
                                                    Base: {field.base}
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <ConflictValueCard
                                                label="Your draft"
                                                value={field.draft}
                                                selected={choice === 'draft'}
                                                onSelect={() => setSyncConflictChoices(prev => ({ ...prev, [field.field]: 'draft' }))}
                                            />
                                            <ConflictValueCard
                                                label={syncConflict.providerLabel}
                                                value={field.remote}
                                                selected={choice === 'remote'}
                                                onSelect={() => setSyncConflictChoices(prev => ({ ...prev, [field.field]: 'remote' }))}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[12px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:text-amber-200"
                                onClick={handleDismissConflict}
                                disabled={saving}
                                data-testid="wi-sync-conflict-cancel"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="rounded-md border border-amber-700 bg-amber-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                                onClick={handleApplyConflictResolution}
                                disabled={saving}
                                data-testid="wi-sync-conflict-apply"
                            >
                                Apply resolution &amp; Save
                            </button>
                        </div>
                    </section>
                )}

                {/* Description */}
                <article className="border border-[#d0d7de] dark:border-[#474749] rounded-md overflow-hidden" data-testid="wi-description-editor">
                    <div className="min-h-[34px] px-[10px] py-[7px] border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] flex items-center justify-between gap-2">
                        <h3 className="text-[13px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc] m-0">Description</h3>
                        <ModeToggleToolbar
                            modes={DESCRIPTION_MODE_OPTIONS}
                            activeMode={descViewMode}
                            onModeChange={setDescViewMode}
                            dirty={!!(baseline && d.description !== baseline.description)}
                            testId="wi-description-mode-toggle"
                        />
                    </div>
                    <div className="p-[10px]">
                        <WorkItemDescriptionEditor
                            value={d.description}
                            onChange={v => updateDraft('description', v)}
                            dirty={!!(baseline && d.description !== baseline.description)}
                            disabled={saving}
                            viewMode={descViewMode}
                            onViewModeChange={setDescViewMode}
                        />
                    </div>
                </article>

                {/* Plan — leaf items only */}
                {!isContainer && (
                <article className="border border-[#d0d7de] dark:border-[#474749] rounded-md overflow-hidden">
                    <div className="min-h-[34px] px-[10px] py-[7px] border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] flex items-center justify-between gap-2">
                        <h3 className="text-[13px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc] m-0">
                            Plan {item.plan ? `v${item.plan.version}` : ''}
                        </h3>
                        {canEditPlan && (
                            <ModeToggleToolbar
                                modes={PLAN_MODE_OPTIONS}
                                activeMode={planViewMode}
                                onModeChange={setPlanViewMode}
                                dirty={planDraft !== null && planDraft !== (item.plan?.content ?? '')}
                                testId="work-item-plan-mode-toggle"
                            />
                        )}
                    </div>
                    <div className="p-[10px]">
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
                            viewMode={planViewMode}
                            onViewModeChange={setPlanViewMode}
                        />
                    </div>
                </article>
                )}

                {/* Success Criteria — goal items only */}
                {effectiveType === 'goal' && (
                    <article className="border border-[#d0d7de] dark:border-[#474749] rounded-md overflow-hidden" data-testid="wi-success-criteria">
                        <div className="min-h-[34px] px-[10px] py-[7px] border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] flex items-center">
                            <h3 className="text-[13px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc] m-0">Success Criteria</h3>
                        </div>
                        <div className="p-[10px]">
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
                    <div className="px-[10px] py-[6px] bg-[#f6f8fa] dark:bg-[#252526] flex items-center gap-3 flex-wrap text-[11px] leading-[1.35]">
                        {/* Parent */}
                        {hierarchyEnabled && effectiveType !== 'epic' ? (
                            <span className="flex items-center gap-1" data-testid="work-item-parent-edit">
                                <strong className="text-[#1f2328] dark:text-[#cccccc]">Parent</strong>
                                <span className="text-[#656d76] dark:text-[#999] flex items-center gap-1">
                                    {d.parentId
                                        ? <span className="font-mono">{d.parentId.slice(0, 8)}…</span>
                                        : <span className="italic">—</span>
                                    }
                                    <button className="text-[#0969da] hover:underline bg-transparent border-0 cursor-pointer p-0 text-[11px]" onClick={() => setShowParentPicker(true)} disabled={saving} data-testid="wi-edit-parent-btn" type="button">
                                        {d.parentId ? 'Change' : 'Set'}
                                    </button>
                                </span>
                            </span>
                        ) : item.parentId ? (
                            <span className="flex items-center gap-1" data-testid="work-item-parent-info">
                                <strong className="text-[#1f2328] dark:text-[#cccccc]">Parent</strong>
                                <span className="text-[#656d76] dark:text-[#999] font-mono">{item.parentId.slice(0, 8)}…</span>
                            </span>
                        ) : null}
                        {/* Tags */}
                        <span className="flex items-center gap-1 min-w-0">
                            <strong className="text-[#1f2328] dark:text-[#cccccc] shrink-0">Tags</strong>
                            <span className="flex gap-0.5 items-center flex-wrap min-w-0">
                                {parseTags(d.tags).length > 0 ? (
                                    parseTags(d.tags).map(tag => (
                                        <span key={tag} className="inline-flex items-center h-[18px] px-1.5 rounded-full border border-[#d0d7de] dark:border-[#555] bg-white dark:bg-transparent text-[10px] text-[#656d76] dark:text-[#999]">{tag}</span>
                                    ))
                                ) : null}
                                <input
                                    type="text"
                                    className="min-w-[60px] w-16 text-[11px] px-0.5 py-0 border-0 outline-none bg-transparent text-[#1f2328] dark:text-[#cccccc] placeholder-[#656d76]"
                                    value={d.tags}
                                    onChange={e => updateDraft('tags', e.target.value)}
                                    disabled={saving}
                                    placeholder="add tags"
                                    data-testid="wi-tags-input"
                                    aria-label="Tags"
                                />
                            </span>
                        </span>
                        {/* Auto-execute (leaf items only) */}
                        {!isContainer && (
                            <label className="flex items-center gap-1 cursor-pointer shrink-0" title="Auto-execute when status reaches Ready to Execute" data-testid="work-item-auto-execute-toggle">
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
                                <strong className="text-[#1f2328] dark:text-[#cccccc]">Auto</strong>
                            </label>
                        )}
                        {/* Source */}
                        <span className="flex items-center gap-1 text-[#656d76] dark:text-[#999] shrink-0">
                            <strong className="text-[#1f2328] dark:text-[#cccccc]">Src</strong>
                            {item.source === 'manual' ? 'Manual' : item.source === 'chat' ? 'Chat' : 'Schedule'}
                        </span>
                    </div>
                </article>


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
                        <div className="min-h-[34px] px-[10px] py-[7px] border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] flex items-center justify-between gap-2">
                            <h3 className="text-[13px] leading-[1.25] font-semibold text-[#1f2328] dark:text-[#cccccc] m-0">Execution History</h3>
                        </div>
                        <div className="p-[10px] space-y-2">
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

            {workItemChatOpen && workItemChatPresentation === 'lens' && workItemChatSurface}

            {workItemChatOpen && workItemChatPresentation === 'side-panel' && (
                <div
                    className="min-h-[320px] h-[min(45vh,420px)] shrink-0 border-t border-[#d0d7de] bg-[#f8f8f8] dark:border-[#3c3c3c] dark:bg-[#1e1e1e]"
                    data-testid="work-item-chat-side-panel-container"
                >
                    {workItemChatSurface}
                </div>
            )}

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
                    currentParentId={d.parentId ?? undefined}
                    onlyPick={true}
                    onParentChanged={(newParentId) => updateDraft('parentId', newParentId)}
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
