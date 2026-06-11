/**
 * Domain-Specific Task Types
 *
 * Unified task type model with mode-based AI dispatch for chat tasks.
 *
 *   CocTaskKind = 'chat' | 'run-workflow' | 'run-script' | 'pr-classification' | 'dream-run'
 *   ChatMode = 'ask' | 'autopilot' | 'ralph'
 *
 * All former AI task types (follow-prompt, ai-clarification, code-review,
 * resolve-comments, task-generation, replicate-template, custom) are now
 * expressed as `type: 'chat'` with the appropriate mode and context.
 *
 * ----------------------------------------------------------------------------
 * Ralph orchestration context lives in three places by design:
 *   - payload.context.ralph  : authoritative on queue tasks (grilling + execution)
 *   - payload.mode==='ralph' : execution-phase routing flag (mode='ask' for grilling)
 *   - metadata.ralph         : denormalized projection for AIProcess history items
 * ALWAYS read context via getRalphContext() — never combine these inline.
 * The payload→metadata projection is centralized in serializeRalphMetadata().
 * ----------------------------------------------------------------------------
 */

import type { Attachment, MCPServerConfig } from '@plusplusoneplusplus/forge';
import type { ForEachItem, MapReduceChildMode, MapReduceItem } from '@plusplusoneplusplus/coc-client';
import type { RalphGrillSetup } from '../ralph/grill-planning';

// ============================================================================
// Target Type
// ============================================================================

export type TargetType = 'prompt' | 'script';

// ============================================================================
// Task Type Definitions (Single Source of Truth)
// ============================================================================

/** Metadata for a single task type. */
export interface TaskTypeDef {
    /** The wire-format string used in QueuedTask.type and payload.kind */
    readonly kind: string;
    /** Human-readable label for UI display */
    readonly label: string;
    /** Whether this task type runs in the exclusive (serial) queue slot */
    readonly exclusive: boolean;
    /** Whether this task type appears in the activity list / filter UI */
    readonly visible: boolean;
}

/**
 * Single source of truth for all CoC task types.
 *
 * Usage:
 *   TaskDefs.chat.kind              // 'chat'
 *   TaskDefs.backgroundReview.kind  // 'background-review'
 *   TaskDefs.runWorkflow.label      // 'Run Workflow'
 */
export const TaskDefs = {
    chat: {
        kind: 'chat',
        label: 'Chat',
        exclusive: false,
        visible: true,
    },
    runWorkflow: {
        kind: 'run-workflow',
        label: 'Run Workflow',
        exclusive: true,
        visible: true,
    },
    runScript: {
        kind: 'run-script',
        label: 'Run Script',
        exclusive: true,
        visible: true,
    },
    prClassification: {
        kind: 'pr-classification',
        label: 'PR Classification',
        exclusive: false,
        visible: false,
    },
    dreamRun: {
        kind: 'dream-run',
        label: 'Dream Run',
        exclusive: false,
        visible: true,
    },
} as const satisfies Record<string, TaskTypeDef>;

/** Union of all task type kind strings, derived from TaskDefs. */
export type CocTaskKind = typeof TaskDefs[keyof typeof TaskDefs]['kind'];

/** Lookup a TaskTypeDef by its wire-format kind string. */
export function getTaskDef(kind: string): TaskTypeDef | undefined {
    return Object.values(TaskDefs).find(d => d.kind === kind);
}

/** Labels for visible task types (used by ActivityListPane, queue-shared). */
export const VISIBLE_TASK_TYPE_LABELS: Record<string, string> = Object.fromEntries(
    Object.values(TaskDefs).filter(d => d.visible).map(d => [d.kind, d.label]),
);

/** Set of task kinds accepted by the public enqueue API. */
export const VALID_ENQUEUE_TYPES: ReadonlySet<string> = new Set(
    Object.values(TaskDefs).filter(d => d.visible).map(d => d.kind),
);

// ============================================================================
// Task Type Union
// ============================================================================

export type TaskType = 'chat' | 'run-workflow' | 'run-script' | 'dream-run';

