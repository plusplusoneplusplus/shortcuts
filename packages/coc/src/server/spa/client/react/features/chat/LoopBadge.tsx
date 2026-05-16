/**
 * LoopBadge — compact badge showing manageable loop count in the chat header.
 *
 * Renders a small pill with a loop icon (🔁) and the count of non-cancelled loops.
 */
import React from 'react';
import { LoopIcon } from './icons/LoopIcon';

export interface LoopBadgeProps {
    count: number;
    hasActiveLoops: boolean;
    onClick?: () => void;
}

export function LoopBadge({ count, hasActiveLoops, onClick }: LoopBadgeProps) {
    if (count === 0) return null;

    const variantClasses = hasActiveLoops
        ? 'bg-[#e6f4ea] dark:bg-[#1a3a2a] text-[#15703a] dark:text-[#4ade80] border-[#b7e1cd] dark:border-[#2a5a3a] hover:bg-[#d4edda] dark:hover:bg-[#1f4a35]'
        : 'bg-[#fff4ce] dark:bg-[#3a2f12] text-[#8a5a00] dark:text-[#fbbf24] border-[#f0d78c] dark:border-[#6b4f14] hover:bg-[#ffe8a3] dark:hover:bg-[#4a3a16]';

    return (
        <button
            type="button"
            className={`loop-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer flex-shrink-0 ${variantClasses}`}
            title={`${count} loop${count > 1 ? 's' : ''} — click to manage`}
            onClick={onClick}
            data-testid="loop-badge"
        >
            <LoopIcon className="w-3 h-3" />
            <span>{count}</span>
        </button>
    );
}
