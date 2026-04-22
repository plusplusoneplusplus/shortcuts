/**
 * BackgroundTasksIndicator — inline status bar showing active background tasks.
 *
 * Rendered at the bottom of the conversation area when the AI is idle but
 * waiting for background agents/shells to complete.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { cn } from '../../shared/cn';
import type { BackgroundTasksState } from './hooks/useChatSSE';

export interface BackgroundTasksIndicatorProps {
    backgroundTasks: BackgroundTasksState;
}

export function BackgroundTasksIndicator({ backgroundTasks }: BackgroundTasksIndicatorProps) {
    const { backgroundAgents, backgroundShells, backgroundTotalActive } = backgroundTasks;
    const [expanded, setExpanded] = useState(false);
    const toggle = useCallback(() => setExpanded(v => !v), []);

    // Auto-collapse when count drops to 0
    useEffect(() => {
        if (backgroundTotalActive === 0) setExpanded(false);
    }, [backgroundTotalActive]);

    if (backgroundTotalActive === 0) return null;

    const allItems = [
        ...backgroundAgents.map(a => ({ kind: 'agent' as const, ...a })),
        ...backgroundShells.map(s => ({ kind: 'shell' as const, ...s })),
    ];
    const hasDescriptions = allItems.some(item => item.description);
    const shouldCollapse = allItems.length > 3;

    return (
        <div
            className={cn(
                'my-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]',
                'bg-[#f8f8f8] dark:bg-[#1e1e1e] text-xs',
            )}
        >
            {/* Header */}
            <div
                role={hasDescriptions ? 'button' : undefined}
                tabIndex={hasDescriptions ? 0 : undefined}
                aria-expanded={hasDescriptions ? expanded : undefined}
                className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5',
                    hasDescriptions && 'cursor-pointer select-none hover:bg-black/[0.03] dark:hover:bg-white/[0.03]',
                )}
                onClick={hasDescriptions ? toggle : undefined}
                onKeyDown={hasDescriptions ? (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
                } : undefined}
            >
                <span className="shrink-0 animate-pulse">⏳</span>
                <span className="font-medium text-[#848484] dark:text-[#a0a0a0]">
                    Waiting for background tasks
                </span>
                <span className="text-[#848484] shrink-0">
                    {backgroundAgents.length > 0 && `🤖 ${backgroundAgents.length} agent${backgroundAgents.length > 1 ? 's' : ''}`}
                    {backgroundAgents.length > 0 && backgroundShells.length > 0 && '  ·  '}
                    {backgroundShells.length > 0 && `💻 ${backgroundShells.length} shell${backgroundShells.length > 1 ? 's' : ''}`}
                </span>
                {hasDescriptions && (
                    <span className="text-[#848484] ml-auto shrink-0">
                        {expanded ? '▼' : '▶'}
                    </span>
                )}
            </div>

            {/* Expanded details */}
            {expanded && hasDescriptions && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-1.5 space-y-0.5">
                    {(shouldCollapse ? allItems.slice(0, 3) : allItems).map(item => (
                        <div key={item.id} className="text-[#616161] dark:text-[#a0a0a0] truncate">
                            <span className="shrink-0">{item.kind === 'agent' ? '🤖' : '💻'}</span>
                            {' '}
                            <span className="font-medium">{item.kind}:</span>
                            {' '}
                            {item.description ? (
                                <span>"{item.id}" — {item.description}</span>
                            ) : (
                                <span>"{item.id}"</span>
                            )}
                        </div>
                    ))}
                    {shouldCollapse && allItems.length > 3 && (
                        <div className="text-[#848484] italic">
                            + {allItems.length - 3} more…
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
