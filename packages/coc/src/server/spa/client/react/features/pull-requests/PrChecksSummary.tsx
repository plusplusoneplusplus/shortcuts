/**
 * Shared, compact CI-checks rendering used by BOTH the full PR-detail
 * `PrChecksTable` (via the shared {@link checkStatusLabel}) and the chat
 * `PrStatusCard` (AC-03 — `PrChecksCompact`).
 *
 * This module is the single home for the check-status → label / icon / summary
 * logic, so the two surfaces share one implementation instead of copy-pasting
 * check-status handling. `PrChecksAndReadiness` imports {@link checkStatusLabel}
 * from here; the chat card renders {@link PrChecksCompact}. Both reuse
 * {@link checkStatusClass} from `pr-derived-data` and the rows produced by
 * `buildCheckRowsFromChecks` (the existing `/checks` endpoint adapter) — no new
 * check transform or copy-pasted status logic is introduced.
 */
import { cn } from '../../ui';
import { checkStatusClass } from './pr-derived-data';
import type { PrCheckRow, CheckStatus } from './pr-derived-data';

/** Human label for a check status (shared with `PrChecksTable`). */
export function checkStatusLabel(status: CheckStatus): string {
    switch (status) {
        case 'success':   return 'Passed';
        case 'warning':   return 'Needs review';
        case 'failure':   return 'Failed';
        case 'cancelled': return 'Cancelled';
        case 'skipped':   return 'Skipped';
        case 'pending':   return 'Pending';
        case 'running':   return 'Running';
        case 'unknown':   return 'Unknown';
    }
}

/** Compact status glyph for the per-check list (colored via `checkStatusClass`). */
const CHECK_STATUS_EMOJI: Record<CheckStatus, string> = {
    success:   '✓',
    warning:   '⚠',
    failure:   '✕',
    cancelled: '⊘',
    skipped:   '–',
    pending:   '○',
    running:   '●',
    unknown:   '?',
};

export function checkStatusEmoji(status: CheckStatus): string {
    return CHECK_STATUS_EMOJI[status];
}

/** Per-status counts for the checks summary. Lossless — `total` = sum of buckets. */
export interface CheckStatusSummary {
    total: number;
    passing: number;
    failing: number;
    pending: number;
    skipped: number;
    warning: number;
    cancelled: number;
    unknown: number;
}

/**
 * Tallies check rows into the summary buckets (AC-03 — passing / failing /
 * pending / skipped counts, plus warning / cancelled / unknown so the total is
 * lossless). `running` folds into `pending` (both "in progress").
 */
export function summarizeCheckRows(rows: readonly PrCheckRow[]): CheckStatusSummary {
    const summary: CheckStatusSummary = {
        total: rows.length,
        passing: 0,
        failing: 0,
        pending: 0,
        skipped: 0,
        warning: 0,
        cancelled: 0,
        unknown: 0,
    };
    for (const row of rows) {
        switch (row.status) {
            case 'success':   summary.passing += 1; break;
            case 'failure':   summary.failing += 1; break;
            case 'pending':
            case 'running':   summary.pending += 1; break;
            case 'skipped':   summary.skipped += 1; break;
            case 'warning':   summary.warning += 1; break;
            case 'cancelled': summary.cancelled += 1; break;
            case 'unknown':   summary.unknown += 1; break;
        }
    }
    return summary;
}

