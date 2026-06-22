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

    const latestRun = existingRuns.length > 0 ? existingRuns[existingRuns.length - 1] : null;
    const latestIsActive = latestRun ? isActiveStatus(latestRun.liveStatus) : false;
    const hasRuns = existingRuns.length > 0;

    async function readSourcePlanContent(): Promise<string> {
        try {
            const blob = await sourceClient.explorer.readTrustedBlob(planFilePath);
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

    async function handleClick() {
        if (submitting || submitted) return;
        setSubmitting(true);
        setError(null);
        try {
            const isRemote = !!selectedTarget?.isRemote;
            const targetWorkspaceId = selectedTarget?.workspaceId ?? workspaceId;
            const targetWorkingDirectory = selectedTarget?.workingDirectory ?? workingDirectory;

            // Local runs reference the plan file path (existing convention); remote
            // runs embed the plan content read from the initiating server (AC-04).
            let prompt: string;
            let context: { files: string[] } | undefined;
            if (isRemote) {
                const planContent = await readSourcePlanContent();
                prompt = buildRemotePrompt(planFilePath, planContent);
                context = undefined;
            } else {
                prompt = `Read and implement the plan file at ${planFilePath}`;
                context = { files: [planFilePath] };
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
                    planFilePath,
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
        <div
            className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-3"
            data-testid="implement-plan-card"
        >
            <div className="rounded-md border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f7f7f7] dark:bg-[#252526] p-3">
                {/* ── Banner: prior runs ─────────────────────────── */}
                {hasRuns && latestRun && (
                    <div data-testid="implement-plan-card-banner">
                        <div className="flex items-center gap-2 text-sm">
                            <span data-testid="implement-plan-card-status-pill">
                                {STATUS_CONFIG[latestRun.liveStatus].emoji}{' '}
                                {STATUS_CONFIG[latestRun.liveStatus].label}
                            </span>
                            <span className="text-[#848484]">·</span>
                            <span className="text-xs text-[#5a5a5a] dark:text-[#999]">
                                started {formatRelativeTime(latestRun.enqueuedAt)}
                                {existingRuns.length > 1 && ` · ${existingRuns.length} runs total`}
                            </span>
                            {describeRunTarget(latestRun) && (
                                <span
                                    className="text-xs text-[#5a5a5a] dark:text-[#999]"
                                    data-testid="implement-plan-card-target-label"
                                >
                                    <span className="text-[#848484]">·</span>{' '}
                                    {latestRun.isRemoteTarget ? '☁️ ' : ''}
                                    {describeRunTarget(latestRun)}
                                </span>
                            )}
                            <div className="ml-auto flex-shrink-0">
                                <button
                                    type="button"
                                    data-testid="implement-plan-card-view-btn"
                                    onClick={() => onViewRun?.(latestRun.processId, latestRun.targetWorkspaceId)}
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                                >
                                    View →
                                </button>
                            </div>
                        </div>

                        {/* Expandable list for additional runs */}
                        {existingRuns.length > 1 && (
                            <div className="mt-1">
                                <button
                                    type="button"
                                    data-testid="implement-plan-card-expand-btn"
                                    onClick={() => setExpanded(!expanded)}
                                    className="text-[11px] text-[#848484] hover:text-[#5a5a5a] dark:hover:text-[#bbb]"
                                >
                                    {expanded ? '▾ Hide runs' : `▸ Show all ${existingRuns.length} runs`}
                                </button>
                                {expanded && (
                                    <div className="mt-1 space-y-1" data-testid="implement-plan-card-run-list">
                                        {[...existingRuns].reverse().map((run, i) => (
                                            <div key={run.processId + '-' + i} className="flex items-center gap-2 text-[11px] text-[#5a5a5a] dark:text-[#999]">
                                                <span>{STATUS_CONFIG[run.liveStatus].emoji} {STATUS_CONFIG[run.liveStatus].label}</span>
                                                <span className="text-[#848484]">·</span>
                                                <span>{formatRelativeTime(run.enqueuedAt)}</span>
                                                {describeRunTarget(run) && (
                                                    <>
                                                        <span className="text-[#848484]">·</span>
                                                        <span>{run.isRemoteTarget ? '☁️ ' : ''}{describeRunTarget(run)}</span>
                                                    </>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => onViewRun?.(run.processId, run.targetWorkspaceId)}
                                                    className="ml-auto text-blue-600 dark:text-blue-400 hover:underline"
                                                >
                                                    View
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="my-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
                    </div>
                )}

                {/* ── Main CTA area ─────────────────────────────── */}
                <div className="flex items-start gap-3">
                    <div className="text-xl leading-none" aria-hidden="true">🚀</div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            Implement this plan
                        </div>
                        <p className="mt-0.5 text-xs text-[#5a5a5a] dark:text-[#999]">
                            Start a new autopilot session to execute the plan produced in this conversation.
                        </p>
                        <p className="mt-1 text-[11px] font-mono text-[#848484] truncate" title={planFilePath}>
                            {planFilePath}
                        </p>
                        {showSelector && (
                            <div
                                className="mt-2 flex items-center gap-2"
                                data-testid="implement-plan-card-target"
                            >
                                <label
                                    htmlFor="implement-plan-card-target-select"
                                    className="text-[11px] text-[#5a5a5a] dark:text-[#999] flex-shrink-0"
                                >
                                    Run in
                                </label>
                                <select
                                    id="implement-plan-card-target-select"
                                    data-testid="implement-plan-card-target-select"
                                    value={selectedTargetId}
                                    onChange={(e) => setSelectedTargetId(e.target.value)}
                                    disabled={disabled}
                                    className="text-xs rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] px-1.5 py-0.5 max-w-[16rem] truncate disabled:opacity-60"
                                >
                                    {targets.map(t => {
                                        const isCurrent = t.workspaceId === workspaceId;
                                        const label = t.isRemote
                                            ? `${t.label} · ${t.serverLabel ?? 'remote'}`
                                            : `${t.label}${isCurrent ? ' (current)' : ''}`;
                                        return (
                                            <option key={t.workspaceId} value={t.workspaceId}>
                                                {label}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                        )}
                        {error && (
                            <p className="mt-1 text-xs text-[#f14c4c]" data-testid="implement-plan-card-error">
                                {error}
                            </p>
                        )}
                    </div>
                    <div className="flex-shrink-0">
                        <button
                            type="button"
                            data-testid="implement-plan-card-btn"
                            onClick={handleClick}
                            disabled={disabled}
                            title={latestIsActive ? 'An implementation is already running. Click to start another.' : undefined}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                                disabled
                                    ? 'bg-blue-400 text-white cursor-not-allowed'
                                    : latestIsActive
                                        ? 'border border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                        : 'bg-blue-600 hover:bg-blue-700 text-white',
                            )}
                        >
                            {submitted ? '✓ Implementing' : submitting ? '⏳ Starting…' : hasRuns ? 'Implement again' : 'Implement →'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
