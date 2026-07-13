/**
 * ImplementPlanLaunchDialog — inline launch panel for implementing a reviewed plan.
 *
 * Modeled on RalphStartPanel's open state: clicking "Implement" on the plan
 * banner expands this panel in place (below the banner) instead of opening a
 * modal overlay. The panel hosts the launch action and carries the chosen AI
 * provider/effort settings into the enqueue payload sent to the selected
 * target server.
 *
 * It owns everything needed to enqueue the implementation task:
 *  • the target/repo selector (when more than one target is reachable),
 *  • the plan-file selector (when more than one plan file is detected) — this is
 *    a controlled input driven by the banner so the banner's status pill and the
 *    dialog stay in sync,
 *  • the shared AI controls (ModalJobAiControls via useModalJobAiSelection), so
 *    the provider/effort selection is remembered across this flow and Ralph,
 *  • a read-only summary of the plan being implemented and the resolved target.
 *
 * The enqueue + record-persistence logic (previously inline on the banner) lives
 * here so it happens only from the dialog's confirm button. Prompt construction
 * mirrors the banner's old behavior:
 *  • canvas-backed plans always inline the canvas content read from the source,
 *  • remote (or remote-sourced) file plans inline the file content read from the
 *    source server, since the target machine cannot read the source's path,
 *  • purely-local file plans keep the path-based prompt + file context.
 */

import { useEffect, useState } from 'react';
import { getCocClientFor, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useCocClient, type CloneRef } from '../../repos/cloneRouting';
import { isQueueProcessId, toQueueProcessId } from '../../utils/queue-process-id';
import { getAgentSelectorProviders, mergeAutoProviderRoutingContext } from '../../utils/providerSelection';
import type { AgentSelectorProvider } from '../../utils/providerSelection';
import type { LocalEffortTiersMap, LocalTierEntry, EffortTierKey } from '../../hooks/useProviderEffortTiers';
import { ModalJobAiControls, useModalJobAiSelection } from '../../shared/ModalJobAiControls';
import type { ImplementationRecord, ImplementTarget } from './ImplementPlanCard';

// ── Remote AI data helpers ─────────────────────────────────────────────

/** Normalizes a raw server tier map (same shape as useProviderEffortTiers normalizeFromServer). */
function normalizeTiersFromServer(raw: Partial<Record<string, unknown>> = {}): LocalEffortTiersMap {
    const result: LocalEffortTiersMap = {};
    const keys: EffortTierKey[] = ['very-low', 'low', 'medium', 'high'];
    for (const key of keys) {
        const entry = raw[key] as { model?: string; reasoningEffort?: string | null; source?: string } | undefined;
        if (entry?.model) {
            result[key] = {
                model: entry.model,
                reasoningEffort: entry.reasoningEffort ?? '',
                source: (entry.source === 'config' ? 'config' : 'default') as LocalTierEntry['source'],
            };
        }
    }
    return result;
}

// ── Props ──────────────────────────────────────────────────────────────

