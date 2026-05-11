/**
 * RalphWorkflowNode — single-iteration node card for the workflow pane.
 *
 * Pure presentational. Renders a status dot, a header line
 * (`Iter N · SIGNAL · duration`), and a body with parsed Files/Decisions/
 * Remaining lines from the journal section. When clicked, calls the
 * supplied handler with the iteration number.
 */

import type React from 'react';
import { cn } from '../../ui/cn';
import { formatDuration } from '../../utils/format';
import type { ParsedProgressSection, RalphIterationRecord } from '@plusplusoneplusplus/coc-client';

export interface RalphWorkflowNodeProps {
    iteration: number;
    /** Matching record entry from `session.json` (when known). */
    record?: RalphIterationRecord;
    /** Matching parsed section from `progress.md` (when written). */
    section?: ParsedProgressSection;
    /** True when this is the iteration that is currently running. */
    isCurrent?: boolean;
    onClick?: (iteration: number) => void;
}

const STATUS_DOT: Record<string, string> = {
    running: 'bg-[#0078d4] dark:bg-[#3794ff] animate-pulse shadow-[0_0_0_3px_rgba(0,120,212,0.22)]',
    completed: 'bg-emerald-500',
    failed: 'bg-rose-500',
    cancelled: 'bg-zinc-400 dark:bg-zinc-500',
    pending: 'bg-zinc-300 dark:bg-zinc-600',
};

const SIGNAL_LABEL: Record<string, string> = {
    RALPH_NEXT: 'NEXT',
    RALPH_COMPLETE: 'COMPLETE',
    NONE: 'no signal',
};

interface ParsedBody {
    files?: string;
    decisions?: string;
    remaining?: string;
    raw?: string;
}

function parseSectionBody(body: string | undefined): ParsedBody {
    if (!body) return {};
    const out: ParsedBody = {};
    const remaining: string[] = [];
    for (const line of body.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const m = t.match(/^(Files|Decisions|Remaining):\s*(.*)$/i);
        if (m) {
            const key = m[1].toLowerCase() as 'files' | 'decisions' | 'remaining';
            out[key] = m[2];
        } else {
            remaining.push(t);
        }
    }
    if (!out.files && !out.decisions && !out.remaining && remaining.length) {
        out.raw = remaining.join('\n');
    }
    return out;
}

function durationLabel(rec?: RalphIterationRecord): string | null {
    if (!rec?.startedAt) return null;
    const start = Date.parse(rec.startedAt);
    if (Number.isNaN(start)) return null;
    const end = rec.endedAt ? Date.parse(rec.endedAt) : Date.now();
    if (Number.isNaN(end) || end < start) return null;
    return formatDuration(end - start);
}

export function RalphWorkflowNode({
    iteration,
    record,
    section,
    isCurrent,
    onClick,
}: RalphWorkflowNodeProps): React.ReactElement {
    const status: string = record?.status ?? (isCurrent ? 'running' : 'pending');
    const signal = section?.signal ?? record?.exitSignal ?? null;
    const duration = durationLabel(record);
    const parsed = parseSectionBody(section?.body);

    return (
        <button
            type="button"
            onClick={onClick ? () => onClick(iteration) : undefined}
            data-testid={`ralph-workflow-node-${iteration}`}
            className={cn(
                'group flex w-full gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-left',
                'shadow-sm hover:bg-zinc-50',
                'dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                isCurrent && 'ring-1 ring-[#0078d4]/40',
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full',
                    STATUS_DOT[status] ?? STATUS_DOT.pending,
                )}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                    <span>Iter {iteration}</span>
                    {signal && (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            {SIGNAL_LABEL[signal] ?? signal}
                        </span>
                    )}
                    {duration && (
                        <span className="ml-auto text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                            {duration}
                        </span>
                    )}
                </div>
                {parsed.raw && (
                    <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-300">{parsed.raw}</p>
                )}
                {parsed.files && (
                    <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-300">
                        <span className="font-semibold">Files:</span> {parsed.files}
                    </p>
                )}
                {parsed.decisions && (
                    <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-300">
                        <span className="font-semibold">Decisions:</span> {parsed.decisions}
                    </p>
                )}
                {parsed.remaining && (
                    <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-300">
                        <span className="font-semibold">Remaining:</span> {parsed.remaining}
                    </p>
                )}
                {!parsed.files && !parsed.decisions && !parsed.remaining && !parsed.raw && (
                    <p className="mt-1 text-xs italic text-zinc-400 dark:text-zinc-500">
                        {status === 'running' ? 'Iteration in progress…' : 'No progress notes yet'}
                    </p>
                )}
            </div>
        </button>
    );
}
