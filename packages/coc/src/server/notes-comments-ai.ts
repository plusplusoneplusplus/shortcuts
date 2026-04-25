/**
 * AI prompt builders for notes comments.
 *
 * Builds a resolve prompt for notes comment threads using anchor-based
 * text selection (quotedText + surrounding context) rather than line/column.
 */

import type { CommentThread } from './notes-comments-types';

/**
 * Build a batch resolve prompt for open notes comment threads.
 *
 * Unlike task comments which use line-based selections, notes comments use
 * text anchors (quotedText + prefix/suffix context). This builder formats
 * the open threads into a structured prompt that asks the AI to revise the
 * document and resolve each comment.
 *
 * @param threads        - All threads from the sidecar; only status==='open' are included.
 * @param notePath       - Path to the note file (used for display and tool reference).
 * @param documentContent - Current document content.
 * @param userContext    - Optional additional context from the user.
 * @returns Structured prompt string.
 */
export function buildNotesBatchResolvePrompt(
    threads: CommentThread[],
    notePath: string,
    documentContent: string,
    userContext?: string,
): string {
    const openThreads = Object.values(threads)
        .filter(t => t.status === 'open')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    let prompt = '# Document Revision Request\n\n';
    prompt += 'Please review and address the following comments in this note.\n';
    prompt += 'For each comment, make the necessary changes to the document.\n\n';
    prompt += '---\n\n';
    prompt += `## File: ${notePath}\n\n`;

    prompt += '### Current Document Content\n\n';
    prompt += '```markdown\n';
    prompt += documentContent;
    prompt += '\n```\n\n';

    openThreads.forEach((thread, i) => {
        prompt += `### Comment ${i + 1}\n\n`;
        prompt += `**Thread ID:** \`${thread.id}\`\n\n`;

        prompt += '**Highlighted Text:**\n```\n';
        prompt += thread.anchor.quotedText;
        prompt += '\n```\n\n';

        if (thread.anchor.prefix) {
            prompt += `**Context before:** …${thread.anchor.prefix}\n\n`;
        }
        if (thread.anchor.suffix) {
            prompt += `**Context after:** ${thread.anchor.suffix}…\n\n`;
        }

        const firstComment = thread.comments[0];
        if (firstComment) {
            prompt += `**Comment:** ${firstComment.content}\n\n`;
        }

        // Include follow-up replies if any
        if (thread.comments.length > 1) {
            const replies = thread.comments.slice(1)
                .filter(c => c.content?.trim())
                .map(c => `> ${c.content}`);
            if (replies.length > 0) {
                prompt += '**Replies:**\n';
                prompt += `${replies.join('\n')}\n\n`;
            }
        }

        prompt += '**Requested Action:** Revise this section to address the comment.\n\n';
    });

    prompt += '---\n\n';
    prompt += '# Instructions\n\n';
    prompt += '1. For each comment above, modify the corresponding section in the document\n';
    prompt += '2. Preserve the overall document structure and formatting\n';
    prompt += '3. Output the COMPLETE revised document content\n';
    prompt += '4. Do NOT include any markdown fencing or explanation — output ONLY the revised document\n';
    prompt += '5. You have a `resolve_comment` tool available. For each comment you address, call `resolve_comment` with the thread\'s ID and a brief summary of the change.\n';
    prompt += '6. Do NOT call `resolve_comment` for comments you cannot address (e.g., ambiguous, need clarification, out of scope).\n';

    if (userContext?.trim()) {
        prompt += '\n## Additional Context from User\n\n';
        prompt += userContext.trim() + '\n';
    }

    return prompt;
}
