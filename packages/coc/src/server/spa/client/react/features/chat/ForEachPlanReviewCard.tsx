import type {
    ForEachChildMode,
    ForEachItem,
    ForEachPlanArtifact,
    ForEachPlanScanResult,
} from '@plusplusoneplusplus/coc-client';
import {
    normalizeForEachPlanItems,
    assertForEachDraftStatuses,
    validateForEachDraftPlan,
    scanForEachPlanArtifacts,
} from '@plusplusoneplusplus/coc-client';
import type { ClientConversationTurn } from '../../types/dashboard';
import {
    TaskGroupPlanReviewCard,
    type TaskGroupPlanApproveArgs,
    type TaskGroupPlanReviewConfig,
} from './TaskGroupPlanReviewCard';

export interface ForEachGenerationMetadata {
    kind: 'generation';
    workspaceId: string;
    generationId: string;
    childMode: ForEachChildMode;
    originalRequest: string;
    status: 'draft' | 'approved';
    runId?: string;
    latestItemCount?: number;
    latestPlanTurnIndex?: number;
    latestPlan?: {
        turnIndex: number;
        items: ForEachItem[];
        childMode: ForEachChildMode;
        sharedInstructions?: string;
        rawJson?: string;
        updatedAt?: string;
    };
    lastPlanError?: string;
    lastPlanErrorTurnIndex?: number;
}

interface DraftPlan {
    items: ForEachItem[];
    sharedInstructions: string;
    childMode: ForEachChildMode;
}

export interface ForEachPlanReviewCardProps {
    workspaceId?: string;
    processId?: string | null;
    metadataProcess: any;
    forEach: ForEachGenerationMetadata;
    turns: ClientConversationTurn[];
    provider?: 'copilot' | 'codex' | 'claude' | 'opencode';
    model?: string;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    onApprovedRun?: (runId: string) => void;
}

export function scanForEachPlans(turns: ClientConversationTurn[]): ForEachPlanScanResult {
    return scanForEachPlanArtifacts(turns);
}

function formatDraftJson(draft: DraftPlan): string {
    return JSON.stringify({
        childMode: draft.childMode,
        sharedInstructions: draft.sharedInstructions || undefined,
        items: draft.items,
    }, null, 2);
}

function parseDraftJson(text: string): DraftPlan {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Advanced JSON must be valid JSON: ${message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Advanced JSON must be an object with childMode, sharedInstructions, and items');
    }
    const record = parsed as { childMode?: unknown; sharedInstructions?: unknown; items?: unknown };
    const childMode = record.childMode === 'ask' || record.childMode === 'autopilot' ? record.childMode : 'ask';
    const sharedInstructions = typeof record.sharedInstructions === 'string' ? record.sharedInstructions : '';
    const validation = validateForEachDraftPlan(record.items);
    if (validation.error || !validation.items) {
        throw new Error(validation.error ?? 'Invalid For Each item plan');
    }
    return { childMode, sharedInstructions, items: validation.items };
}

function isForEachGenerationMetadata(value: unknown): value is ForEachGenerationMetadata {
    return !!value
        && typeof value === 'object'
        && (value as { kind?: unknown }).kind === 'generation';
}

function getPersistedPlanState(forEach: ForEachGenerationMetadata): ForEachPlanScanResult {
    const latestPlan = forEach.latestPlan;
    let plan: ForEachPlanArtifact | null = null;
    let error: { turnIndex: number; message: string } | null = null;

    if (latestPlan) {
        try {
            const items = normalizeForEachPlanItems(latestPlan.items);
            assertForEachDraftStatuses(items);
            const childMode = latestPlan.childMode === 'ask' || latestPlan.childMode === 'autopilot'
                ? latestPlan.childMode
                : undefined;
            const sharedInstructions = typeof latestPlan.sharedInstructions === 'string'
                ? latestPlan.sharedInstructions
                : undefined;
            plan = {
                turnIndex: latestPlan.turnIndex,
                items,
                rawJson: typeof latestPlan.rawJson === 'string'
                    ? latestPlan.rawJson
                    : formatDraftJson({
                        childMode: latestPlan.childMode,
                        sharedInstructions: sharedInstructions ?? '',
                        items,
                    }),
                ...(childMode ? { childMode } : {}),
                ...(sharedInstructions !== undefined ? { sharedInstructions } : {}),
            };
        } catch (err) {
            error = {
                turnIndex: latestPlan.turnIndex,
                message: err instanceof Error ? err.message : String(err),
            };
        }
    }

    if (forEach.lastPlanError) {
        error = {
            turnIndex: forEach.lastPlanErrorTurnIndex ?? forEach.latestPlanTurnIndex ?? plan?.turnIndex ?? 0,
            message: forEach.lastPlanError,
        };
    }

    return { plan, error };
}

