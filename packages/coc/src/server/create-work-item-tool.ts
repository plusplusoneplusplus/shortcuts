/**
 * Create Work Item Tool
 *
 * Factory that creates a `create_work_item` custom tool for the Copilot SDK.
 * The model calls this tool when the user asks to create a work item during
 * a chat session. The handler persists the item via FileWorkItemStore and
 * optionally broadcasts a WebSocket event so connected clients update immediately.
 */

import * as crypto from 'crypto';
import { defineTool } from '@plusplusoneplusplus/forge';
import { FileWorkItemStore } from './work-items/work-item-store';
import type { WorkItemPriority } from './work-items/types';

// ============================================================================
// Types
// ============================================================================

export interface CreateWorkItemArgs {
    title: string;
    description?: string;
    priority?: 'high' | 'normal' | 'low';
    tags?: string[];
}

export type BroadcastWorkItemFn = (event: {
    type: 'work-item-added';
    workspaceId: string;
    item: unknown;
}) => void;

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a `create_work_item` custom tool definition for the Copilot SDK.
 *
 * @param dataDir     - Base data directory (e.g. `~/.coc`).
 * @param repoId      - Workspace / repository ID the item belongs to.
 * @param broadcastFn - Optional function to broadcast a WebSocket event after creation.
 */
export function createWorkItemTool(
    dataDir: string,
    repoId: string,
    broadcastFn?: BroadcastWorkItemFn,
) {
    const store = new FileWorkItemStore({ dataDir });

    const tool = defineTool<CreateWorkItemArgs>('create_work_item', {
        description:
            'Create a new work item in the Work Items page for this repository. ' +
            'Use this when the user asks to create a work item, track a feature request, ' +
            'file a bug, or save a task for later execution.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Short, descriptive title for the work item.',
                },
                description: {
                    type: 'string',
                    description: 'Markdown description with context and details.',
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description: 'Priority of the work item (default: normal).',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional tags for categorization (e.g. ["bug", "frontend"]).',
                },
            },
            required: ['title'],
        },
        handler: async (args: CreateWorkItemArgs) => {
            const now = new Date().toISOString();
            const item = {
                id: crypto.randomUUID(),
                repoId,
                title: args.title,
                description: args.description ?? '',
                status: 'created' as const,
                createdAt: now,
                updatedAt: now,
                source: 'chat' as const,
                priority: (args.priority ?? 'normal') as WorkItemPriority,
                tags: args.tags,
            };

            await store.addWorkItem(item);
            broadcastFn?.({ type: 'work-item-added', workspaceId: repoId, item });

            return { created: true, id: item.id, title: item.title };
        },
    });

    return { tool };
}