// ============================================================================
// Chat Mode
// ============================================================================

/** Controls permissions and concurrency for chat tasks. */
export type ChatMode = 'ask' | 'autopilot' | 'ralph';

export interface InheritedLensChatMode {
    inherited: true;
    source: 'features.commitChatLens';
}

/**
 * Legacy chat-mode wire values accepted for runtime compatibility only.
 * `plan` is normalized to `ask` before execution or persistence.
 */
export type LegacyChatMode = ChatMode | 'plan';

/** User-facing schedule modes. Ralph scheduling is handled by server internals only. */
export type ScheduleMode = 'ask' | 'autopilot';

/** Instruction folder names that loadInstructions accepts (no ralph — it aliases autopilot). */
export type InstructionMode = 'ask' | 'autopilot';

const CHAT_MODE_NORMALIZATION: Record<LegacyChatMode, ChatMode> = {
    ask: 'ask',
    plan: 'ask',
    autopilot: 'autopilot',
    ralph: 'ralph',
};

/** Normalize chat-mode values from persisted legacy data or older clients. */
export function normalizeChatMode(value: unknown): ChatMode | undefined {
    if (typeof value !== 'string') return undefined;
    return CHAT_MODE_NORMALIZATION[value as LegacyChatMode];
}

/** Normalize a chat-mode value, falling back when the value is absent or invalid. */
export function normalizeChatModeOrDefault(value: unknown, fallback: ChatMode = 'ask'): ChatMode {
    return normalizeChatMode(value) ?? fallback;
}

/** Maps each ChatMode to the instruction folder used by loadInstructions. */
const INSTRUCTION_MODE_MAP: Record<ChatMode, InstructionMode> = {
    ask: 'ask',
    autopilot: 'autopilot',
    ralph: 'autopilot',
};

/** Returns the instruction folder name for a chat mode; legacy `plan` uses Ask instructions. */
export function resolveInstructionMode(mode: LegacyChatMode): InstructionMode {
    return INSTRUCTION_MODE_MAP[normalizeChatModeOrDefault(mode)];
}

// ============================================================================
// Chat Context
// ============================================================================

/** Contextual information injected into the prompt before sending to AI. */
export interface ChatContext {
    /** Files/folders to include as context (replaces promptFilePath, planFilePath). */
    files?: string[];
    /** Inline text blocks to inject. */
    blocks?: Array<{ label: string; content: string }>;
    /** Skill names to activate. */
    skills?: string[];
    /** Task generation preset (FS introspection config). */
    taskGeneration?: {
        targetFolder?: string;
        name?: string;
        depth?: 'simple' | 'normal' | 'deep';
        mode?: 'from-feature';
        images?: string[];
    };
    /** Commit replication preset. */
    replication?: {
        commitHash: string;
        templateName: string;
        hints?: string[];
        model?: string;
    };
    /** Resolve-comments preset (server-side comment resolution data). */
    resolveComments?: {
        documentUri: string;
        commentIds: string[];
        documentContent: string;
        filePath: string;
        wsId?: string;
    };
    /** Resolve-diff-comments-multi preset (multi-file, ref-based, no diff content). */
    resolveDiffCommentsMulti?: {
        files: Array<{
            storageKey: string;
            commentIds: string[];
            filePath: string;
        }>;
        wsId: string;
        oldRef: string;
        newRef: string;
    };
    /** Commit-chat preset (side-by-side chat anchored to a specific commit). */
    commitChat?: {
        commitHash: string;
        commitMessage?: string;
    };
    /** Pull-request-chat preset (side-by-side chat anchored to a specific PR). */
    pullRequestChat?: {
        /** Stable per-provider PR identifier (numeric for GitHub/ADO). */
        prId: string;
        /** Optional repo identifier (workspace ID) the PR belongs to. */
        repoId?: string;
        /** Human-readable PR number (typically equal to prId for GitHub/ADO). */
        prNumber?: number;
        /** PR title — used to enrich the AI prompt. */
        prTitle?: string;
    };
    /** Work Item chat preset (side-by-side chat anchored to a local Work Item/Goal). */
    workItemChat?: {
        workspaceId: string;
        workItemId: string;
        workItemNumber?: number;
        status?: string;
        type?: string;
    };
    /** Local Goal grilling chat; final spec is intended for the Work Item store, not Notes. */
    workItemGoalGrilling?: {
        workspaceId: string;
        workItemId: string;
        title?: string;
        contentVersion?: number | null;
    };
    /** Note-chat preset (side-by-side chat anchored to a specific note). */
    noteChat?: {
        notePath: string;
        noteTitle?: string;
    };
    /** Note-create preset (AI-generated title + placement for a new note). */
    noteCreate?: {
        prompt: string;
        chatTaskId?: string;
    };
    /** Inherited Lens Chat mode marker for note-producing AI flows. */
    lensChat?: InheritedLensChatMode;
    /** Schedule-specific metadata. */
    scheduleId?: string;
    /** Schedule run record ID that originated this task chain. */
    scheduleRunId?: string;
    scheduleParams?: Record<string, string>;
    /** Ralph-mode orchestration metadata. */
    ralph?: RalphContext;
    /** For Each generation or parent-run linkage. */
    forEach?: ForEachContext;
    /** Map Reduce generation or parent-run linkage. */
    mapReduce?: MapReduceContext;
    /** Auto provider selection details captured before execution. */
    autoProviderRouting?: {
        requested?: boolean;
        selectedByAuto?: boolean;
        provider?: ChatProvider;
        fallbackUsed?: boolean;
        warnings?: string[];
        decisions?: unknown[];
        fallback?: unknown;
    };
    /** PR diff classification context — dispatches to ClassificationExecutor. */
    classifyDiff?: {
        repoId: string;
        prId: string;
        headSha: string;
    };
}

