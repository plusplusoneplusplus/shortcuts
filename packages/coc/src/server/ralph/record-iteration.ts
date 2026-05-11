/**
 * Bridge → journal write helper for one completed Ralph iteration.
 *
 * Wraps the `RalphSessionStore` calls used by `CLITaskExecutor`'s
 * `enqueueRalphNextIteration` so the sequence (append section + update
 * session.json with phase/terminalReason/iterations[]) is unit-testable in
 * isolation.
 *
 * No-ops when the dataDir, workspaceId, or sessionId is missing — supports
 * legacy in-flight sessions gracefully.
 */

import { RalphSessionStore } from './ralph-session-store';
import type {
    RalphExitSignal,
    RalphIterationRecord,
    RalphSessionRecord,
    RalphTerminalReason,
} from './types';

export interface RecordIterationInput {
    dataDir?: string;
    workspaceId?: string;
    sessionId?: string;
    iteration: number;
    maxIterations: number;
    signal: RalphExitSignal;
    progressBody: string;
    taskId: string;
    processId: string;
    /** True when the loop will continue with another iteration. */
    shouldContinue: boolean;
    /** Goal text used to seed `session.json` if it does not yet exist. */
    originalGoal?: string;
    /** Override clock for tests. Defaults to `new Date().toISOString()`. */
    nowIso?: string;
}

export interface RecordIterationResult {
    skipped: boolean;
    record?: RalphSessionRecord;
}

export async function recordRalphIteration(
    input: RecordIterationInput,
    storeOverride?: RalphSessionStore,
): Promise<RecordIterationResult> {
    const { dataDir, workspaceId, sessionId } = input;
    if ((!dataDir && !storeOverride) || !workspaceId || !sessionId) {
        return { skipped: true };
    }

    const store = storeOverride ?? new RalphSessionStore({ dataDir: dataDir! });
    const now = input.nowIso ?? new Date().toISOString();

    await store.appendProgressSection(workspaceId, sessionId, {
        iteration: input.iteration,
        signal: input.signal,
        timestamp: now,
        body: input.progressBody || '(no RALPH_PROGRESS body provided)',
    });

    const phase: 'executing' | 'complete' = input.shouldContinue ? 'executing' : 'complete';
    let terminalReason: RalphTerminalReason | undefined;
    if (!input.shouldContinue) {
        if (input.signal === 'RALPH_COMPLETE') terminalReason = 'RALPH_COMPLETE';
        else if (input.signal === 'NONE') terminalReason = 'NO_SIGNAL';
        else terminalReason = 'CAP_REACHED';
    }

    const record = await store.updateSessionRecord(workspaceId, sessionId, (rec) => {
        const next: RalphSessionRecord = rec ?? {
            sessionId,
            workspaceId,
            originalGoal: input.originalGoal ?? '',
            maxIterations: input.maxIterations,
            currentIteration: 0,
            phase,
            startedAt: now,
            iterations: [],
        };
        next.currentIteration = input.iteration;
        next.phase = phase;
        if (terminalReason) {
            next.completedAt = now;
            next.terminalReason = terminalReason;
        }
        const existing = next.iterations.find(i => i.iteration === input.iteration);
        const entry: RalphIterationRecord = {
            iteration: input.iteration,
            taskId: input.taskId,
            processId: input.processId,
            startedAt: existing?.startedAt ?? now,
            endedAt: now,
            status: 'completed',
            exitSignal: input.signal,
        };
        if (existing) Object.assign(existing, entry);
        else next.iterations.push(entry);
        return next;
    });

    return { skipped: false, record };
}
