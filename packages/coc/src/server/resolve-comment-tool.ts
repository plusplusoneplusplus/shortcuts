/**
 * Resolve Comment Tool
 *
 * Factory that creates a per-invocation `resolve_comment` custom tool
 * and a resolution tracker. The tool is registered on the AI session
 * so AI can explicitly mark each comment it addresses.
 *
 * Per-invocation factory pattern: each AI call gets its own Map,
 * avoiding cross-request contamination.
 */

import { defineTool } from '@plusplusoneplusplus/pipeline-core';

interface ResolveCommentArgs {
    commentId: string;
    summary: string;
}

export function createResolveCommentTool() {
    const resolvedIds = new Map<string, string>(); // commentId → summary

    const tool = defineTool<ResolveCommentArgs>('resolve_comment', {
        description: 'Mark a comment as resolved after addressing it in the revised document. Call once per comment you actually fix.',
        parameters: {
            type: 'object',
            properties: {
                commentId: { type: 'string', description: 'The comment ID from the prompt' },
                summary: { type: 'string', description: 'Brief description of what was changed' },
            },
            required: ['commentId', 'summary'],
        },
        handler: (args) => {
            resolvedIds.set(args.commentId, args.summary);
            return { resolved: true, commentId: args.commentId };
        },
    });

    return {
        tool,
        getResolvedIds: () => [...resolvedIds.keys()],
        getResolutions: () => new Map(resolvedIds),
    };
}
