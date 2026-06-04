/**
 * RalphSessionRow — collapsible group row for a Ralph session.
 *
 * Visually mirrors `HistoryGroupHeader` (plan-file groups): a compact one-line
 * row in the same `[10px_36px_minmax(0,1fr)_auto]` grid with a status dot,
 * `RALPH` mode pill, chevron toggle, title, child-count badge, and relative
 * time. Phase is signaled entirely via the status-dot color (no separate
 * phase badge). Children are rendered inline (no decorative wrapper) by
 * delegating to the caller's `renderTaskCard` with `{ isGroupChild: true }`.
 */

import type React from 'react';
import { useState } from 'react';
import { cn } from '../../ui/cn';
import { formatRelativeTime } from '../../utils/format';
import type { RalphSession } from './ralph-session-grouping';
import { RALPH_MULTI_LOOP } from '../../featureFlags';

interface RalphSessionRowProps {
    session: RalphSession;
    selectedTaskId: string | null;
    /** When this session is the right-pane selection. Highlights the row. */
    selectedSessionId?: string | null;
    now: number;
    unseenProcessIds?: Set<string>;
    onSelectTask: (id: string, task?: any) => void;
    /**
     * Called when the user clicks the row body (not the chevron). The right
     * pane uses this to switch to the workflow visualization for this
     * session. Optional so older callers compile unchanged.
     */
    onSelectSession?: (sessionId: string) => void;
    /** Right-click handler for the group row (context menu). */
    onContextMenu?: (e: React.MouseEvent) => void;
    /** Render a single child task row. Mirrors `renderChatListRow`'s options
     *  object so we can request the muted, group-child variant. */
    renderTaskCard: (
        task: any,
        opts?: { isGroupChild?: boolean; taskStatus?: 'running' | 'queued' | 'completed' },
    ) => React.ReactNode;
}

/** Phase → status-dot classes. Mirrors HistoryGroupHeader's STATUS_DOT_CLASSES
 *  palette so ralph rows visually align with plan-file group rows. */
const PHASE_DOT_CLASSES: Record<RalphSession['phase'], string> = {
    grilling: 'bg-amber-500',
    executing: 'bg-[#0078d4] dark:bg-[#3794ff] animate-pulse shadow-[0_0_0_3px_rgba(0,120,212,0.22)]',
    complete: 'bg-[#bbbbbb] dark:bg-[#5c5c5c]',
};

const PHASE_DOT_LABEL: Record<RalphSession['phase'], string> = {
    grilling: 'clarifying',
    executing: 'executing',
    complete: 'done',
};

