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

import type { Attachment, MCPServerConfig } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Target Type
// ============================================================================

export type TargetType = 'prompt' | 'script';

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
    /** Schedule-specific metadata. */
    scheduleId?: string;
    scheduleParams?: Record<string, string>;
}

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

// ============================================================================
// Payload Union
// ============================================================================

export type TaskPayload = ChatPayload | RunWorkflowPayload | RunScriptPayload;

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

/** Check whether a chat payload carries task-generation context. */
export function hasTaskGenerationContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.taskGeneration;
}

/** Check whether a chat payload carries resolve-comments context. */
export function hasResolveCommentsContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.resolveComments;
}

/** Check whether a chat payload carries replication context. */
export function hasReplicationContext(payload: Record<string, unknown>): boolean {
    return isChatPayload(payload) && !!payload.context?.replication;
}
