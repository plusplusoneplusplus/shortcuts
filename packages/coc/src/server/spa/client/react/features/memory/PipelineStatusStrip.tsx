/**
 * PipelineStatusStrip — compact status indicator for the memory candidate pipeline.
 *
 * Displays pending candidate count, promotion status, and last promotion time.
 * Hidden when there is no candidate database yet (pendingRawCount is undefined/null).
 */

import { formatRelativeTime } from '../../utils/format';
import type { MemoryStats } from './memoryApi';

export interface PipelineStatusStripProps {
    stats: MemoryStats | null;
}

export function PipelineStatusStrip({ stats }: PipelineStatusStripProps) {
    if (!stats) return null;

    // Hide strip if there's no candidate data at all (no pending, no active task, never run)
    const hasRawPipeline =
        stats.pendingRawCount > 0 ||
        stats.claimedRawCount > 0 ||
        (stats.lastPromotedAt ?? stats.lastAggregatedAt) != null ||
        (stats.promotionStatus ?? stats.consolidationStatus) === 'queued' ||
        (stats.promotionStatus ?? stats.consolidationStatus) === 'running';
    if (!hasRawPipeline) return null;

    const pendingRawCount = stats.pendingRawCount;
    const claimedRawCount = stats.claimedRawCount;
    const promotionStatus = stats.promotionStatus ?? stats.consolidationStatus;
    const lastPromotedAt = stats.lastPromotedAt ?? stats.lastAggregatedAt;
    const lastPromotionError = stats.lastPromotionError ?? stats.lastAggregateError;

    // Error state
    if (lastPromotionError && promotionStatus !== 'running' && promotionStatus !== 'queued') {
        const truncated = lastPromotionError.length > 80
            ? lastPromotionError.slice(0, 77) + '…'
            : lastPromotionError;
        return (
            <div
                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                data-testid="pipeline-status-strip"
                data-status="error"
            >
                <span className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
                {pendingRawCount > 0 && <span>{pendingRawCount} pending</span>}
                {pendingRawCount > 0 && <span className="text-red-400 dark:text-red-600">·</span>}
                <span className="truncate" title={lastPromotionError}>⚠ {truncated}</span>
            </div>
        );
    }

    // Running state
    if (promotionStatus === 'running') {
        return (
            <div
                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                data-testid="pipeline-status-strip"
                data-status="running"
            >
                <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" aria-hidden="true" />
                {pendingRawCount > 0 && <span>{pendingRawCount} pending</span>}
                {pendingRawCount > 0 && claimedRawCount > 0 && <span className="text-blue-400 dark:text-blue-600">·</span>}
                {claimedRawCount > 0 && <span>{claimedRawCount} claimed</span>}
                {(pendingRawCount > 0 || claimedRawCount > 0) && <span className="text-blue-400 dark:text-blue-600">·</span>}
                <span>▶ promoting</span>
            </div>
        );
    }

    // Queued state
    if (promotionStatus === 'queued') {
        return (
            <div
                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                data-testid="pipeline-status-strip"
                data-status="queued"
            >
                <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" aria-hidden="true" />
                {pendingRawCount > 0 && <span>{pendingRawCount} pending</span>}
                {pendingRawCount > 0 && <span className="text-amber-400 dark:text-amber-600">·</span>}
                <span>⏳ queued</span>
            </div>
        );
    }

    // Pending + idle
    if (pendingRawCount > 0) {
        const lastRunText = lastPromotedAt ? formatRelativeTime(lastPromotedAt) : null;
        return (
            <div
                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                data-testid="pipeline-status-strip"
                data-status="pending"
            >
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                <span>{pendingRawCount} pending</span>
                <span className="text-amber-400 dark:text-amber-600">·</span>
                <span>idle</span>
                {lastRunText && (
                    <>
                        <span className="text-amber-400 dark:text-amber-600">·</span>
                        <span>Last promotion {lastRunText}</span>
                    </>
                )}
            </div>
        );
    }

    // Up to date (no pending, idle)
    const lastRunText = lastPromotedAt ? formatRelativeTime(lastPromotedAt) : null;
    return (
        <div
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"
            data-testid="pipeline-status-strip"
            data-status="up-to-date"
        >
            <span>✓ Up to date</span>
            {lastRunText && (
                <>
                    <span className="text-green-400 dark:text-green-600">·</span>
                    <span>Last promotion {lastRunText}</span>
                </>
            )}
        </div>
    );
}
