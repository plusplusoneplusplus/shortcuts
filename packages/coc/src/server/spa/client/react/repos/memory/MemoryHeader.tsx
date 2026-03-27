/**
 * MemoryHeader — displays memory stats, action buttons, and consolidation status pill.
 */

import React from 'react';
import { formatRelativeTime } from '../../utils/format';

interface MemoryHeaderProps {
    observationCount: number;
    noteCount: number;
    consolidatedAt: string | null;
    consolidationStatus?: 'idle' | 'queued' | 'running';
    onAddNote: () => void;
    onAggregate: () => void;
    onViewConsolidated?: () => void;
}

export function MemoryHeader({
    observationCount,
    noteCount,
    consolidatedAt,
    consolidationStatus,
    onAddNote,
    onAggregate,
    onViewConsolidated,
}: MemoryHeaderProps) {
    const totalCount = observationCount + noteCount;
    const consolidatedLabel = consolidatedAt
        ? formatRelativeTime(consolidatedAt)
        : 'never';

    const isActive = consolidationStatus === 'queued' || consolidationStatus === 'running';

    return (
        <div className="mb-3">
            <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">Memory</h2>
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[#848484] flex-1" data-testid="memory-stats-label">
                    {totalCount} observation{totalCount !== 1 ? 's' : ''} · consolidated{' '}
                    {consolidatedAt && onViewConsolidated ? (
                        <button
                            onClick={onViewConsolidated}
                            className="text-[#0078d4] hover:underline cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit"
                            data-testid="memory-view-consolidated-btn"
                        >
                            {consolidatedLabel}
                        </button>
                    ) : (
                        consolidatedLabel
                    )}
                </span>
                <button
                    onClick={onAddNote}
                    className="text-xs px-2.5 py-1 rounded border border-[#0078d4] text-[#0078d4] hover:bg-[#0078d4]/10 transition-colors"
                    data-testid="memory-add-note-btn"
                >
                    + Add Note
                </button>
                {isActive ? (
                    <button
                        onClick={onAggregate}
                        className={`text-xs px-2.5 py-1 rounded inline-flex items-center gap-1.5 transition-colors ${
                            consolidationStatus === 'queued'
                                ? 'bg-[#e8a317]/15 text-[#a97a0d] dark:text-[#e8a317] border border-[#e8a317]/30'
                                : 'bg-[#0078d4]/15 text-[#0078d4] border border-[#0078d4]/30'
                        }`}
                        data-testid="memory-aggregate-btn"
                    >
                        <span className={`inline-block w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin`} />
                        {consolidationStatus === 'queued' ? 'Queued…' : 'Consolidating…'}
                    </button>
                ) : (
                    <button
                        onClick={onAggregate}
                        className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                        data-testid="memory-aggregate-btn"
                    >
                        Aggregate ▾
                    </button>
                )}
            </div>
            <div className="mt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
        </div>
    );
}
