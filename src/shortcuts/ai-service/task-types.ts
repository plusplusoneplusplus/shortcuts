/**
 * Local payload interfaces and type guards for the AI queue system.
 *
 * These types were originally defined in pipeline-core but moved out
 * because pipeline-core's queue is type-agnostic. The VS Code extension
 * only uses two of the seven payload types, so they live here locally
 * rather than pulling in a dependency on coc-server.
 */

/**
 * Payload for follow-prompt tasks (instruction file or direct content).
 */
export interface FollowPromptPayload {
    /** Repository identifier (for multi-repo workspaces) */
    repoId?: string;
    /** Path to the prompt/instruction file */
    promptFilePath?: string;
    /** Direct prompt content (preferred over promptFilePath when present) */
    promptContent?: string;
    /** Path to the plan file to pass along */
    planFilePath?: string;
    /** Skill name (metadata only, not included in prompt text) */
    skillName?: string;
    /** Additional context appended to the prompt */
    additionalContext?: string;
    /** Working directory for AI execution */
    workingDirectory?: string;
    /** Folder path context */
    folderPath?: string;
}

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
}

/**
 * Type guard for FollowPromptPayload.
 * Checks whether the payload contains a prompt file path or direct prompt content.
 */
export function isFollowPromptPayload(payload: Record<string, unknown> | object): payload is FollowPromptPayload {
    return 'promptFilePath' in payload || 'promptContent' in payload;
}

/**
 * Type guard for AIClarificationPayload.
 * Checks for a prompt field without a data field (which would indicate a different payload type).
 */
export function isAIClarificationPayload(payload: Record<string, unknown> | object): payload is AIClarificationPayload {
    return 'prompt' in payload && !('data' in payload);
}