export type ForEachChildMode = 'ask' | 'autopilot';

export interface ForEachGenerationLatestPlan {
    turnIndex: number;
    items: ForEachItem[];
    childMode: ForEachChildMode;
    sharedInstructions?: string;
    rawJson?: string;
    updatedAt?: string;
}

/** For Each child chat linkage (mirrored verbatim into AIProcess.metadata.forEach). */
export interface ForEachChildContext {
    /** Legacy child contexts omitted kind; keep that shape valid. */
    kind?: 'child';
    workspaceId: string;
    runId: string;
    itemId: string;
    childMode: ForEachChildMode;
}

/** Visible For Each item-plan generation chat metadata. */
export interface ForEachGenerationContext {
    kind: 'generation';
    workspaceId: string;
    generationId: string;
    childMode: ForEachChildMode;
    originalRequest: string;
    status: 'draft' | 'approved';
    runId?: string;
    latestItemCount?: number;
    latestPlanTurnIndex?: number;
    latestPlan?: ForEachGenerationLatestPlan;
    lastPlanError?: string;
    lastPlanErrorTurnIndex?: number;
}

export type ForEachContext = ForEachChildContext | ForEachGenerationContext;

export interface MapReduceGenerationLatestPlan {
    turnIndex: number;
    items: MapReduceItem[];
    childMode: MapReduceChildMode;
    sharedInstructions?: string;
    reduceInstructions: string;
    maxParallel: number;
    rawJson?: string;
    updatedAt?: string;
}

/** Visible Map Reduce plan-generation chat metadata. */
export interface MapReduceGenerationContext {
    kind: 'generation';
    workspaceId: string;
    generationId: string;
    childMode: MapReduceChildMode;
    originalRequest: string;
    status: 'draft' | 'approved';
    runId?: string;
    latestItemCount?: number;
    latestPlanTurnIndex?: number;
    latestPlan?: MapReduceGenerationLatestPlan;
    lastPlanError?: string;
    lastPlanErrorTurnIndex?: number;
}

/** Map Reduce map child chat linkage (mirrored verbatim into AIProcess.metadata.mapReduce). */
export interface MapReduceMapChildContext {
    workspaceId: string;
    runId: string;
    phase: 'map';
    itemId: string;
    childMode: MapReduceChildMode;
}

