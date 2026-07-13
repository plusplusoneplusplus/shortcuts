/**
 * RalphSessionRow — collapsible group row for a Ralph session.
 *
 * Thin wrapper over the shared `TaskGroupRunRow` chrome: it derives the
 * Ralph-specific display (phase status dot, `R` badge, clarifying/iteration
 * sub-label, session-context drag support) and delegates layout, expansion,
 * pin/more affordances, and child rendering to the shared row. Children are
 * rendered by delegating to the caller's `renderTaskCard` with
 * `{ isGroupChild: true }`.
 */

import type React from 'react';
import type { RalphSession } from './ralph-session-grouping';
import { RALPH_MULTI_LOOP } from '../../featureFlags';
import { type RalphSessionContextDragPayload, writeRalphSessionContextDragData } from './sessionContextDrag';
import { TaskGroupRunRow } from './TaskGroupRunRow';

interface RalphSessionRowProps {
    session: RalphSession;
    selectedTaskId: string | null;
    /** When this session is the right-pane selection. Highlights the row. */
    selectedSessionId?: string | null;
    /** When every child process is selected by history multi-select. */
    isRangeSelected?: boolean;
    /** When some — but not all — child processes are selected. */
    isPartiallySelected?: boolean;
    /** Controlled expansion state supplied by ChatListPane so range selection can mirror rendered rows. */
    expanded?: boolean;
    onToggleExpanded?: () => void;
    now: number;
    unseenProcessIds?: Set<string>;
    onSelectTask: (id: string, task?: any) => void;
    /**
     * Called when the user clicks the row body (not the chevron). The right
     * pane uses this to switch to the workflow visualization for this
     * session. Optional so older callers compile unchanged.
     */
    onSelectSession?: (sessionId: string, event: React.MouseEvent<HTMLDivElement>) => void;
    /** Right-click handler for the group row (context menu). */
    onContextMenu?: (e: React.MouseEvent) => void;
    /** Mobile long-press handlers supplied by the list pane. */
    onTouchStart?: (e: React.TouchEvent) => void;
    onTouchEnd?: (e: React.TouchEvent) => void;
    onTouchMove?: (e: React.TouchEvent) => void;
    /** Parent-row pin state and actions. This is independent from child chat pins. */
    isPinned?: boolean;
    onTogglePin?: () => void;
    onMoreActions?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    /** Optional pointer-only context payload used when session-context dragging is enabled. */
    sessionContextPayload?: RalphSessionContextDragPayload | null;
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
    failed: 'bg-[#e5534b] dark:bg-[#f85149]',
};

const PHASE_DOT_LABEL: Record<RalphSession['phase'], string> = {
    grilling: 'clarifying',
    executing: 'executing',
    complete: 'done',
    failed: 'failed',
};

export function RalphSessionRow({
    session,
    selectedTaskId: _selectedTaskId,
    selectedSessionId,
    isRangeSelected,
    isPartiallySelected,
    expanded,
    onToggleExpanded,
    now,
    unseenProcessIds: _unseenProcessIds,
    onSelectTask: _onSelectTask,
    onSelectSession,
    onContextMenu,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    isPinned,
    onTogglePin,
    onMoreActions,
    sessionContextPayload,
    renderTaskCard,
}: RalphSessionRowProps) {
    const iterCount = session.iterations.length;

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

    const children = [
        ...(session.grillingProcess ? [session.grillingProcess] : []),
        ...session.iterations,
    ];

    return (
        <TaskGroupRunRow
            group={{
                runId: session.sessionId,
                children,
                latestTimestamp: session.latestTimestamp,
                hasUnseen: session.hasUnseen,
            }}
            display={{
                testIdPrefix: 'ralph-session',
                label: session.title,
                title: subLabel,
                badge: 'R',
                badgeTitle: 'Ralph · iterative goal-driven session',
                groupNoun: 'Ralph session',
                badgeClassName: 'text-purple-600 dark:text-purple-400 border-purple-500/70 dark:border-purple-500/60 bg-purple-50/60 dark:bg-purple-500/10',
                selectedRingClassName: 'ring-[#0078d4]/40',
                statusDotClassName: PHASE_DOT_CLASSES[session.phase],
                statusLabel: session.phase,
                statusAriaLabel: `phase: ${PHASE_DOT_LABEL[session.phase]}`,
                status: session.phase,
                statusAttributeName: 'data-session-phase',
                groupIdAttributeName: 'data-session-id',
                titleTestId: 'ralph-session-title',
                titleTooltip: `${session.title} · ${subLabel}`,
                titleAriaLabel: `Ralph session: ${session.title} · ${subLabel}`,
                collapseAriaLabel: 'Collapse session',
                expandAriaLabel: 'Expand session',
            }}
            selectedRunId={selectedSessionId}
            isRangeSelected={isRangeSelected}
            isPartiallySelected={isPartiallySelected}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
            now={now}
            onSelectRun={onSelectSession ? (sessionId, event) => onSelectSession(sessionId, event) : undefined}
            onContextMenu={onContextMenu}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchMove={onTouchMove}
            isPinned={isPinned}
            onTogglePin={onTogglePin}
            onMoreActions={onMoreActions}
            draggable={sessionContextPayload ? true : undefined}
            onDragStart={sessionContextPayload ? (e) => writeRalphSessionContextDragData(e.dataTransfer, sessionContextPayload) : undefined}
            bodyDataAttributes={{
                'data-session-context-source': sessionContextPayload ? 'true' : undefined,
                'data-session-context-kind': sessionContextPayload ? 'ralph-session' : undefined,
                'data-session-context-status': sessionContextPayload?.status,
            }}
            bodyTitle={sessionContextPayload ? `${sessionContextPayload.displayLabel} - drag to attach as Ralph session context` : undefined}
            renderTaskCard={(task) => renderTaskCard(task, { isGroupChild: true })}
        />
    );
}
