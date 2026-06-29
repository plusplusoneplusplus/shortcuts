/**
 * ImplementPlanCard — inline action card shown after a completed plan-file chat.
 *
 * Renders a CTA that enqueues a new autopilot task referencing the plan file.
 * When prior implementation runs exist (recorded in task metadata), a status
 * banner is rendered above the CTA showing the most recent run's live status,
 * total run count, and a link to navigate to any recorded run.
 *
 * A compact target-repo selector (shown only when more than one reachable repo
 * is available) lets the user run the plan in the current repo or in an
 * already-registered, online remote clone:
 *  • Local target → keeps the existing path-based prompt and one-click behavior.
 *  • Remote target → reads the plan content on the initiating server, embeds it
 *    in the prompt, and enqueues on the target repo's routed CoC client, because
 *    the remote machine cannot read the initiating machine's local plan path.
 * The selector is gated entirely by the targets the caller supplies (which come
 * from existing remote repo/server availability), so installs without remote
 * support keep the unchanged local-only UI.
 */

import { useState } from 'react';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useCocClient, type CloneRef } from '../../repos/cloneRouting';
import { isQueueProcessId, toQueueProcessId } from '../../utils/queue-process-id';
import { formatRelativeTime } from '../../utils/format';
import { cn } from '../../ui/cn';

// ── Types ──────────────────────────────────────────────────────────────

/** Persisted in `task.metadata.implementations` on the source plan-file task. */
export interface ImplementationRecord {
    processId: string;
    planFilePath: string;
    enqueuedAt: string; // ISO
    /**
     * Target identity (AC-05). Absent on legacy records, which are treated as
     * local runs in the current repo.
     */
    targetWorkspaceId?: string;
    /** Target repo display label. */
    targetLabel?: string;
    /** Remote server label; absent/empty means a local target. */
    targetServerLabel?: string;
    /** True when the run was dispatched to a remote clone. */
    isRemoteTarget?: boolean;
}

export type RunLiveStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';

/** Merged record + live status for rendering. */
export interface ExistingRun extends ImplementationRecord {
    liveStatus: RunLiveStatus;
}

/**
 * A selectable target repo for running the implementation. The current repo and
 * every reachable (online) remote clone known to the dashboard becomes a target;
 * unavailable remote targets are never included by the caller (AC-02).
 */
export interface ImplementTarget {
    /** Workspace id on its owning server. */
    workspaceId: string;
    /** Repo display label. */
    label: string;
    /** Remote server label; undefined for local targets. */
    serverLabel?: string;
    /** Target repo working directory (root path on its server). */
    workingDirectory?: string;
    /** Remote routing base URL; undefined for local targets. */
    baseUrl?: string;
    /** True for an online remote clone; false for a local repo. */
    isRemote: boolean;
}

// ── Props ──────────────────────────────────────────────────────────────

export interface ImplementPlanCardProps {
    planFilePath: string;
    /**
     * All detected `.plan.md` files for this chat, in conversation scan order
     * (AC-01). When 2+ are present the card renders a plan-file selector and
     * tracks the chosen file for the implement action, status pill, button
     * label, and prior-runs list (AC-02/AC-03). An empty or single-element list
     * keeps the card's single-file behavior byte-for-byte unchanged.
     */
    planFiles?: string[];
    /**
     * When the plan lives in a canvas instead of a `.plan.md` file, this is the
     * canvas id. The content is read from the canvas and embedded inline in the
     * prompt (the plan has no on-disk path); `planFilePath` is treated as a
     * display label only.
     */
    planCanvasId?: string;
    workspaceId?: string;
    workingDirectory?: string;
    onImplemented: (newProcessId: string) => void;
    /** Existing implementation runs with resolved live status. */
    existingRuns?: ExistingRun[];
    /**
     * Navigate to a recorded run's chat detail. `targetWorkspaceId` identifies
     * the repo/server the run executes on so the caller opens the correct
     * local or remote run.
     */
    onViewRun?: (processId: string, targetWorkspaceId?: string) => void;
    /** Source process ID (for persisting implementation records). */
    sourceProcessId?: string;
    /** Current metadata of the source process (for merge-patching). */
    sourceMetadata?: Record<string, unknown>;
    /** Called after a new implementation record is persisted (for optimistic local update). */
    onRecordPersisted?: (record: ImplementationRecord) => void;
    /**
     * Reachable targets (current repo + online remote clones). The selector is
     * rendered only when more than one target is available; otherwise the card
     * keeps its single-target, local-only behavior.
     */
    availableTargets?: ImplementTarget[];
}

// ── Helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<RunLiveStatus, { emoji: string; label: string }> = {
    running: { emoji: '🟢', label: 'Running' },
    queued: { emoji: '🟡', label: 'Queued' },
    completed: { emoji: '✅', label: 'Completed' },
    failed: { emoji: '⚠️', label: 'Failed' },
    cancelled: { emoji: '⏸', label: 'Cancelled' },
    unknown: { emoji: '❓', label: 'Unknown' },
};

function isActiveStatus(status: RunLiveStatus): boolean {
    return status === 'running' || status === 'queued';
}

/** Short human label for a run's target (e.g. "my-app · dev-vm" or "my-app"). */
function describeRunTarget(run: ExistingRun): string | null {
    if (!run.targetLabel && !run.isRemoteTarget) return null;
    const label = run.targetLabel || 'repo';
    if (run.isRemoteTarget && run.targetServerLabel) return `${label} · ${run.targetServerLabel}`;
    return label;
}

/** Build the prompt for a remote run by inlining the plan content (AC-04). */
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

/** Resolve a target to a CocClient routing ref: remote → object marker, local → id. */
function toCloneRef(target: ImplementTarget | undefined, fallbackId: string | undefined): CloneRef | undefined {
    if (target?.isRemote && target.baseUrl) {
        return { id: target.workspaceId, baseUrl: target.baseUrl, remote: {} };
    }
    return target?.workspaceId ?? fallbackId;
}

// ── Component ──────────────────────────────────────────────────────────

