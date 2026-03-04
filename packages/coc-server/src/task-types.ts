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
    | 'readonly-chat'
    | 'chat-followup'
    | 'task-generation'
    | 'run-pipeline'
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

export interface RunPipelinePayload {
    readonly kind: 'run-pipeline';
    pipelinePath: string;
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

export interface ChatFollowUpPayload {
    readonly kind: 'chat-followup';
    /** The process ID of the parent chat session to follow up on */
    processId: string;
    /** Queue task ID of the original chat task — used to re-activate it instead of creating a new row */
    parentTaskId?: string;
    /** Message content to send as the follow-up */
    content: string;
    /** Optional file attachments decoded from uploaded images */
    attachments?: Attachment[];
    /** Temp directory created for image attachments — cleaned up after execution */
    imageTempDir?: string;
    /** Working directory of the original process — used to route to the correct per-repo queue */
    workingDirectory?: string;
}

// ============================================================================
// Payload Union
// ============================================================================

export type TaskPayload =
    | FollowPromptPayload
    | ResolveCommentsPayload
    | AIClarificationPayload
    | ChatPayload
    | ChatFollowUpPayload
    | TaskGenerationPayload
    | RunPipelinePayload
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

export function isReadOnlyChatPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & ChatPayload {
    return (payload as any).kind === 'chat';
}

export function isCustomTaskPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & CustomTaskPayload {
    return 'data' in payload;
}

export function isTaskGenerationPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & TaskGenerationPayload {
    return (payload as any).kind === 'task-generation';
}

export function isRunPipelinePayload(payload: Record<string, unknown>): payload is Record<string, unknown> & RunPipelinePayload {
    return (payload as any).kind === 'run-pipeline';
}

export function isRunScriptPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & RunScriptPayload {
    return (payload as any).kind === 'run-script';
}

export function isChatFollowUpPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & ChatFollowUpPayload {
    return (payload as any).kind === 'chat-followup';
}
