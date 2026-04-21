/**
 * Domain-Specific Task Types
 *
 * Unified task type model: three task types with mode-based AI dispatch.
 *
 *   TaskType = 'chat' | 'run-workflow' | 'run-script'
 *   ChatMode = 'ask' | 'plan' | 'autopilot'
 *
 * All former AI task types (follow-prompt, ai-clarification, code-review,
 * resolve-comments, task-generation, replicate-template, custom) are now
 * expressed as `type: 'chat'` with the appropriate mode and context.
 */

import type { Attachment, MCPServerConfig } from '@plusplusoneplusplus/forge';

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
    memoryAggregate: {
        kind: 'memory-aggregate',
        label: 'Memory Aggregate',
        exclusive: false,
        visible: false,
    },
    backgroundReview: {
        kind: 'background-review',
        label: 'Background Review',
        exclusive: false,
        visible: false,
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

export type TaskType = 'chat' | 'run-workflow' | 'run-script';

// ============================================================================
// Chat Mode
// ============================================================================

/** Controls permissions and concurrency for chat tasks. */
export type ChatMode = 'ask' | 'plan' | 'autopilot';

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
    /** Note-chat preset (side-by-side chat anchored to a specific note). */
    noteChat?: {
        notePath: string;
        noteTitle?: string;
    };
    /** Schedule-specific metadata. */
    scheduleId?: string;
    scheduleParams?: Record<string, string>;
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

export interface MemoryAggregatePayload {
    readonly kind: 'memory-aggregate';
    workspaceId: string;
    target: 'memory' | 'system';
    model?: string;
    /** Why this task was enqueued (e.g. 'capture-trigger', 'manual'). */
    trigger?: string;
}

export interface BackgroundReviewPayload {
    readonly kind: 'background-review';
    sourceProcessId: string;
    workspaceId: string;
    conversationSnapshot: Array<{ role: 'user' | 'assistant'; content: string }>;
    timeoutMs?: number;
}

// ============================================================================
// Payload Union
// ============================================================================

export type TaskPayload = ChatPayload | RunWorkflowPayload | RunScriptPayload | MemoryAggregatePayload | BackgroundReviewPayload;

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

export function isMemoryAggregatePayload(payload: Record<string, unknown>): payload is Record<string, unknown> & MemoryAggregatePayload {
    return payload.kind === 'memory-aggregate';
}

export function isBackgroundReviewPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & BackgroundReviewPayload {
    return payload.kind === 'background-review';
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

/** Check whether a chat payload carries note-chat context. */
export function hasNoteChatContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.noteChat;
}
