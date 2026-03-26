/**
 * AI prompt builders for diff comments.
 *
 * Extracted from diff-comments-handler.ts to reduce file size.
 */

import {
    DEFAULT_AI_COMMANDS,
    type AICommand,
    buildPromptFromContext,
    type PromptContext,
} from '@plusplusoneplusplus/forge';
import type { DiffComment } from '@plusplusoneplusplus/forge';

/**
 * Build an enriched prompt using a named AI command for a diff comment.
 */
export function buildDiffEnrichedPrompt(
    command: AICommand,
    comment: DiffComment,
    customQuestion: string | undefined
): string {
    const promptTemplate =
        command.isCustomInput && customQuestion ? customQuestion : command.prompt;

    const context: PromptContext = {
        selectedText: comment.selectedText,
        filePath: comment.context.filePath,
    };

    let prompt = buildPromptFromContext(promptTemplate, context);
    prompt += `\n\nDiff context: ${comment.context.filePath} (${comment.context.oldRef} → ${comment.context.newRef})`;
    if (comment.comment) {
        prompt += `\nUser comment: "${comment.comment}"`;
    }
    return prompt;
}

/**
 * Build a simple AI prompt with diff-specific context.
 */
export function buildDiffAIPrompt(comment: DiffComment, question: string): string {
    let prompt = 'Context: The user is reviewing a git diff.\n';
    prompt += `File: ${comment.context.filePath}\n`;
    prompt += `Diff range: ${comment.context.oldRef} → ${comment.context.newRef}\n\n`;
    if (comment.selectedText) {
        prompt += 'They selected the following text from the diff:\n---\n' + comment.selectedText + '\n---\n\n';
    }
    if (comment.comment) {
        prompt += 'Their comment says: "' + comment.comment + '"\n\n';
    }
    prompt += 'Question: ' + question + '\n\nProvide a clear, actionable response.';
    return prompt;
}

/** Re-export DEFAULT_AI_COMMANDS so the handler doesn't need a separate forge import for it. */
export { DEFAULT_AI_COMMANDS };
