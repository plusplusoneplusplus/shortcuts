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
 * Render a single comment block for use in batch resolve prompts.
 * Shared between single-file and multi-file prompt builders.
 */
export function renderCommentBlock(comment: DiffComment, index: number): string {
    let block = `### Comment ${index + 1}`;
    if (comment.selection?.diffLineStart != null) {
        block += ` (Diff line ${comment.selection.diffLineStart})`;
    }
    block += '\n\n';
    block += `- **ID**: \`${comment.id}\`\n`;
    block += `- **Selected Text**: "${comment.selectedText}"\n`;
    block += `- **Comment**: "${comment.comment}"\n`;
    const author = comment.author?.trim();
    if (author) {
        block += `- **Author**: ${author}\n`;
    }
    if (Array.isArray(comment.tags) && comment.tags.length > 0) {
        const tags = comment.tags.map(tag => tag.trim()).filter(Boolean);
        if (tags.length > 0) {
            block += `- **Tags**: ${tags.join(', ')}\n`;
        }
    }
    if (comment.aiResponse?.trim()) {
        block += `- **Previous AI Response**: ${comment.aiResponse}\n`;
    }
    if (Array.isArray(comment.replies) && comment.replies.length > 0) {
        const replies = comment.replies
            .filter(reply => reply.text?.trim())
            .map(reply => `${reply.author || 'Anonymous'}: ${reply.text}`);
        if (replies.length > 0) {
            block += `- **Replies**:\n`;
            replies.forEach(r => { block += `  > ${r}\n`; });
        }
    }
    block += '\n';
    return block;
}

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
        prompt += renderCommentBlock(c, i);
    });

    prompt += '## Instructions\n\n';
    prompt += '1. Analyze each comment in the context of the diff shown above.\n';
    prompt += '2. For each comment you can address, explain whether the code change is correct, what improvement could be made, or why the concern is already handled.\n';
    prompt += '3. Call `resolve_comment(commentId, summary)` for each comment you address.\n';
    prompt += '4. Do NOT call `resolve_comment` for comments you cannot address.\n';

    return prompt;
}

/**
 * Build a batch-resolve prompt for multi-file diff comments.
 *
 * Unlike the single-file variant, this prompt does NOT embed diff content.
 * Instead it references oldRef/newRef and instructs the AI to use tools
 * to examine the actual code changes.
 */
export function buildMultiFileBatchResolvePrompt(
    fileEntries: Array<{ filePath: string; comments: DiffComment[] }>,
    oldRef: string,
    newRef: string,
): string {
    // Collect open comments per file, filtering and sorting
    const filesWithOpen = fileEntries
        .map(entry => ({
            filePath: entry.filePath,
            openComments: entry.comments
                .filter(c => c.status === 'open')
                .sort((a, b) => (a.selection?.diffLineStart ?? 0) - (b.selection?.diffLineStart ?? 0)),
        }))
        .filter(entry => entry.openComments.length > 0);

    if (filesWithOpen.length === 0) {
        return '';
    }

    let prompt = '# Multi-File Diff Comment Resolution\n\n';
    prompt += `You are reviewing comments on code changes from \`${oldRef}\` to \`${newRef}\`.\n`;
    prompt += 'Use your tools to examine the actual code changes for each file listed below.\n\n';

    prompt += '## Files with Open Comments\n\n';

    filesWithOpen.forEach((file, fileIdx) => {
        prompt += `### File ${fileIdx + 1}: \`${file.filePath}\`\n\n`;
        prompt += '#### Comments\n\n';
        file.openComments.forEach((c, commentIdx) => {
            // Use ##### heading for individual comments within a file
            let block = `##### Comment ${commentIdx + 1}`;
            if (c.selection?.diffLineStart != null) {
                block += ` (Diff line ${c.selection.diffLineStart})`;
            }
            block += '\n\n';
            block += `- **ID**: \`${c.id}\`\n`;
            block += `- **Selected Text**: "${c.selectedText}"\n`;
            block += `- **Comment**: "${c.comment}"\n`;
            const author = c.author?.trim();
            if (author) {
                block += `- **Author**: ${author}\n`;
            }
            if (Array.isArray(c.tags) && c.tags.length > 0) {
                const tags = c.tags.map(tag => tag.trim()).filter(Boolean);
                if (tags.length > 0) {
                    block += `- **Tags**: ${tags.join(', ')}\n`;
                }
            }
            if (c.aiResponse?.trim()) {
                block += `- **Previous AI Response**: ${c.aiResponse}\n`;
            }
            if (Array.isArray(c.replies) && c.replies.length > 0) {
                const replies = c.replies
                    .filter(reply => reply.text?.trim())
                    .map(reply => `${reply.author || 'Anonymous'}: ${reply.text}`);
                if (replies.length > 0) {
                    block += `- **Replies**:\n`;
                    replies.forEach(r => { block += `  > ${r}\n`; });
                }
            }
            block += '\n';
            prompt += block;
        });
    });

    prompt += '## Instructions\n\n';
    prompt += `1. For each file, examine the diff between \`${oldRef}\` and \`${newRef}\` using your available tools.\n`;
    prompt += '2. Analyze each comment in the context of the actual code changes.\n';
    prompt += '3. Call `resolve_comment(commentId, summary)` for each comment you address.\n';
    prompt += '4. Do NOT call `resolve_comment` for comments you cannot address.\n';
    prompt += '5. Comments span multiple files — consider cross-file relationships.\n';

    return prompt;
}
