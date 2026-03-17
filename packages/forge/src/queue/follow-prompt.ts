/**
 * Follow-Prompt Types and Utilities
 *
 * Shared payload interface and prompt-building logic for follow-prompt tasks.
 * Used by both the VS Code extension and the CoC server to ensure consistent
 * prompt construction when executing skill/prompt-file based AI tasks.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Payload Interface
// ============================================================================

/**
 * Payload for follow-prompt tasks (instruction file or direct content).
 */
export interface FollowPromptPayload {
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
}

// ============================================================================
// Type Guard
// ============================================================================

/**
 * Type guard for FollowPromptPayload.
 * Checks whether the payload contains a prompt file path or direct prompt content.
 */
export function isFollowPromptPayload(payload: Record<string, unknown> | object): payload is FollowPromptPayload {
    return 'promptFilePath' in payload || 'promptContent' in payload;
}

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Build the prompt text for a follow-prompt task.
 *
 * Format:
 * - With direct content: `{promptContent} {planFilePath}`
 * - With file path:      `Follow the instruction {promptFilePath}. {planFilePath}`
 * - Additional context is appended as: `\n\nAdditional context: {text}`
 */
export function buildFollowPromptText(payload: FollowPromptPayload): string {
    let fullPrompt: string;
    if (payload.promptContent) {
        fullPrompt = payload.promptContent;
        if (payload.planFilePath) {
            fullPrompt += ` ${payload.planFilePath}`;
        }
    } else {
        fullPrompt = `Follow the instruction ${payload.promptFilePath}. ${payload.planFilePath || ''}`.trim();
    }
    if (payload.additionalContext && payload.additionalContext.trim()) {
        fullPrompt += `\n\nAdditional context: ${payload.additionalContext.trim()}`;
    }
    return fullPrompt;
}
