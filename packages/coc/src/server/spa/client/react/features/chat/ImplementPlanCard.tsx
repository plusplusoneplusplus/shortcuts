/**
 * ImplementPlanCard — inline action card shown after a completed plan-file chat.
 *
 * Renders a CTA that enqueues a new autopilot task referencing the plan file.
 * When prior implementation runs exist (recorded in task metadata), a status
 * banner is rendered above the CTA showing the most recent run's live status,
 * total run count, and a link to navigate to any recorded run.
 */

import { useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { isQueueProcessId, toQueueProcessId } from '../../utils/queue-process-id';
import { formatRelativeTime } from '../../utils/format';
import { cn } from '../../ui/cn';

// ── Types ──────────────────────────────────────────────────────────────

/** Persisted in `task.metadata.implementations` on the source plan-file task. */
export interface ImplementationRecord {
    processId: string;
    planFilePath: string;
    enqueuedAt: string; // ISO
}

export type RunLiveStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';

/** Merged record + live status for rendering. */
export interface ExistingRun extends ImplementationRecord {
    liveStatus: RunLiveStatus;
}

// ── Props ──────────────────────────────────────────────────────────────

export interface ImplementPlanCardProps {
    planFilePath: string;
    workspaceId?: string;
    workingDirectory?: string;
    onImplemented: (newProcessId: string) => void;
    /** Existing implementation runs with resolved live status. */
    existingRuns?: ExistingRun[];
    /** Navigate to a recorded run's chat detail. */
    onViewRun?: (processId: string) => void;
    /** Source process ID (for persisting implementation records). */
    sourceProcessId?: string;
    /** Current metadata of the source process (for merge-patching). */
    sourceMetadata?: Record<string, unknown>;
    /** Called after a new implementation record is persisted (for optimistic local update). */
    onRecordPersisted?: (record: ImplementationRecord) => void;
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
}: ImplementPlanCardProps) {
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);

    const latestRun = existingRuns.length > 0 ? existingRuns[existingRuns.length - 1] : null;
    const latestIsActive = latestRun ? isActiveStatus(latestRun.liveStatus) : false;
    const hasRuns = existingRuns.length > 0;

    async function handleClick() {
        if (submitting || submitted) return;
        setSubmitting(true);
        setError(null);
        try {
            const result = await getSpaCocClient().queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: 'autopilot' as any,
                    prompt: `Read and implement the plan file at ${planFilePath}`,
                    context: { files: [planFilePath] },
                    workingDirectory,
                    workspaceId,
                } as any,
            });
            const rawId = (result as any).task?.id ?? (result as any).id;
            if (!rawId) throw new Error('No task id returned from enqueue');
            const processId = isQueueProcessId(rawId) ? rawId : toQueueProcessId(rawId);

            // Persist implementation record on the source task (best-effort)
            if (sourceProcessId) {
                const record: ImplementationRecord = {
                    processId,
                    planFilePath,
                    enqueuedAt: new Date().toISOString(),
                };
                const prevImpls = Array.isArray(sourceMetadata?.implementations)
                    ? (sourceMetadata!.implementations as ImplementationRecord[])
                    : [];
                const merged = {
                    ...(sourceMetadata ?? {}),
                    implementations: [...prevImpls, record],
                };
                try {
                    await getSpaCocClient().processes.update(sourceProcessId, { metadata: merged } as any);
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
                            <div className="ml-auto flex-shrink-0">
                                <button
                                    type="button"
                                    data-testid="implement-plan-card-view-btn"
                                    onClick={() => onViewRun?.(latestRun.processId)}
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
                                                <button
                                                    type="button"
                                                    onClick={() => onViewRun?.(run.processId)}
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
