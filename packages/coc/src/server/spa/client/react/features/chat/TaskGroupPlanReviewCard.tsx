import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { ClientConversationTurn } from '../../types/dashboard';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useCocClient } from '../../repos/cloneRouting';
import { cn } from '../../ui/cn';

/**
 * TaskGroupPlanReviewCard — shared plan-review card for item-based task
 * groups (For Each runs, Map Reduce runs, future group types).
 *
 * The scan merge (transcript vs persisted metadata), draft/JSON editor
 * state machinery, item list editor, and approval flow live here once.
 * Feature cards stay as thin wrappers that supply a
 * {@link TaskGroupPlanReviewConfig} (labels, accent, scan/validate/format
 * adapters, the approve submission, and kind-specific extra fields).
 */

export interface TaskGroupPlanDraftItem {
    id: string;
    title: string;
    prompt: string;
    status?: string;
    dependsOn?: string[];
}

export interface TaskGroupPlanDraftBase {
    /** Feature item type (ForEachItem, MapReduceItem, …); the editor only touches the shared fields. */
    items: any[];
    sharedInstructions: string;
    childMode: 'ask' | 'autopilot';
}

export interface TaskGroupPlanScan {
    plan: { turnIndex: number; rawJson?: string } | null;
    error: { turnIndex: number; message: string } | null;
}

export interface TaskGroupPlanMetadataBase {
    status: 'draft' | 'approved';
    runId?: string;
}

export interface TaskGroupPlanAccent {
    /** Card container border/background. */
    card: string;
    /** Heading + field label text. */
    headingText: string;
    /** Count pill (and other header pills). */
    pill: string;
    /** Muted description text under the heading. */
    subText: string;
    /** "Open run" button. */
    openRunButton: string;
    /** Borders for the shared-instructions/child-mode editors. */
    editorBorder: string;
    /** Active child-mode toggle. */
    childModeActive: string;
    /** Item card / details / footer hairline border. */
    hairlineBorder: string;
    /** "Add item" button. */
    addItemButton: string;
    /** Advanced JSON summary text. */
    jsonSummaryText: string;
    /** Approve button. */
    approveButton: string;
}

export interface TaskGroupPlanApproveArgs<TDraft extends TaskGroupPlanDraftBase, TMeta extends TaskGroupPlanMetadataBase> {
    client: ReturnType<typeof useCocClient>;
    workspaceId: string;
    processId: string;
    meta: TMeta;
    metadataProcess: any;
    /** Draft with validated/normalized fields applied. */
    draft: TDraft;
    scanPlanTurnIndex?: number;
    provider?: 'copilot' | 'codex' | 'claude' | 'opencode';
    model?: string;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
}

export interface TaskGroupPlanReviewConfig<TDraft extends TaskGroupPlanDraftBase, TMeta extends TaskGroupPlanMetadataBase> {
    /** DOM test-id prefix (e.g. 'for-each' → 'for-each-plan-review-card', 'for-each-plan-item-…'). */
    testIdPrefix: string;
    /** Card heading (e.g. 'Proposed For Each item plan'). */
    heading: string;
    /** Noun used in the count pill ('item' | 'map item'). */
    itemNoun: string;
    /** 'Add item' button label. */
    addItemLabel: string;
    /** Muted description under the heading. */
    description: string;
    /** Noun in the scan-error banner ('item plan' | 'Map Reduce plan'). */
    scanErrorNoun: string;
    /** Validation message when no plan is available yet. */
    noPlanText: string;
    /** Fallback error for a failed approval. */
    approveErrorFallback: string;
    /** Tailwind classes for the accent family. */
    accent: TaskGroupPlanAccent;
    /** Grid template for the top row (shared instructions … child mode). */
    topGridClassName: string;
    scanTranscript: (turns: ClientConversationTurn[]) => TaskGroupPlanScan;
    getPersistedPlanState: (meta: TMeta) => TaskGroupPlanScan;
    /** Build the initial draft from the winning scan's plan artifact (the feature's plan artifact type). */
    buildDraft: (plan: any, meta: TMeta) => TDraft;
    formatDraftJson: (draft: TDraft) => string;
    /** Parse the advanced-JSON editor text; throws with a user-facing message. */
    parseDraftJson: (text: string) => TDraft;
    /** Validate the draft; returns the draft with normalized fields applied, or an error. */
    validate: (draft: TDraft) => { draft: TDraft | null; error: string | null };
    /** Create/update + approve the run and patch generation metadata. Returns the approved run. */
    approve: (args: TaskGroupPlanApproveArgs<TDraft, TMeta>) => Promise<{ runId: string }>;
    /** Extra header pills after the count pill (e.g. max parallel). */
    renderHeaderPills?: (draft: TDraft) => React.ReactNode;
    /** Extra fields inside the top grid, between shared instructions and child mode. */
    renderExtraTopFields?: (draft: TDraft, applyDraft: (next: TDraft) => void) => React.ReactNode;
    /** Extra sections between the top grid and the item list (e.g. reduce instructions). */
    renderExtraSections?: (draft: TDraft, applyDraft: (next: TDraft) => void) => React.ReactNode;
}

