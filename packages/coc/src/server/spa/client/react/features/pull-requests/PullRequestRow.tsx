/**
 * PullRequestRow — single PR queue row in the redesigned review command
 * queue. Shows a state dot, the PR title, a `#number / files / minutes`
 * meta line, and a deterministic AI risk pill.
 *
 * AI metadata (file count, review minutes, risk level) is sourced from
 * `pr-mock-data` until a real AI backend is wired up. Real data still
 * drives the title, status, and PR number.
 */

import { cn } from '../../ui';
import {
    getMockPrFileCount,
    getMockPrReviewMinutes,
    getMockQueueRisk,
    queueDotClass,
    queueRiskClass,
} from './pr-mock-data';
import type { QueueDotState, QueueRiskBadge } from './pr-mock-data';
import type { PullRequest } from './pr-utils';

interface PullRequestRowProps {
    pr: PullRequest;
    onClick: () => void;
    isSelected?: boolean;
    onSelect?: (id: string, checked: boolean, shiftKey: boolean) => void;
    isChecked?: boolean;
    /** When true, the selection checkbox is rendered. Hidden by default. */
    batchMode?: boolean;
    /**
     * Optional override for the state dot. When omitted, the dot is
     * derived from the PR status and the AI-flagged risk level.
     */
    dotState?: QueueDotState;
    /**
     * Optional override for the risk pill. When omitted, the risk is
     * sourced from the deterministic AI mock summary.
     */
    risk?: QueueRiskBadge;
}

const RISK_LABEL: Record<QueueRiskBadge, string> = {
    low: 'Low',
    med: 'Med',
    high: 'High',
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
    dotState,
    risk,
}: PullRequestRowProps) {
    const effectiveRisk: QueueRiskBadge = risk ?? getMockQueueRisk(pr);
    const effectiveDot: QueueDotState = dotState ?? deriveDotState(pr, effectiveRisk);
    const fileCount = getMockPrFileCount(pr);
    const minutes = getMockPrReviewMinutes(pr);

    return (
        <div
            className={cn(
                'pr-row grid w-full cursor-pointer items-start gap-2.5 border-b border-l-[3px] border-gray-100 bg-white px-3.5 py-2.5 text-left transition-colors dark:border-gray-800 dark:bg-gray-900',
                isSelected
                    ? 'border-l-blue-500 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-800/60',
            )}
            style={{ gridTemplateColumns: '18px minmax(0, 1fr) auto' }}
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
                    className="mr-1 mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-500"
                />
            )}
            {!batchMode && (
                <span
                    aria-hidden="true"
                    className={cn(
                        'pr-state-dot mt-[3px] h-3.5 w-3.5 shrink-0 rounded-full',
                        queueDotClass(effectiveDot),
                    )}
                    data-testid="pr-state-dot"
                    data-state={effectiveDot}
                />
            )}
            <div className="min-w-0">
                <span
                    className="pr-title block truncate text-[13px] font-semibold leading-snug text-gray-900 dark:text-gray-100"
                    title={pr.title}
                >
                    {pr.title}
                </span>
                <div className="pr-meta mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    {pr.number != null && (
                        <span className="pr-number font-mono tabular-nums">#{pr.number}</span>
                    )}
                    <span>{fileCount} files</span>
                    <span>{minutes} min</span>
                </div>
            </div>
            <span
                className={cn(
                    'pr-risk inline-flex h-[22px] min-w-[48px] items-center justify-center rounded-full px-2 text-[10px] font-bold uppercase tracking-wide',
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
