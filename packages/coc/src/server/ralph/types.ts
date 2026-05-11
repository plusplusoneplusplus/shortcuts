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
    taskId: string;
    processId: string;
    startedAt: string;
    endedAt?: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    exitSignal?: RalphExitSignal;
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
}

export interface ParsedProgressSection {
    iteration: number;
    signal: RalphExitSignal;
    timestamp: string;
    body: string;
}