async function approve({
    client,
    workspaceId,
    processId,
    meta: forEach,
    metadataProcess,
    draft,
    scanPlanTurnIndex,
    provider,
    model,
    reasoningEffort,
}: TaskGroupPlanApproveArgs<DraftPlan, ForEachGenerationMetadata>) {
    const run = forEach.runId
        ? await client.forEach.updatePlan(workspaceId, forEach.runId, {
            items: draft.items,
            sharedInstructions: draft.sharedInstructions,
            childMode: draft.childMode,
        })
        : await client.forEach.create(workspaceId, {
            originalRequest: forEach.originalRequest,
            items: draft.items,
            sharedInstructions: draft.sharedInstructions,
            childMode: draft.childMode,
            provider,
            config: model || reasoningEffort ? { ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) } : undefined,
            generationProcessId: processId,
            generationId: forEach.generationId,
        });
    const approved = run.status === 'approved'
        ? run
        : await client.forEach.approve(workspaceId, run.runId);

    const currentMetadata = (metadataProcess?.metadata ?? {}) as Record<string, unknown>;
    const currentForEach = isForEachGenerationMetadata(currentMetadata.forEach) ? currentMetadata.forEach : forEach;
    const nextForEach: ForEachGenerationMetadata = {
        ...currentForEach,
        status: 'approved',
        runId: approved.runId,
        latestItemCount: approved.items.length,
        latestPlanTurnIndex: scanPlanTurnIndex,
        latestPlan: {
            turnIndex: scanPlanTurnIndex ?? currentForEach.latestPlan?.turnIndex ?? 0,
            childMode: draft.childMode,
            sharedInstructions: draft.sharedInstructions || undefined,
            items: draft.items,
            rawJson: formatDraftJson(draft),
            updatedAt: new Date().toISOString(),
        },
    };
    delete nextForEach.lastPlanError;
    delete nextForEach.lastPlanErrorTurnIndex;
    await client.processes.patchMetadata(processId, {
        set: { forEach: nextForEach },
    }, { workspace: workspaceId });
    return approved;
}

const FOR_EACH_PLAN_CONFIG: TaskGroupPlanReviewConfig<DraftPlan, ForEachGenerationMetadata> = {
    testIdPrefix: 'for-each',
    heading: 'Proposed For Each item plan',
    itemNoun: 'item',
    addItemLabel: 'Add item',
    description: 'Review and approve only. Child chats start later from the For Each run pane.',
    scanErrorNoun: 'item plan',
    noPlanText: 'No valid For Each item plan is available yet.',
    approveErrorFallback: 'Failed to approve For Each item plan',
    topGridClassName: 'md:grid-cols-[minmax(0,1fr)_auto]',
    accent: {
        card: 'border-sky-200 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/20',
        headingText: 'text-sky-900 dark:text-sky-100',
        pill: 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-100',
        subText: 'text-sky-800/80 dark:text-sky-200/80',
        openRunButton: 'border-sky-300 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900/60',
        editorBorder: 'border-sky-200 dark:border-sky-900',
        childModeActive: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-100',
        hairlineBorder: 'border-sky-100 dark:border-sky-900/70',
        addItemButton: 'border-sky-300 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100',
        jsonSummaryText: 'text-sky-800 dark:text-sky-100',
        approveButton: 'bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 dark:disabled:bg-sky-900',
    },
    scanTranscript: scanForEachPlans,
    getPersistedPlanState,
    buildDraft: (plan: ForEachPlanArtifact, forEach) => ({
        childMode: plan.childMode ?? forEach.childMode ?? 'ask',
        sharedInstructions: plan.sharedInstructions ?? '',
        items: plan.items,
    }),
    formatDraftJson,
    parseDraftJson,
    validate: draft => {
        const checked = validateForEachDraftPlan(draft.items);
        if (checked.error || !checked.items) {
            return { draft: null, error: checked.error ?? 'Invalid For Each item plan' };
        }
        return { draft: { ...draft, items: checked.items }, error: null };
    },
    approve,
};

export function ForEachPlanReviewCard({ forEach, ...rest }: ForEachPlanReviewCardProps) {
    return <TaskGroupPlanReviewCard {...rest} meta={forEach} config={FOR_EACH_PLAN_CONFIG} />;
}
