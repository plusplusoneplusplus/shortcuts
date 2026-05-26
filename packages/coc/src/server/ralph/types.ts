/**
 * Ralph session journal types.
 */

export type RalphExitSignal = 'RALPH_NEXT' | 'RALPH_COMPLETE' | 'NONE';

export type RalphSessionPhase = 'grilling' | 'executing' | 'complete';

export type RalphTerminalReason =
    | 'RALPH_COMPLETE'
    | 'CAP_REACHED'
    | 'CANCELLED'
    | 'NO_SIGNAL';

export interface RalphIterationRecord {
    iteration: number;
    /** 1-based index of the loop this iteration belongs to. */
    loopIndex: number;
    taskId: string;
    processId: string;
    startedAt: string;
    endedAt?: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    exitSignal?: RalphExitSignal;
}

/** Metadata for a single goal-phase (loop) within a Ralph session. */
export interface RalphLoopRecord {
    /** 1-based loop index. */
    loopIndex: number;
    goal: string;
    startIteration: number;
    endIteration?: number;
    terminalReason?: RalphTerminalReason;
    startedAt: string;
    completedAt?: string;
}

export interface RalphSessionRecord {
    sessionId: string;
    workspaceId: string;
    originalGoal: string;
    maxIterations: number;
    currentIteration: number;
    phase: RalphSessionPhase;
    startedAt: string;
    completedAt?: string;
    terminalReason?: RalphTerminalReason;
    iterations: RalphIterationRecord[];
    /** Multi-loop history. Absent on pre-existing single-loop sessions. */
    loops?: RalphLoopRecord[];
}

export interface ParsedProgressSection {
    iteration: number;
    signal: RalphExitSignal;
    timestamp: string;
    body: string;
}
