import { useEffect, useMemo, useState } from 'react';
import type {
    MapReduceChildMode,
    MapReduceItem,
    MapReducePlanArtifact,
    MapReducePlanScanResult,
    MapReduceRun,
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
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useCocClient } from '../../repos/cloneRouting';
import { cn } from '../../ui/cn';

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

function itemDependencyText(item: MapReduceItem): string {
    return (item.dependsOn ?? []).join(', ');
}

function parseDependencies(value: string): string[] | undefined {
    const deps = value.split(',').map(part => part.trim()).filter(Boolean);
    return deps.length > 0 ? deps : undefined;
}

function makeNewItem(existing: MapReduceItem[]): MapReduceItem {
    const used = new Set(existing.map(item => item.id));
    let index = existing.length + 1;
    let id = `item-${index}`;
    while (used.has(id)) {
        index += 1;
        id = `item-${index}`;
    }
    return {
        id,
        title: `Item ${index}`,
        prompt: '',
        status: 'pending',
    };
}

function isMapReduceGenerationMetadata(value: unknown): value is MapReduceGenerationMetadata {
    return !!value
        && typeof value === 'object'
        && (value as { kind?: unknown }).kind === 'generation';
}

function planJson(plan: Pick<DraftPlan, 'childMode' | 'sharedInstructions' | 'maxParallel' | 'reduceInstructions' | 'items'>): string {
    return JSON.stringify({
        childMode: plan.childMode,
        sharedInstructions: plan.sharedInstructions || undefined,
        maxParallel: plan.maxParallel,
        reduceInstructions: plan.reduceInstructions,
        items: plan.items,
    }, null, 2);
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
                    : planJson({
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

function latestScanTurn(scan: MapReducePlanScanResult): number {
    return Math.max(scan.plan?.turnIndex ?? -1, scan.error?.turnIndex ?? -1);
}

export function MapReducePlanReviewCard({
    workspaceId,
    processId,
    metadataProcess,
    mapReduce,
    turns,
    provider,
    model,
    reasoningEffort,
    onApprovedRun,
}: MapReducePlanReviewCardProps) {
    // AC-07: plan create/update/approve route to the selected clone's server.
    const cloneClient = useCocClient(workspaceId);
    const transcriptScan = useMemo(() => scanMapReducePlans(turns), [turns]);
    const persistedScan = useMemo(() => getPersistedPlanState(mapReduce), [mapReduce]);
    const scan = latestScanTurn(transcriptScan) > latestScanTurn(persistedScan)
        ? transcriptScan
        : persistedScan.plan || persistedScan.error
            ? persistedScan
            : transcriptScan;
    const generatedKey = scan.plan ? `${scan.plan.turnIndex}:${scan.plan.rawJson}` : 'none';
    const [loadedKey, setLoadedKey] = useState('');
    const [baselineJson, setBaselineJson] = useState('');
    const [draft, setDraft] = useState<DraftPlan | null>(null);
    const [jsonOpen, setJsonOpen] = useState(false);
    const [jsonText, setJsonText] = useState('');
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [approvedRun, setApprovedRun] = useState<MapReduceRun | null>(null);

    useEffect(() => {
        if (!scan.plan || generatedKey === loadedKey) return;
        const nextDraft: DraftPlan = {
            childMode: scan.plan.childMode ?? mapReduce.childMode ?? 'ask',
            sharedInstructions: scan.plan.sharedInstructions ?? '',
            reduceInstructions: scan.plan.reduceInstructions,
            maxParallel: scan.plan.maxParallel ?? DEFAULT_MAP_REDUCE_MAX_PARALLEL,
            items: scan.plan.items,
        };
        const formatted = formatDraftJson(nextDraft);
        setDraft(nextDraft);
        setBaselineJson(formatted);
        setJsonText(formatted);
        setJsonError(null);
        setLoadedKey(generatedKey);
        setError(null);
    }, [generatedKey, loadedKey, mapReduce.childMode, scan.plan]);

    if (!scan.plan && !scan.error) return null;

    const validation = draft
        ? validateMapReduceDraftPlan({
            items: draft.items,
            reduceInstructions: draft.reduceInstructions,
            maxParallel: draft.maxParallel,
        })
        : { plan: null, error: 'No valid Map Reduce plan is available yet.' };
    const currentJson = draft ? formatDraftJson(draft) : '';
    const dirty = draft ? currentJson !== baselineJson : false;
    const approvalBlocked = busy || !!jsonError || !!validation.error || !draft || !workspaceId || !processId || mapReduce.status === 'approved' || !!approvedRun;
    const linkedRunId = approvedRun?.runId ?? mapReduce.runId;

    function applyDraft(next: DraftPlan) {
        setDraft(next);
        setJsonText(formatDraftJson(next));
        setJsonError(null);
        setError(null);
    }

    function updateItem(index: number, patch: Partial<MapReduceItem>) {
        if (!draft) return;
        applyDraft({
            ...draft,
            items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
        });
    }

    function moveItem(index: number, direction: -1 | 1) {
        if (!draft) return;
        const target = index + direction;
        if (target < 0 || target >= draft.items.length) return;
        const items = [...draft.items];
        const [item] = items.splice(index, 1);
        items.splice(target, 0, item);
        applyDraft({ ...draft, items });
    }

    function removeItem(index: number) {
        if (!draft) return;
        applyDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) });
    }

    function handleJsonChange(value: string) {
        setJsonText(value);
        setError(null);
        try {
            const parsed = parseDraftJson(value);
            setDraft(parsed);
            setJsonError(null);
        } catch (err) {
            setJsonError(err instanceof Error ? err.message : String(err));
        }
    }

    async function approveRun() {
        if (!draft || !workspaceId || !processId) return;
        const checked = validateMapReduceDraftPlan({
            items: draft.items,
            reduceInstructions: draft.reduceInstructions,
            maxParallel: draft.maxParallel,
        });
        if (checked.error || !checked.plan) {
            setError(checked.error ?? 'Invalid Map Reduce plan');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const client = cloneClient;
            const run = mapReduce.runId
                ? await client.mapReduce.updatePlan(workspaceId, mapReduce.runId, {
                    items: checked.plan.items,
                    sharedInstructions: draft.sharedInstructions,
                    reduceInstructions: checked.plan.reduceInstructions,
                    maxParallel: checked.plan.maxParallel,
                    childMode: draft.childMode,
                })
                : await client.mapReduce.create(workspaceId, {
                    originalRequest: mapReduce.originalRequest,
                    items: checked.plan.items,
                    sharedInstructions: draft.sharedInstructions,
                    reduceInstructions: checked.plan.reduceInstructions,
                    maxParallel: checked.plan.maxParallel,
                    childMode: draft.childMode,
                    provider,
                    config: model || reasoningEffort ? { ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) } : undefined,
                    generationProcessId: processId,
                    generationId: mapReduce.generationId,
                });
            const approved = run.status === 'approved'
                ? run
                : await client.mapReduce.approve(workspaceId, run.runId);
            setApprovedRun(approved);

            const currentMetadata = (metadataProcess?.metadata ?? {}) as Record<string, unknown>;
            const currentMapReduce = isMapReduceGenerationMetadata(currentMetadata.mapReduce) ? currentMetadata.mapReduce : mapReduce;
            const nextMapReduce: MapReduceGenerationMetadata = {
                ...currentMapReduce,
                status: 'approved',
                runId: approved.runId,
                latestItemCount: approved.items.length,
                latestPlanTurnIndex: scan.plan?.turnIndex,
                latestPlan: {
                    turnIndex: scan.plan?.turnIndex ?? currentMapReduce.latestPlan?.turnIndex ?? 0,
                    childMode: draft.childMode,
                    sharedInstructions: draft.sharedInstructions || undefined,
                    reduceInstructions: checked.plan.reduceInstructions,
                    maxParallel: checked.plan.maxParallel,
                    items: checked.plan.items,
                    rawJson: formatDraftJson({
                        ...draft,
                        items: checked.plan.items,
                        reduceInstructions: checked.plan.reduceInstructions,
                        maxParallel: checked.plan.maxParallel,
                    }),
                    updatedAt: new Date().toISOString(),
                },
            };
            delete nextMapReduce.lastPlanError;
            delete nextMapReduce.lastPlanErrorTurnIndex;
            await client.processes.patchMetadata(processId, {
                set: { mapReduce: nextMapReduce },
            }, { workspace: workspaceId });
            onApprovedRun?.(approved.runId);
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, 'Failed to approve Map Reduce plan'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <section
            className="mx-4 mb-3 rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 text-xs shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20"
            data-testid="map-reduce-plan-review-card"
        >
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">Proposed Map Reduce plan</h3>
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-100">
                            {draft?.items.length ?? 0} map item{draft?.items.length === 1 ? '' : 's'}
                        </span>
                        {draft && (
                            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-100" data-testid="map-reduce-plan-max-parallel-pill">
                                max {draft.maxParallel} parallel
                            </span>
                        )}
                        {dirty && <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300" data-testid="map-reduce-plan-dirty">Edited</span>}
                    </div>
                    <p className="mt-0.5 text-[11px] text-indigo-800/80 dark:text-indigo-200/80">
                        Review and approve only. Map and reduce child chats start later from the Map Reduce run pane.
                    </p>
                </div>
                {linkedRunId && (
                    <button
                        type="button"
                        className="rounded border border-indigo-300 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100 dark:hover:bg-indigo-900/60"
                        onClick={() => onApprovedRun?.(linkedRunId)}
                        data-testid="map-reduce-open-run-btn"
                    >
                        Open run
                    </button>
                )}
            </div>

            {scan.error && (
                <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="map-reduce-plan-scan-error">
                    Latest assistant output did not contain a valid Map Reduce plan: {scan.error.message}. Keeping the previous valid plan.
                </div>
            )}

            {draft && (
                <div className="mt-3 space-y-3">
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_9rem_auto]">
                        <label className="block">
                            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-indigo-900 dark:text-indigo-100">Shared instructions</span>
                            <textarea
                                value={draft.sharedInstructions}
                                onChange={(e) => applyDraft({ ...draft, sharedInstructions: e.target.value })}
                                rows={2}
                                className="w-full resize-y rounded border border-indigo-200 bg-white p-2 text-xs text-zinc-900 dark:border-indigo-900 dark:bg-zinc-950 dark:text-zinc-100"
                                data-testid="map-reduce-shared-instructions-editor"
                            />
                        </label>
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
                        <div>
                            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-indigo-900 dark:text-indigo-100">Child mode</div>
                            <div className="inline-flex rounded border border-indigo-200 bg-white p-0.5 dark:border-indigo-900 dark:bg-zinc-950" data-testid="map-reduce-plan-child-mode">
                                {(['ask', 'autopilot'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => applyDraft({ ...draft, childMode: mode })}
                                        className={cn(
                                            'rounded px-2 py-1 text-[11px] font-medium',
                                            draft.childMode === mode
                                                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-100'
                                                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900',
                                        )}
                                        data-testid={`map-reduce-plan-child-mode-${mode}`}
                                    >
                                        {mode === 'ask' ? 'Ask' : 'Autopilot'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

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

                    <div className="space-y-2" data-testid="map-reduce-plan-items">
                        {draft.items.map((item, index) => (
                            <div key={`${item.id}:${index}`} className="rounded border border-indigo-100 bg-white p-2 dark:border-indigo-900/70 dark:bg-zinc-950" data-testid={`map-reduce-plan-item-${item.id}`}>
                                <div className="grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)_auto]">
                                    <label className="block">
                                        <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">ID</span>
                                        <input
                                            value={item.id}
                                            onChange={(e) => updateItem(index, { id: e.target.value })}
                                            className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                                            data-testid={`map-reduce-plan-item-id-${index}`}
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Title</span>
                                        <input
                                            value={item.title}
                                            onChange={(e) => updateItem(index, { title: e.target.value })}
                                            className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                                            data-testid={`map-reduce-plan-item-title-${index}`}
                                        />
                                    </label>
                                    <div className="flex items-end gap-1">
                                        <button type="button" onClick={() => moveItem(index, -1)} disabled={index === 0} className="rounded border border-zinc-200 px-2 py-1 text-[11px] disabled:opacity-40 dark:border-zinc-800" data-testid={`map-reduce-plan-item-up-${index}`}>Up</button>
                                        <button type="button" onClick={() => moveItem(index, 1)} disabled={index === draft.items.length - 1} className="rounded border border-zinc-200 px-2 py-1 text-[11px] disabled:opacity-40 dark:border-zinc-800" data-testid={`map-reduce-plan-item-down-${index}`}>Down</button>
                                        <button type="button" onClick={() => removeItem(index)} className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 dark:border-red-900 dark:text-red-200" data-testid={`map-reduce-plan-item-remove-${index}`}>Remove</button>
                                    </div>
                                </div>
                                <label className="mt-2 block">
                                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Prompt</span>
                                    <textarea
                                        value={item.prompt}
                                        onChange={(e) => updateItem(index, { prompt: e.target.value })}
                                        rows={3}
                                        className="w-full resize-y rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                                        data-testid={`map-reduce-plan-item-prompt-${index}`}
                                    />
                                </label>
                                <label className="mt-2 block">
                                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Dependencies</span>
                                    <input
                                        value={itemDependencyText(item)}
                                        onChange={(e) => updateItem(index, { dependsOn: parseDependencies(e.target.value) })}
                                        placeholder="item-1, item-2"
                                        className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                                        data-testid={`map-reduce-plan-item-deps-${index}`}
                                    />
                                </label>
                            </div>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={() => applyDraft({ ...draft, items: [...draft.items, makeNewItem(draft.items)] })}
                        className="rounded border border-indigo-300 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100"
                        data-testid="map-reduce-plan-add-item"
                    >
                        Add map item
                    </button>

                    <details open={jsonOpen} onToggle={(event) => setJsonOpen(event.currentTarget.open)} className="rounded border border-indigo-100 bg-white p-2 dark:border-indigo-900/70 dark:bg-zinc-950">
                        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-100" data-testid="map-reduce-plan-json-toggle">
                            Advanced JSON
                        </summary>
                        <textarea
                            value={jsonText}
                            onChange={(e) => handleJsonChange(e.target.value)}
                            rows={10}
                            className="mt-2 w-full resize-y rounded border border-zinc-200 bg-white p-2 font-mono text-xs text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                            data-testid="map-reduce-plan-json"
                        />
                        {jsonError && (
                            <p className="mt-1 text-[11px] text-red-600 dark:text-red-300" data-testid="map-reduce-plan-json-error">{jsonError}</p>
                        )}
                    </details>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-indigo-100 pt-2 dark:border-indigo-900/70">
                        <div>
                            {validation.error ? (
                                <p className="text-[11px] text-red-600 dark:text-red-300" data-testid="map-reduce-plan-validation-error">{validation.error}</p>
                            ) : (
                                <p className="text-[11px] text-emerald-700 dark:text-emerald-300" data-testid="map-reduce-plan-validation-ok">Plan is valid and ready for approval.</p>
                            )}
                            {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-300" data-testid="map-reduce-plan-approve-error">{error}</p>}
                        </div>
                        <button
                            type="button"
                            onClick={() => void approveRun()}
                            disabled={approvalBlocked}
                            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 dark:disabled:bg-indigo-900"
                            data-testid="map-reduce-plan-approve-btn"
                        >
                            {busy ? 'Approving...' : mapReduce.status === 'approved' || approvedRun ? 'Approved' : 'Approve run'}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}
