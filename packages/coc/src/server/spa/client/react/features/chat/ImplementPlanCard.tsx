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
 *
 * The path-based prompt is only safe when the plan verifiably lives on the
 * server that runs the task. When the SOURCE workspace is itself a remote clone
 * (`sourceIsRemote`), the plan content is always read from the source server and
 * embedded inline — regardless of what the target list claims — so a remote
 * machine's plan path can never leak into a task on the wrong server.
 * The selector is gated entirely by the targets the caller supplies (which come
 * from existing remote repo/server availability), so installs without remote
 * support keep the unchanged local-only UI.
 */

import { useState } from 'react';
import { formatRelativeTime } from '../../utils/format';
import { cn } from '../../ui/cn';
import { ImplementPlanLaunchDialog } from './ImplementPlanLaunchDialog';

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
    /**
     * Chosen AI selection for this run (AC-05), recorded for display only. All
     * optional and absent on legacy records — no schema migration.
     */
    provider?: string;
    effortTier?: string;
    model?: string;
    reasoningEffort?: string;
    autoProviderRouting?: boolean;
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
    /**
     * True when the source workspace (where the plan file lives) is NOT a local
     * workspace of this dashboard's server — a remote clone, or a workspace id
     * this server does not own. Forces the inline-content prompt so a
     * machine-local plan path never leaks into a task on another server.
     */
    sourceIsRemote?: boolean;
    /** Remote routing base URL of the source workspace, when known. */
    sourceBaseUrl?: string;
    /**
     * Open a file-backed plan in the chat's docked source canvas. Canvas-backed
     * plans have no file to open, so this is not exposed for them.
     */
    onOpenPlanFile?: (filePath: string) => void;
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

/** File basename (last path segment) for a plan-file dropdown label. */
function planFileBasename(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

// ── Component ──────────────────────────────────────────────────────────

export function ImplementPlanCard({
    planFilePath,
    planFiles = [],
    planCanvasId,
    workspaceId,
    workingDirectory,
    sourceIsRemote,
    sourceBaseUrl,
    onOpenPlanFile,
    onImplemented,
    existingRuns = [],
    onViewRun,
    sourceProcessId,
    sourceMetadata,
    onRecordPersisted,
    availableTargets,
}: ImplementPlanCardProps) {
    const [expanded, setExpanded] = useState(false);
    // The banner is a trigger: clicking Implement expands the inline launch
    // panel below the banner, which hosts the selectors, AI controls, and the
    // confirm/enqueue action (AC-01). Enqueue never happens directly from the
    // banner.
    const [dialogOpen, setDialogOpen] = useState(false);

    // ── Plan-file selection (AC-02/AC-03) ──────────────────────────────
    // The banner and launch dialog share this selection so the displayed path,
    // status pill, prior-runs list, and implementation action stay scoped to the
    // same file. With 0–1 files this is fixed to planFilePath.
    const showFileSelector = planFiles.length > 1;
    const [selectedPlanFile, setSelectedPlanFile] = useState<string>(planFiles[0] ?? planFilePath);
    const activePlanFilePath = showFileSelector ? selectedPlanFile : planFilePath;
    const canOpenPlanFile = !planCanvasId && onOpenPlanFile !== undefined;

    // Prior runs filtered to the selected plan file (AC-03), matched against each
    // record's `planFilePath`. Single-file keeps the full, unfiltered list.
    const filteredRuns = showFileSelector
        ? existingRuns.filter(r => r.planFilePath === activePlanFilePath)
        : existingRuns;

    const latestRun = filteredRuns.length > 0 ? filteredRuns[filteredRuns.length - 1] : null;
    const latestIsActive = latestRun ? isActiveStatus(latestRun.liveStatus) : false;
    const hasRuns = filteredRuns.length > 0;

    return (
        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-3" data-testid="implement-plan-card">
            <div className="rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#161b22] shadow-sm">
                {/* ── Compact single-row header (PR-banner style) ── */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
                    <span className="shrink-0" aria-hidden="true">🚀</span>
                    <span className="shrink-0 text-xs font-semibold text-[#1f2328] dark:text-[#c9d1d9]">
                        Implement this plan
                    </span>
                    {canOpenPlanFile ? (
                        <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left text-[11px] font-mono text-[#0969da] dark:text-[#58a6ff] underline decoration-dotted underline-offset-2 hover:text-[#0550ae] dark:hover:text-[#79c0ff] focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0969da]/50"
                            data-testid="implement-plan-card-path"
                            onClick={() => onOpenPlanFile?.(activePlanFilePath)}
                            title={`Open this plan in the right-side file panel.\n${activePlanFilePath}`}
                            aria-label={`Open ${planFileBasename(activePlanFilePath)} in the right-side file panel`}
                        >
                            {activePlanFilePath}
                        </button>
                    ) : (
                        <span
                            className="min-w-0 flex-1 truncate text-[11px] font-mono text-[#848484]"
                            title={`Start a new autopilot session to execute the plan.\n${activePlanFilePath}`}
                        >
                            {activePlanFilePath}
                        </span>
                    )}

                    {showFileSelector && (
                        <div className="flex shrink-0 items-center gap-1" data-testid="implement-plan-card-file">
                            <label htmlFor="implement-plan-card-file-select" className="text-[11px] text-[#57606a] dark:text-[#8b949e]">
                                Plan
                            </label>
                            <select
                                id="implement-plan-card-file-select"
                                data-testid="implement-plan-card-file-select"
                                value={selectedPlanFile}
                                onChange={(event) => setSelectedPlanFile(event.target.value)}
                                className="max-w-[12rem] truncate rounded border border-[#d0d7de] bg-white px-1 py-0.5 text-[11px] text-[#1f2328] dark:border-[#3c3c3c] dark:bg-[#0d1117] dark:text-[#c9d1d9]"
                            >
                                {planFiles.map(filePath => (
                                    <option key={filePath} value={filePath}>{planFileBasename(filePath)}</option>
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

                    <button
                        type="button"
                        data-testid="implement-plan-card-btn"
                        onClick={() => setDialogOpen(true)}
                        title={latestIsActive ? 'An implementation is already running. Click to start another.' : undefined}
                        className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                            latestIsActive
                                ? 'border border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                : 'bg-blue-600 hover:bg-blue-700 text-white',
                        )}
                    >
                        {hasRuns ? 'Implement again' : 'Implement →'}
                    </button>
                </div>

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

            <ImplementPlanLaunchDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                planFilePath={planFilePath}
                planFiles={planFiles}
                selectedPlanFile={activePlanFilePath}
                onSelectPlanFile={setSelectedPlanFile}
                planCanvasId={planCanvasId}
                workspaceId={workspaceId}
                workingDirectory={workingDirectory}
                sourceIsRemote={sourceIsRemote}
                sourceBaseUrl={sourceBaseUrl}
                availableTargets={availableTargets}
                sourceProcessId={sourceProcessId}
                sourceMetadata={sourceMetadata}
                onImplemented={onImplemented}
                onRecordPersisted={onRecordPersisted}
            />
        </div>
    );
}
