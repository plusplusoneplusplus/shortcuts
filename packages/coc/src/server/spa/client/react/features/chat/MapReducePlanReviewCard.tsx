import type {
    MapReduceChildMode,
    MapReduceItem,
    MapReducePlanArtifact,
    MapReducePlanScanResult,
} from '@plusplusoneplusplus/coc-client';
import {
    DEFAULT_MAP_REDUCE_MAX_PARALLEL,
    assertMapReduceDraftStatuses,
    normalizeMapReduceMaxParallel,
    normalizeMapReducePlanItems,
    normalizeMapReduceReduceInstructions,
    scanMapReducePlanArtifacts,
    validateMapReduceDraftPlan,
} from '@plusplusoneplusplus/coc-client';
import type { ClientConversationTurn } from '../../types/dashboard';
import { cn } from '../../ui/cn';
import {
    TaskGroupPlanReviewCard,
    type TaskGroupPlanApproveArgs,
    type TaskGroupPlanReviewConfig,
} from './TaskGroupPlanReviewCard';

export interface MapReduceGenerationMetadata {
    kind: 'generation';
    workspaceId: string;
    generationId: string;
    childMode: MapReduceChildMode;
    originalRequest: string;
    status: 'draft' | 'approved';
    runId?: string;
    latestItemCount?: number;
    latestPlanTurnIndex?: number;
    latestPlan?: {
        turnIndex: number;
        items: MapReduceItem[];
        childMode: MapReduceChildMode;
        sharedInstructions?: string;
        reduceInstructions: string;
        maxParallel: number;
        rawJson?: string;
        updatedAt?: string;
    };
    lastPlanError?: string;
    lastPlanErrorTurnIndex?: number;
}

interface DraftPlan {
    items: MapReduceItem[];
    sharedInstructions: string;
    reduceInstructions: string;
    maxParallel: number;
    childMode: MapReduceChildMode;
}

export interface MapReducePlanReviewCardProps {
    workspaceId?: string;
    processId?: string | null;
    metadataProcess: any;
    mapReduce: MapReduceGenerationMetadata;
    turns: ClientConversationTurn[];
    provider?: 'copilot' | 'codex' | 'claude' | 'opencode';
    model?: string;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    onApprovedRun?: (runId: string) => void;
}

export function scanMapReducePlans(turns: ClientConversationTurn[]): MapReducePlanScanResult {
    return scanMapReducePlanArtifacts(turns);
}

