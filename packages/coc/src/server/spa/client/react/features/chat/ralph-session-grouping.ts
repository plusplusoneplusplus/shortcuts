/**
 * ralph-session-grouping — groups history tasks by shared ralph.sessionId.
 *
 * Pure utility: no React, no side effects.
 */

import { deriveTaskGroupRef } from '@plusplusoneplusplus/coc-client';
import { deriveRalphTitle } from './ralph-title';

export interface RalphSession {
    kind: 'ralph-session';
    sessionId: string;
    /**
     * Concise, goal-derived display title for the session row. Derived on the
     * fly from existing Ralph goal metadata (no new persistent title state);
     * falls back to "Ralph Session" when no usable goal text is available.
     */
    title: string;
    /** The grilling-phase process (ask mode + context.ralph.phase = 'grilling') */
    grillingProcess: any | undefined;
    /** All non-grilling processes in this session (iterations, follow-ups, etc.) */
    iterations: any[];
    /** Most recent timestamp across all processes in this session */
    latestTimestamp: number;
    /** Whether any process in this session is unseen */
    hasUnseen: boolean;
    /** Overall session phase */
    phase: RalphSessionPhase;
    /** Number of goal-loops that have occurred in this session (≥ 1). */
    loopCount: number;
}

export type RalphHistoryEntry = RalphSession | (any & { kind?: undefined });
export type RalphSessionPhase = 'grilling' | 'executing' | 'complete' | 'failed';

/** Extract ralph.sessionId from a process/task.
 *
 * Live queue_tasks expose this on `payload.context.ralph`, while history items
 * (from GET /api/workspaces/:id/history) expose it on the top-level `ralph`
 * field forwarded by `toProcessHistoryItem()`.
 */
export function getRalphSessionId(task: any): string | undefined {
    const ref = deriveTaskGroupRef(task);
    return ref?.kind === 'ralph' ? ref.groupId : undefined;
}

/** Extract ralph.originalGoal from a process/task.
 *
 * Live queue_tasks expose this on `payload.context.ralph`, while history items
 * (from GET /api/workspaces/:id/history) expose it on the top-level `ralph`
 * field forwarded verbatim by `serializeRalphMetadata` → `toProcessHistoryItem`.
 */
export function getRalphGoal(task: any): string | undefined {
    return (task?.payload?.context?.ralph?.originalGoal ?? task?.ralph?.originalGoal) as string | undefined;
}

/**
 * Resolve a concise display title for a Ralph session from the goal metadata
 * carried by any of its processes. Prefers the grilling process (which holds
 * the originally confirmed goal) and falls back through the iterations so
 * completed historical sessions improve automatically once their existing
 * metadata contains the goal.
 */
function resolveSessionTitle(grillingProcess: any | undefined, iterations: any[]): string {
    const ordered = [grillingProcess, ...iterations].filter(Boolean);
    for (const task of ordered) {
        const goal = getRalphGoal(task);
        if (typeof goal === 'string' && goal.trim()) {
            return deriveRalphTitle(goal);
        }
    }
    return deriveRalphTitle(undefined);
}

/** Extract ralph.phase from a process/task. Same fallback rule as above. */
export function getRalphPhase(task: any): RalphSessionPhase | undefined {
    return (task.payload?.context?.ralph?.phase ?? task.ralph?.phase) as any;
}

/** Extract ralph.currentIteration from a process/task. Same fallback rule. */
function getRalphIteration(task: any): number {
    return (task.payload?.context?.ralph?.currentIteration ?? task.ralph?.currentIteration ?? 0) as number;
}

/** Extract ralph.loopIndex from a process/task (1 if absent). */
function getRalphLoopIndex(task: any): number {
    return (task.payload?.context?.ralph?.loopIndex ?? task.ralph?.loopIndex ?? 1) as number;
}

/** Extract the task mode (live: payload.mode; history: top-level mode). */
function getTaskMode(task: any): string | undefined {
    return (task.payload?.mode ?? task.mode) as string | undefined;
}

/** Returns true if a task is part of a Ralph session. */
export function isRalphTask(task: any): boolean {
    return !!getRalphSessionId(task);
}

/** Compute the aggregate phase for a Ralph session. */
function computeSessionPhase(
    grillingProcess: any | undefined,
    iterations: any[],
): RalphSessionPhase {
    if (iterations.some(t => getRalphPhase(t) === 'failed' || t?.status === 'failed')) {
        return 'failed';
    }
    if (grillingProcess && (getRalphPhase(grillingProcess) === 'failed' || grillingProcess.status === 'failed')) {
        return 'failed';
    }
    // If any iteration signals complete
    if (iterations.some(t => getRalphPhase(t) === 'complete')) {
        // Check if it's actually done
        const lastIter = iterations[iterations.length - 1];
        if (lastIter?.status === 'completed') {
            // Heuristic: check if it was marked complete
            return 'complete';
        }
        return 'executing';
    }
    // All iterations finished without an explicit 'complete' phase marker
    // (history items always carry phase='executing'). Treat the session as done.
    if (iterations.length > 0 && iterations.every(t => t.status === 'completed')) {
        return 'complete';
    }
    if (iterations.length > 0) return 'executing';
    if (grillingProcess) {
        const gPhase = getRalphPhase(grillingProcess);
        if (gPhase === 'grilling') return 'grilling';
    }
    return 'grilling';
}

