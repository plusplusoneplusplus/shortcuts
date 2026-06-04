/**
 * PullRequestRow — single PR queue row in the redesigned review command
 * queue. Shows a state dot, the PR title, a `#number / files / minutes`
 * meta line, and a deterministic risk pill.
 *
 * Real provider/git diff stats drive file count, review minutes, and risk.
 */

import { cn } from '../../ui';
import { formatRelativeTime } from '../../utils/format';
import {
    queueDotClass,
    queueRiskClass,
} from './pr-derived-data';
import type { QueueDotState } from './pr-derived-data';
import { deriveQueueRisk, estimateReviewMinutes, formatTimestamp } from './pr-utils';
import type { PullRequest, QueueRiskBadge } from './pr-utils';

interface PullRequestRowProps {
    pr: PullRequest;
    onClick: () => void;
    isSelected?: boolean;
    onSelect?: (id: string, checked: boolean, shiftKey: boolean) => void;
    isChecked?: boolean;
    /** When true, the selection checkbox is rendered. Hidden by default. */
    batchMode?: boolean;
    /**
     * When true, the row collapses to a centered state-dot only.
     * Used by the collapsed PR queue rail.
     */
    compact?: boolean;
    /**
     * Optional override for the state dot. When omitted, the dot is
     * derived from the PR status and the deterministic risk level.
     */
    dotState?: QueueDotState;
    /**
     * Optional override for the risk pill. When omitted, the risk is
     * derived from real diff stats.
     */
    risk?: QueueRiskBadge;
    /** When true, show a ⭐ badge indicating this PR is AI-suggested for the user. */
    isSuggested?: boolean;
}

const RISK_LABEL: Record<QueueRiskBadge, string> = {
    low: 'Low',
    med: 'Med',
    high: 'High',
    unknown: 'N/A',
};

function deriveDotState(pr: PullRequest, risk: QueueRiskBadge): QueueDotState {
    if (pr.status === 'draft' || pr.isDraft) return 'draft';
    if (risk === 'high') return 'blocked';
    if (pr.status === 'merged' || pr.status === 'closed') return 'ready';
    return 'open';
}

export function PullRequestRow({
    pr,
    onClick,
    isSelected,
    onSelect,
    isChecked,
    batchMode,
    compact,
    dotState,
    risk,
    isSuggested,
}: PullRequestRowProps) {
    const effectiveRisk: QueueRiskBadge = risk ?? deriveQueueRisk(pr.diffStats);
    const effectiveDot: QueueDotState = dotState ?? deriveDotState(pr, effectiveRisk);
    const fileCount = pr.diffStats?.changedFiles;
    const minutes = estimateReviewMinutes(pr.diffStats);
    const filesLabel = fileCount == null
        ? 'n/a files'
        : `${fileCount} file${fileCount === 1 ? '' : 's'}`;
    const minutesLabel = minutes == null ? 'n/a min' : `${minutes} min`;

    if (compact) {
        return (
            <button
                type="button"
                title={pr.title}
                aria-label={pr.title}
                onClick={onClick}
                data-testid="pr-row"
                data-pr-status={pr.status}
                data-compact="true"
                className={cn(
                    'pr-row relative flex w-full cursor-pointer justify-center border-0 bg-white py-[7px] text-left transition-colors dark:bg-gray-900',
                    isSelected
                        ? "bg-gray-100 before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:bg-gray-500 before:content-[''] dark:bg-gray-700/60 dark:before:bg-gray-400"
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/60',
                )}
            >
                <span
                    aria-hidden="true"
                    className={cn(
                        'pr-state-dot h-[13px] w-[13px] shrink-0 rounded-full border-[2.5px]',
                        queueDotClass(effectiveDot),
                    )}
                    data-testid="pr-state-dot"
                    data-state={effectiveDot}
                />
            </button>
        );
    }

    return (
        <div
            className={cn(
                'pr-row grid w-full cursor-pointer items-start gap-[7px] border-b border-l-[3px] border-gray-100 bg-white py-1.5 pl-2.5 pr-2 text-left transition-colors dark:border-gray-800 dark:bg-gray-900',
                isSelected
                    ? 'border-l-gray-500 bg-gray-100 dark:border-l-gray-400 dark:bg-gray-700/60'
                    : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800/60',
            )}
            style={{ gridTemplateColumns: '16px minmax(0, 1fr) auto' }}
            onClick={onClick}
            data-testid="pr-row"
            data-pr-status={pr.status}
        >
            {batchMode && (
                <input
                    type="checkbox"
                    data-testid="pr-row-checkbox"
                    checked={isChecked ?? false}
                    onChange={e => {
                        e.stopPropagation();
                        const shiftKey = e.nativeEvent instanceof MouseEvent ? e.nativeEvent.shiftKey : false;
                        onSelect?.(String(pr.number ?? pr.id), e.target.checked, shiftKey);
                    }}
                    onClick={e => e.stopPropagation()}
                    className="mr-0.5 mt-0.5 h-3 w-3 shrink-0 cursor-pointer accent-blue-500"
                />
            )}
            {!batchMode && (
                <span
                    aria-hidden="true"
                    className={cn(
                        'pr-state-dot mt-[2px] h-[13px] w-[13px] shrink-0 rounded-full border-[2.5px]',
                        queueDotClass(effectiveDot),
                    )}
                    data-testid="pr-state-dot"
                    data-state={effectiveDot}
                />
            )}
            <div className="min-w-0">
                <span
                    className="pr-title block truncate text-[12px] font-semibold leading-[1.25] text-gray-900 dark:text-gray-100"
                    title={pr.title}
                >
                    {isSuggested && (
                        <span
                            className="pr-suggested-badge mr-0.5 text-yellow-500"
                            data-testid="pr-suggested-badge"
                            aria-label="Suggested for you"
                        >⭐</span>
                    )}
                    {pr.title}
                </span>
                <div className="pr-meta mt-px flex items-center gap-1 text-[11px] leading-[1.3] text-gray-500 dark:text-gray-400">
                    {pr.number != null && (
                        <span className="pr-number font-mono tabular-nums">#{pr.number}</span>
                    )}
                    <span>{filesLabel}</span>
                    <span>{minutesLabel}</span>
                    {pr.updatedAt && (
                        <span
                            className="pr-updated-at"
                            data-testid="pr-updated-at"
                            title={formatTimestamp(pr.updatedAt)}
                        >
                            {formatRelativeTime(pr.updatedAt)}
                        </span>
                    )}
                </div>
            </div>
            <span
                className={cn(
                    'pr-risk inline-flex h-[18px] min-w-[38px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold uppercase tracking-normal leading-none',
                    queueRiskClass(effectiveRisk),
                )}
                data-testid="pr-risk-pill"
                data-risk={effectiveRisk}
            >
                {RISK_LABEL[effectiveRisk]}
            </span>
        </div>
    );
}
