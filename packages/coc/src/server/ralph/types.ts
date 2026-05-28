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
    /** Final-check automation records. Absent on legacy sessions. */
    finalChecks?: RalphFinalCheckRecord[];
}

export interface ParsedProgressSection {
    iteration: number;
    signal: RalphExitSignal;
    timestamp: string;
    body: string;
}

// ============================================================================
// Final-check types (AC-01, AC-03)
// ============================================================================

export type RalphFinalCheckStatus = 'running' | 'completed' | 'failed';

/** Metadata record for one final-check run within a Ralph session. */
export interface RalphFinalCheckRecord {
    /** 1-based index of this check within the session. */
    checkIndex: number;
    /** The loop index that triggered this check (the loop that just completed). */
    loopIndex: number;
    /** The iteration number of the last iteration in the triggering loop. */
    sourceIteration: number;
    taskId?: string;
    processId?: string;
    startedAt: string;
    completedAt?: string;
    status: RalphFinalCheckStatus;
    /** Undefined while running; set on completion or failure. */
    hasGaps?: boolean;
    gapCount?: number;
    /** True if a gap-fix loop was started after this check. */
    gapLoopStarted?: boolean;
    /** The loopIndex of the gap-fix loop started, if any. */
    gapLoopIndex?: number;
    /** True when the gap-fix-loop cap was reached and no new loop was started. */
    capReached?: boolean;
    /** True when gapFixGoal was absent but synthesized server-side. */
    goalSynthesized?: boolean;
}
