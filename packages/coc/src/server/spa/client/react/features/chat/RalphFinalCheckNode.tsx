/**
 * RalphFinalCheckNode — single final-check node card for the workflow pane.
 *
 * Pure presentational. Renders a status dot, a header line
 * (`Final check #N · STATUS`), and a gap-outcome summary derived from the
 * `RalphFinalCheckRecord`. When a `processId` is present and an `onSelect`
 * handler is supplied, the node is clickable and forwards that process id so
 * the host can open the final-check chat in the detail pane. Without a
 * `processId` (or handler) it renders as a disabled, non-clickable card.
 */

import type React from 'react';
import { cn } from '../../ui/cn';
import { formatDuration } from '../../utils/format';
import type { RalphFinalCheckRecord, RalphFinalCheckStatus } from '@plusplusoneplusplus/coc-client';

export interface RalphFinalCheckNodeProps {
    check: RalphFinalCheckRecord;
    /** Called with the recorded `processId` when a clickable node is selected. */
    onSelect?: (processId: string) => void;
}

const STATUS_DOT: Record<RalphFinalCheckStatus, string> = {
    queued: 'bg-zinc-300 dark:bg-zinc-600',
    running: 'bg-[#0078d4] dark:bg-[#3794ff] animate-pulse shadow-[0_0_0_3px_rgba(0,120,212,0.22)]',
    completed: 'bg-emerald-500',
    failed: 'bg-rose-500',
};

const STATUS_LABEL: Record<RalphFinalCheckStatus, string> = {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
};

/**
 * Human-readable gap outcome. Returns `No gaps`, `1 gap`, or `<N> gaps` for a
 * completed check; an in-progress/unknown copy otherwise.
 */
export function describeGapOutcome(check: RalphFinalCheckRecord): string {
    if (check.status === 'completed') {
        if (check.hasGaps === false) return 'No gaps';
        if (typeof check.gapCount === 'number') {
            if (check.gapCount <= 0) return 'No gaps';
            return check.gapCount === 1 ? '1 gap' : `${check.gapCount} gaps`;
        }
        if (check.hasGaps === true) return 'Gaps found';
        return 'Outcome unknown';
    }
    if (check.status === 'failed') return 'Check did not complete';
    if (check.status === 'running') return 'Checking for gaps…';
    return 'Queued for validation';
}

function durationLabel(check: RalphFinalCheckRecord): string | null {
    if (!check.startedAt) return null;
    const start = Date.parse(check.startedAt);
    if (Number.isNaN(start)) return null;
    const end = check.completedAt ? Date.parse(check.completedAt) : Date.now();
    if (Number.isNaN(end) || end < start) return null;
    return formatDuration(end - start);
}

export function RalphFinalCheckNode({ check, onSelect }: RalphFinalCheckNodeProps): React.ReactElement {
    const clickable = Boolean(check.processId && onSelect);
    const duration = durationLabel(check);
    const gapOutcome = describeGapOutcome(check);

    return (
        <button
            type="button"
            disabled={!clickable}
            onClick={clickable ? () => onSelect?.(check.processId as string) : undefined}
            data-testid={`ralph-final-check-node-${check.checkIndex}`}
            aria-label={`Final check #${check.checkIndex}`}
            className={cn(
                'group flex w-full gap-3 rounded-md border border-l-2 px-3 py-2 text-left',
                'border-violet-200 border-l-violet-400 bg-violet-50/60 shadow-sm',
                'dark:border-violet-800 dark:border-l-violet-500 dark:bg-violet-950/30',
                clickable ? 'hover:bg-violet-100/70 dark:hover:bg-violet-900/40' : 'cursor-default',
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full',
                    STATUS_DOT[check.status] ?? STATUS_DOT.queued,
                )}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-medium text-violet-800 dark:text-violet-200">
                    <span>Final check #{check.checkIndex}</span>
                    <span
                        className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-violet-700 dark:bg-violet-900/60 dark:text-violet-200"
                        data-testid={`ralph-final-check-status-${check.checkIndex}`}
                    >
                        {STATUS_LABEL[check.status] ?? check.status}
                    </span>
                    {duration && (
                        <span className="ml-auto text-[10px] tabular-nums text-violet-500 dark:text-violet-400">
                            {duration}
                        </span>
                    )}
                </div>
                <p
                    className="mt-1 truncate text-xs text-violet-700 dark:text-violet-300"
                    data-testid={`ralph-final-check-gaps-${check.checkIndex}`}
                >
                    {gapOutcome}
                </p>
            </div>
        </button>
    );
}