export interface TaskGroupPlanReviewCardProps<TDraft extends TaskGroupPlanDraftBase, TMeta extends TaskGroupPlanMetadataBase> {
    workspaceId?: string;
    processId?: string | null;
    metadataProcess: any;
    meta: TMeta;
    turns: ClientConversationTurn[];
    config: TaskGroupPlanReviewConfig<TDraft, TMeta>;
    provider?: 'copilot' | 'codex' | 'claude' | 'opencode';
    model?: string;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    onApprovedRun?: (runId: string) => void;
}

function itemDependencyText(item: TaskGroupPlanDraftItem): string {
    return (item.dependsOn ?? []).join(', ');
}

function parseDependencies(value: string): string[] | undefined {
    const deps = value.split(',').map(part => part.trim()).filter(Boolean);
    return deps.length > 0 ? deps : undefined;
}

function makeNewItem(existing: TaskGroupPlanDraftItem[]): any {
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

function latestScanTurn(scan: TaskGroupPlanScan): number {
    return Math.max(scan.plan?.turnIndex ?? -1, scan.error?.turnIndex ?? -1);
}

export function TaskGroupPlanReviewCard<TDraft extends TaskGroupPlanDraftBase, TMeta extends TaskGroupPlanMetadataBase>({
    workspaceId,
    processId,
    metadataProcess,
    meta,
    turns,
    config,
    provider,
    model,
    reasoningEffort,
    onApprovedRun,
}: TaskGroupPlanReviewCardProps<TDraft, TMeta>) {
    // AC-07: plan create/update/approve route to the selected clone's server.
    const cloneClient = useCocClient(workspaceId);
    const prefix = config.testIdPrefix;
    const accent = config.accent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const transcriptScan = useMemo(() => config.scanTranscript(turns), [turns]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const persistedScan = useMemo(() => config.getPersistedPlanState(meta), [meta]);
    const scan = latestScanTurn(transcriptScan) > latestScanTurn(persistedScan)
        ? transcriptScan
        : persistedScan.plan || persistedScan.error
            ? persistedScan
            : transcriptScan;
    const generatedKey = scan.plan ? `${scan.plan.turnIndex}:${scan.plan.rawJson}` : 'none';
    const [loadedKey, setLoadedKey] = useState('');
    const [baselineJson, setBaselineJson] = useState('');
    const [draft, setDraft] = useState<TDraft | null>(null);
    const [jsonOpen, setJsonOpen] = useState(false);
    const [jsonText, setJsonText] = useState('');
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [approvedRun, setApprovedRun] = useState<{ runId: string } | null>(null);

    useEffect(() => {
        if (!scan.plan || generatedKey === loadedKey) return;
        const nextDraft = config.buildDraft(scan.plan, meta);
        const formatted = config.formatDraftJson(nextDraft);
        setDraft(nextDraft);
        setBaselineJson(formatted);
        setJsonText(formatted);
        setJsonError(null);
        setLoadedKey(generatedKey);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meta, generatedKey, loadedKey, scan.plan]);

    if (!scan.plan && !scan.error) return null;

    const validation = draft ? config.validate(draft) : { draft: null, error: config.noPlanText };
    const currentJson = draft ? config.formatDraftJson(draft) : '';
    const dirty = draft ? currentJson !== baselineJson : false;
    const approvalBlocked = busy || !!jsonError || !!validation.error || !draft || !workspaceId || !processId || meta.status === 'approved' || !!approvedRun;
    const linkedRunId = approvedRun?.runId ?? meta.runId;

    function applyDraft(next: TDraft) {
        setDraft(next);
        setJsonText(config.formatDraftJson(next));
        setJsonError(null);
        setError(null);
    }

    function updateItem(index: number, patch: Partial<TaskGroupPlanDraftItem>) {
        if (!draft) return;
        applyDraft({
            ...draft,
            items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
        } as TDraft);
    }

    function moveItem(index: number, direction: -1 | 1) {
        if (!draft) return;
        const target = index + direction;
        if (target < 0 || target >= draft.items.length) return;
        const items = [...draft.items];
        const [item] = items.splice(index, 1);
        items.splice(target, 0, item);
        applyDraft({ ...draft, items } as TDraft);
    }

    function removeItem(index: number) {
        if (!draft) return;
        applyDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) } as TDraft);
    }

    function handleJsonChange(value: string) {
        setJsonText(value);
        setError(null);
        try {
            const parsed = config.parseDraftJson(value);
            setDraft(parsed);
            setJsonError(null);
        } catch (err) {
            setJsonError(err instanceof Error ? err.message : String(err));
        }
    }

    async function approveRun() {
        if (!draft || !workspaceId || !processId) return;
        const checked = config.validate(draft);
        if (checked.error || !checked.draft) {
            setError(checked.error ?? config.approveErrorFallback);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const approved = await config.approve({
                client: cloneClient,
                workspaceId,
                processId,
                meta,
                metadataProcess,
                draft: checked.draft,
                scanPlanTurnIndex: scan.plan?.turnIndex,
                provider,
                model,
                reasoningEffort,
            });
            setApprovedRun(approved);
            onApprovedRun?.(approved.runId);
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, config.approveErrorFallback));
        } finally {
            setBusy(false);
        }
    }

    return (
        <section
            className={cn('mx-4 mb-3 rounded-lg border p-3 text-xs shadow-sm', accent.card)}
            data-testid={`${prefix}-plan-review-card`}
        >
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className={cn('text-sm font-semibold', accent.headingText)}>{config.heading}</h3>
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', accent.pill)}>
                            {draft?.items.length ?? 0} {config.itemNoun}{draft?.items.length === 1 ? '' : 's'}
                        </span>
                        {draft && config.renderHeaderPills?.(draft)}
                        {dirty && <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300" data-testid={`${prefix}-plan-dirty`}>Edited</span>}
                    </div>
                    <p className={cn('mt-0.5 text-[11px]', accent.subText)}>
                        {config.description}
                    </p>
                </div>
                {linkedRunId && (
                    <button
                        type="button"
                        className={cn('rounded border bg-white px-2 py-1 text-[11px] font-medium', accent.openRunButton)}
                        onClick={() => onApprovedRun?.(linkedRunId)}
                        data-testid={`${prefix}-open-run-btn`}
                    >
                        Open run
                    </button>
                )}
            </div>

            {scan.error && (
                <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid={`${prefix}-plan-scan-error`}>
                    Latest assistant output did not contain a valid {config.scanErrorNoun}: {scan.error.message}. Keeping the previous valid plan.
                </div>
            )}

            {draft && (
                <div className="mt-3 space-y-3">
                    <div className={cn('grid gap-2', config.topGridClassName)}>
                        <label className="block">
                            <span className={cn('mb-1 block text-[11px] font-medium uppercase tracking-wide', accent.headingText)}>Shared instructions</span>
                            <textarea
                                value={draft.sharedInstructions}
                                onChange={(e) => applyDraft({ ...draft, sharedInstructions: e.target.value } as TDraft)}
                                rows={2}
                                className={cn('w-full resize-y rounded border bg-white p-2 text-xs text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100', accent.editorBorder)}
                                data-testid={`${prefix}-shared-instructions-editor`}
                            />
                        </label>
                        {config.renderExtraTopFields?.(draft, applyDraft)}
                        <div>
                            <div className={cn('mb-1 text-[11px] font-medium uppercase tracking-wide', accent.headingText)}>Child mode</div>
                            <div className={cn('inline-flex rounded border bg-white p-0.5 dark:bg-zinc-950', accent.editorBorder)} data-testid={`${prefix}-plan-child-mode`}>
                                {(['ask', 'autopilot'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => applyDraft({ ...draft, childMode: mode } as TDraft)}
                                        className={cn(
                                            'rounded px-2 py-1 text-[11px] font-medium',
                                            draft.childMode === mode
                                                ? accent.childModeActive
                                                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900',
                                        )}
                                        data-testid={`${prefix}-plan-child-mode-${mode}`}
                                    >
                                        {mode === 'ask' ? 'Ask' : 'Autopilot'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {config.renderExtraSections?.(draft, applyDraft)}

                    <div className="space-y-2" data-testid={`${prefix}-plan-items`}>
                        {draft.items.map((item, index) => (
                            <div key={`${item.id}:${index}`} className={cn('rounded border bg-white p-2 dark:bg-zinc-950', accent.hairlineBorder)} data-testid={`${prefix}-plan-item-${item.id}`}>
                                <div className="grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)_auto]">
                                    <label className="block">
                                        <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">ID</span>
                                        <input
                                            value={item.id}
                                            onChange={(e) => updateItem(index, { id: e.target.value })}
                                            className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                                            data-testid={`${prefix}-plan-item-id-${index}`}
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Title</span>
                                        <input
                                            value={item.title}
                                            onChange={(e) => updateItem(index, { title: e.target.value })}
                                            className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                                            data-testid={`${prefix}-plan-item-title-${index}`}
                                        />
                                    </label>
                                    <div className="flex items-end gap-1">
                                        <button type="button" onClick={() => moveItem(index, -1)} disabled={index === 0} className="rounded border border-zinc-200 px-2 py-1 text-[11px] disabled:opacity-40 dark:border-zinc-800" data-testid={`${prefix}-plan-item-up-${index}`}>Up</button>
                                        <button type="button" onClick={() => moveItem(index, 1)} disabled={index === draft.items.length - 1} className="rounded border border-zinc-200 px-2 py-1 text-[11px] disabled:opacity-40 dark:border-zinc-800" data-testid={`${prefix}-plan-item-down-${index}`}>Down</button>
                                        <button type="button" onClick={() => removeItem(index)} className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 dark:border-red-900 dark:text-red-200" data-testid={`${prefix}-plan-item-remove-${index}`}>Remove</button>
                                    </div>
                                </div>
                                <label className="mt-2 block">
                                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Prompt</span>
                                    <textarea
                                        value={item.prompt}
                                        onChange={(e) => updateItem(index, { prompt: e.target.value })}
                                        rows={3}
                                        className="w-full resize-y rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                                        data-testid={`${prefix}-plan-item-prompt-${index}`}
                                    />
                                </label>
                                <label className="mt-2 block">
                                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Dependencies</span>
                                    <input
                                        value={itemDependencyText(item)}
                                        onChange={(e) => updateItem(index, { dependsOn: parseDependencies(e.target.value) })}
                                        placeholder="item-1, item-2"
                                        className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                                        data-testid={`${prefix}-plan-item-deps-${index}`}
                                    />
                                </label>
                            </div>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={() => applyDraft({ ...draft, items: [...draft.items, makeNewItem(draft.items)] } as TDraft)}
                        className={cn('rounded border bg-white px-2 py-1 text-[11px] font-medium', accent.addItemButton)}
                        data-testid={`${prefix}-plan-add-item`}
                    >
                        {config.addItemLabel}
                    </button>

                    <details open={jsonOpen} onToggle={(event) => setJsonOpen(event.currentTarget.open)} className={cn('rounded border bg-white p-2 dark:bg-zinc-950', accent.hairlineBorder)}>
                        <summary className={cn('cursor-pointer text-[11px] font-semibold uppercase tracking-wide', accent.jsonSummaryText)} data-testid={`${prefix}-plan-json-toggle`}>
                            Advanced JSON
                        </summary>
                        <textarea
                            value={jsonText}
                            onChange={(e) => handleJsonChange(e.target.value)}
                            rows={10}
                            className="mt-2 w-full resize-y rounded border border-zinc-200 bg-white p-2 font-mono text-xs text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                            data-testid={`${prefix}-plan-json`}
                        />
                        {jsonError && (
                            <p className="mt-1 text-[11px] text-red-600 dark:text-red-300" data-testid={`${prefix}-plan-json-error`}>{jsonError}</p>
                        )}
                    </details>

                    <div className={cn('flex flex-wrap items-center justify-between gap-2 border-t pt-2', accent.hairlineBorder)}>
                        <div>
                            {validation.error ? (
                                <p className="text-[11px] text-red-600 dark:text-red-300" data-testid={`${prefix}-plan-validation-error`}>{validation.error}</p>
                            ) : (
                                <p className="text-[11px] text-emerald-700 dark:text-emerald-300" data-testid={`${prefix}-plan-validation-ok`}>Plan is valid and ready for approval.</p>
                            )}
                            {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-300" data-testid={`${prefix}-plan-approve-error`}>{error}</p>}
                        </div>
                        <button
                            type="button"
                            onClick={() => void approveRun()}
                            disabled={approvalBlocked}
                            className={cn('rounded px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed', accent.approveButton)}
                            data-testid={`${prefix}-plan-approve-btn`}
                        >
                            {busy ? 'Approving...' : meta.status === 'approved' || approvedRun ? 'Approved' : 'Approve run'}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}
