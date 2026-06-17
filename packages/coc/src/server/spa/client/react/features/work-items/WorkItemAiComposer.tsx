/**
 * WorkItemAiComposer — AI-assisted work item authoring modal/drawer.
 *
 * Modes:
 *   create  — draft a new work item from a free-text prompt
 *   improve — propose improvements for an existing work item
 *
 * States: idle → generating → clarifying | preview → saving
 *
 * Layout: two-column wide dialog
 *   Left (40%):  prompt textarea, context info, clarification Q&A, action buttons
 *   Right (60%): editable preview tabs — "Work Item" | "Goal" | "Child Tasks"
 *
 * Review-before-save: nothing is persisted until the user clicks "Approve".
 */

import { useState, useCallback, useEffect } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button, cn, Spinner } from '../../ui';
import { useCocClient } from '../../repos/cloneRouting';
import { isWorkItemsHierarchyEnabled } from '../../utils/config';
import { resolveWorkItemOriginId } from './workItemOriginScope';
import type {
    WorkItemAiGenerationResponse,
    WorkItemAiDraftResult,
    WorkItemType,
} from '@plusplusoneplusplus/coc-client';

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'generating' | 'clarifying' | 'preview' | 'saving';
type PreviewTab = 'work-item' | 'goal' | 'child-tasks';

export interface WorkItemAiComposerProps {
    open: boolean;
    onClose: () => void;
    workspaceId: string;
    originId?: string;
    /** 'create' = draft new item; 'improve' = refine existing item */
    mode: 'create' | 'improve';
    /** Existing item context (required for 'improve' mode) */
    existingItem?: {
        id: string;
        title: string;
        description: string;
        type?: string;
        plan?: { content: string };
    };
    /** Suggested hierarchy parent for a new item */
    parentId?: string;
    /** Suggested type for a new item */
    itemType?: WorkItemType;
    /** Called after successful creation with the new work item */
    onCreated?: (item: Record<string, unknown>) => void;
    /** Called after successful improvement (caller should re-fetch) */
    onImproved?: () => void;
}

interface DraftWorkItem {
    title: string;
    description: string;
    priority: 'high' | 'normal' | 'low';
    type: string;
    tags: string;
    successCriteria: string;
}

interface DraftChildTask {
    title: string;
    description: string;
    type: string;
}

const EMPTY_DRAFT: DraftWorkItem = {
    title: '',
    description: '',
    priority: 'normal',
    type: 'work-item',
    tags: '',
    successCriteria: '',
};

/** Maximum clarification rounds (mirrors server constant). */
const MAX_CLARIFICATION_ROUNDS = 3;

const TAB_TEST_IDS: Record<string, string> = {
    'work-item': 'ai-composer-tab-work-item',
    'goal': 'ai-composer-tab-goal',
    'child-tasks': 'ai-composer-tab-child-tasks',
};

// ─── Main component ──────────────────────────────────────────────────────────