/** Display order + styling for the non-zero summary chips (problems first). */
const SUMMARY_CHIPS: Array<{
    key: Exclude<keyof CheckStatusSummary, 'total'>;
    label: string;
    toneClass: string;
}> = [
    { key: 'failing',   label: 'failing',   toneClass: 'bg-[#ffebe9] text-[#cf222e] dark:bg-[#f85149]/20 dark:text-[#f85149]' },
    { key: 'warning',   label: 'warning',   toneClass: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200' },
    { key: 'pending',   label: 'pending',   toneClass: 'bg-[#ddf4ff] text-[#0969da] dark:bg-[#388bfd]/25 dark:text-[#58a6ff]' },
    { key: 'passing',   label: 'passing',   toneClass: 'bg-[#dafbe1] text-[#1a7f37] dark:bg-[#238636]/25 dark:text-[#3fb950]' },
    { key: 'skipped',   label: 'skipped',   toneClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
    { key: 'cancelled', label: 'cancelled', toneClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
    { key: 'unknown',   label: 'unknown',   toneClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
];

/**
 * Just the non-zero summary chips for a set of check rows (problems-first order),
 * extracted so BOTH the expanded {@link PrChecksCompact} list AND the always-visible
 * inline summary on the chat card's Checks line render the same chips from one
 * implementation. Renders nothing when there are no rows. Reuses
 * {@link summarizeCheckRows} + {@link SUMMARY_CHIPS} (no copy-pasted status logic).
 */
export function PrChecksSummaryChips({
    rows,
    testId = 'pr-checks-compact',
}: {
    rows: readonly PrCheckRow[];
    /** Namespaces the data-testids so multiple cards don't collide. */
    testId?: string;
}) {
    if (rows.length === 0) return null;
    const summary = summarizeCheckRows(rows);
    return (
        <div className="flex flex-wrap items-center gap-1" data-testid={`${testId}-summary`}>
            {SUMMARY_CHIPS.filter(chip => summary[chip.key] > 0).map(chip => (
                <span
                    key={chip.key}
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        chip.toneClass,
                    )}
                    data-testid={`${testId}-count-${chip.key}`}
                    data-count={summary[chip.key]}
                >
                    {summary[chip.key]} {chip.label}
                </span>
            ))}
        </div>
    );
}

/** Per-PR checks fetch lifecycle. */
export type PrChecksCompactState = 'loading' | 'ready' | 'error';

export interface PrChecksCompactProps {
    state: PrChecksCompactState;
    rows: readonly PrCheckRow[];
    error?: string;
    /** Re-fetch the checks (shown on error). */
    onRetry?: () => void;
    /** Namespaces the data-testids so multiple cards don't collide. */
    testId?: string;
}

/**
 * Compact checks panel — a summary-count line plus a per-check list (status
 * glyph, name with optional details link, status label, duration). Shared by the
 * chat PR status card; reuses {@link summarizeCheckRows} / {@link checkStatusLabel}
 * / {@link checkStatusClass} (no copy-pasted check-status logic).
 */
export function PrChecksCompact({ state, rows, error, onRetry, testId = 'pr-checks-compact' }: PrChecksCompactProps) {
    if (state === 'loading') {
        return (
            <div
                className="flex items-center gap-1.5 px-1 py-1 text-[11px] text-[#57606a] dark:text-[#8b949e]"
                data-testid={`${testId}-loading`}
            >
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#d0d7de] dark:bg-[#30363d]" aria-hidden="true" />
                <span>Loading checks…</span>
            </div>
        );
    }

    if (state === 'error') {
        return (
            <div
                className="flex flex-wrap items-center gap-1.5 px-1 py-1 text-[11px]"
                data-testid={`${testId}-error`}
                role="alert"
            >
                <span className="text-[#cf222e] dark:text-[#f85149]">{error || 'Failed to load checks.'}</span>
                {onRetry && (
                    <button
                        type="button"
                        className="rounded px-1 py-0.5 font-medium text-[#0969da] dark:text-[#58a6ff] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                        data-testid={`${testId}-retry`}
                        onClick={onRetry}
                    >
                        Retry
                    </button>
                )}
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <p
                className="m-0 px-1 py-1 text-[11px] italic text-[#57606a] dark:text-[#8b949e]"
                data-testid={`${testId}-empty`}
            >
                No CI checks reported yet.
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-1" data-testid={`${testId}`}>
            <PrChecksSummaryChips rows={rows} testId={testId} />
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {rows.map(row => (
                    <li
                        key={row.id}
                        className="flex items-center gap-1.5 text-[11px] leading-snug"
                        data-testid={`${testId}-row`}
                        data-status={row.status}
                    >
                        <span className={cn('shrink-0 font-semibold', checkStatusClass(row.status))} aria-hidden="true">
                            {checkStatusEmoji(row.status)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[#1f2328] dark:text-[#c9d1d9]" title={row.name}>
                            {row.detailsUrl ? (
                                <a
                                    href={row.detailsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#0969da] hover:underline dark:text-[#58a6ff]"
                                    data-testid={`${testId}-link`}
                                >
                                    {row.name}
                                </a>
                            ) : (
                                row.name
                            )}
                        </span>
                        <span className={cn('shrink-0 font-medium', checkStatusClass(row.status))}>
                            {checkStatusLabel(row.status)}
                        </span>
                        {row.duration && (
                            <span className="shrink-0 font-mono tabular-nums text-[#57606a] dark:text-[#8b949e]">
                                {row.duration}
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
