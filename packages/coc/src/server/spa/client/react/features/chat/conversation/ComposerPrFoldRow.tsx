/**
 * ComposerPrFoldRow — the single compact row that stands in for the composer PR
 * chips folded away by {@link partitionComposerPrChips}.
 *
 * Deliberately shorter than a real chip (`py-1` against the chip's `py-1.5`) but
 * otherwise the same surface and divider, so the stack still reads as one
 * continuous rail docked in the composer.
 *
 * Left to right: the disclosure chevron, overlapping state dots for the first few
 * folded PRs, the count, a `4 merged · 1 closed` breakdown, and the folded PR
 * numbers pushed right. That is enough to tell whether anything down there needs
 * attention without expanding it.
 */
import React from 'react';
import { cn } from '../../../ui/cn';
import { prStatusBadge } from '../../pull-requests/pr-utils';
import type { FoldedPrChipsSummary } from './composerPrChipFold';

const FOLD_ROW_CLASS =
    'flex w-full items-center gap-2 px-3 py-1 text-left text-xs ' +
    'bg-[#f6f8fa] dark:bg-[#161b22] ' +
    'border-0 border-b border-solid border-[#d0d7de] dark:border-[#3c3c3c] ' +
    'cursor-pointer hover:brightness-[0.98] dark:hover:brightness-110';

/** Solid dot fill per PR status — the muted echo of {@link prStatusBadge}. */
function dotClass(status: string): string {
    switch (status) {
        case 'open':   return 'bg-[#1a7f37] dark:bg-[#3fb950]';
        case 'draft':  return 'bg-[#9a6700] dark:bg-[#d29922]';
        case 'merged': return 'bg-[#8250df] dark:bg-[#a371f7]';
        case 'closed': return 'bg-[#cf222e] dark:bg-[#f85149]';
        default:       return 'bg-[#57606a] dark:bg-[#8b949e]';
    }
}

/**
 * Overlapping status dots. Each dot carries a ring in the row's own background so
 * the overlap reads as a stack rather than a smear.
 */
function FoldDots({ statuses }: { statuses: string[] }) {
    if (statuses.length === 0) return null;
    return (
        <span className="flex shrink-0 items-center" data-testid="composer-pr-fold-dots" aria-hidden="true">
            {statuses.map((status, idx) => (
                <span
                    key={`${status}-${idx}`}
                    className={cn(
                        'h-2 w-2 rounded-full ring-1 ring-[#f6f8fa] dark:ring-[#161b22]',
                        idx > 0 && '-ml-1',
                        dotClass(status),
                    )}
                    data-status={status}
                />
            ))}
        </span>
    );
}

export interface ComposerPrFoldRowProps {
    /** Tally of what is hidden, from {@link summarizeFoldedPrChips}. */
    summary: FoldedPrChipsSummary;
    /** Whether the folded chips are currently rendered below this row. */
    open: boolean;
    /** Toggle the fold. */
    onToggle: () => void;
}

export function ComposerPrFoldRow({ summary, open, onToggle }: ComposerPrFoldRowProps) {
    const label = `${summary.count} earlier ${summary.count === 1 ? 'PR' : 'PRs'}`;
    const numbers = summary.numbers.map(n => `#${n}`).join(' ');

    return (
        <button
            type="button"
            className={FOLD_ROW_CLASS}
            onClick={onToggle}
            aria-expanded={open}
            title={`${label} — ${summary.breakdownText}`}
            data-testid="composer-pr-fold-row"
            data-open={open ? 'true' : 'false'}
            data-count={summary.count}
        >
            <span
                className="shrink-0 w-3 text-center text-[10px] text-[#57606a] dark:text-[#8b949e]"
                aria-hidden="true"
            >
                {open ? '▾' : '▸'}
            </span>
            <FoldDots statuses={summary.dotStatuses} />
            <span
                className="shrink-0 font-medium text-[#1f2328] dark:text-[#c9d1d9]"
                data-testid="composer-pr-fold-count"
            >
                {label}
            </span>
            {summary.breakdownText && (
                <span
                    className="shrink-0 text-[#57606a] dark:text-[#8b949e]"
                    data-testid="composer-pr-fold-breakdown"
                >
                    {summary.breakdownText}
                </span>
            )}
            <span
                className="ml-auto min-w-0 truncate font-mono text-[11px] text-[#57606a] dark:text-[#8b949e]"
                data-testid="composer-pr-fold-numbers"
            >
                {numbers}
            </span>
        </button>
    );
}