export function ImplementPlanCard({
    planFilePath,
    planFiles = [],
    planCanvasId,
    workspaceId,
    workingDirectory,
    onImplemented,
    existingRuns = [],
    onViewRun,
    sourceProcessId,
    sourceMetadata,
    onRecordPersisted,
    availableTargets,
}: ImplementPlanCardProps) {
    const targets = availableTargets ?? [];
    const showSelector = targets.length > 1;

    // Default to the current repo so the existing one-click local behavior is
    // unchanged (AC-01); fall back to the first local, then any, target.
    const defaultTargetId =
        workspaceId
        ?? targets.find(t => !t.isRemote)?.workspaceId
        ?? targets[0]?.workspaceId;
    const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>(defaultTargetId);

    const selectedTarget = targets.find(t => t.workspaceId === selectedTargetId);

    // AC-07/AC-03: the source client (initiating server) persists the record and
    // reads the plan; the target client routes the enqueue to the chosen repo.
    const sourceClient = useCocClient(workspaceId);
    const targetClient = useCocClient(toCloneRef(selectedTarget, workspaceId));

    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);

    // ── Plan-file selector (AC-02/AC-03) ───────────────────────────────
    // The selector appears only in the auto-detected multi-file case. With 0–1
    // files the card falls back to `planFilePath` so single-file behavior is
    // byte-for-byte unchanged. Selection is ephemeral local state, defaulting to
    // the first detected file (which equals `planFilePath`).
    const showFileSelector = planFiles.length > 1;
    const [selectedPlanFile, setSelectedPlanFile] = useState<string>(planFiles[0] ?? planFilePath);
    const activePlanFilePath = showFileSelector ? selectedPlanFile : planFilePath;

    // Prior runs filtered to the selected plan file (AC-03), matched against each
    // record's `planFilePath`. Single-file keeps the full, unfiltered list.
    const filteredRuns = showFileSelector
        ? existingRuns.filter(r => r.planFilePath === activePlanFilePath)
        : existingRuns;

    const latestRun = filteredRuns.length > 0 ? filteredRuns[filteredRuns.length - 1] : null;
    const latestIsActive = latestRun ? isActiveStatus(latestRun.liveStatus) : false;
    const hasRuns = filteredRuns.length > 0;

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

    async function handleClick() {
        if (submitting || submitted) return;
        setSubmitting(true);
        setError(null);
        try {
            const isRemote = !!selectedTarget?.isRemote;
            const targetWorkspaceId = selectedTarget?.workspaceId ?? workspaceId;
            const targetWorkingDirectory = selectedTarget?.workingDirectory ?? workingDirectory;

            // Canvas-backed plans have no on-disk path, so always read the canvas
            // content from the source server and embed it inline (local or remote).
            // File-based plans keep the existing convention: local runs reference
            // the path, remote runs embed the file content read from the source
            // server (AC-04).
            let prompt: string;
            let context: { files: string[] } | undefined;
            if (planCanvasId) {
                const planContent = await readSourceCanvasContent(planCanvasId);
                prompt = buildCanvasPrompt(activePlanFilePath, planContent);
                context = undefined;
            } else if (isRemote) {
                const planContent = await readSourcePlanContent();
                prompt = buildRemotePrompt(activePlanFilePath, planContent);
                context = undefined;
            } else {
                prompt = `Read and implement the plan file at ${activePlanFilePath}`;
                context = { files: [activePlanFilePath] };
            }

            const result = await targetClient.queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: 'autopilot' as any,
                    prompt,
                    ...(context ? { context } : {}),
                    workingDirectory: targetWorkingDirectory,
                    workspaceId: targetWorkspaceId,
                } as any,
            });
            const rawId = (result as any).task?.id ?? (result as any).id;
            if (!rawId) throw new Error('No task id returned from enqueue');
            const processId = isQueueProcessId(rawId) ? rawId : toQueueProcessId(rawId);

            // Persist implementation record on the source task (best-effort), via the
            // source client so records always land on the initiating server.
            if (sourceProcessId) {
                const record: ImplementationRecord = {
                    processId,
                    planFilePath: activePlanFilePath,
                    enqueuedAt: new Date().toISOString(),
                    targetWorkspaceId,
                    targetLabel: selectedTarget?.label,
                    targetServerLabel: isRemote ? selectedTarget?.serverLabel : undefined,
                    isRemoteTarget: isRemote,
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

            setSubmitted(true);
            onImplemented(processId);
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, 'Failed to start implementation'));
        } finally {
            setSubmitting(false);
        }
    }

    const disabled = submitting || submitted;

    return (
        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-3" data-testid="implement-plan-card">
            <div className="rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#161b22] shadow-sm">
                {/* ── Compact single-row header (PR-banner style) ── */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
                    <span className="shrink-0" aria-hidden="true">🚀</span>
                    <span className="shrink-0 text-xs font-semibold text-[#1f2328] dark:text-[#c9d1d9]">
                        Implement this plan
                    </span>
                    <span
                        className="min-w-0 flex-1 truncate text-[11px] font-mono text-[#848484]"
                        title={`Start a new autopilot session to execute the plan.\n${activePlanFilePath}`}
                    >
                        {activePlanFilePath}
                    </span>

                    {showFileSelector && (
                        <div className="flex shrink-0 items-center gap-1" data-testid="implement-plan-card-file">
                            <label htmlFor="implement-plan-card-file-select" className="text-[11px] text-[#57606a] dark:text-[#8b949e]">
                                Plan
                            </label>
                            <select
                                id="implement-plan-card-file-select"
                                data-testid="implement-plan-card-file-select"
                                value={selectedPlanFile}
                                onChange={(e) => setSelectedPlanFile(e.target.value)}
                                disabled={disabled}
                                className="text-[11px] rounded border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#0d1117] text-[#1f2328] dark:text-[#c9d1d9] px-1 py-0.5 max-w-[12rem] truncate disabled:opacity-60"
                            >
                                {planFiles.map(p => (
                                    <option key={p} value={p}>{planFileBasename(p)}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {hasRuns && latestRun && (
                        <button
                            type="button"
                            data-testid="implement-plan-card-status-pill"
                            onClick={() => onViewRun?.(latestRun.processId, latestRun.targetWorkspaceId)}
                            title={`started ${formatRelativeTime(latestRun.enqueuedAt)}${filteredRuns.length > 1 ? ` · ${filteredRuns.length} runs total` : ''}${describeRunTarget(latestRun) ? ` · ${describeRunTarget(latestRun)}` : ''}`}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-black/[0.04] dark:bg-white/[0.06] text-[#57606a] dark:text-[#8b949e] hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"
                        >
                            <span data-testid="implement-plan-card-view-btn" className="contents">
                                {STATUS_CONFIG[latestRun.liveStatus].emoji} {STATUS_CONFIG[latestRun.liveStatus].label}
                                {latestRun.isRemoteTarget ? ' ☁️' : ''}
                                {filteredRuns.length > 1 && ` · ${filteredRuns.length}`}
                                {' →'}
                            </span>
                        </button>
                    )}

                    {showSelector && (
                        <div className="flex shrink-0 items-center gap-1" data-testid="implement-plan-card-target">
                            <label htmlFor="implement-plan-card-target-select" className="text-[11px] text-[#57606a] dark:text-[#8b949e]">
                                Run in
                            </label>
                            <select
                                id="implement-plan-card-target-select"
                                data-testid="implement-plan-card-target-select"
                                value={selectedTargetId}
                                onChange={(e) => setSelectedTargetId(e.target.value)}
                                disabled={disabled}
                                className="text-[11px] rounded border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#0d1117] text-[#1f2328] dark:text-[#c9d1d9] px-1 py-0.5 max-w-[12rem] truncate disabled:opacity-60"
                            >
                                {targets.map(t => {
                                    const isCurrent = t.workspaceId === workspaceId;
                                    const label = t.isRemote ? `${t.label} · ${t.serverLabel ?? 'remote'}` : `${t.label}${isCurrent ? ' (current)' : ''}`;
                                    return <option key={t.workspaceId} value={t.workspaceId}>{label}</option>;
                                })}
                            </select>
                        </div>
                    )}

                    <button
                        type="button"
                        data-testid="implement-plan-card-btn"
                        onClick={handleClick}
                        disabled={disabled}
                        title={latestIsActive ? 'An implementation is already running. Click to start another.' : undefined}
                        className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                            disabled ? 'bg-blue-400 text-white cursor-not-allowed'
                                : latestIsActive ? 'border border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                : 'bg-blue-600 hover:bg-blue-700 text-white',
                        )}
                    >
                        {submitted ? '✓ Implementing' : submitting ? '⏳ Starting…' : hasRuns ? 'Implement again' : 'Implement →'}
                    </button>
                </div>

                {error && (
                    <p className="px-2.5 pb-1.5 text-[11px] text-[#cf222e] dark:text-[#f85149]" data-testid="implement-plan-card-error">
                        {error}
                    </p>
                )}

                {filteredRuns.length > 1 && (
                    <div className="border-t border-[#d0d7de] dark:border-[#3c3c3c] px-2.5 py-1">
                        <button
                            type="button"
                            data-testid="implement-plan-card-expand-btn"
                            onClick={() => setExpanded(!expanded)}
                            className="text-[11px] text-[#57606a] dark:text-[#8b949e] hover:text-[#1f2328] dark:hover:text-[#c9d1d9]"
                        >
                            {expanded ? '▾ Hide runs' : `▸ Show all ${filteredRuns.length} runs`}
                        </button>
                        {expanded && (
                            <div className="mt-1 space-y-1" data-testid="implement-plan-card-run-list">
                                {[...filteredRuns].reverse().map((run, i) => (
                                    <div key={run.processId + '-' + i} className="flex items-center gap-2 text-[11px] text-[#57606a] dark:text-[#8b949e]">
                                        <span>{STATUS_CONFIG[run.liveStatus].emoji} {STATUS_CONFIG[run.liveStatus].label}</span>
                                        <span>· {formatRelativeTime(run.enqueuedAt)}</span>
                                        {describeRunTarget(run) && <span>· {run.isRemoteTarget ? '☁️ ' : ''}{describeRunTarget(run)}</span>}
                                        <button type="button" onClick={() => onViewRun?.(run.processId, run.targetWorkspaceId)} className="ml-auto text-blue-600 dark:text-blue-400 hover:underline">View</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