/** Map Reduce reduce-step child chat linkage (mirrored verbatim into AIProcess.metadata.mapReduce). */
export interface MapReduceReduceChildContext {
    workspaceId: string;
    runId: string;
    phase: 'reduce';
    childMode: MapReduceChildMode;
}

export type MapReduceContext = MapReduceMapChildContext | MapReduceReduceChildContext | MapReduceGenerationContext;

/** Ralph-mode orchestration context (mirrored verbatim into AIProcess.metadata.ralph). */
export interface RalphContext {
    /** Confirmed goal spec (plain text or structured Markdown). */
    originalGoal: string;
    /** Maximum iterations before the loop stops (default: 10). */
    maxIterations?: number;
    /** 1-based iteration counter, incremented on each re-enqueue. */
    currentIteration?: number;
    /** Links the grill-me task and all iteration tasks in the UI. */
    sessionId?: string;
    /** 1-based loop index for multi-loop Ralph sessions. */
    loopIndex?: number;
    /** Current stage of the Ralph session. */
    phase?: 'grilling' | 'executing' | 'complete';
    /** Optional multi-agent grilling setup. Honored only when the server feature flag is enabled. */
    grill?: RalphGrillSetup;
    /**
     * Present on final-check tasks only (AC-01/02). Identifies this as a
     * read-only goal-gap checker task. When set, `enqueueRalphNextIteration`
     * routes to the final-check orchestration path instead of the normal
     * iteration continuation path.
     */
    finalCheck?: {
        kind: 'goal-gap-check';
        /** 1-based index of this check within the session. */
        checkIndex: number;
        /** Last iteration number of the loop that triggered this check. */
        sourceIteration: number;
        /** The loop index that triggered this check. */
        loopIndex: number;
    };
}

// ============================================================================
// Post-Action Types
// ============================================================================

/** A single post-action to run after the AI task completes. */
export type PostAction =
    | { type: 'script'; script: string }
    | { type: 'skill'; skillName: string; prompt?: string };

// ============================================================================
// Payload Interfaces
// ============================================================================

/** Supported AI provider IDs for per-chat routing. */
export type ChatProvider = 'copilot' | 'codex' | 'claude';

/** Supported ChatProvider values (for runtime validation). */
export const VALID_CHAT_PROVIDERS: ReadonlySet<ChatProvider> = new Set(['copilot', 'codex', 'claude']);

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/** Supported reasoning-effort override values (for runtime validation). */
export const VALID_REASONING_EFFORTS: ReadonlySet<ReasoningEffort> = new Set(['low', 'medium', 'high', 'xhigh']);

export interface ChatPayload {
    readonly kind: 'chat';
    mode: ChatMode;
    prompt: string;
    context?: ChatContext;
    /** Additional tools to inject (e.g., 'resolve-comments'). */
    tools?: string[];
    /** For follow-ups: the process ID of the existing conversation. */
    processId?: string;
    attachments?: Attachment[];
    imageTempDir?: string;
    workspaceId?: string;
    folderPath?: string;
    workingDirectory?: string;
    /** Model override for this task. */
    model?: string;
    /** Shell command/path to run before the AI task. */
    beforeScript?: string;
    /** Shell command/path to run after the AI task (always runs, even if AI fails). */
    afterScript?: string;
    /** Ordered list of post-actions (scripts or skills) to run after the AI task. */
    postActions?: PostAction[];
    /** Base64 data-URLs to persist in the user conversation turn. */
    images?: string[];
    /**
     * AI provider to use for this chat task.
     * Defaults to the server-level default provider when omitted.
     * Supported values: 'copilot' | 'codex' | 'claude'.
     */
    provider?: ChatProvider;
    /** Per-turn reasoning-effort override, normalized to task config by queue validation. */
    reasoningEffort?: ReasoningEffort;
}

export interface RunWorkflowPayload {
    readonly kind: 'run-workflow';
    workflowPath: string;
    workingDirectory: string;
    model?: string;
    params?: Record<string, string>;
    workspaceId?: string;
    /** Pre-filtered MCP server map to pass to the AI SDK for this pipeline run. */
    mcpServers?: Record<string, MCPServerConfig>;
}

