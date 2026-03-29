/**
 * MemoryHeader — displays memory stats and action buttons.
 */

import React from 'react';

interface MemoryHeaderProps {
    observationCount: number;
    noteCount: number;
    onAddNote: () => void;
    onAggregate: () => void;
}

export function MemoryHeader({
    observationCount,
    noteCount,
    onAddNote,
    onAggregate,
}: MemoryHeaderProps) {
    const totalCount = observationCount + noteCount;

    return (
        <div className="mb-3">
            <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">Memory</h2>
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[#848484] flex-1" data-testid="memory-stats-label">
                    {totalCount} observation{totalCount !== 1 ? 's' : ''}
                </span>
                <button
                    onClick={onAddNote}
                    className="text-xs px-2.5 py-1 rounded border border-[#0078d4] text-[#0078d4] hover:bg-[#0078d4]/10 transition-colors"
                    data-testid="memory-add-note-btn"
                >
                    + Add Note
                </button>
                <button
                    onClick={onAggregate}
                    className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                    data-testid="memory-aggregate-btn"
                >
                    Aggregate ▾
                </button>
            </div>
            <div className="mt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
        </div>
    );
}
