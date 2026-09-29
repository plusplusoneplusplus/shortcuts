/**
 * Portable Ralph orchestration records and parse result types.
 *
 * These contracts intentionally contain no CoC server queue, process-store,
 * route, WebSocket, or filesystem ownership types.
 */

export type RalphExitSignal = 'RALPH_NEXT' | 'RALPH_COMPLETE' | 'RALPH_NEEDS_INPUT' | 'NONE';

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

export type RalphSessionPhase = 'grilling' | 'executing' | 'awaiting-input' | 'complete';

export type RalphTerminalReason =
    | 'RALPH_COMPLETE'
    | 'MANUAL_VERIFICATION_ONLY'
    | 'CAP_REACHED'
    | 'CANCELLED'
    | 'NO_SIGNAL'
    | 'USER_STOPPED';

export type RalphSessionCompleteReason =
    | 'signal'
    | 'manual-verification-only'
    | 'cap'
    | 'user-stopped'
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
    /**
     * HEAD SHA of the checkout after this iteration completed; absent on
     * legacy sessions and when git could not be read.
     */
    headSha?: string;
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
    /**
     * HEAD SHA of the workspace checkout at session creation (non-worktree
     * sessions). Gives later automation (e.g. PR submit) the exact
     * `baselineSha..HEAD` commit range this session produced. Absent on
     * legacy sessions and when the SHA could not be resolved at creation.
     */
    baselineSha?: string;
    startedAt: string;
    completedAt?: string;
    terminalReason?: RalphTerminalReason;
    iterations: RalphIterationRecord[];
    /** Multi-loop history. Absent on pre-existing single-loop sessions. */
    loops?: RalphLoopRecord[];
    /** Final-check automation records. Absent on legacy sessions. */
    finalChecks?: RalphFinalCheckRecord[];
    /** PR-submit automation records. Absent on legacy sessions. */
    submits?: RalphSubmitRecord[];
    /**
     * The isolated Git worktree backing this session, when the session was
     * launched with opt-in worktree execution. Lets resume/continue/final-check
     * and the dashboard chip recover the worktree without re-deriving it.
     * Absent on non-worktree sessions.
     */
    worktree?: RalphWorktreeMetadata;
    /**
     * The question batch the session is waiting on while
     * `phase === 'awaiting-input'`. Cleared when the user answers or stops
     * the session. Absent on sessions that never asked.
     */
    pendingInput?: RalphPendingInput;
    /** Answers the user gave to earlier RALPH_NEEDS_INPUT batches, oldest first. */
    humanInputs?: RalphHumanInput[];
}

/** A RALPH_NEEDS_INPUT request persisted on the session until answered. */
export interface RalphPendingInput {
    /** The iteration that asked. */
    iteration: number;
    taskId: string;
    processId: string;
    requestedAt: string;
    request: RalphInputRequest;
}

/** One answered question from a RALPH_NEEDS_INPUT batch. */
export interface RalphHumanAnswer {
    question: string;
    answer: string | string[];
}

/** The user's reply to a RALPH_NEEDS_INPUT batch, carried into the next iteration. */
export interface RalphHumanInput {
    /** The iteration that asked. */
    iteration: number;
    answeredAt: string;
    answers: RalphHumanAnswer[];
    note?: string;
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
    /**
     * Set once a format-repair turn has been requested for this check.
     * Bounds the repair to exactly one attempt, across restarts.
     */
    repairAttempted?: boolean;
}

export type RalphSubmitStatus = 'queued' | 'running' | 'completed' | 'failed';

/** Metadata record for one PR-submit run within a Ralph session. */
export interface RalphSubmitRecord {
    /** 1-based index of this submit within the session. */
    submitIndex: number;
    taskId?: string;
    processId?: string;
    startedAt: string;
    completedAt?: string;
    status: RalphSubmitStatus;
    /** URL of the created pull request; set on successful completion. */
    prUrl?: string;
    prNumber?: number;
    /** Commit SHAs included in the pull request, oldest first. */
    commitShas?: string[];
    /** Failure reason; set when status is 'failed'. */
    error?: string;
}

export type RalphSubmitParseStatus = 'submitted' | 'failed' | 'unparseable';

/**
 * Parsed outcome of a PR-submit agent response (the RALPH_SUBMIT_RESULT
 * JSON block the submit prompt instructs the agent to end with).
 */
export interface RalphSubmitResult {
    status: RalphSubmitParseStatus;
    /** URL of the created pull request; present when status is 'submitted'. */
    prUrl?: string;
    prNumber?: number;
    /** Commit SHAs included in the pull request, oldest first. */
    commitShas?: string[];
    /**
     * Failure reason reported by the agent when status is 'failed', or the
     * parse-error detail when status is 'unparseable'.
     */
    error?: string;
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

/** Answer types a RALPH_NEEDS_INPUT question may use (mirrors `ask_user`). */
export type RalphInputQuestionType = 'select' | 'multi-select' | 'yes-no' | 'confirm' | 'text';

export interface RalphInputOption {
    value: string;
    label: string;
    description?: string;
}

/** One question in a RALPH_NEEDS_INPUT batch; `ask_user` shape plus a recommendation. */
export interface RalphInputQuestion {
    question: string;
    type: RalphInputQuestionType;
    options?: RalphInputOption[];
    defaultValue?: string | string[];
    /** The agent's recommended answer, used by "Use recommendation". */
    recommendation: string | string[];
}

/** The single question batch an iteration may raise with RALPH_NEEDS_INPUT. */
export interface RalphInputRequest {
    /** What the agent found and why it is blocked. */
    context: string;
    questions: RalphInputQuestion[];
}

export type RalphNeedsInputParseResult =
    | { status: 'absent' }
    | { status: 'ok'; request: RalphInputRequest }
    | { status: 'invalid'; error: string };