export interface RunScriptPayload {
    readonly kind: 'run-script';
    script: string;
    workingDirectory?: string;
    scheduleId?: string;
}

export interface PrClassificationPayload {
    readonly kind: 'pr-classification';
    workspaceId: string;
    repoId: string;
    prId: string;
    headSha: string;
    prompt: string;
    workingDirectory?: string;
    skills?: string[];
    /** AI provider to use (optional; falls back to server default). */
    provider?: ChatProvider;
    /** Reasoning effort override for models that support it. */
    reasoningEffort?: ReasoningEffort;
}

export type DreamRunTrigger = 'manual' | 'idle';

export interface DreamRunPayload {
    readonly kind: 'dream-run';
    workspaceId: string;
    trigger: DreamRunTrigger;
    confidenceThreshold?: number;
    maxCandidates?: number;
    conversationLimit?: number;
    minIdleMs?: number;
    timeoutMs?: number;
    /** AI provider to use (optional; falls back to server default). */
    provider?: ChatProvider;
    /** Model override for this dream run. */
    model?: string;
    /** Reasoning effort override for models that support it. */
    reasoningEffort?: ReasoningEffort;
    workingDirectory?: string;
}

// ============================================================================
// Payload Union
// ============================================================================

export type TaskPayload = ChatPayload | RunWorkflowPayload | RunScriptPayload | PrClassificationPayload | DreamRunPayload;

// ============================================================================
// Type Guards
// ============================================================================

export function isChatPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & ChatPayload {
    return payload.kind === 'chat';
}

export function isChatFollowUp(payload: Record<string, unknown>): payload is Record<string, unknown> & ChatPayload {
    return isChatPayload(payload) && !!payload.processId;
}

export function isRunWorkflowPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & RunWorkflowPayload {
    return payload.kind === 'run-workflow';
}

export function isRunScriptPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & RunScriptPayload {
    return payload.kind === 'run-script';
}

export function isPrClassificationPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & PrClassificationPayload {
    return payload.kind === 'pr-classification';
}

export function isDreamRunPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & DreamRunPayload {
    return payload.kind === 'dream-run';
}

/** Check whether a chat payload carries task-generation context. */
export function hasTaskGenerationContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.taskGeneration;
}

/** Check whether a chat payload carries resolve-comments context. */
export function hasResolveCommentsContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.resolveComments;
}

/** Check whether a chat payload carries resolve-diff-comments-multi context. */
export function hasResolveDiffCommentsMultiContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.resolveDiffCommentsMulti;
}

/** Check whether a chat payload carries replication context. */
export function hasReplicationContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.replication;
}

/** Check whether a chat payload carries commit-chat context. */
export function hasCommitChatContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.commitChat;
}

/** Check whether a chat payload carries pull-request-chat context. */
export function hasPullRequestChatContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.pullRequestChat;
}

/** Check whether a chat payload carries note-chat context. */
export function hasNoteChatContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.noteChat;
}

/** Check whether a chat payload carries note-create context. */
export function hasNoteCreateContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.noteCreate;
}

/** Check whether a value is the inherited Lens Chat mode marker. */
export function isInheritedLensChatMode(value: unknown): value is InheritedLensChatMode {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return candidate.inherited === true && candidate.source === 'features.commitChatLens';
}

/** Check whether a chat payload carries Ralph-mode orchestration context. */
export function hasRalphContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.ralph;
}

/** Check whether a chat payload carries PR diff classification context. */
export function hasClassifyDiffContext(payload: Record<string, unknown>): boolean {
    if (!isChatPayload(payload)) return false;
    const ctx = payload.context?.classifyDiff;
    return !!ctx && typeof ctx.repoId === 'string' && typeof ctx.prId === 'string' && typeof ctx.headSha === 'string';
}

/** Check whether a chat payload is in Ralph mode. */
export function isRalphMode(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && payload.mode === 'ralph';
}