/**
 * Group a flat list of tasks/history items by ralph.sessionId.
 * Non-ralph tasks remain standalone.
 * Groups with only 1 item that is in executing phase remain as groups.
 * Groups with only the grilling process remain as groups (to show Start Ralph).
 */
export function groupByRalphSession(
    items: any[],
    unseenIds?: Set<string>,
): RalphHistoryEntry[] {
    const bySession = new Map<string, any[]>();
    const standalone: any[] = [];

    for (const item of items) {
        const sessionId = getRalphSessionId(item);
        if (!sessionId) {
            standalone.push(item);
            continue;
        }
        const group = bySession.get(sessionId);
        if (group) {
            group.push(item);
        } else {
            bySession.set(sessionId, [item]);
        }
    }

    const entries: RalphHistoryEntry[] = [];

    for (const [sessionId, sessionItems] of bySession) {
        const grillingProcess = sessionItems.find(t => getRalphPhase(t) === 'grilling');
        const iterations = sessionItems
            .filter(t => t !== grillingProcess)
            .sort((a: any, b: any) => {
                const iterDiff = getRalphIteration(a) - getRalphIteration(b);
                if (iterDiff !== 0) return iterDiff;
                // Timestamp tiebreak for items at the same iteration number
                const tsA = a.createdAt ?? a.startedAt ?? a.startTime ?? 0;
                const tsB = b.createdAt ?? b.startedAt ?? b.startTime ?? 0;
                return (typeof tsA === 'number' ? tsA : +new Date(tsA))
                     - (typeof tsB === 'number' ? tsB : +new Date(tsB));
            });

        // Sort timestamp for the session row in the chat list.
        //
        // For *complete* sessions we deliberately use the latest end-time
        // (`endTime` / `completedAt`) and ignore `lastActivityAt`, because
        // server-side post-completion turn appends (follow-up handling,
        // retries, late tool-result events) can keep bumping
        // `lastActivityAt` long after the session is actually done. Using
        // it would pin a finished 9h-old session above a fresh 1h-old chat,
        // which is what users see and report as "ralph won't sit down".
        //
        // For sessions still running (grilling / executing) we keep
        // `lastActivityAt` first — that's the desired behavior: live
        // activity should float to the top.
        function getTs(t: any): number {
            const ts = t.lastActivityAt ?? t.endTime ?? t.completedAt ?? t.startedAt ?? t.startTime ?? t.createdAt ?? 0;
            return typeof ts === 'number' ? ts : +new Date(ts);
        }
        function getEndTs(t: any): number {
            const ts = t.endTime ?? t.completedAt ?? t.startedAt ?? t.startTime ?? t.createdAt ?? 0;
            return typeof ts === 'number' ? ts : +new Date(ts);
        }
        const sessionPhase = computeSessionPhase(grillingProcess, iterations);
        const tsPicker = sessionPhase === 'complete' || sessionPhase === 'failed' ? getEndTs : getTs;
        const latestTimestamp = Math.max(...sessionItems.map(tsPicker));

        const hasUnseen = unseenIds
            ? sessionItems.some(t => unseenIds.has(t.id))
            : false;

        const loopCount = Math.max(1, ...sessionItems.map(getRalphLoopIndex));

        entries.push({
            kind: 'ralph-session',
            sessionId,
            title: resolveSessionTitle(grillingProcess, iterations),
            grillingProcess,
            iterations,
            latestTimestamp,
            hasUnseen,
            phase: sessionPhase,
            loopCount,
        });
    }

    for (const item of standalone) {
        entries.push(item);
    }

    // Sort by latest timestamp descending. Standalone (non-ralph) entries
    // use the same activity-aware fallback chain as live ralph sessions —
    // we only restrict ralph *complete* sessions to end-time so they stop
    // floating after late server-side turn appends.
    entries.sort((a, b) => {
        const tsA = a.kind === 'ralph-session' ? a.latestTimestamp : (() => {
            const ts = a.lastActivityAt ?? a.endTime ?? a.completedAt ?? a.startedAt ?? a.startTime ?? a.createdAt ?? 0;
            return typeof ts === 'number' ? ts : +new Date(ts);
        })();
        const tsB = b.kind === 'ralph-session' ? b.latestTimestamp : (() => {
            const ts = b.lastActivityAt ?? b.endTime ?? b.completedAt ?? b.startedAt ?? b.startTime ?? b.createdAt ?? 0;
            return typeof ts === 'number' ? ts : +new Date(ts);
        })();
        return tsB - tsA;
    });

    return entries;
}