function formatDraftJson(draft: DraftPlan): string {
    return JSON.stringify({
        childMode: draft.childMode,
        sharedInstructions: draft.sharedInstructions || undefined,
        maxParallel: draft.maxParallel,
        reduceInstructions: draft.reduceInstructions,
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
        throw new Error('Advanced JSON must be an object with childMode, maxParallel, reduceInstructions, sharedInstructions, and items');
    }
    const record = parsed as { childMode?: unknown; sharedInstructions?: unknown };
    const validation = validateMapReduceDraftPlan(parsed);
    if (validation.error || !validation.plan) {
        throw new Error(validation.error ?? 'Invalid Map Reduce plan');
    }
    const childMode = record.childMode === 'ask' || record.childMode === 'autopilot' ? record.childMode : 'ask';
    const sharedInstructions = typeof record.sharedInstructions === 'string' ? record.sharedInstructions : '';
    return {
        childMode,
        sharedInstructions,
        items: validation.plan.items,
        reduceInstructions: validation.plan.reduceInstructions,
        maxParallel: validation.plan.maxParallel,
    };
}

function isMapReduceGenerationMetadata(value: unknown): value is MapReduceGenerationMetadata {
    return !!value
        && typeof value === 'object'
        && (value as { kind?: unknown }).kind === 'generation';
}

function getPersistedPlanState(mapReduce: MapReduceGenerationMetadata): MapReducePlanScanResult {
    const latestPlan = mapReduce.latestPlan;
    let plan: MapReducePlanArtifact | null = null;
    let error: { turnIndex: number; message: string } | null = null;

    if (latestPlan) {
        try {
            const items = normalizeMapReducePlanItems(latestPlan.items);
            assertMapReduceDraftStatuses(items);
            const childMode = latestPlan.childMode === 'ask' || latestPlan.childMode === 'autopilot'
                ? latestPlan.childMode
                : undefined;
            const sharedInstructions = typeof latestPlan.sharedInstructions === 'string'
                ? latestPlan.sharedInstructions
                : undefined;
            const reduceInstructions = normalizeMapReduceReduceInstructions(latestPlan.reduceInstructions);
            const maxParallel = normalizeMapReduceMaxParallel(latestPlan.maxParallel);
            plan = {
                turnIndex: latestPlan.turnIndex,
                items,
                reduceInstructions,
                maxParallel,
                rawJson: typeof latestPlan.rawJson === 'string'
                    ? latestPlan.rawJson
                    : formatDraftJson({
                        childMode: latestPlan.childMode,
                        sharedInstructions: sharedInstructions ?? '',
                        maxParallel,
                        reduceInstructions,
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

    if (mapReduce.lastPlanError) {
        error = {
            turnIndex: mapReduce.lastPlanErrorTurnIndex ?? mapReduce.latestPlanTurnIndex ?? plan?.turnIndex ?? 0,
            message: mapReduce.lastPlanError,
        };
    }

    return { plan, error };
}

async function approve({
    client,
    workspaceId,
    processId,
    meta: mapReduce,
    metadataProcess,
    draft,
    scanPlanTurnIndex,
    provider,
    model,
    reasoningEffort,
}: TaskGroupPlanApproveArgs<DraftPlan, MapReduceGenerationMetadata>) {
    const run = mapReduce.runId
        ? await client.mapReduce.updatePlan(workspaceId, mapReduce.runId, {
            items: draft.items,
            sharedInstructions: draft.sharedInstructions,
            reduceInstructions: draft.reduceInstructions,
            maxParallel: draft.maxParallel,
            childMode: draft.childMode,
        })
        : await client.mapReduce.create(workspaceId, {
            originalRequest: mapReduce.originalRequest,
            items: draft.items,
            sharedInstructions: draft.sharedInstructions,
            reduceInstructions: draft.reduceInstructions,
            maxParallel: draft.maxParallel,
            childMode: draft.childMode,
            provider,
            config: model || reasoningEffort ? { ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) } : undefined,
            generationProcessId: processId,
            generationId: mapReduce.generationId,
        });
    const approved = run.status === 'approved'
        ? run
        : await client.mapReduce.approve(workspaceId, run.runId);

    const currentMetadata = (metadataProcess?.metadata ?? {}) as Record<string, unknown>;
    const currentMapReduce = isMapReduceGenerationMetadata(currentMetadata.mapReduce) ? currentMetadata.mapReduce : mapReduce;
    const nextMapReduce: MapReduceGenerationMetadata = {
        ...currentMapReduce,
        status: 'approved',
        runId: approved.runId,
        latestItemCount: approved.items.length,
        latestPlanTurnIndex: scanPlanTurnIndex,
        latestPlan: {
            turnIndex: scanPlanTurnIndex ?? currentMapReduce.latestPlan?.turnIndex ?? 0,
            childMode: draft.childMode,
            sharedInstructions: draft.sharedInstructions || undefined,
            reduceInstructions: draft.reduceInstructions,
            maxParallel: draft.maxParallel,
            items: draft.items,
            rawJson: formatDraftJson(draft),
            updatedAt: new Date().toISOString(),
        },
    };
    delete nextMapReduce.lastPlanError;
    delete nextMapReduce.lastPlanErrorTurnIndex;
    await client.processes.patchMetadata(processId, {
        set: { mapReduce: nextMapReduce },
    }, { workspace: workspaceId });
    return approved;
}

const MAP_REDUCE_PLAN_CONFIG: TaskGroupPlanReviewConfig<DraftPlan, MapReduceGenerationMetadata> = {
    testIdPrefix: 'map-reduce',
    heading: 'Proposed Map Reduce plan',
    itemNoun: 'map item',
    addItemLabel: 'Add map item',
    description: 'Review and approve only. Map and reduce child chats start later from the Map Reduce run pane.',
    scanErrorNoun: 'Map Reduce plan',
    noPlanText: 'No valid Map Reduce plan is available yet.',
    approveErrorFallback: 'Failed to approve Map Reduce plan',
    topGridClassName: 'md:grid-cols-[minmax(0,1fr)_9rem_auto]',
    accent: {
        card: 'border-indigo-200 bg-indigo-50/70 dark:border-indigo-900/60 dark:bg-indigo-950/20',
        headingText: 'text-indigo-900 dark:text-indigo-100',
        pill: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-100',
        subText: 'text-indigo-800/80 dark:text-indigo-200/80',
        openRunButton: 'border-indigo-300 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100 dark:hover:bg-indigo-900/60',
        editorBorder: 'border-indigo-200 dark:border-indigo-900',
        childModeActive: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-100',
        hairlineBorder: 'border-indigo-100 dark:border-indigo-900/70',
        addItemButton: 'border-indigo-300 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100',
        jsonSummaryText: 'text-indigo-800 dark:text-indigo-100',
        approveButton: 'bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 dark:disabled:bg-indigo-900',
    },
    scanTranscript: scanMapReducePlans,
    getPersistedPlanState,
    buildDraft: (plan: MapReducePlanArtifact, mapReduce) => ({
        childMode: plan.childMode ?? mapReduce.childMode ?? 'ask',
        sharedInstructions: plan.sharedInstructions ?? '',
        reduceInstructions: plan.reduceInstructions,
        maxParallel: plan.maxParallel ?? DEFAULT_MAP_REDUCE_MAX_PARALLEL,
        items: plan.items,
    }),
    formatDraftJson,
    parseDraftJson,
    validate: draft => {
        const checked = validateMapReduceDraftPlan({
            items: draft.items,
            reduceInstructions: draft.reduceInstructions,
            maxParallel: draft.maxParallel,
        });
        if (checked.error || !checked.plan) {
            return { draft: null, error: checked.error ?? 'Invalid Map Reduce plan' };
        }
        return {
            draft: {
                ...draft,
                items: checked.plan.items,
                reduceInstructions: checked.plan.reduceInstructions,
                maxParallel: checked.plan.maxParallel,
            },
            error: null,
        };
    },
    approve,
    renderHeaderPills: draft => (
        <span
            className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-100')}
            data-testid="map-reduce-plan-max-parallel-pill"
        >
            max {draft.maxParallel} parallel
        </span>
    ),
    renderExtraTopFields: (draft, applyDraft) => (
        <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-indigo-900 dark:text-indigo-100">Max parallel</span>
            <input
                type="number"
                min={1}
                step={1}
                value={draft.maxParallel}
                onChange={(e) => applyDraft({ ...draft, maxParallel: Number(e.target.value) })}
                className="w-full rounded border border-indigo-200 bg-white px-2 py-1 text-xs dark:border-indigo-900 dark:bg-zinc-950"
                data-testid="map-reduce-max-parallel-editor"
            />
        </label>
    ),
    renderExtraSections: (draft, applyDraft) => (
        <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-indigo-900 dark:text-indigo-100">Reduce instructions</span>
            <textarea
                value={draft.reduceInstructions}
                onChange={(e) => applyDraft({ ...draft, reduceInstructions: e.target.value })}
                rows={3}
                className="w-full resize-y rounded border border-indigo-200 bg-white p-2 text-xs text-zinc-900 dark:border-indigo-900 dark:bg-zinc-950 dark:text-zinc-100"
                data-testid="map-reduce-reduce-instructions-editor"
            />
        </label>
    ),
};

export function MapReducePlanReviewCard({ mapReduce, ...rest }: MapReducePlanReviewCardProps) {
    return <TaskGroupPlanReviewCard {...rest} meta={mapReduce} config={MAP_REDUCE_PLAN_CONFIG} />;
}
