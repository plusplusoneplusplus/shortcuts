import React from 'react';
import './scheduler-delay-hint.css';

export function schedulerDelayLabel(minutes: number | undefined, scope: 'all' | 'autopilot'): string | undefined {
    if (minutes === undefined || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
        return undefined;
    }
    return `Delay between tasks: ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} (${scope === 'all' ? 'ALL scope: all tasks' : 'AP scope: autopilot tasks'})`;
}

/** The owning queue supplies configuration; countdowns and pause state are separate. */
export function SchedulerDelayHint({ minutes, scope }: { minutes: number; scope: 'all' | 'autopilot' }) {
    return (
        <span
            data-testid={`scheduler-delay-hint-${scope}`}
            className="inline-flex items-center gap-0.5 text-[10px] leading-none text-[#606060] dark:text-[#b0b0b0] whitespace-nowrap"
            aria-hidden="true"
        >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="flex-shrink-0">
                <circle cx="7" cy="7" r="5.25" />
                <path d="M7 3.75V7l2.25 1.5" />
            </svg>
            <span className="scheduler-delay-interval">{minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`}</span>
        </span>
    );
}
