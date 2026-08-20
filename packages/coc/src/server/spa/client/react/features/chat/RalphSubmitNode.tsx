/**
 * RalphSubmitNode — single PR-submit node card for the workflow pane.
 *
 * Pure presentational. Renders a status dot, a header line
 * (`PR submit #N · STATUS`), and a status-dependent body: the PR link on a
 * completed submit, the failure reason on a failed one, progress copy
 * otherwise. When a `processId` is present and an `onSelect` handler is
 * supplied, the card is clickable and forwards that process id so the host
 * can open the submit chat in the detail pane. The card root is a `div`
 * (not a `button`) because a completed node nests a real `<a>` link.
 */

import type React from 'react';
import { cn } from '../../ui/cn';
import { formatDuration } from '../../utils/format';
import type { RalphSubmitRecord, RalphSubmitStatus } from '@plusplusoneplusplus/coc-client';

export interface RalphSubmitNodeProps {
    submit: RalphSubmitRecord;
    /** Called with the recorded `processId` when a clickable node is selected. */
    onSelect?: (processId: string) => void;
}

const STATUS_DOT: Record<RalphSubmitStatus, string> = {
    queued: 'bg-zinc-300 dark:bg-zinc-600',
    running: 'bg-[#0078d4] dark:bg-[#3794ff] animate-pulse shadow-[0_0_0_3px_rgba(0,120,212,0.22)]',
    completed: 'bg-emerald-500',
    failed: 'bg-rose-500',
};

const STATUS_LABEL: Record<RalphSubmitStatus, string> = {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
};

function durationLabel(submit: RalphSubmitRecord): string | null {
    if (!submit.startedAt) return null;
    const start = Date.parse(submit.startedAt);
    if (Number.isNaN(start)) return null;
    const end = submit.completedAt ? Date.parse(submit.completedAt) : Date.now();
    if (Number.isNaN(end) || end < start) return null;
    return formatDuration(end - start);
}

export function RalphSubmitNode({ submit, onSelect }: RalphSubmitNodeProps): React.ReactElement {
    const clickable = Boolean(submit.processId && onSelect);
    const duration = durationLabel(submit);

    const handleSelect = clickable
        ? () => onSelect?.(submit.processId as string)
        : undefined;

    return (
        <div
            role="button"
            tabIndex={clickable ? 0 : -1}
            aria-disabled={!clickable}
            onClick={handleSelect}
            onKeyDown={handleSelect
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect();
                    }
                }
                : undefined}
            data-testid={`ralph-submit-node-${submit.submitIndex}`}
            aria-label={`PR submit #${submit.submitIndex}`}
            className={cn(
                'group flex w-full gap-3 rounded-md border border-l-2 px-3 py-2 text-left',
                'border-emerald-200 border-l-emerald-400 bg-emerald-50/60 shadow-sm',
                'dark:border-emerald-800 dark:border-l-emerald-500 dark:bg-emerald-950/30',
                clickable ? 'cursor-pointer hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40' : 'cursor-default',
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full',
                    STATUS_DOT[submit.status] ?? STATUS_DOT.queued,
                )}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                    <span>PR submit #{submit.submitIndex}</span>
                    <span
                        className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200"
                        data-testid={`ralph-submit-status-${submit.submitIndex}`}
                    >
                        {STATUS_LABEL[submit.status] ?? submit.status}
                    </span>
                    {duration && (
                        <span className="ml-auto text-[10px] tabular-nums text-emerald-500 dark:text-emerald-400">
                            {duration}
                        </span>
                    )}
                </div>
                {submit.status === 'completed' && submit.prUrl ? (
                    <p className="mt-1 truncate text-xs">
                        <a
                            href={submit.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`ralph-submit-link-${submit.submitIndex}`}
                            className="text-emerald-700 underline hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
                        >
                            {typeof submit.prNumber === 'number' ? `PR #${submit.prNumber}` : submit.prUrl}
                        </a>
                    </p>
                ) : (
                    <p
                        className="mt-1 truncate text-xs text-emerald-700 dark:text-emerald-300"
                        data-testid={`ralph-submit-summary-${submit.submitIndex}`}
                    >
                        {submit.status === 'failed'
                            ? (submit.error ?? 'Submit failed')
                            : submit.status === 'running'
                                ? 'Publishing pull request…'
                                : submit.status === 'completed'
                                    ? 'Completed'
                                    : 'Queued for submit'}
                    </p>
                )}
            </div>
        </div>
    );
}
