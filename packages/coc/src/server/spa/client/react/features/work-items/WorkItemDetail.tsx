/**
 * WorkItemDetail — right-pane detail view for a selected work item.
 * Shows title, description, status, plan (with version tabs + comments),
 * execution history, and action buttons.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, cn } from '../../ui';
import { fetchApi } from '../../hooks/useApi';
import { useCocClient } from '../../repos/cloneRouting';
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
import { isWorkItemsAiAuthoringEnabled, isWorkItemsHierarchyEnabled, isWorkItemsWorkflowEnabled } from '../../utils/config';
import { WorkItemParentPicker } from './WorkItemParentPicker';
import {
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
import { WorkItemRemoteMirrorBadge } from './WorkItemGitHubMirrorBadge';
import { useReviewChatPresentation } from '../git/hooks/useReviewChatPresentation';
import type { ReviewChatTarget } from '../git/commits/commitChatPlacement';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { WorkItemChatPanel } from './WorkItemChatPanel';
import { WorkItemChatPlacementFrame } from './WorkItemChatPlacementFrame';
import { WorkItemAiDraftApplyDialog } from './WorkItemAiDraftApplyDialog';
import { ensureQueueProcessId } from '../../utils/queue-process-id';
import { resolveWorkItemOriginId } from './workItemOriginScope';

const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Leave without saving?';
const WORK_ITEM_CHAT_PANEL_WIDTH_STORAGE_PREFIX = 'coc.workItemChatPanel.width';

function getWorkItemChatPanelWidthStorageKey(workspaceId: string, workItemId: string): string {
    return `${WORK_ITEM_CHAT_PANEL_WIDTH_STORAGE_PREFIX}.${encodeURIComponent(workspaceId)}.${encodeURIComponent(workItemId)}`;
}

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

function statusConfigFor(status: string, workflowCommandCenter: boolean, type: string): { label: string; badgeStatus: string } {
    const fallback = STATUS_LABELS[status] || STATUS_LABELS.created;
    if (!workflowCommandCenter) return fallback;
    if (status === 'created') return { ...fallback, label: 'Draft' };
    if (status === 'drafting') return { ...fallback, label: type === 'goal' ? 'Grilling' : 'Drafting' };
    if (status === 'planning') return { ...fallback, label: type === 'goal' ? 'Grilling' : 'Planning' };
    if (status === 'readyToExecute') return { ...fallback, label: 'Ready' };
    if (status === 'aiDone') return { ...fallback, label: 'Review' };
    if (status === 'aiFailed') return { ...fallback, label: 'Failed' };
    return fallback;
}

function formatExecutionModeLabel(mode: string | undefined): string | undefined {
    if (mode === 'ralph') return 'Ralph';
    if (mode === 'one-shot') return 'One-shot';
    return mode;
}

function formatProviderLabel(provider: string): string {
    return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function isCommentResolveExecution(exec: { sessionCategory?: string }): boolean {
    return exec.sessionCategory === 'resolve-plan-comments' || exec.sessionCategory === 'resolve-commit-comments';
}

function isWorkflowAiReviewExecution(exec: { sessionCategory?: string; kind?: string }): boolean {
    return exec.sessionCategory === 'work-item-ai-review' || exec.kind === 'ai-review';
}

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
    originId?: string;
    onBack?: () => void;
    onExecuted?: () => void;
    /** Called when the user clicks the execution session entry for a task. */
    onViewTask?: (taskId: string) => void;
    /** Called when the user clicks a commit SHA to view its diff inline. */
    onViewCommit?: (sha: string) => void;
    /** Called when the user wants to view a completed task in the Tasks tab. */
    onNavigateToTasksTab?: (taskId: string) => void;
}