export function RalphSessionRow({
    session,
    selectedTaskId: _selectedTaskId,
    selectedSessionId,
    now: _now,
    unseenProcessIds: _unseenProcessIds,
    onSelectTask: _onSelectTask,
    onSelectSession,
    onContextMenu,
    renderTaskCard,
}: RalphSessionRowProps) {
    const [expanded, setExpanded] = useState(false);
    const isSelected = selectedSessionId === session.sessionId;

    const iterCount = session.iterations.length;
    const subCount = (session.grillingProcess ? 1 : 0) + iterCount;

    // Short muted suffix that fits inside the truncating title cell.
    // When multi-loop is enabled and there are multiple loops, prefix with the loop count.
    let subLabel: string;
    if (session.phase === 'grilling') {
        subLabel = 'Clarifying';
    } else if (RALPH_MULTI_LOOP && session.loopCount > 1) {
        subLabel = `${session.loopCount} loops · ${iterCount} iter`;
    } else {
        subLabel = `${iterCount} iter`;
    }

    const timestamp = session.latestTimestamp
        ? formatRelativeTime(new Date(session.latestTimestamp).toISOString())
        : '';

    const dotClasses = PHASE_DOT_CLASSES[session.phase];

    // RALPH mode pill — purple variant, same shape as HistoryGroupHeader's
    // `modeBadgeClasses`, mirroring the ralph color from ChatListPane.
    const modeBadgeClasses = cn(
        'inline-flex items-center justify-center rounded-[3px] border font-mono font-bold uppercase select-none',
        'text-[9.5px] leading-none tracking-[0.06em] py-[4px] w-full',
        'text-purple-600 dark:text-purple-400',
        'border-purple-500/70 dark:border-purple-500/60',
        'bg-purple-50/60 dark:bg-purple-500/10',
    );

    const toggle = () => setExpanded(e => !e);

    return (
        <div
            data-testid="ralph-session-row"
            data-session-id={session.sessionId}
            data-selected={isSelected ? 'true' : 'false'}
            className={cn(
                expanded && 'bg-[#f7f7f8] dark:bg-[#1f1f20]/80',
                isSelected && 'ring-1 ring-[#0078d4]/40',
            )}
        >
            <div
                className={cn(
                    'chat-row group relative cursor-pointer leading-none transition-colors',
                    'grid items-center gap-2 px-3 py-1',
                    'grid-cols-[10px_36px_minmax(0,1fr)_auto]',
                    'text-[12.5px] h-[26px]',
                    'border-b border-[#e0e0e0]/60 dark:border-[#3c3c3c]/60',
                    'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2b]',
                )}
                onClick={() => {
                    if (onSelectSession) onSelectSession(session.sessionId);
                    else toggle();
                }}
                onContextMenu={onContextMenu}
                data-testid="ralph-session-body"
                data-session-phase={session.phase}
                data-expanded={expanded ? 'true' : 'false'}
                aria-expanded={expanded}
            >
                <span
                    className={cn('w-2 h-2 rounded-full justify-self-center transition-shadow', dotClasses)}
                    aria-label={`phase: ${PHASE_DOT_LABEL[session.phase]}`}
                />
                <span className={modeBadgeClasses} title="Ralph · iterative goal-driven session">
                    RALPH
                </span>
                <span className="min-w-0 flex items-center gap-1 overflow-hidden">
                    <button
                        type="button"
                        className={cn(
                            'shrink-0 inline-flex items-center justify-center w-4 h-4 -ml-1 rounded',
                            'text-[#848484] dark:text-[#a0a0a0] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
                            'transition-transform',
                            expanded && 'rotate-90',
                        )}
                        onClick={e => { e.stopPropagation(); toggle(); }}
                        data-testid="ralph-session-chevron"
                        aria-label={expanded ? 'Collapse session' : 'Expand session'}
                        aria-expanded={expanded}
                    >
                        <span className="text-[12px] leading-none" aria-hidden="true">›</span>
                    </button>
                    {session.hasUnseen && (
                        <span
                            className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]"
                            data-testid="ralph-session-unseen-dot"
                            aria-label="Unseen activity"
                        />
                    )}
                    <span
                        className={cn(
                            'chat-title truncate text-[#1e1e1e] dark:text-[#cccccc]',
                            session.hasUnseen && 'font-semibold',
                        )}
                    >
                        Ralph Session
                        <span className="ml-1.5 font-normal text-[#848484] dark:text-[#9d9d9d]">
                            {subLabel}
                        </span>
                    </span>
                    {subCount > 0 && (
                        <span
                            className="shrink-0 text-[10px] font-mono tabular-nums text-[#848484] dark:text-[#9d9d9d]"
                            data-testid="ralph-session-child-count"
                        >
                            {subCount}
                        </span>
                    )}
                </span>
                <span className="flex items-center gap-1 text-[#848484] dark:text-[#999]">
                    <span className="text-[10.5px] font-mono tabular-nums whitespace-nowrap">
                        {timestamp}
                    </span>
                </span>
            </div>

            {expanded && (
                <div
                    className="flex flex-col ml-3 pl-2 border-l border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="ralph-session-children"
                >
                    {session.grillingProcess && (
                        <div key={session.grillingProcess.id ?? 'grilling'}>
                            {renderTaskCard(session.grillingProcess, { isGroupChild: true })}
                        </div>
                    )}
                    {session.iterations.map((iter, idx) => (
                        <div key={iter.id ?? idx}>
                            {renderTaskCard(iter, { isGroupChild: true })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