export function WorkItemAiComposer({
    open,
    onClose,
    workspaceId,
    originId,
    mode,
    existingItem,
    parentId,
    itemType,
    onCreated,
    onImproved,
}: WorkItemAiComposerProps) {
    const cloneClient = useCocClient(workspaceId); // AC-07: AI compose/create/improve on the selected clone's server.
    const workItemOriginId = originId ?? resolveWorkItemOriginId({ workspaceId });
    const [phase, setPhase] = useState<Phase>('idle');

    // Prompt & clarification
    const [prompt, setPrompt] = useState('');
    const [clarifyQuestions, setClarifyQuestions] = useState<string[]>([]);
    const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([]);
    const [clarifyCount, setClarifyCount] = useState(0);

    // Draft preview
    const [draftWorkItem, setDraftWorkItem] = useState<DraftWorkItem>({ ...EMPTY_DRAFT });
    const [draftGoal, setDraftGoal] = useState('');
    const [draftChildTasks, setDraftChildTasks] = useState<DraftChildTask[]>([]);
    const [activeTab, setActiveTab] = useState<PreviewTab>('work-item');

    // Error
    const [error, setError] = useState<string | null>(null);

    const hierarchyEnabled = isWorkItemsHierarchyEnabled();

    // Reset state whenever the dialog opens
    useEffect(() => {
        if (open) {
            setPhase('idle');
            setPrompt('');
            setClarifyQuestions([]);
            setClarifyAnswers([]);
            setClarifyCount(0);
            setDraftWorkItem({ ...EMPTY_DRAFT, type: itemType ?? 'work-item' });
            setDraftGoal('');
            setDraftChildTasks([]);
            setActiveTab('work-item');
            setError(null);
        }
    }, [open, itemType]);

    // Apply a draft response from the API into local editable state
    const applyDraft = useCallback((resp: WorkItemAiDraftResult) => {
        const wi = resp.workItem;
        setDraftWorkItem({
            title: wi.title ?? '',
            description: wi.description ?? '',
            priority: wi.priority ?? 'normal',
            type: wi.type ?? itemType ?? 'work-item',
            tags: (wi.tags ?? []).join(', '),
            successCriteria: wi.successCriteria ?? '',
        });
        setDraftGoal(resp.goal ?? wi.plan ?? '');
        setDraftChildTasks(
            (resp.childTasks ?? []).map(ct => ({
                title: ct.title,
                description: ct.description ?? '',
                type: ct.type ?? 'work-item',
            })),
        );
        setActiveTab('work-item');
        setPhase('preview');
    }, [itemType]);

    // Call the AI API to generate a draft or ask clarification
    const handleGenerate = useCallback(async (forceDraft = false) => {
        if (!prompt.trim()) {
            setError('Please describe what you want to build');
            return;
        }
        setError(null);
        setPhase('generating');

        const effectiveClarifyCount = forceDraft ? MAX_CLARIFICATION_ROUNDS : clarifyCount;

        try {
            let resp: WorkItemAiGenerationResponse;

            if (mode === 'create') {
                resp = await cloneClient.workItems.aiDraftForOrigin(workItemOriginId, {
                    prompt: prompt.trim(),
                    type: (itemType as WorkItemType) ?? 'work-item',
                    parentId: parentId ?? undefined,
                    clarificationAnswers: clarifyAnswers.length > 0 ? clarifyAnswers : undefined,
                    clarificationCount: effectiveClarifyCount,
                }, { workspaceId });
            } else {
                resp = await cloneClient.workItems.aiImproveForOrigin(workItemOriginId, existingItem!.id, {
                    prompt: prompt.trim(),
                    targets: ['fields', 'goal', 'childTasks'],
                    clarificationAnswers: clarifyAnswers.length > 0 ? clarifyAnswers : undefined,
                    clarificationCount: effectiveClarifyCount,
                }, { workspaceId });
            }

            if (resp.kind === 'clarification') {
                setClarifyQuestions(resp.questions);
                setClarifyAnswers(new Array(resp.questions.length).fill(''));
                setClarifyCount(resp.clarificationCount + 1);
                setPhase('clarifying');
            } else {
                applyDraft(resp);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate draft');
            // Restore the previous phase so the user can retry
            setPhase(clarifyCount > 0 ? 'clarifying' : 'idle');
        }
    }, [prompt, mode, workspaceId, workItemOriginId, existingItem, itemType, parentId, clarifyAnswers, clarifyCount, applyDraft, cloneClient]);

    // Persist the approved draft via the standard create/update/plan routes
    const handleApprove = useCallback(async () => {
        setPhase('saving');
        setError(null);

        try {
            const tags = draftWorkItem.tags
                .split(',')
                .map(t => t.trim())
                .filter(Boolean);

            if (mode === 'create') {
                // When hierarchy is disabled, fold child tasks into the plan as a checklist
                let planContent = draftGoal;
                if (draftChildTasks.length > 0 && !hierarchyEnabled) {
                    const checklist = draftChildTasks
                        .filter(ct => ct.title.trim())
                        .map(ct =>
                            `- [ ] ${ct.title}${ct.description ? `\n  ${ct.description}` : ''}`
                        )
                        .join('\n');
                    planContent = planContent
                        ? `${planContent}\n\n## Tasks\n${checklist}`
                        : `## Tasks\n${checklist}`;
                }

                const created = await cloneClient.workItems.createForOrigin(workItemOriginId, {
                    title: draftWorkItem.title,
                    description: draftWorkItem.description || undefined,
                    priority: draftWorkItem.priority,
                    tags: tags.length > 0 ? tags : undefined,
                    type: draftWorkItem.type as WorkItemType,
                    successCriteria:
                        draftWorkItem.type === 'goal' && draftWorkItem.successCriteria
                            ? draftWorkItem.successCriteria
                            : undefined,
                    parentId: hierarchyEnabled && parentId ? parentId : undefined,
                    source: 'manual',
                    plan: planContent ? { content: planContent } : undefined,
                }, { workspaceId });

                // Create child leaf items when hierarchy is enabled
                if (hierarchyEnabled && draftChildTasks.length > 0) {
                    for (const child of draftChildTasks) {
                        if (!child.title.trim()) continue;
                        await cloneClient.workItems.createForOrigin(workItemOriginId, {
                            title: child.title.trim(),
                            description: child.description || undefined,
                            type: (child.type as WorkItemType) || 'work-item',
                            parentId: created.id,
                            source: 'manual',
                        }, { workspaceId });
                    }
                }

                onCreated?.(created as Record<string, unknown>);
                onClose();
            } else {
                // improve mode — patch the changed fields
                await cloneClient.workItems.updateForOrigin(workItemOriginId, existingItem!.id, {
                    title: draftWorkItem.title,
                    description: draftWorkItem.description,
                    priority: draftWorkItem.priority,
                    tags: tags.length > 0 ? tags : [],
                    ...(draftGoal && draftGoal !== existingItem?.plan?.content ? { plan: { content: draftGoal } } : {}),
                }, { workspaceId });

                onImproved?.();
                onClose();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
            setPhase('preview');
        }
    }, [
        mode, workspaceId, workItemOriginId, existingItem, parentId, hierarchyEnabled,
        draftWorkItem, draftGoal, draftChildTasks,
        onCreated, onImproved, onClose, cloneClient,
    ]);

    const isBusy = phase === 'generating' || phase === 'saving';
    const isApproveVisible = phase === 'preview' || phase === 'saving';
    const hasGoal = draftGoal.trim().length > 0;
    const hasChildTasks = draftChildTasks.length > 0;

    const dialogTitle = mode === 'create' ? '✨ Create with AI' : '✨ Improve with AI';
    const approveLabel = phase === 'saving'
        ? 'Saving…'
        : mode === 'create' ? 'Approve & Create' : 'Approve & Update';

    // ── Left panel ────────────────────────────────────────────────────────────

    const leftPanel = (
        <div className="flex flex-col gap-3 h-full" data-testid="ai-composer-left">
            {/* Context block (improve mode) */}
            {mode === 'improve' && existingItem && (
                <div className="text-xs text-[#848484] dark:text-[#999] bg-[#f0f0f0] dark:bg-[#2a2a2a] rounded p-2" data-testid="ai-composer-context">
                    <span className="font-medium">Improving:</span>{' '}
                    <span className="text-[#3c3c3c] dark:text-[#ccc] truncate">{existingItem.title}</span>
                </div>
            )}

            {/* Prompt textarea */}
            <div className="flex-1 flex flex-col gap-1">
                <label className="text-xs font-medium text-[#848484] dark:text-[#999]">
                    {mode === 'create' ? 'Describe what you want to build' : 'What would you like to improve?'}
                </label>
                <textarea
                    className="flex-1 min-h-[80px] rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder={mode === 'create'
                        ? 'E.g. "Add a dark mode toggle to the settings page…"'
                        : 'E.g. "Make the description more concrete, add acceptance criteria…"'
                    }
                    disabled={isBusy}
                    data-testid="ai-composer-prompt"
                />
            </div>

            {/* Error block */}
            {error && (
                <div
                    className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded p-2 flex items-start gap-2"
                    data-testid="ai-composer-error"
                >
                    <span className="flex-1">{error}</span>
                    <button className="text-[10px] shrink-0" onClick={() => setError(null)} aria-label="Dismiss error">✕</button>
                </div>
            )}

            {/* Clarification Q&A */}
            {phase === 'clarifying' && clarifyQuestions.length > 0 && (
                <div className="space-y-2" data-testid="ai-composer-clarification">
                    <p className="text-xs font-medium text-[#616161] dark:text-[#999]">
                        A few quick questions ({clarifyCount}/{MAX_CLARIFICATION_ROUNDS}):
                    </p>
                    {clarifyQuestions.map((q, i) => (
                        <div key={i} className="space-y-0.5">
                            <p className="text-xs text-[#3c3c3c] dark:text-[#ccc]">{q}</p>
                            <textarea
                                className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-xs text-[#1e1e1e] dark:text-[#cccccc] p-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                rows={2}
                                value={clarifyAnswers[i] ?? ''}
                                onChange={e => {
                                    const next = [...clarifyAnswers];
                                    next[i] = e.target.value;
                                    setClarifyAnswers(next);
                                }}
                                placeholder="Your answer…"
                                disabled={isBusy}
                                data-testid={`ai-composer-clarify-answer-${i}`}
                            />
                        </div>
                    ))}
                </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-1.5">
                {phase === 'clarifying' && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleGenerate(true)}
                        disabled={isBusy}
                        data-testid="ai-composer-generate-anyway-btn"
                    >
                        Generate draft anyway
                    </Button>
                )}
                <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleGenerate(false)}
                    disabled={isBusy || !prompt.trim()}
                    loading={phase === 'generating'}
                    data-testid="ai-composer-generate-btn"
                >
                    {phase === 'clarifying' ? 'Continue' : phase === 'preview' ? 'Regenerate' : 'Generate'}
                </Button>
            </div>
        </div>
    );

    // ── Right panel ───────────────────────────────────────────────────────────

    const previewTabs: { id: PreviewTab; label: string; visible: boolean }[] = [
        { id: 'work-item', label: 'Work Item', visible: true },
        { id: 'goal', label: 'Goal / Plan', visible: hasGoal },
        {
            id: 'child-tasks',
            label: hierarchyEnabled ? 'Child Tasks' : 'Task Checklist',
            visible: hasChildTasks,
        },
    ];
    const visibleTabs = previewTabs.filter(t => t.visible);

    const rightPanel = (
        <div className="flex flex-col h-full gap-2" data-testid="ai-composer-right">
            {(phase === 'idle' || phase === 'generating') ? (
                <div className="flex-1 flex items-center justify-center text-sm text-[#848484]" data-testid="ai-composer-preview-empty">
                    {phase === 'generating' ? (
                        <div className="flex flex-col items-center gap-2">
                            <Spinner size="md" />
                            <span>Generating draft…</span>
                        </div>
                    ) : (
                        <div className="text-center space-y-1">
                            <div className="text-2xl">✨</div>
                            <div>Enter a description and click Generate to see a draft</div>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    {/* Tab bar */}
                    {visibleTabs.length > 1 && (
                        <div className="flex gap-0.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]" role="tablist" data-testid="ai-composer-tabs">
                            {visibleTabs.map(tab => (
                                <button
                                    key={tab.id}
                                    role="tab"
                                    aria-selected={activeTab === tab.id}
                                    className={cn(
                                        'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
                                        activeTab === tab.id
                                            ? 'border-b-2 border-[#0078d4] text-[#0078d4] dark:text-[#3794ff]'
                                            : 'text-[#848484] hover:text-[#3c3c3c] dark:hover:text-[#ccc]',
                                    )}
                                    onClick={() => setActiveTab(tab.id)}
                                    data-testid={TAB_TEST_IDS[tab.id] ?? `ai-composer-tab-${tab.id}`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Tab content */}
                    <div className="flex-1 overflow-y-auto space-y-2" data-testid="ai-composer-preview-content">
                        {activeTab === 'work-item' && (
                            <div className="space-y-2" data-testid="ai-composer-work-item-tab">
                                <div>
                                    <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Title *</label>
                                    <input
                                        type="text"
                                        className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                        value={draftWorkItem.title}
                                        onChange={e => setDraftWorkItem(d => ({ ...d, title: e.target.value }))}
                                        disabled={phase === 'saving'}
                                        data-testid="ai-composer-preview-title"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Description</label>
                                    <textarea
                                        className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                        rows={4}
                                        value={draftWorkItem.description}
                                        onChange={e => setDraftWorkItem(d => ({ ...d, description: e.target.value }))}
                                        disabled={phase === 'saving'}
                                        data-testid="ai-composer-preview-description"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Priority</label>
                                        <select
                                            className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                            value={draftWorkItem.priority}
                                            onChange={e => setDraftWorkItem(d => ({ ...d, priority: e.target.value as 'high' | 'normal' | 'low' }))}
                                            disabled={phase === 'saving'}
                                            data-testid="ai-composer-preview-priority"
                                        >
                                            <option value="normal">Normal</option>
                                            <option value="high">High</option>
                                            <option value="low">Low</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Type</label>
                                        <select
                                            className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                            value={draftWorkItem.type}
                                            onChange={e => setDraftWorkItem(d => ({ ...d, type: e.target.value }))}
                                            disabled={phase === 'saving'}
                                            data-testid="ai-composer-preview-type"
                                        >
                                            <option value="work-item">Work Item</option>
                                            <option value="bug">Bug</option>
                                            <option value="goal">Goal</option>
                                            <option value="pbi">PBI / Story</option>
                                            <option value="feature">Feature</option>
                                            <option value="epic">Epic</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Tags</label>
                                    <input
                                        type="text"
                                        className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                        value={draftWorkItem.tags}
                                        onChange={e => setDraftWorkItem(d => ({ ...d, tags: e.target.value }))}
                                        placeholder="Comma-separated tags"
                                        disabled={phase === 'saving'}
                                        data-testid="ai-composer-preview-tags"
                                    />
                                </div>
                                {draftWorkItem.type === 'goal' && (
                                    <div>
                                        <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Success Criteria</label>
                                        <textarea
                                            className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                            rows={3}
                                            value={draftWorkItem.successCriteria}
                                            onChange={e => setDraftWorkItem(d => ({ ...d, successCriteria: e.target.value }))}
                                            disabled={phase === 'saving'}
                                            data-testid="ai-composer-preview-success-criteria"
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'goal' && (
                            <div data-testid="ai-composer-goal-tab">
                                <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">
                                    Goal / Plan (markdown)
                                </label>
                                <textarea
                                    className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 resize-none font-mono focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                    rows={14}
                                    value={draftGoal}
                                    onChange={e => setDraftGoal(e.target.value)}
                                    disabled={phase === 'saving'}
                                    data-testid="ai-composer-preview-goal"
                                />
                            </div>
                        )}

                        {activeTab === 'child-tasks' && (
                            <div className="space-y-2" data-testid="ai-composer-child-tasks-tab">
                                {!hierarchyEnabled && (
                                    <p className="text-xs text-[#848484] dark:text-[#999] bg-[#f5f5f5] dark:bg-[#2a2a2a] rounded p-2">
                                        ℹ️ Hierarchy is disabled — these tasks will be added as a checklist in the plan.
                                    </p>
                                )}
                                {draftChildTasks.map((task, i) => (
                                    <div key={i} className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-2 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                className="flex-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-1.5 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                                value={task.title}
                                                onChange={e => {
                                                    const next = [...draftChildTasks];
                                                    next[i] = { ...next[i], title: e.target.value };
                                                    setDraftChildTasks(next);
                                                }}
                                                placeholder="Child task title"
                                                disabled={phase === 'saving'}
                                                data-testid={`ai-composer-child-task-title-${i}`}
                                            />
                                            <button
                                                className="text-[#848484] hover:text-red-500 text-xs shrink-0"
                                                onClick={() => setDraftChildTasks(ts => ts.filter((_, j) => j !== i))}
                                                disabled={phase === 'saving'}
                                                aria-label="Remove task"
                                                data-testid={`ai-composer-child-task-remove-${i}`}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <input
                                            type="text"
                                            className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-xs text-[#1e1e1e] dark:text-[#cccccc] p-1.5 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                            value={task.description}
                                            onChange={e => {
                                                const next = [...draftChildTasks];
                                                next[i] = { ...next[i], description: e.target.value };
                                                setDraftChildTasks(next);
                                            }}
                                            placeholder="Description (optional)"
                                            disabled={phase === 'saving'}
                                            data-testid={`ai-composer-child-task-desc-${i}`}
                                        />
                                    </div>
                                ))}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDraftChildTasks(ts => [...ts, { title: '', description: '', type: 'work-item' }])}
                                    disabled={phase === 'saving'}
                                    data-testid="ai-composer-add-child-task-btn"
                                >
                                    + Add task
                                </Button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <Dialog
            open={open}
            onClose={isBusy ? undefined : onClose}
            title={dialogTitle}
            className="max-w-[900px]"
            id="work-item-ai-composer"
            footer={
                <>
                    <Button
                        variant="secondary"
                        onClick={onClose}
                        disabled={isBusy}
                        data-testid="ai-composer-cancel-btn"
                    >
                        Cancel
                    </Button>
                    {isApproveVisible && (
                        <Button
                            variant="primary"
                            onClick={handleApprove}
                            disabled={isBusy || !draftWorkItem.title.trim()}
                            loading={phase === 'saving'}
                            data-testid="ai-composer-approve-btn"
                        >
                            {approveLabel}
                        </Button>
                    )}
                </>
            }
        >
            {/* Two-column layout: left (prompt) + right (preview) */}
            <div className="flex gap-4 h-[55vh] min-h-0">
                {/* Left: prompt + clarification (40%) */}
                <div className="w-[38%] shrink-0 flex flex-col min-h-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] pr-4">
                    {leftPanel}
                </div>

                {/* Right: editable preview (60%) */}
                <div className="flex-1 min-w-0 flex flex-col min-h-0">
                    {rightPanel}
                </div>
            </div>
        </Dialog>
    );
}