// ============================================================================
// Ralph Context Accessors (single source of truth)
// ============================================================================

/**
 * Resolves Ralph orchestration context from any task-or-process shape, or null.
 *
 * Precedence:
 *   1. `payload.context.ralph` (authoritative for live queue tasks)
 *   2. `metadata.ralph`        (denormalized projection on AIProcess history)
 *   3. `null`
 *
 * `payload.mode === 'ralph'` is intentionally NOT consulted — it is a routing
 * flag, not a context source.
 */
export function getRalphContext(
    source: { payload?: unknown; metadata?: unknown } | null | undefined,
): RalphContext | null {
    if (!source) return null;
    const payload = source.payload as { context?: { ralph?: unknown } } | undefined;
    const fromPayload = payload?.context?.ralph;
    if (fromPayload && typeof fromPayload === 'object') {
        return fromPayload as RalphContext;
    }
    const metadata = source.metadata as { ralph?: unknown } | undefined;
    const fromMetadata = metadata?.ralph;
    if (fromMetadata && typeof fromMetadata === 'object') {
        return fromMetadata as RalphContext;
    }
    return null;
}

/** True iff the source carries any Ralph orchestration context (any phase). */
export function isRalphTask(
    source: { payload?: unknown; metadata?: unknown } | null | undefined,
): boolean {
    return getRalphContext(source) !== null;
}

export function getForEachContext(
    source: { payload?: unknown; metadata?: unknown } | null | undefined,
): ForEachContext | null {
    if (!source) return null;
    const payload = source.payload as { context?: { forEach?: unknown } } | undefined;
    const fromPayload = payload?.context?.forEach;
    if (fromPayload && typeof fromPayload === 'object') {
        return fromPayload as ForEachContext;
    }
    const metadata = source.metadata as { forEach?: unknown } | undefined;
    const fromMetadata = metadata?.forEach;
    if (fromMetadata && typeof fromMetadata === 'object') {
        return fromMetadata as ForEachContext;
    }
    return null;
}

export function getMapReduceContext(
    source: { payload?: unknown; metadata?: unknown } | null | undefined,
): MapReduceContext | null {
    if (!source) {
        return null;
    }
    const payload = source.payload as { context?: { mapReduce?: unknown } } | undefined;
    const fromPayload = payload?.context?.mapReduce;
    if (fromPayload && typeof fromPayload === 'object') {
        return fromPayload as MapReduceContext;
    }
    const metadata = source.metadata as { mapReduce?: unknown } | undefined;
    const fromMetadata = metadata?.mapReduce;
    if (fromMetadata && typeof fromMetadata === 'object') {
        return fromMetadata as MapReduceContext;
    }
    return null;
}

export function isForEachGenerationContext(context: ForEachContext | null | undefined): context is ForEachGenerationContext {
    return context?.kind === 'generation';
}

export function isMapReduceGenerationContext(context: MapReduceContext | null | undefined): context is MapReduceGenerationContext {
    return (context as { kind?: unknown } | null | undefined)?.kind === 'generation';
}

/**
 * Computes the value to assign to `AIProcess.metadata.ralph` from a queued task
 * payload. Returns `undefined` for non-chat payloads or chat payloads without
 * ralph context. This is the single payload→metadata projection point.
 */
export function serializeRalphMetadata(payload: unknown): RalphContext | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    if (!isChatPayload(payload as Record<string, unknown>)) return undefined;
    const ralph = (payload as ChatPayload).context?.ralph;
    return ralph ?? undefined;
}

export function serializeForEachMetadata(payload: unknown): ForEachContext | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    if (!isChatPayload(payload as Record<string, unknown>)) return undefined;
    const forEach = (payload as ChatPayload).context?.forEach;
    return forEach ?? undefined;
}

export function serializeMapReduceMetadata(payload: unknown): MapReduceContext | undefined {
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }
    if (!isChatPayload(payload as Record<string, unknown>)) {
        return undefined;
    }
    const mapReduce = (payload as ChatPayload).context?.mapReduce;
    return mapReduce ?? undefined;
}
