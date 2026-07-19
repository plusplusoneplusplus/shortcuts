/**
 * PullRequestRow — single PR queue row in the redesigned review command
 * queue. Shows a state dot, the PR title, a `#number / files` meta line,
 * and a deterministic risk pill.
 *
 * Real provider/git diff stats drive file count and risk.
 */

import { cn } from '../../ui';
import { formatRelativeTime } from '../../utils/format';
import {
    queueDotClass,
    queueDotLabel,
    queueRiskClass,
} from './pr-derived-data';
import type { QueueDotState } from './pr-derived-data';
import { deriveQueueRisk, formatTimestamp } from './pr-utils';
import type { PullRequest, QueueRiskBadge } from './pr-utils';
import { type PullRequestContextDragPayload, writePointerContextDragData } from '../chat/sessionContextDrag';

export type PrClassificationBadgeStatus = 'ready' | 'running' | 'missing';

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
    /** Pointer-only context payload used by chat/task composer drag targets. */
    sessionContextPayload?: PullRequestContextDragPayload | null;
    /** Lightweight Team auto-classification status for this loaded PR. */
    classificationStatus?: PrClassificationBadgeStatus;
}

const RISK_LABEL: Record<QueueRiskBadge, string> = {
    low: 'Low',
    med: 'Med',
    high: 'High',
    unknown: 'N/A',
};

const CLASSIFICATION_BADGE: Record<PrClassificationBadgeStatus, { label: string; ariaLabel: string; className: string }> = {
    ready: {
        label: 'AI ready',
        ariaLabel: 'AI classification ready',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
    },
    running: {
        label: 'AI running',
        ariaLabel: 'AI classification running',
        className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200',
    },
    missing: {
        label: 'AI missing',
        ariaLabel: 'AI classification missing',
        className: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
    },
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
    sessionContextPayload,
    classificationStatus,
}: PullRequestRowProps) {
    const effectiveRisk: QueueRiskBadge = risk ?? deriveQueueRisk(pr.diffStats);
    const effectiveDot: QueueDotState = dotState ?? deriveDotState(pr, effectiveRisk);
    const fileCount = pr.diffStats?.changedFiles;
    const filesLabel = fileCount == null
        ? 'n/a files'
        : `${fileCount} file${fileCount === 1 ? '' : 's'}`;

    if (compact) {
        return (
            <button
                type="button"
                title={pr.title}
                aria-label={pr.title}
                onClick={onClick}
                draggable={!!sessionContextPayload}
                onDragStart={sessionContextPayload ? e => writePointerContextDragData(e.dataTransfer, sessionContextPayload) : undefined}
                data-testid="pr-row"
                data-session-context-source={sessionContextPayload ? 'true' : undefined}
                data-session-context-kind={sessionContextPayload ? 'pull-request' : undefined}
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
                    role="img"
                    title={queueDotLabel(effectiveDot)}
                    aria-label={queueDotLabel(effectiveDot)}
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
                sessionContextPayload && 'cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-sky-300 dark:hover:ring-sky-700',
            )}
            style={{ gridTemplateColumns: '16px minmax(0, 1fr) auto' }}
            onClick={onClick}
            draggable={!!sessionContextPayload}
            onDragStart={sessionContextPayload ? e => writePointerContextDragData(e.dataTransfer, sessionContextPayload) : undefined}
            data-testid="pr-row"
            data-session-context-source={sessionContextPayload ? 'true' : undefined}
            data-session-context-kind={sessionContextPayload ? 'pull-request' : undefined}
            data-pr-status={pr.status}
            title={sessionContextPayload ? `${sessionContextPayload.label} - drag to attach as pull request context` : undefined}
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
                    role="img"
                    title={queueDotLabel(effectiveDot)}
                    aria-label={queueDotLabel(effectiveDot)}
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
            <div className="flex flex-col items-end gap-1">
                {classificationStatus && (
                    <span
                        className={cn(
                            'inline-flex h-[18px] max-w-[74px] items-center rounded-full border px-1.5 text-[10px] font-semibold leading-none',
                            CLASSIFICATION_BADGE[classificationStatus].className,
                        )}
                        data-testid="pr-classification-badge"
                        data-classification-status={classificationStatus}
                        aria-label={CLASSIFICATION_BADGE[classificationStatus].ariaLabel}
                        title={CLASSIFICATION_BADGE[classificationStatus].ariaLabel}
                    >
                        {CLASSIFICATION_BADGE[classificationStatus].label}
                    </span>
                )}
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
        </div>
    );
}
