/**
 * LoopBadge — compact badge showing active loop count in the chat header.
 *
 * Renders a small pill with a loop icon (🔁) and the count of active loops.
 * Only visible when there is at least one active loop for the current process.
 */
import React from 'react';

export interface LoopBadgeProps {
    activeCount: number;
    onClick?: () => void;
}

export function LoopBadge({ activeCount, onClick }: LoopBadgeProps) {
    if (activeCount === 0) return null;

    return (
        <button
            type="button"
            className="loop-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#e6f4ea] dark:bg-[#1a3a2a] text-[#15703a] dark:text-[#4ade80] border border-[#b7e1cd] dark:border-[#2a5a3a] hover:bg-[#d4edda] dark:hover:bg-[#1f4a35] transition-colors cursor-pointer flex-shrink-0"
            title={`${activeCount} active loop${activeCount > 1 ? 's' : ''} — click to manage`}
            onClick={onClick}
            data-testid="loop-badge"
        >
            <span aria-hidden="true">🔁</span>
            <span>{activeCount}</span>
        </button>
    );
}
