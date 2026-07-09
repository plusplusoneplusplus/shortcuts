/**
 * Portable Ralph orchestration records and parse result types.
 *
 * These contracts intentionally contain no CoC server queue, process-store,
 * route, WebSocket, or filesystem ownership types.
 */

export type RalphExitSignal = 'RALPH_NEXT' | 'RALPH_COMPLETE' | 'NONE';

export type RalphSignal = RalphExitSignal;

export interface RalphParseResult {
    /** Loop control signal detected in the response. */
    signal: RalphSignal;
    /**
     * Content of the RALPH_PROGRESS: block, trimmed.
     * Empty string when no block was found.
     */
    progress: string;
}

export type RalphSessionPhase = 'grilling' | 'executing' | 'complete';

export type RalphTerminalReason =
    | 'RALPH_COMPLETE'
    | 'MANUAL_VERIFICATION_ONLY'
    | 'CAP_REACHED'
    | 'CANCELLED'
    | 'NO_SIGNAL';

export type RalphSessionCompleteReason =
    | 'signal'
    | 'manual-verification-only'
    | 'cap'
    | 'final-check-failed'
    | 'final-check-enqueue-failed'
    | 'final-check-session-missing'
    | 'final-check-gap-loop-start-failed'
    | 'final-check-gap-enqueue-failed';

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

/**
 * Portable mirror of the CoC-server `WorktreeMetadata` contract (which lives in
 * `@plusplusoneplusplus/coc-client`). Duplicated here so the dependency-free
 * portable Ralph record can carry the worktree that backs a session without
 * coupling `coc-workflow` to the client package. Structurally compatible: the
 * server assigns its `WorktreeMetadata` straight into this field.
 */
export interface RalphWorktreeMetadata {
    /** Stable id for this worktree run (usually the Ralph session id). */
    id: string;
    /** Workspace whose checkout this worktree was branched from. */
    workspaceId: string;
    /** Absolute path to the isolated worktree checkout on the target server. */
    path: string;
    /** Dedicated branch created for this run, e.g. `coc/<slug>-<short-id>`. */
    branch: string;
    /** Requested base ref/branch/SHA, if any; omitted when based on `HEAD`. */
    baseRef?: string;
    /** Resolved commit SHA the worktree branch was created from. */
    baseSha: string;
    /** ISO timestamp when the worktree was created. */
    createdAt: string;
    /** Whether the source checkout had uncommitted changes at creation time. */
    sourceDirty: boolean;
    /** Human-facing warning surfaced when `sourceDirty` is true. */
    sourceDirtyWarning?: string;
    /** Linked queued process id, when known. */
    processId?: string;
    /** Linked Ralph session id, when the worktree backs a Ralph session. */
    ralphSessionId?: string;
    /** Lifecycle status; `cleaned` once the checkout has been removed. */
    status: 'active' | 'cleaned';
    /** ISO timestamp when the checkout was removed via cleanup, if cleaned. */
    cleanedAt?: string;
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
    /**
     * The isolated Git worktree backing this session, when the session was
     * launched with opt-in worktree execution. Lets resume/continue/final-check
     * and the dashboard chip recover the worktree without re-deriving it.
     * Absent on non-worktree sessions.
     */
    worktree?: RalphWorktreeMetadata;
}

export interface ParsedProgressSection {
    iteration: number;
    signal: RalphExitSignal;
    timestamp: string;
    body: string;
}

export type RalphFinalCheckStatus = 'queued' | 'running' | 'completed' | 'failed';

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

export interface FinalCheckGap {
    id: string;
    title: string;
    evidence: string;
    recommendedAction: string;
    validation?: string;
}

export type FinalCheckParseStatus =
    | 'clean'
    | 'gaps'
    | 'invalid'
    | 'unparseable';

export interface FinalCheckResult {
    status: FinalCheckParseStatus;
    hasGaps: boolean;
    summary: string;
    gaps: FinalCheckGap[];
    /**
     * Focused gap-fix goal. Present when hasGaps is true.
     * When the AI omitted it but hasGaps is true, this field contains a
     * synthesized goal and `goalSynthesized` is true.
     */
    gapFixGoal?: string;
    /** True when gapFixGoal was absent in the AI response and was synthesized. */
    goalSynthesized?: boolean;
    /** Raw error message when status is 'unparseable' or 'invalid'. */
    error?: string;
}
