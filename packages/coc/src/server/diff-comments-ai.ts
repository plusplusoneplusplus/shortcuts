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

/**
 * Build a batch-resolve prompt for diff comments.
 *
 * Unlike task-comment resolve (which asks AI to output a revised document),
 * diff-comment resolve asks AI only for analysis/summary per comment.
 * The AI calls `resolve_comment(id, summary)` for each addressed comment.
 */
export function buildDiffBatchResolvePrompt(
    comments: DiffComment[],
    diffContent: string,
    filePath: string,
    oldRef: string,
    newRef: string,
): string {
    const openComments = comments
        .filter(c => c.status === 'open')
        .sort((a, b) => (a.selection?.diffLineStart ?? 0) - (b.selection?.diffLineStart ?? 0));

    if (openComments.length === 0) {
        return '';
    }

    let prompt = '# Diff Comment Resolution Request\n\n';
    prompt += `You are reviewing comments on a code diff for file \`${filePath}\` (${oldRef} → ${newRef}).\n\n`;

    prompt += '## Diff Content\n\n';
    prompt += '```diff\n';
    prompt += diffContent;
    prompt += '\n```\n\n';

    prompt += '## Open Comments\n\n';

    openComments.forEach((c, i) => {
        prompt += `### Comment ${i + 1}`;
        if (c.selection?.diffLineStart != null) {
            prompt += ` (Diff line ${c.selection.diffLineStart})`;
        }
        prompt += '\n\n';
        prompt += `- **ID**: \`${c.id}\`\n`;
        prompt += `- **Selected Text**: "${c.selectedText}"\n`;
        prompt += `- **Comment**: "${c.comment}"\n`;
        const author = c.author?.trim();
        if (author) {
            prompt += `- **Author**: ${author}\n`;
        }
        if (c.category?.trim()) {
            prompt += `- **Category**: ${c.category.trim()}\n`;
        }
        if (Array.isArray(c.tags) && c.tags.length > 0) {
            const tags = c.tags.map(tag => tag.trim()).filter(Boolean);
            if (tags.length > 0) {
                prompt += `- **Tags**: ${tags.join(', ')}\n`;
            }
        }
        if (c.aiResponse?.trim()) {
            prompt += `- **Previous AI Response**: ${c.aiResponse}\n`;
        }
        if (Array.isArray(c.replies) && c.replies.length > 0) {
            const replies = c.replies
                .filter(reply => reply.text?.trim())
                .map(reply => `${reply.author || 'Anonymous'}: ${reply.text}`);
            if (replies.length > 0) {
                prompt += `- **Replies**:\n`;
                replies.forEach(r => { prompt += `  > ${r}\n`; });
            }
        }
        prompt += '\n';
    });

    prompt += '## Instructions\n\n';
    prompt += '1. Analyze each comment in the context of the diff shown above.\n';
    prompt += '2. For each comment you can address, explain whether the code change is correct, what improvement could be made, or why the concern is already handled.\n';
    prompt += '3. Call `resolve_comment(commentId, summary)` for each comment you address.\n';
    prompt += '4. Do NOT call `resolve_comment` for comments you cannot address.\n';

    return prompt;
}
