/**
 * ralph-session-grouping — groups history tasks by shared ralph.sessionId.
 *
 * Pure utility: no React, no side effects.
 */

export interface RalphSession {
    kind: 'ralph-session';
    sessionId: string;
    /** The grilling-phase process (ask mode + context.ralph.phase = 'grilling') */
    grillingProcess: any | undefined;
    /** Execution iterations (mode: 'ralph', phase: 'executing'|'complete') */
    iterations: any[];
    /** Most recent timestamp across all processes in this session */
    latestTimestamp: number;
    /** Whether any process in this session is unseen */
    hasUnseen: boolean;
    /** Overall session phase */
    phase: 'grilling' | 'executing' | 'complete';
}

export type RalphHistoryEntry = RalphSession | (any & { kind?: undefined });

/** Extract ralph.sessionId from a process/task. */
export function getRalphSessionId(task: any): string | undefined {
    return task.payload?.context?.ralph?.sessionId as string | undefined;
}

/** Extract ralph.phase from a process/task. */
export function getRalphPhase(task: any): 'grilling' | 'executing' | 'complete' | undefined {
    return task.payload?.context?.ralph?.phase as any;
}

/** Returns true if a task is part of a Ralph session. */
export function isRalphTask(task: any): boolean {
    return !!getRalphSessionId(task);
}

/** Compute the aggregate phase for a Ralph session. */
function computeSessionPhase(
    grillingProcess: any | undefined,
    iterations: any[],
): 'grilling' | 'executing' | 'complete' {
    // If any iteration signals complete
    if (iterations.some(t => getRalphPhase(t) === 'complete' || t.payload?.context?.ralph?.accumulatedProgress)) {
        // Check if it's actually done
        const lastIter = iterations[iterations.length - 1];
        if (lastIter?.status === 'completed') {
            // Heuristic: check if it was marked complete
            return 'complete';
        }
        return 'executing';
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
            .filter(t => t.payload?.mode === 'ralph')
            .sort((a: any, b: any) => {
                const iterA = a.payload?.context?.ralph?.currentIteration ?? 0;
                const iterB = b.payload?.context?.ralph?.currentIteration ?? 0;
                return iterA - iterB;
            });

        function getTs(t: any): number {
            const ts = t.lastActivityAt ?? t.endTime ?? t.completedAt ?? t.startedAt ?? t.startTime ?? t.createdAt ?? 0;
            return typeof ts === 'number' ? ts : +new Date(ts);
        }
        const latestTimestamp = Math.max(...sessionItems.map(getTs));

        const hasUnseen = unseenIds
            ? sessionItems.some(t => unseenIds.has(t.id))
            : false;

        entries.push({
            kind: 'ralph-session',
            sessionId,
            grillingProcess,
            iterations,
            latestTimestamp,
            hasUnseen,
            phase: computeSessionPhase(grillingProcess, iterations),
        });
    }

    for (const item of standalone) {
        entries.push(item);
    }

    // Sort by latest timestamp descending
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
