/**
 * AI prompt builders for task comments.
 *
 * Extracted from task-comments-handler.ts to reduce file size.
 */

import {
    DEFAULT_AI_COMMANDS,
    type AICommand,
    buildPromptFromContext,
    type PromptContext,
} from '@plusplusoneplusplus/forge';
import type { TaskComment, DocumentContext } from './task-comments-manager';

/**
 * Build an enriched prompt using a named AI command and optional document context.
 */
export function buildEnrichedPrompt(
    command: AICommand,
    comment: TaskComment,
    customQuestion: string | undefined,
    docCtx: DocumentContext | undefined
): string {
    const promptTemplate =
        command.isCustomInput && customQuestion ? customQuestion : command.prompt;

    const context: PromptContext = {
        selectedText: comment.selectedText,
        filePath: docCtx?.filePath ?? comment.filePath,
        surroundingContent: docCtx?.surroundingLines,
        nearestHeading: docCtx?.nearestHeading ?? null,
        headings: docCtx?.allHeadings,
    };

    return buildPromptFromContext(promptTemplate, context);
}

/**
 * Build a document revision prompt for one or more open comments.
 * Ported from VS Code's PromptGenerator.generateMarkdownPrompt().
 *
 * @param comments       - Array of TaskComment objects; only status==='open' are included.
 * @param absoluteFilePath - Absolute path to the task file.
 * @param displayPath    - Relative task path (used for display only).
 * @returns Structured prompt string. The AI must output ONLY the revised document.
 */
export function buildBatchResolvePrompt(
    comments: TaskComment[],
    absoluteFilePath: string,
    displayPath: string,
    userContext?: string,
): string {
    const openComments = comments
        .filter(c => c.status === 'open')
        .sort((a, b) => a.selection.startLine - b.selection.startLine);

    let prompt = '# Document Review Request\n\n';
    prompt += 'Please review the following comments in the markdown document and propose how to address each one.\n';
    prompt += 'Do NOT directly modify the file. Instead, explain what changes should be made and show proposed edits as markdown code blocks or diffs.\n\n';
    prompt += '---\n\n';
    prompt += `## File: ${displayPath}\n\n`;
    prompt += `The document is located at: ${absoluteFilePath}\n`;
    prompt += 'Read it using your tools to understand the full context.\n\n';

    openComments.forEach((c, i) => {
        prompt += `### Comment ${i + 1} (Line ${c.selection.startLine})\n\n`;
        prompt += `**ID:** \`${c.id}\`\n\n`;
        prompt += '**Selected Text:**\n```\n';
        prompt += c.selectedText;
        prompt += '\n```\n\n';
        prompt += `**Comment:** ${c.comment}\n\n`;
        const author = c.author?.trim();
        if (author) {
            prompt += `**Author:** ${author}\n\n`;
        }
        const category = c.category?.trim();
        if (category) {
            prompt += `**Category:** ${category}\n\n`;
        }
        if (Array.isArray(c.tags) && c.tags.length > 0) {
            const tags = c.tags.map(tag => tag.trim()).filter(Boolean);
            if (tags.length > 0) {
                prompt += `**Tags:** ${tags.join(', ')}\n\n`;
            }
        }
        if (c.aiResponse?.trim()) {
            prompt += '**Previous AI Response:**\n';
            prompt += `${c.aiResponse}\n\n`;
        }
        if (Array.isArray(c.replies) && c.replies.length > 0) {
            const replies = c.replies
                .filter(reply => reply.text?.trim())
                .map(reply => `> ${reply.author || 'Anonymous'}: ${reply.text}`);
            if (replies.length > 0) {
                prompt += '**Replies:**\n';
                prompt += `${replies.join('\n')}\n\n`;
            }
        }
        prompt += '**Requested Action:** Propose how to revise this section to address the comment.\n\n';
    });

    prompt += '---\n\n';
    prompt += '# Instructions\n\n';
    prompt += '1. For each comment above, propose the specific changes needed in the document\n';
    prompt += '2. Show proposed edits as markdown code blocks or unified diffs\n';
    prompt += '3. Explain why each change addresses the comment\n';
    prompt += '4. Do NOT directly edit or overwrite the file — only propose changes for the user to review\n';
    prompt += '5. You have a `resolve_comment` tool available. For each comment you propose a solution for, call `resolve_comment` with the comment\'s ID and a brief summary of the proposed change.\n';
    prompt += '6. Do NOT call `resolve_comment` for comments you cannot address (e.g., ambiguous, need clarification, out of scope).\n';

    if (userContext?.trim()) {
        prompt += '\n## Additional Context from User\n\n';
        prompt += userContext.trim() + '\n';
    }

    return prompt;
}

/**
 * Build a prompt for AI clarification from a comment.
 */
export function buildAIPrompt(comment: TaskComment, question: string): string {
    let prompt = 'Context: The user is reviewing a markdown task document.\n';
    if (comment.selectedText) {
        prompt += 'They selected the following text:\n---\n' + comment.selectedText + '\n---\n\n';
    }
    if (comment.comment) {
        prompt += 'Their comment says: "' + comment.comment + '"\n\n';
    }
    prompt += 'Question: ' + question + '\n\nProvide a clear, actionable response.';
    return prompt;
}

/** Re-export DEFAULT_AI_COMMANDS so the handler doesn't need a separate forge import for it. */
export { DEFAULT_AI_COMMANDS };
