/**
 * CronBadge — cron-count pill in the chat header. Renders nothing at count 0,
 * and tints green when any cron is active, amber when they are all paused.
 * The caller decides which crons are counted.
 */
import React from 'react';
import { CronIcon } from './icons/CronIcon';

export interface CronBadgeProps {
    count: number;
    hasActiveCrons: boolean;
    onClick?: () => void;
}

export function CronBadge({ count, hasActiveCrons, onClick }: CronBadgeProps) {
    if (count === 0) return null;

    const variantClasses = hasActiveCrons
        ? 'bg-[#e6f4ea] dark:bg-[#1a3a2a] text-[#15703a] dark:text-[#4ade80] border-[#b7e1cd] dark:border-[#2a5a3a] hover:bg-[#d4edda] dark:hover:bg-[#1f4a35]'
        : 'bg-[#fff4ce] dark:bg-[#3a2f12] text-[#8a5a00] dark:text-[#fbbf24] border-[#f0d78c] dark:border-[#6b4f14] hover:bg-[#ffe8a3] dark:hover:bg-[#4a3a16]';

    return (
        <button
            type="button"
            className={`cron-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer flex-shrink-0 ${variantClasses}`}
            title={`${count} cron${count > 1 ? 's' : ''} — click to manage`}
            onClick={onClick}
            data-testid="cron-badge"
        >
            <CronIcon className="w-3 h-3" />
            <span>{count}</span>
        </button>
    );
}