interface WorkItemFull {
    id: string; workItemNumber?: number; title: string; description: string; status: string;
    type?: string;
    parentId?: string;
    successCriteria?: string;
    grillSessionId?: string;
    priority?: string; source?: string; sourceId?: string;
    tracker?: { kind: string };
    createdAt: string; updatedAt: string; completedAt?: string;
    plan?: { version: number; currentVersion?: number; content: string; updatedAt?: string; resolvedBy?: string };
    taskId?: string; processId?: string;
    currentContentVersion?: number;
    executionHistory?: Array<{
        taskId: string;
        processId?: string;
        planVersion?: number;
        startedAt: string;
        completedAt?: string;
        status: string;
        error?: string;
        autoReExecuted?: boolean;
        title?: string;
        sessionCategory?: string;
        executionMode?: string;
        ralphSessionId?: string;
        aiSettings?: {
            provider?: string;
            model?: string;
            reasoningEffort?: string;
            effortTier?: string;
            autoProviderRouting?: boolean;
        };
        skillNames?: string[];
        prUrl?: string;
        kind?: string;
        reviewedChangeId?: string;
        reviewedTaskId?: string;
    }>;
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
        branchName?: string;
        prNumber?: number;
        prUrl?: string;
        prStatus?: string;
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

function buildGoalGrillingPrompt(item: WorkItemFull): string {
    const parts = [
        `Please grill me to turn this saved Goal into a precise implementation-ready goal spec.\n\nGoal title: ${item.title}`,
    ];
    if (item.description?.trim()) {
        parts.push(`Saved description:\n${item.description.trim()}`);
    }
    if (item.successCriteria?.trim()) {
        parts.push(`Current success criteria:\n${item.successCriteria.trim()}`);
    }
    if (item.plan?.content?.trim()) {
        parts.push(`Current Goal content version v${item.plan.version}:\n${item.plan.content.trim()}`);
    }
    parts.push('Ask focused clarification questions until the goal is clear, then emit the final goal spec as a Markdown block starting with `## Goal`.');
    return parts.join('\n\n');
}

function createRalphSessionId(): string {
    return `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export function WorkItemDetail({ workItemId, workspaceId, originId, onBack, onExecuted, onViewTask, onViewCommit, onNavigateToTasksTab }: WorkItemDetailProps) {
    // AC-07: all work-item detail reads/writes target the selected clone's server.
    const cloneClient = useCocClient(workspaceId);
    const workItemOriginId = originId ?? resolveWorkItemOriginId({ workspaceId });
    const originOptions = useMemo(() => ({ workspaceId }), [workspaceId]);
    const [item, setItem] = useState<WorkItemFull | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showExecuteDialog, setShowExecuteDialog] = useState(false);
    const [reviewComment, setReviewComment] = useState('');
    const [requestingChanges, setRequestingChanges] = useState(false);
    const [acceptingDone, setAcceptingDone] = useState(false);
    const [submittingPr, setSubmittingPr] = useState(false);
    const [startingAiReview, setStartingAiReview] = useState(false);
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
    /** Plan content draft, lifted from WorkItemPlanSection into the unified batch. */
    const [planDraft, setPlanDraft] = useState<string | null>(null);
    const [descViewMode, setDescViewMode] = useState<DescriptionViewMode>('source');
    const [planViewMode, setPlanViewMode] = useState<PlanViewMode>('preview');

    const [showAiComposer, setShowAiComposer] = useState(false);
    const [showAiDraftApplyDialog, setShowAiDraftApplyDialog] = useState(false);
    const [startingGoalGrilling, setStartingGoalGrilling] = useState(false);
    const aiAuthoringEnabled = isWorkItemsAiAuthoringEnabled();
    const { isMobile } = useBreakpoint();
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
        isDesktop: workItemChatIsDesktop,
    } = useReviewChatPresentation({
        target: workItemChatTarget,
        forceLensOnNonDesktop: true,
    });
    const workItemChatResize = useResizablePanel({
        initialWidth: 360,
        minWidth: 200,
        maxWidth: 600,
        storageKey: getWorkItemChatPanelWidthStorageKey(workspaceId, workItemId),
        direction: 'right',
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
            const data = await cloneClient.workItems.getForOrigin(workItemOriginId, requestedWorkItemId, { workspaceId: requestedWorkspaceId });
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
    }, [workspaceId, workItemOriginId, workItemId, cloneClient]);

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
    const contextItems = workItemState.workItemsByRepo[workItemOriginId] || [];
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
            closeWorkItemChat();
            onBack?.();
        }
    }, [closeWorkItemChat, contextItem, onBack]);

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
            await cloneClient.workItems.updateStatusForOrigin(
                workItemOriginId,
                workItemId,
                'done',
                { completedAt: new Date().toISOString() },
                originOptions,
            );
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
            await cloneClient.workItems.requestChangesForOrigin(workItemOriginId, workItemId, { comments }, originOptions);
            setReviewComment('');
            await fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to request changes');
        } finally {
            setRequestingChanges(false);
        }
    };

    const handleSubmitPr = async () => {
        if (!latestReviewChange) return;
        setSubmittingPr(true);
        setError(null);
        try {
            await cloneClient.workItems.submitPullRequestForOrigin(workItemOriginId, workItemId, {
                changeId: latestReviewChange.id,
            }, originOptions);
            await fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to submit PR');
        } finally {
            setSubmittingPr(false);
        }
    };

    const handleStartAiReview = async () => {
        if (!item || !workflowCommandCenter) return;
        setStartingAiReview(true);
        setError(null);
        try {
            const result = await cloneClient.workItems.startAiReviewForOrigin(workItemOriginId, workItemId, {}, originOptions);
            if (result.workItem) {
                dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workItemOriginId, item: result.workItem as any });
            }
            if (result.taskId && onViewTask) {
                onViewTask(result.taskId);
            }
            await fetchItem();
        } catch (err: any) {
            setError(err.message || 'Failed to start AI review');
        } finally {
            setStartingAiReview(false);
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
            await cloneClient.workItems.requestChangesForOrigin(workItemOriginId, workItemId, { comments: formatted, source: 'diff-comments' }, originOptions);

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
            const result = await cloneClient.workItems.resolveCommentsForOrigin(workItemOriginId, workItemId, {
                type: 'commit',
                commitSha: sha,
                ...(sourceRunIndex != null ? { sourceRunIndex } : {}),
            }, originOptions);
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
                await cloneClient.workItems.resolveCommentsForOrigin(workItemOriginId, workItemId, {
                    type: 'commit',
                    commitSha: commit.sha,
                    sourceRunIndex,
                }, originOptions);
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
                updated = await cloneClient.workItems.updateForOrigin(workItemOriginId, workItemId, updates, originOptions) as any;
            }
            setDraft(draftToSave);
            setSyncConflict(null);
            setSyncConflictChoices({});
            dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workItemOriginId, item: updated as any });
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
    }, [item, planDraft, workItemOriginId, workItemId, dispatch, fetchItem, cloneClient, originOptions]);

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

    const handleGoalGrilling = useCallback(async () => {
        if (!item || item.id !== workItemId) return;
        if (item.grillSessionId) {
            openWorkItemChat();
            return;
        }
        setStartingGoalGrilling(true);
        setError(null);
        try {
            const sessionId = createRalphSessionId();
            const result = await cloneClient.queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: 'ask',
                    prompt: buildGoalGrillingPrompt(item),
                    workspaceId,
                    context: {
                        skills: ['grill-me'],
                        ralph: {
                            phase: 'grilling',
                            sessionId,
                        },
                        workItemGoalGrilling: {
                            workspaceId,
                            workItemId,
                            title: item.title,
                            contentVersion: item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version ?? null,
                        },
                        workItemChat: {
                            workspaceId,
                            originId: workItemOriginId,
                            workItemId,
                            workItemNumber: item.workItemNumber,
                            status: item.status,
                            type: item.type ?? 'work-item',
                        },
                    },
                },
            });
            const taskId = result.task?.id ?? (result as { id?: string }).id;
            if (!taskId) throw new Error('Failed to create Goal grilling chat task');

            await cloneClient.workItems.createChatBindingForOrigin(workItemOriginId, workItemId, taskId);
            await cloneClient.workItems.updateForOrigin(workItemOriginId, workItemId, {
                grillSessionId: ensureQueueProcessId(taskId),
                ...(item.status === 'created' ? { status: 'drafting' } : {}),
            }, originOptions);
            await fetchItem();
            openWorkItemChat();
        } catch (err: any) {
            setError(err.message || 'Failed to start Goal grilling');
        } finally {
            setStartingGoalGrilling(false);
        }
    }, [fetchItem, item, openWorkItemChat, workItemOriginId, originOptions, workItemId, workspaceId, cloneClient]);

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
    const hierarchyEnabled = isWorkItemsHierarchyEnabled();
    const workflowEnabled = isWorkItemsWorkflowEnabled();
    const isLocalOnlyWorkflowItem = (effectiveType === 'work-item' || effectiveType === 'goal')
        && (!item.tracker || item.tracker.kind === 'local-only')
        && !item.githubMirror
        && !item.azureBoardsMirror;
    const workflowCommandCenter = workflowEnabled && isLocalOnlyWorkflowItem;
    const compactWorkflowLayout = workflowCommandCenter && isMobile;
    const compactWorkflowActionClass = compactWorkflowLayout
        ? 'min-h-10 flex-1 px-3 text-[12px]'
        : 'min-h-[22px] px-[6px] text-[10px]';
    const compactWorkflowReviewButtonClass = compactWorkflowLayout ? 'flex-1 justify-center' : undefined;
    const compactWorkflowIconButtonClass = compactWorkflowLayout
        ? 'inline-flex min-h-10 w-10 items-center justify-center rounded-[4px] border border-red-200 bg-red-50 text-[15px] dark:border-red-800 dark:bg-red-900/20'
        : 'text-[12px] bg-transparent border-0 p-0';
    const statusCfg = statusConfigFor(item.status, workflowCommandCenter, effectiveType);
    const canExecute = !isContainer && item.status === 'readyToExecute';
    const canEditPlan = !isContainer && ['created', 'planning', 'readyToExecute'].includes(item.status);
    const isAiDone = !isContainer && item.status === 'aiDone';
    const validNextStatuses = VALID_TRANSITIONS[item.status] ?? [];
    const isLocalOnlyWorkflowWorkItem = effectiveType === 'work-item' && isLocalOnlyWorkflowItem;
    const canUseGoalGrilling = workflowEnabled && effectiveType === 'goal' && isLocalOnlyWorkflowItem;
    const canDraftWithAi = workflowEnabled && aiAuthoringEnabled && isLocalOnlyWorkflowWorkItem;
    const canUseVersionWorkflowActions = workflowEnabled && isLocalOnlyWorkflowItem;
    const canSelectExecutionMode = workflowEnabled && isLocalOnlyWorkflowItem;
    const defaultExecutionMode = workflowEnabled && effectiveType === 'goal' && isLocalOnlyWorkflowItem ? 'ralph' : 'one-shot';
    const latestReviewExecution = item.executionHistory
        ?.map((exec, index) => ({ exec, index }))
        .filter(({ exec }) => exec.status === 'completed' && !isCommentResolveExecution(exec) && !isWorkflowAiReviewExecution(exec))
        .at(-1);
    const latestReviewChange = latestReviewExecution
        ? item.changes?.find(change => change.taskId === latestReviewExecution.exec.taskId)
        : undefined;
    const canSubmitPr = workflowCommandCenter
        && isAiDone
        && !!latestReviewChange
        && latestReviewChange.commits.length > 0
        && !latestReviewChange.prUrl;
    const hasRunningAiReview = item.executionHistory?.some(exec => isWorkflowAiReviewExecution(exec) && exec.status === 'running') ?? false;
    const canStartAiReview = workflowCommandCenter && isAiDone;

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
        originId: workItemOriginId,
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
    const renderWorkItemChatSideColumn = workItemChatOpen
        && workItemChatPresentation === 'side-panel'
        && workItemChatLensEnabled
        && workItemChatPinned
        && workItemChatIsDesktop;

    return (
        <div className="relative flex flex-col h-full overflow-hidden" data-testid="work-item-detail">
            {/* ── Detail header ── */}
            <div
                className="border-b border-[#d0d7de] dark:border-[#474749] bg-white dark:bg-[#1e1e1e] grid gap-2 shrink-0"
                style={{ padding: compactWorkflowLayout ? '10px 12px' : '12px 16px' }}
            >
                {/* Title row */}
                <div
                    className="grid gap-2 items-center"
                    style={{ gridTemplateColumns: compactWorkflowLayout ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) auto auto' }}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        {onBack && (
                            <button onClick={guardedBack} className="text-[#656d76] hover:text-[#1f2328] dark:hover:text-[#ccc] shrink-0" data-testid="work-item-back-btn" aria-label="Back">
                                ←
                            </button>
                        )}
                        {item.workItemNumber != null && (
                            <span className="font-mono text-[12px] text-[#656d76] dark:text-[#999] shrink-0" data-testid="work-item-detail-number">
                                {typePrefix}-{item.workItemNumber}
                            </span>
                        )}
                        <input
                            type="text"
                            className="min-w-0 flex-1 border border-[#d0d7de] dark:border-[#555] rounded-md bg-white dark:bg-[#1e1e1e] text-[#1f2328] dark:text-[#cccccc] px-2 py-[5px] text-[18px] leading-[1.25] font-semibold outline-none focus:border-[#0969da] focus:shadow-[0_0_0_3px_rgba(9,105,218,0.16)]"
                            value={d.title}
                            onChange={e => updateDraft('title', e.target.value)}
                            disabled={saving}
                            data-testid="wi-title-input"
                            aria-label="Title"
                        />
                        {isDirty && (
                            <span className="inline-flex items-center rounded-full px-2 py-px text-[11px] leading-[1.4] border border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400 whitespace-nowrap" data-testid="wi-dirty-indicator">
                                unsaved
                            </span>
                        )}
                    </div>
                    <button
                        className={cn(
                            'inline-flex items-center justify-center gap-[5px] border border-[rgba(31,35,40,0.15)] rounded-md bg-[#1f883d] text-white px-2 text-[12px] font-semibold tracking-[0.02em] whitespace-nowrap hover:bg-[#1a7f37] disabled:opacity-50 dark:bg-[#238636] dark:hover:bg-[#2ea043]',
                            compactWorkflowLayout ? 'min-h-10 w-full' : 'min-h-7',
                        )}
                        onClick={handleSave}
                        disabled={!isDirty || saving}
                        data-testid="wi-save-btn"
                        title="Save changes (Ctrl+S)"
                        type="button"
                    >
                        Save
                    </button>
                    {!compactWorkflowLayout && <span />}
                </div>

                {/* Properties row + inline actions */}
                <div className={cn('flex items-center gap-1.5 flex-wrap text-[11px] leading-[1.35]', compactWorkflowLayout && 'gap-2')} data-testid="work-item-properties-row">
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
                            <option key={s} value={s}>{statusConfigFor(s, workflowCommandCenter, effectiveType).label}</option>
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
                    {hierarchyEnabled && effectiveType !== 'epic' ? (
                        <span className="flex items-center gap-1 shrink-0" data-testid="work-item-parent-edit">
                            <strong className="text-[#1f2328] dark:text-[#cccccc]">Parent</strong>
                            <span className="text-[#656d76] dark:text-[#999] flex items-center gap-1">
                                {d.parentId
                                    ? <span className="font-mono">{d.parentId.slice(0, 8)}...</span>
                                    : <span className="italic">-</span>
                                }
                                <button className="text-[#0969da] hover:underline bg-transparent border-0 cursor-pointer p-0 text-[11px]" onClick={() => setShowParentPicker(true)} disabled={saving} data-testid="wi-edit-parent-btn" type="button">
                                    {d.parentId ? 'Change' : 'Set'}
                                </button>
                            </span>
                        </span>
                    ) : item.parentId ? (
                        <span className="flex items-center gap-1 shrink-0" data-testid="work-item-parent-info">
                            <strong className="text-[#1f2328] dark:text-[#cccccc]">Parent</strong>
                            <span className="text-[#656d76] dark:text-[#999] font-mono">{item.parentId.slice(0, 8)}...</span>
                        </span>
                    ) : null}
                    <span className="flex items-center gap-1 min-w-[120px]">
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
                    {!isContainer && (
                        <label className="flex items-center gap-1 cursor-pointer shrink-0" title="Auto-execute when status reaches Ready to Execute" data-testid="work-item-auto-execute-toggle">
                            <input
                                type="checkbox"
                                checked={item.autoExecute ?? false}
                                onChange={async (e) => {
                                    try {
                                        await cloneClient.workItems.updateForOrigin(workItemOriginId, workItemId, { autoExecute: e.target.checked }, originOptions);
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
                    <span className="flex items-center gap-1 text-[#656d76] dark:text-[#999] shrink-0">
                        <strong className="text-[#1f2328] dark:text-[#cccccc]">Src</strong>
                        {item.source === 'manual' ? 'Manual' : item.source === 'chat' ? 'Chat' : 'Schedule'}
                    </span>
                    {/* Inline action icons — compact, right-aligned */}
                    <div
                        className={cn(
                            'flex items-center gap-2 shrink-0',
                            compactWorkflowLayout && 'order-last w-full flex-wrap gap-2 pt-1',
                        )}
                        data-testid="work-item-primary-actions"
                    >
                        {!isContainer && (
                            <button
                                className={cn(
                                    'inline-flex items-center justify-center border border-[#0969da] rounded-[4px] bg-[#0969da] text-white font-semibold whitespace-nowrap hover:bg-[#0550ae] disabled:opacity-40',
                                    compactWorkflowActionClass,
                                )}
                                onClick={() => setShowExecuteDialog(true)}
                                disabled={!canExecute}
                                data-testid="work-item-execute-btn"
                                type="button"
                            >
                                Run
                            </button>
                        )}
                        <button
                            className={cn(
                                'inline-flex items-center justify-center rounded-[4px] border border-purple-300 bg-purple-50 font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-200 dark:hover:bg-purple-900/50',
                                compactWorkflowActionClass,
                            )}
                            onClick={openWorkItemChat}
                            data-testid="work-item-ask-ai-btn"
                            aria-pressed={workItemChatOpen}
                            title={isDirty ? 'Ask AI about the saved Work Item; unsaved edits are not included' : 'Ask AI about this Work Item'}
                            type="button"
                        >
                            Ask AI
                        </button>
                        {canDraftWithAi && (
                            <button
                                className={cn(
                                    'inline-flex items-center justify-center rounded-[4px] border border-purple-300 bg-purple-50 font-semibold text-purple-700 hover:bg-purple-100 disabled:opacity-40 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-200 dark:hover:bg-purple-900/50',
                                    compactWorkflowActionClass,
                                )}
                                onClick={() => setShowAiDraftApplyDialog(true)}
                                disabled={isDirty || saving}
                                data-testid="work-item-draft-with-ai-btn"
                                title={isDirty ? 'Save or discard local edits before drafting with AI' : item.plan?.content ? 'Create a new AI-authored plan version' : 'Draft description and v1 plan with AI'}
                                type="button"
                            >
                                {item.plan?.content ? 'Revise with AI' : 'Draft with AI'}
                            </button>
                        )}
                        {canUseGoalGrilling && (
                            <button
                                className={cn(
                                    'inline-flex items-center justify-center rounded-[4px] border border-amber-300 bg-amber-50 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50',
                                    compactWorkflowActionClass,
                                )}
                                onClick={handleGoalGrilling}
                                disabled={isDirty || saving || startingGoalGrilling}
                                data-testid="work-item-goal-grilling-btn"
                                title={isDirty ? 'Save or discard local edits before grilling this Goal' : item.grillSessionId ? 'Resume the Goal grilling chat' : 'Start a Goal grilling chat'}
                                type="button"
                            >
                                {startingGoalGrilling ? 'Starting…' : item.grillSessionId ? 'Continue grilling' : 'Start grilling'}
                            </button>
                        )}
                        {aiAuthoringEnabled && !canDraftWithAi && (
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
                        <button className={cn('text-[#cf222e] hover:text-[#a40e26] dark:text-red-400 dark:hover:text-red-300 cursor-pointer leading-none', compactWorkflowIconButtonClass)} data-testid="work-item-delete-btn"
                            type="button"
                            onClick={async () => {
                                if (confirm('Delete this work item?')) {
                                    await cloneClient.workItems.deleteForOrigin(workItemOriginId, workItemId, originOptions);
                                    closeWorkItemChat();
                                    onBack?.();
                                }
                            }}>
                            🗑
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Body ── */}
            <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-y-auto min-h-0 bg-white dark:bg-[#1e1e1e]" data-testid="work-item-detail-content">
                <div
                    className="grid gap-3 items-start"
                    style={{
                        gridTemplateColumns: 'minmax(0, 1fr)',
                        padding: compactWorkflowLayout ? '10px 10px 18px' : '12px 16px 18px',
                    }}
                >
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
                            originId={workItemOriginId}
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
                            enableVersionActions={canUseVersionWorkflowActions}
                            hasUnsavedChanges={isDirty}
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

                {/* Review section (aiDone only) */}
                {isAiDone && (
                    <section className="bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800 rounded-lg p-3" data-testid="work-item-review-section">
                        <h3 className="text-xs font-medium text-purple-700 dark:text-purple-400 uppercase mb-2">
                            🔄 {workflowCommandCenter ? 'Review Required' : 'AI Done — Review Required'}
                        </h3>
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
                        {workflowCommandCenter && latestReviewExecution && (
                            <div className="mb-3 rounded-md border border-purple-200 bg-white/70 p-2 text-[11px] text-[#3c3c3c] dark:border-purple-800 dark:bg-[#1e1e1e]/70 dark:text-[#cccccc]" data-testid="work-item-review-run-summary">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-semibold">Latest run #{latestReviewExecution.index + 1}</span>
                                    {latestReviewExecution.exec.title && <span>{latestReviewExecution.exec.title}</span>}
                                    {latestReviewExecution.exec.planVersion !== undefined && (
                                        <span className="rounded-full border border-purple-200 bg-purple-50 px-1.5 py-px text-[10px] text-purple-700 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-200">
                                            v{latestReviewExecution.exec.planVersion}
                                        </span>
                                    )}
                                    {formatExecutionModeLabel(latestReviewExecution.exec.executionMode) && (
                                        <span className="rounded-full border border-[#d0d7de] bg-[#f6f8fa] px-1.5 py-px text-[10px] text-[#656d76] dark:border-[#555] dark:bg-transparent dark:text-[#999]">
                                            {formatExecutionModeLabel(latestReviewExecution.exec.executionMode)}
                                        </span>
                                    )}
                                    <span className="text-[#656d76] dark:text-[#999]">
                                        {latestReviewChange?.commits.length ?? 0} commit{(latestReviewChange?.commits.length ?? 0) === 1 ? '' : 's'}
                                    </span>
                                </div>
                                {latestReviewChange && latestReviewChange.commits.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {latestReviewChange.commits.map(commit => (
                                            <code key={commit.sha} className="rounded bg-purple-100 px-1 py-px text-[10px] text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                                                {commit.sha.slice(0, 7)}
                                            </code>
                                        ))}
                                    </div>
                                )}
                                {latestReviewChange?.prUrl && (
                                    <a
                                        href={latestReviewChange.prUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-1 inline-flex text-[10px] text-[#0969da] hover:underline"
                                        data-testid="work-item-review-pr-link"
                                    >
                                        PR {latestReviewChange.prNumber ? `#${latestReviewChange.prNumber}` : 'submitted'} →
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
                            <div
                                className={cn('flex gap-2', compactWorkflowLayout && 'flex-wrap')}
                                data-testid="work-item-review-actions"
                            >
                                <Button variant="primary" size="sm" onClick={handleAcceptDone} disabled={acceptingDone} loading={acceptingDone} data-testid="work-item-accept-done-btn" className={compactWorkflowReviewButtonClass}>
                                    ✅ Accept &amp; Done
                                </Button>
                                {canSubmitPr && (
                                    <Button variant="success" size="sm" onClick={handleSubmitPr} disabled={submittingPr} loading={submittingPr} data-testid="work-item-submit-pr-btn" className={compactWorkflowReviewButtonClass}>
                                        Submit PR
                                    </Button>
                                )}
                                {canStartAiReview && (
                                    <Button variant="secondary" size="sm" onClick={handleStartAiReview} disabled={startingAiReview || hasRunningAiReview} loading={startingAiReview} data-testid="work-item-ai-review-btn" className={compactWorkflowReviewButtonClass}>
                                        {hasRunningAiReview ? 'AI review running' : 'AI Review'}
                                    </Button>
                                )}
                                <Button variant="ghost" size="sm" onClick={handleRequestChanges} disabled={requestingChanges} loading={requestingChanges} data-testid="work-item-request-changes-btn" className={compactWorkflowReviewButtonClass}>
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
                                        {workflowCommandCenter ? 'Ready for Review — Execution Session' : 'AI Completed — Running Session'}
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
                                const executionModeLabel = formatExecutionModeLabel(exec.executionMode);
                                const metadataChips: Array<{ key: string; label: string; title?: string }> = [];
                                if (exec.planVersion !== undefined) metadataChips.push({ key: 'version', label: `Version v${exec.planVersion}` });
                                if (executionModeLabel) metadataChips.push({ key: 'mode', label: executionModeLabel });
                                if (exec.ralphSessionId) metadataChips.push({ key: 'ralph', label: `Ralph ${exec.ralphSessionId}`, title: exec.ralphSessionId });
                                if (exec.aiSettings?.autoProviderRouting) metadataChips.push({ key: 'auto-provider', label: 'Auto provider' });
                                if (exec.aiSettings?.provider) metadataChips.push({ key: 'provider', label: `Provider ${formatProviderLabel(exec.aiSettings.provider)}` });
                                if (exec.aiSettings?.model) metadataChips.push({ key: 'model', label: `Model ${exec.aiSettings.model}`, title: exec.aiSettings.model });
                                if (exec.aiSettings?.reasoningEffort) metadataChips.push({ key: 'effort', label: `Effort ${exec.aiSettings.reasoningEffort}` });
                                if (exec.aiSettings?.effortTier) metadataChips.push({ key: 'tier', label: `Tier ${exec.aiSettings.effortTier}` });
                                if (exec.skillNames?.length) metadataChips.push({ key: 'skills', label: `Skills ${exec.skillNames.join(', ')}`, title: exec.skillNames.join(', ') });
                                if (matchingChange?.prUrl) metadataChips.push({
                                    key: 'pr',
                                    label: matchingChange.prNumber ? `PR #${matchingChange.prNumber}` : 'PR submitted',
                                    title: matchingChange.prUrl,
                                });
                                return (
                                    <div key={i} className="rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] text-xs" data-testid={`exec-entry-${i}`}>
                                        <div
                                            className={cn('flex gap-2 px-3 py-2', compactWorkflowLayout ? 'items-start flex-wrap gap-y-1' : 'items-center')}
                                            data-testid={`exec-header-${i}`}
                                        >
                                            <span>{exec.status === 'running' ? '🔵' : exec.status === 'completed' ? '🟢' : exec.status === 'failed' ? '🔴' : '⚪'}</span>
                                            <span className={cn('font-medium text-[#3c3c3c] dark:text-[#cccccc]', compactWorkflowLayout && 'min-w-0 flex-1 basis-[calc(100%-1.75rem)]')}>
                                                Run #{i + 1}{exec.title ? `: ${exec.title}` : ''}
                                            </span>
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
                                            {isWorkflowAiReviewExecution(exec) && (
                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[9px]" data-testid={`exec-ai-review-badge-${i}`}>
                                                    🔎 AI review
                                                </span>
                                            )}
                                            <span className={cn('text-[#848484]', compactWorkflowLayout && 'basis-full pl-6')}>{formatRelativeTime(exec.startedAt)}</span>
                                            {exec.completedAt && <span className="text-[#848484]">· {formatRelativeTime(exec.completedAt)}</span>}
                                        </div>
                                        {metadataChips.length > 0 && (
                                            <div className="px-3 pb-1.5 flex flex-wrap gap-1.5" data-testid={`exec-metadata-${i}`}>
                                                {metadataChips.map(chip => (
                                                    <span
                                                        key={chip.key}
                                                        title={chip.title}
                                                        className="inline-flex max-w-full min-w-0 items-center rounded-full border border-[#d0d7de] bg-white px-1.5 py-px text-[10px] text-[#656d76] dark:border-[#555] dark:bg-transparent dark:text-[#999]"
                                                        data-testid={`exec-metadata-chip-${i}-${chip.key}`}
                                                    >
                                                        <span className="truncate">{chip.label}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
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
                                            {matchingChange?.prUrl && (
                                                <a
                                                    href={matchingChange.prUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-[#0078d4] hover:underline text-[10px]"
                                                    data-testid={`exec-pr-link-${i}`}
                                                >
                                                    PR {matchingChange.prNumber ? `#${matchingChange.prNumber}` : 'submitted'} →
                                                </a>
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
                                                        <div key={c.sha} className={cn('flex items-start gap-1.5 text-[10px]', compactWorkflowLayout && 'flex-wrap')}>
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
                                                            <span
                                                                className={cn('text-[#3c3c3c] dark:text-[#cccccc] truncate', compactWorkflowLayout && 'basis-full whitespace-normal break-words pl-0')}
                                                                title={c.message}
                                                                data-testid={`exec-commit-message-${c.sha.slice(0, 7)}`}
                                                            >
                                                                {c.message}
                                                            </span>
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
            {renderWorkItemChatSideColumn && (
                <>
                    <div
                        className="hidden lg:flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 bg-[#e0e0e0] dark:bg-[#3c3c3c] shrink-0"
                        onMouseDown={workItemChatResize.handleMouseDown}
                        onTouchStart={workItemChatResize.handleTouchStart}
                        role="separator"
                        aria-label="Resize Work Item chat panel"
                        data-testid="work-item-chat-resize-handle"
                    />
                    <div
                        style={{ width: workItemChatResize.width }}
                        className="hidden lg:block shrink-0 h-full"
                        data-testid="work-item-chat-side-column"
                    >
                        {workItemChatSurface}
                    </div>
                </>
            )}
            </div>

            {workItemChatOpen && workItemChatPresentation === 'lens' && workItemChatSurface}

            {workItemChatOpen && workItemChatPresentation === 'side-panel' && !renderWorkItemChatSideColumn && (
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
                    originId={workItemOriginId}
                    workItemId={workItemId}
                    workItemTitle={item.title}
                    defaultExecutionMode={defaultExecutionMode}
                    allowExecutionModeSelection={canSelectExecutionMode}
                    onClose={() => setShowExecuteDialog(false)}
                    onExecuted={handleExecuteDialogDone}
                />
            )}
            <WorkItemAiComposer
                open={showAiComposer}
                onClose={() => setShowAiComposer(false)}
                workspaceId={workspaceId}
                originId={workItemOriginId}
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
            {showAiDraftApplyDialog && (
                <WorkItemAiDraftApplyDialog
                    open={showAiDraftApplyDialog}
                    workspaceId={workspaceId}
                    originId={workItemOriginId}
                    item={{
                        id: item.id,
                        title: item.title,
                        updatedAt: item.updatedAt,
                        currentContentVersion: item.currentContentVersion,
                        plan: item.plan,
                    }}
                    onClose={() => setShowAiDraftApplyDialog(false)}
                    onApplied={(updated) => {
                        dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workItemOriginId, item: updated as any });
                        void fetchItem();
                    }}
                />
            )}
            {showParentPicker && (
                <WorkItemParentPicker
                    open={showParentPicker}
                    onClose={() => setShowParentPicker(false)}
                    workspaceId={workspaceId}
                    originId={workItemOriginId}
                    itemId={workItemId}
                    itemType={effectiveType as any}
                    currentParentId={d.parentId ?? undefined}
                    onlyPick={true}
                    onParentChanged={(newParentId) => updateDraft('parentId', newParentId)}
                />
            )}
        </div>
    );
}
