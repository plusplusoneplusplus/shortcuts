/**
 * Local payload interfaces and type guards for the AI queue system.
 *
 * FollowPromptPayload and buildFollowPromptText are shared with pipeline-core
 * so that the VS Code extension and CoC server produce identical prompts.
 * Local-only types (AIClarificationPayload) remain here.
 */

// Re-export shared follow-prompt types from pipeline-core
export {
    FollowPromptPayload,
    isFollowPromptPayload,
    buildFollowPromptText,
} from '@plusplusoneplusplus/pipeline-core';

/**
 * Payload for AI clarification tasks (explain/go-deeper on selected text).
 */
export interface AIClarificationPayload {
    /** Repository identifier (for multi-repo workspaces) */
    repoId?: string;
    /** Pre-built prompt text */
    prompt?: string;
    /** Working directory for AI execution */
    workingDirectory?: string;
    /** Model to use for this clarification */
    model?: string;
    /** Selected text to clarify */
    selectedText?: string;
    /** Source file path */
    filePath?: string;
    /** Start line of selection */
    startLine?: number;
    /** End line of selection */
    endLine?: number;
    /** Lines surrounding the selection for context */
    surroundingLines?: string;
    /** Nearest markdown heading above the selection */
    nearestHeading?: string | null;
    /** Type of instruction (clarify, go-deeper, custom) */
    instructionType?: string;
    /** Custom instruction text */
    customInstruction?: string;
    /** Content of an associated prompt file */
    promptFileContent?: string;
    /** Skill name (metadata only) */
    skillName?: string;
    /** Agent mode for execution ('ask' = read-only, 'plan', 'autopilot') */
    mode?: 'ask' | 'plan' | 'autopilot';
}

/**
 * Type guard for AIClarificationPayload.
 * Checks for a prompt field without a data field (which would indicate a different payload type).
 */
export function isAIClarificationPayload(payload: Record<string, unknown> | object): payload is AIClarificationPayload {
    return 'prompt' in payload && !('data' in payload);
}
