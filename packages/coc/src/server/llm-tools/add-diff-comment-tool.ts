/**
 * Add Diff Comment Tool
 *
 * Factory that creates a per-invocation `add_diff_comment` custom tool
 * for commit chat. The AI calls this tool to leave persistent, anchored
 * review comments on specific lines of a commit diff.
 *
 * Per-invocation factory pattern: each AI call gets its own state,
 * avoiding cross-request contamination. Pre-bound context (workspace,
 * commit, parent) is closed over so the AI only provides per-call values.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { DiffCommentContext, DiffCommentSelection } from '@plusplusoneplusplus/forge';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { DiffCommentsManager } from '../tasks/comments/diff-comments-manager';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import {
    getFileDiff,
    parseUnifiedDiff,
    mapLinesToDiffIndices,
    extractTextFromDiffLines,
} from './diff-line-mapper';

// ============================================================================
// Types
// ============================================================================

export interface AddDiffCommentArgs {
    filePath: string;
    lineStart: number;
    lineEnd?: number;
    side: 'added' | 'removed' | 'context';
    comment: string;
    selectedText?: string;
    category?: 'bug' | 'question' | 'suggestion' | 'praise' | 'nitpick' | 'general';
}

export interface AddDiffCommentDeps {
    manager: DiffCommentsManager;
    workspaceId: string;
    commitHash: string;
    parentHash: string;
    workingDirectory: string;
    getWsServer?: () => ProcessWebSocketServer | undefined;
}

interface AddedComment {
    commentId: string;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    category: string;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a per-invocation `add_diff_comment` tool with pre-bound commit context.
 *
 * Returns:
 * - `tool` — the Tool object to register on the AI session.
 * - `getAddedComments()` — accessor for post-execution summary.
 */
export function createAddDiffCommentTool(deps: AddDiffCommentDeps) {
    const addedComments: AddedComment[] = [];

    const tool = defineTool<AddDiffCommentArgs>('add_diff_comment', {
        description:
            'Leave a review comment anchored to specific lines of the commit diff — to flag bugs, suggest improvements, ask questions, or praise.',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Repo-relative file path',
                },
                lineStart: {
                    type: 'number',
                    description: 'Start line number in the source file (1-based)',
                },
                lineEnd: {
                    type: 'number',
                    description: 'End line number (defaults to lineStart for single-line comments)',
                },
                side: {
                    type: 'string',
                    enum: ['added', 'removed', 'context'],
                    description: 'Diff side: "added" = new lines, "removed" = deleted lines, "context" = unchanged lines',
                },
                comment: {
                    type: 'string',
                    description: 'The review comment text',
                },
                selectedText: {
                    type: 'string',
                    description: 'The code text being annotated (auto-extracted from diff if omitted)',
                },
                category: {
                    type: 'string',
                    enum: ['bug', 'question', 'suggestion', 'praise', 'nitpick', 'general'],
                    description: 'Comment category (defaults to "general")',
                },
            },
            required: ['filePath', 'lineStart', 'side', 'comment'],
        },
        handler: async (args) => {
            try {
                const lineEnd = args.lineEnd ?? args.lineStart;
                const category = args.category ?? 'general';

                // 1. Get the diff and parse it
                const diffOutput = getFileDiff(
                    deps.workingDirectory,
                    deps.parentHash,
                    deps.commitHash,
                    args.filePath,
                );

                const parsedLines = parseUnifiedDiff(diffOutput);
                if (parsedLines.length === 0) {
                    return { success: false, error: `No diff content found for ${args.filePath} — file may be binary or unchanged` };
                }

                // 2. Map source lines to diff indices
                const mapping = mapLinesToDiffIndices(parsedLines, args.side, args.lineStart, lineEnd);

                // 3. Resolve selectedText
                const selectedText = args.selectedText
                    || extractTextFromDiffLines(parsedLines, mapping.diffLineStart, mapping.diffLineEnd);

                // 4. Build DiffCommentContext using the same convention as the SPA client
                const context: DiffCommentContext = {
                    repositoryId: deps.workspaceId,
                    filePath: args.filePath,
                    oldRef: `${deps.commitHash}^`,
                    newRef: deps.commitHash,
                };

                // 5. Build selection
                const selection: DiffCommentSelection = {
                    diffLineStart: mapping.diffLineStart,
                    diffLineEnd: mapping.diffLineEnd,
                    side: args.side,
                    oldLineStart: mapping.oldLineStart,
                    oldLineEnd: mapping.oldLineEnd,
                    newLineStart: mapping.newLineStart,
                    newLineEnd: mapping.newLineEnd,
                    startColumn: 0,
                    endColumn: 0,
                };

                // 6. Add comment via manager
                const commentData = {
                    context,
                    selection,
                    selectedText,
                    comment: args.comment,
                    status: 'open' as const,
                    author: 'AI',
                    tags: [category],
                };

                const addedComment = await deps.manager.addComment(
                    deps.workspaceId,
                    context,
                    commentData,
                );

                // 7. Compute storage key and broadcast
                const storageKey = deps.manager.hashContext(context);
                deps.getWsServer?.()?.broadcastProcessEvent({
                    type: 'diff-comment-updated',
                    action: 'added',
                    workspaceId: deps.workspaceId,
                    storageKey,
                    comment: addedComment,
                });

                // 8. Track for post-execution summary
                addedComments.push({
                    commentId: addedComment.id,
                    filePath: args.filePath,
                    lineStart: args.lineStart,
                    lineEnd,
                    category,
                });

                return {
                    success: true,
                    commentId: addedComment.id,
                    filePath: args.filePath,
                };
            } catch (err: any) {
                return {
                    success: false,
                    error: err?.message || 'Failed to add diff comment',
                };
            }
        },
    });

    return {
        tool: tool as Tool<unknown>,
        getAddedComments: () => [...addedComments],
    };
}
