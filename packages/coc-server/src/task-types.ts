/**
 * Domain-Specific Task Types
 *
 * Task type union, payload interfaces, and type guard functions for the CoC
 * execution layer. These are application-level concerns that belong in
 * coc-server (not in the generic pipeline-core queue engine).
 *
 * CodeReviewPayload is intentionally excluded — it was unused.
 * The 'code-review' string stays in TaskType for forward-compatibility.
 */

import type { Attachment } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Target Type
// ============================================================================

export type TargetType = 'prompt' | 'script';

// ============================================================================
// Task Type Union
// ============================================================================

export type TaskType =
    | 'follow-prompt'
    | 'resolve-comments'
    | 'code-review'
    | 'ai-clarification'
    | 'chat'
    | 'task-generation'
    | 'run-workflow'
    | 'run-script'
    | 'custom';

// ============================================================================
// Payload Interfaces
// ============================================================================

export interface FollowPromptPayload {
    repoId?: string;
    promptFilePath?: string;
    promptContent?: string;
    planFilePath?: string;
    skillName?: string;
    skillNames?: string[];
    additionalContext?: string;
    workingDirectory?: string;
    folderPath?: string;
}

export interface ResolveCommentsPayload {
    repoId?: string;
    documentUri: string;
    commentIds: string[];
    promptTemplate: string;
    workingDirectory?: string;
    documentContent: string;
    filePath: string;
    /** Workspace ID — used by server to persist comment resolution and broadcast WS events. */
    wsId?: string;
}

export interface AIClarificationPayload {
    repoId?: string;
    prompt?: string;
    workingDirectory?: string;
    model?: string;
    selectedText?: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    surroundingLines?: string;
    nearestHeading?: string | null;
    instructionType?: string;
    customInstruction?: string;
    promptFileContent?: string;
    skillName?: string;
}

export interface ChatPayload {
    readonly kind: 'chat';
    prompt: string;
    readonly?: boolean;
    processId?: string;
    parentTaskId?: string;
    attachments?: Attachment[];
    imageTempDir?: string;
    skillNames?: string[];
    workspaceId?: string;
    folderPath?: string;
    workingDirectory?: string;
}

export interface TaskGenerationPayload {
    readonly kind: 'task-generation';
    workingDirectory: string;
    prompt: string;
    targetFolder?: string;
    name?: string;
    model?: string;
    depth?: 'simple' | 'normal' | 'deep';
    mode?: 'from-feature';
    images?: string[];
    workspaceId?: string;
}

export interface RunWorkflowPayload {
    readonly kind: 'run-workflow';
    workflowPath: string;
    workingDirectory: string;
    model?: string;
    params?: Record<string, string>;
    workspaceId?: string;
    /** Pre-filtered MCP server map to pass to the AI SDK for this pipeline run. */
    mcpServers?: Record<string, import('@plusplusoneplusplus/pipeline-core').MCPServerConfig>;
}

export interface RunScriptPayload {
    readonly kind: 'run-script';
    script: string;
    workingDirectory?: string;
    scheduleId?: string;
}

export interface CustomTaskPayload {
    repoId?: string;
    data: Record<string, unknown>;
}

// ============================================================================
// Payload Union
// ============================================================================

export type TaskPayload =
    | FollowPromptPayload
    | ResolveCommentsPayload
    | AIClarificationPayload
    | ChatPayload
    | TaskGenerationPayload
    | RunWorkflowPayload
    | RunScriptPayload
    | CustomTaskPayload;

// ============================================================================
// Type Guards
// ============================================================================

// Guards accept Record<string, unknown> to match QueuedTask.payload (which is
// Record<string, unknown> after pipeline-core was generified). The intersection
// return type ensures callers get properly typed access to payload properties.

export function isFollowPromptPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & FollowPromptPayload {
    return 'promptFilePath' in payload || 'promptContent' in payload;
}

export function isResolveCommentsPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & ResolveCommentsPayload {
    return 'documentUri' in payload && 'commentIds' in payload;
}

export function isAIClarificationPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & AIClarificationPayload {
    return 'prompt' in payload && !('data' in payload);
}

export function isChatPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & ChatPayload {
    return (payload as any).kind === 'chat';
}

export function isChatFollowUp(payload: Record<string, unknown>): payload is Record<string, unknown> & ChatPayload {
    return isChatPayload(payload) && !!(payload as any).processId;
}

export function isCustomTaskPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & CustomTaskPayload {
    return 'data' in payload;
}

export function isTaskGenerationPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & TaskGenerationPayload {
    return (payload as any).kind === 'task-generation';
}

export function isRunWorkflowPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & RunWorkflowPayload {
    return (payload as any).kind === 'run-workflow';
}

export function isRunScriptPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & RunScriptPayload {
    return (payload as any).kind === 'run-script';
}