export interface ImplementPlanLaunchDialogProps {
    open: boolean;
    onClose: () => void;
    /** Full path (or display label for canvas plans) of the plan being implemented. */
    planFilePath: string;
    /** All detected plan files; a selector is shown when 2+ are present. */
    planFiles?: string[];
    /** Currently selected plan file (controlled by the banner). */
    selectedPlanFile: string;
    /** Change the selected plan file (kept in sync with the banner). */
    onSelectPlanFile: (filePath: string) => void;
    /** Canvas id when the plan lives in a canvas rather than a file. */
    planCanvasId?: string;
    workspaceId?: string;
    workingDirectory?: string;
    /** True when the source workspace is a remote clone (forces inline prompt). */
    sourceIsRemote?: boolean;
    /** Remote routing base URL of the source workspace, when known. */
    sourceBaseUrl?: string;
    /** Reachable targets (current repo + online remote clones). */
    availableTargets?: ImplementTarget[];
    /** Source process ID (for persisting implementation records). */
    sourceProcessId?: string;
    /** Current metadata of the source process (for merge-patching). */
    sourceMetadata?: Record<string, unknown>;
    /** Called with the new processId after a successful enqueue. */
    onImplemented: (newProcessId: string) => void;
    /** Called after a new implementation record is persisted (optimistic update). */
    onRecordPersisted?: (record: ImplementationRecord) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Build the prompt for a remote run by inlining the plan content. */
function buildRemotePrompt(planFilePath: string, planContent: string): string {
    return [
        'Implement the following plan in this repository.',
        `The plan was authored as \`${planFilePath}\` on another machine, so its full content is inlined below.`,
        '',
        '----- BEGIN PLAN -----',
        planContent,
        '----- END PLAN -----',
    ].join('\n');
}

/** Build the prompt for a canvas-backed plan by inlining the canvas content. */
function buildCanvasPrompt(planLabel: string, planContent: string): string {
    return [
        'Implement the following plan in this repository.',
        `The plan was authored in a canvas ("${planLabel}"), so its full content is inlined below.`,
        '',
        '----- BEGIN PLAN -----',
        planContent,
        '----- END PLAN -----',
    ].join('\n');
}

/** File basename (last path segment) for a plan-file dropdown label. */
function planFileBasename(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Resolve the enqueue routing ref. An explicit remote target routes via its own
 * baseUrl. When the run falls back to the source workspace and that workspace is
 * a remote clone with a known baseUrl, route to the source server explicitly — a
 * bare remote workspace id silently resolves to the LOCAL client when the clone
 * registry does not know it. Everything else routes by id.
 */
function toCloneRef(
    target: ImplementTarget | undefined,
    fallbackId: string | undefined,
    source?: { isRemote?: boolean; baseUrl?: string },
): CloneRef | undefined {
    if (target?.isRemote && target.baseUrl) {
        return { id: target.workspaceId, baseUrl: target.baseUrl, remote: {} };
    }
    const targetIsSource = !target || target.workspaceId === fallbackId;
    if (targetIsSource && source?.isRemote && source.baseUrl) {
        return { id: fallbackId ?? '', baseUrl: source.baseUrl, remote: {} };
    }
    return target?.workspaceId ?? fallbackId;
}

// ── Component ──────────────────────────────────────────────────────────

export function ImplementPlanLaunchDialog({
    open,
    onClose,
    planFilePath,
    planFiles = [],
    selectedPlanFile,
    onSelectPlanFile,
    planCanvasId,
    workspaceId,
    workingDirectory,
    sourceIsRemote,
    sourceBaseUrl,
    availableTargets,
    sourceProcessId,
    sourceMetadata,
    onImplemented,
    onRecordPersisted,
}: ImplementPlanLaunchDialogProps) {
    const targets = availableTargets ?? [];
    const showTargetSelector = targets.length > 1;
    const showFileSelector = planFiles.length > 1;

    // Default to the current repo so the existing one-click local behavior is
    // preserved; fall back to the first local, then any, target.
    const defaultTargetId =
        workspaceId
        ?? targets.find(t => !t.isRemote)?.workspaceId
        ?? targets[0]?.workspaceId;
    const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>(defaultTargetId);
    const selectedTarget = targets.find(t => t.workspaceId === selectedTargetId);

    // The plan file the dialog implements. With 0–1 files it is fixed to
    // planFilePath; with 2+ it follows the banner-controlled selection.
    const activePlanFilePath = showFileSelector ? selectedPlanFile : planFilePath;

    // AC-04: when the selected target is a remote clone, fetch the available
    // providers and effort tiers from THAT server so the AI controls reflect
    // what the remote machine actually supports.
    const [remoteAiData, setRemoteAiData] = useState<{
        agentProviders: AgentSelectorProvider[];
        effortTierMap: Partial<Record<string, LocalEffortTiersMap>>;
    } | null>(null);
    const [remoteAiError, setRemoteAiError] = useState(false);
    const [remoteAiLoading, setRemoteAiLoading] = useState(false);

    useEffect(() => {
        const isRemote = selectedTarget?.isRemote;
        const baseUrl = selectedTarget?.baseUrl;
        if (!isRemote || !baseUrl) {
            setRemoteAiData(null);
            setRemoteAiError(false);
            setRemoteAiLoading(false);
            return;
        }
        let cancelled = false;
        setRemoteAiLoading(true);
        setRemoteAiError(false);
        setRemoteAiData(null);

        const client = getCocClientFor(baseUrl);
        (async () => {
            try {
                const providersResult = await (client as any).agentProviders.list() as { providers?: any[] };
                const rawProviders = providersResult?.providers ?? [];
                const providers = getAgentSelectorProviders(rawProviders);

                const tierEntries = await Promise.allSettled(
                    (rawProviders as Array<{ id: string; enabled?: boolean }>)
                        .filter(p => p.enabled !== false)
                        .map(async (p) => {
                            const result = await (client as any).agentProviders.getEffortTiers(p.id) as { effortTiers?: any };
                            return [p.id, normalizeTiersFromServer(result?.effortTiers)] as [string, LocalEffortTiersMap];
                        }),
                );
                const effortTierMap: Partial<Record<string, LocalEffortTiersMap>> = {};
                for (const entry of tierEntries) {
                    if (entry.status === 'fulfilled') {
                        effortTierMap[entry.value[0]] = entry.value[1];
                    }
                }
                if (!cancelled) setRemoteAiData({ agentProviders: providers, effortTierMap });
            } catch {
                if (!cancelled) setRemoteAiError(true);
            } finally {
                if (!cancelled) setRemoteAiLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTarget?.workspaceId, selectedTarget?.isRemote, selectedTarget?.baseUrl]);

    // Shared AI selection — same workspace provider preference + localStorage
    // effort tier as the Ralph launch dialog (AC-03). Keyed by the selected
    // target so the persisted default follows the chosen repo.
    // AC-04: when remote data is available, pass it as external overrides so
    // the options shown come from the target server, not the local one.
    const aiSelection = useModalJobAiSelection({
        workspaceId: selectedTargetId ?? workspaceId,
        mode: 'autopilot',
        ...(remoteAiData ? {
            externalAgentProviders: remoteAiData.agentProviders,
            externalEffortTierMap: remoteAiData.effortTierMap,
        } : {}),
    });

    // Source client reads the plan/canvas + persists the record on the
    // initiating server; target client routes the enqueue to the chosen repo.
    const sourceRef: CloneRef | undefined = sourceIsRemote && sourceBaseUrl
        ? { id: workspaceId ?? '', baseUrl: sourceBaseUrl, remote: {} }
        : workspaceId;
    const sourceClient = useCocClient(sourceRef);
    const targetClient = useCocClient(
        toCloneRef(selectedTarget, workspaceId, { isRemote: sourceIsRemote, baseUrl: sourceBaseUrl }),
    );

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset transient state whenever the dialog (re)opens.
    useEffect(() => {
        if (!open) return;
        setError(null);
        setSubmitting(false);
        setSelectedTargetId(defaultTargetId);
    }, [open, defaultTargetId]);

    // Escape closes the panel without enqueuing (AC-01), except mid-launch.
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !submitting) onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, submitting, onClose]);

    if (!open) return null;

    async function readSourcePlanContent(): Promise<string> {
        try {
            const blob = await sourceClient.explorer.readTrustedBlob(activePlanFilePath);
            if (blob.encoding === 'base64') {
                try {
                    return typeof atob === 'function' ? atob(blob.content) : blob.content;
                } catch {
                    return blob.content;
                }
            }
            return blob.content;
        } catch (err) {
            throw new Error(
                `Could not read the plan file on the source server: ${getSpaCocClientErrorMessage(err, 'read failed')}`,
            );
        }
    }

    async function readSourceCanvasContent(canvasId: string): Promise<string> {
        try {
            const canvas = await sourceClient.canvases.get(workspaceId ?? '', canvasId);
            return canvas.content;
        } catch (err) {
            throw new Error(
                `Could not read the plan canvas on the source server: ${getSpaCocClientErrorMessage(err, 'read failed')}`,
            );
        }
    }

    async function handleConfirm() {
        if (submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const isRemote = !!selectedTarget?.isRemote;
            const targetIsSource = !selectedTarget || selectedTarget.workspaceId === workspaceId;
            const runsRemotely = isRemote || (targetIsSource && !!sourceIsRemote);
            const targetWorkspaceId = selectedTarget?.workspaceId ?? workspaceId;
            const targetWorkingDirectory = selectedTarget?.workingDirectory ?? workingDirectory;

            let prompt: string;
            let baseContext: Record<string, unknown> | undefined;
            if (planCanvasId) {
                const planContent = await readSourceCanvasContent(planCanvasId);
                prompt = buildCanvasPrompt(activePlanFilePath, planContent);
                baseContext = undefined;
            } else if (isRemote || sourceIsRemote) {
                const planContent = await readSourcePlanContent();
                prompt = buildRemotePrompt(activePlanFilePath, planContent);
                baseContext = undefined;
            } else {
                prompt = `Read and implement the plan file at ${activePlanFilePath}`;
                baseContext = { files: [activePlanFilePath] };
            }

            // AC-05: carry the resolved AI selection into the enqueue payload —
            // provider override, auto-routing context flag, and model / reasoning
            // effort / effort tier, matching the shapes the queue route honors.
            const resolvedAi = aiSelection.resolved;
            const context = mergeAutoProviderRoutingContext(resolvedAi, baseContext);
            const config = resolvedAi.effortTier ? { effortTier: resolvedAi.effortTier } : undefined;

            const result = await targetClient.queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: 'autopilot' as any,
                    prompt,
                    ...(context ? { context } : {}),
                    ...(resolvedAi.model ? { model: resolvedAi.model } : {}),
                    ...(resolvedAi.reasoningEffort ? { reasoningEffort: resolvedAi.reasoningEffort } : {}),
                    ...(resolvedAi.provider ? { provider: resolvedAi.provider } : {}),
                    workingDirectory: targetWorkingDirectory,
                    workspaceId: targetWorkspaceId,
                } as any,
                ...(config ? { config } : {}),
            });
            const rawId = (result as any).task?.id ?? (result as any).id;
            if (!rawId) throw new Error('No task id returned from enqueue');
            const processId = isQueueProcessId(rawId) ? rawId : toQueueProcessId(rawId);

            if (sourceProcessId) {
                const record: ImplementationRecord = {
                    processId,
                    planFilePath: activePlanFilePath,
                    enqueuedAt: new Date().toISOString(),
                    targetWorkspaceId,
                    targetLabel: selectedTarget?.label,
                    targetServerLabel: isRemote ? selectedTarget?.serverLabel : undefined,
                    isRemoteTarget: runsRemotely,
                    // AC-05: record the chosen provider/effort for later display.
                    // No schema migration — purely optional annotation fields.
                    provider: resolvedAi.provider,
                    effortTier: resolvedAi.effortTier,
                    model: resolvedAi.model,
                    reasoningEffort: resolvedAi.reasoningEffort,
                    autoProviderRouting: resolvedAi.autoProviderRouting,
                };
                const prevImpls = Array.isArray(sourceMetadata?.implementations)
                    ? (sourceMetadata!.implementations as ImplementationRecord[])
                    : [];
                const implementations = [...prevImpls, record];
                try {
                    await sourceClient.processes.patchMetadata(sourceProcessId, {
                        set: { implementations },
                    });
                    onRecordPersisted?.(record);
                } catch (persistErr) {
                    console.warn('Failed to persist implementation record:', persistErr);
                }
            }

            onImplemented(processId);
            onClose();
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, 'Failed to start implementation'));
        } finally {
            setSubmitting(false);
        }
    }

    const planSummaryLabel = planCanvasId ? planFilePath : activePlanFilePath;

    return (
        <div
            className="mt-2 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#161b22] px-3 py-3 space-y-2"
            data-testid="implement-launch-dialog"
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    🚀 Implement this plan
                </h3>
                <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] disabled:opacity-50"
                    aria-label="Close"
                >
                    ✕
                </button>
            </div>
            <p className="text-xs text-[#848484]">
                Review the settings below, then click <strong>Implement</strong> to enqueue the run.
            </p>

            {/* Plan-file selector (multi-file only) */}
            {showFileSelector && (
                <div>
                    <label htmlFor="implement-launch-file-select" className="block text-xs text-[#848484] mb-1">
                        Plan file:
                    </label>
                    <select
                        id="implement-launch-file-select"
                        data-testid="implement-launch-file-select"
                        value={selectedPlanFile}
                        onChange={(e) => onSelectPlanFile(e.target.value)}
                        disabled={submitting}
                        className="w-full text-xs rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1a1a1a] text-[#1e1e1e] dark:text-[#cccccc] px-2 py-1 disabled:opacity-60"
                    >
                        {planFiles.map(p => (
                            <option key={p} value={p}>{planFileBasename(p)}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Target selector + AI controls, side by side (RalphStartPanel layout) */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                {showTargetSelector && (
                    <div className="flex-1 min-w-0">
                        <label htmlFor="implement-launch-target-select" className="block text-xs text-[#848484] mb-1">
                            Run in:
                        </label>
                        <select
                            id="implement-launch-target-select"
                            data-testid="implement-launch-target-select"
                            value={selectedTargetId}
                            onChange={(e) => setSelectedTargetId(e.target.value)}
                            disabled={submitting}
                            className="w-full text-xs rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1a1a1a] text-[#1e1e1e] dark:text-[#cccccc] px-2 py-1 disabled:opacity-60"
                        >
                            {targets.map(t => {
                                const isCurrent = t.workspaceId === workspaceId;
                                const label = t.isRemote
                                    ? `${t.label} · ${t.serverLabel ?? 'remote'}`
                                    : `${t.label}${isCurrent ? ' (current)' : ''}`;
                                return <option key={t.workspaceId} value={t.workspaceId}>{label}</option>;
                            })}
                        </select>
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="block text-xs text-[#848484] mb-1">Agent:</div>
                    {remoteAiError ? (
                        <p
                            className="text-xs text-[#848484]"
                            data-testid="implement-launch-remote-ai-unavailable"
                        >
                            Cannot reach target server — AI settings unavailable
                        </p>
                    ) : (
                        <ModalJobAiControls
                            selection={aiSelection}
                            disabled={submitting || remoteAiLoading}
                            testIdPrefix="implement-launch"
                        />
                    )}
                </div>
            </div>

            {/* Read-only plan summary */}
            <div>
                <div className="text-xs text-[#848484] mb-1">Plan to implement:</div>
                <div
                    className="text-xs rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#1a1a1a] px-2 py-1 font-mono text-[#1e1e1e] dark:text-[#cccccc] break-all"
                    data-testid="implement-launch-summary"
                >
                    {planSummaryLabel}
                </div>
            </div>

            {/* Error */}
            {error && (
                <p className="text-xs text-[#f14c4c]" data-testid="implement-launch-error">
                    {error}
                </p>
            )}

            {/* Footer */}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    data-testid="implement-launch-confirm-btn"
                    onClick={handleConfirm}
                    disabled={submitting}
                    className={
                        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors '
                        + (submitting ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700')
                    }
                >
                    {submitting ? '⏳ Starting…' : '🚀 Implement'}
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="text-sm text-[#5a5a5a] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#ccc] disabled:opacity-50"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
