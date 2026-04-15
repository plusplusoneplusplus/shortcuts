/**
 * Search Conversations Tool
 *
 * Factory that creates a `search_conversations` custom tool for the Copilot SDK.
 * The model calls this tool to search past AI conversation history using FTS5
 * full-text search. Requires a SQLite-backed ProcessStore.
 *
 * Per-invocation factory pattern: each AI call gets its own tool instance
 * bound to the store instance, avoiding cross-request contamination.
 */

import { defineTool } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

export interface SearchConversationsArgs {
    query: string;
    workspaceId?: string;
    limit?: number;
}

const MAX_RESULTS = 20;
const DEFAULT_LIMIT = 10;

/**
 * Strip HTML `<mark>` tags from FTS5 snippet output.
 * Snippets use `<mark>...</mark>` for highlighting in the web UI,
 * but the LLM doesn't need HTML markup.
 */
export function stripMarkTags(text: string): string {
    return text.replace(/<\/?mark>/g, '');
}

/**
 * Create a `search_conversations` custom tool definition for the Copilot SDK.
 *
 * @param store       ProcessStore instance (must support `searchConversations` for results)
 * @param workspaceId Optional default workspace ID to scope searches
 */
export function createSearchConversationsTool(store: ProcessStore, workspaceId?: string) {
    const tool = defineTool<SearchConversationsArgs>('search_conversations', {
        description:
            'Search past AI conversation history in this workspace using full-text search. ' +
            'Returns matching conversation snippets with process metadata. ' +
            'Use when the user references previous discussions or you need context from earlier sessions.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query (supports FTS5 syntax: quoted phrases, AND/OR/NOT operators)',
                },
                workspaceId: {
                    type: 'string',
                    description: 'Optional workspace ID to scope the search to a specific repository',
                },
                limit: {
                    type: 'number',
                    description: `Maximum number of results to return (default: ${DEFAULT_LIMIT}, max: ${MAX_RESULTS})`,
                },
            },
            required: ['query'],
        },
        handler: async (args: SearchConversationsArgs) => {
            if (!store.searchConversations) {
                return {
                    results: [],
                    total: 0,
                    query: args.query,
                    note: 'Conversation search is not available (requires SQLite backend)',
                };
            }

            const effectiveLimit = Math.min(
                Math.max(1, args.limit ?? DEFAULT_LIMIT),
                MAX_RESULTS,
            );
            const effectiveWorkspaceId = args.workspaceId ?? workspaceId;

            const { results, total } = await store.searchConversations(args.query, {
                workspaceId: effectiveWorkspaceId,
                limit: effectiveLimit,
            });

            return {
                results: results.map(r => ({
                    processId: r.processId,
                    title: r.processTitle || r.promptPreview,
                    snippet: stripMarkTags(r.snippet),
                    status: r.processStatus,
                    startTime: r.startTime,
                })),
                total,
                query: args.query,
            };
        },
    });

    return { tool };
}
