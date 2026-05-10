/**
 * RalphSessionRow — collapsible group row for a Ralph session in the history list.
 *
 * Shows a purple header with phase badge, iteration count, unseen dot,
 * and an expand/collapse chevron. When expanded, renders child items
 * (grilling process + iterations) indented with a left border.
 */

import type React from 'react';
import { useState } from 'react';
import { cn } from '../../ui/cn';
import type { RalphSession } from './ralph-session-grouping';

interface RalphSessionRowProps {
    session: RalphSession;
    selectedTaskId: string | null;
    now: number;
    unseenProcessIds?: Set<string>;
    onSelectTask: (id: string, task?: any) => void;
    /** Render a single task row (reuses existing task card rendering from parent) */
    renderTaskCard: (task: any, opts?: { indented?: boolean; iterationLabel?: string }) => React.ReactNode;
}

const PHASE_BADGE: Record<RalphSession['phase'], { label: string; cls: string }> = {
    grilling:  { label: 'Clarifying', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
    executing: { label: 'Executing',  cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
    complete:  { label: 'Done',       cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
};

export function RalphSessionRow({
    session,
    selectedTaskId: _selectedTaskId,
    now: _now,
    unseenProcessIds: _unseenProcessIds,
    onSelectTask: _onSelectTask,
    renderTaskCard,
}: RalphSessionRowProps) {
    const [expanded, setExpanded] = useState(session.hasUnseen);
    const badge = PHASE_BADGE[session.phase];

    const iterCount = session.iterations.length;
    const subCount  = (session.grillingProcess ? 1 : 0) + iterCount;

    const subLabel = iterCount > 0
        ? `${iterCount} iteration${iterCount === 1 ? '' : 's'}`
        : 'Clarifying goal…';

    return (
        <div className="mb-1" data-testid="ralph-session-row" data-session-id={session.sessionId}>
            {/* Header row */}
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors',
                    'bg-purple-50 dark:bg-purple-950/20 hover:bg-purple-100 dark:hover:bg-purple-900/30',
                    'border border-purple-200 dark:border-purple-800/50',
                )}
                aria-expanded={expanded}
                data-testid="ralph-session-header"
            >
                {/* Unseen dot */}
                {session.hasUnseen && (
                    <span className="h-2 w-2 rounded-full bg-purple-500 flex-shrink-0" aria-label="Unseen activity" />
                )}
                {/* Icon + label */}
                <span className="text-purple-600 dark:text-purple-400 text-xs">🔄</span>
                <span className="flex-1 min-w-0 text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate">
                    Ralph Session
                    <span className="ml-1.5 font-normal text-[#848484]">{subLabel}</span>
                </span>
                {/* Phase badge */}
                <span className={cn('flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full', badge.cls)}>
                    {badge.label}
                </span>
                {/* Count badge */}
                {subCount > 0 && (
                    <span className="flex-shrink-0 text-[10px] text-[#848484] tabular-nums">
                        {subCount}
                    </span>
                )}
                {/* Chevron */}
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                    className={cn('flex-shrink-0 text-[#848484] transition-transform', expanded ? 'rotate-90' : '')}
                >
                    <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            </button>

            {/* Expanded children */}
            {expanded && (
                <div className="ml-3 mt-0.5 pl-2 border-l-2 border-purple-200 dark:border-purple-700 space-y-0.5">
                    {/* Grilling process */}
                    {session.grillingProcess && (
                        <div data-testid="ralph-session-grilling">
                            {renderTaskCard(session.grillingProcess, { indented: true, iterationLabel: '🎯 Goal Setting' })}
                        </div>
                    )}
                    {/* Execution iterations */}
                    {session.iterations.map((iter, idx) => (
                        <div key={iter.id ?? idx} data-testid={`ralph-iteration-${idx + 1}`}>
                            {renderTaskCard(iter, { indented: true, iterationLabel: `Iteration ${iter.payload?.context?.ralph?.currentIteration ?? idx + 1}` })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
