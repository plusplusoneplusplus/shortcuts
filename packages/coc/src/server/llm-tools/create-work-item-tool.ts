/**
 * Create Work Item Tool
 *
 * Factory that creates a `create_work_item` custom tool for the Copilot SDK.
 * The model calls this tool when the user asks to create a work item during
 * a chat session. The handler persists the item via FileWorkItemStore and
 * optionally broadcasts a WebSocket event so connected clients update immediately.
 */

import * as crypto from 'crypto';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import { FileWorkItemStore } from '../work-items/work-item-store';
import type { WorkItemPriority, WorkItemStatus } from '../work-items/types';
import { WORK_ITEM_PLAN_TEMPLATE } from '../work-items/plan-template';

// ============================================================================
// Types
// ============================================================================

export interface CreateWorkItemArgs {
    title: string;
    description?: string;
    priority?: 'high' | 'normal' | 'low';
    tags?: string[];
    /** Markdown plan for the work item. Use the standard template sections:
     * ## Objective, ## Background, ## Steps (checkboxes), ## Acceptance Criteria, ## Notes */
    plan?: string;
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
 * Detect when a model puts the plan markdown into `description` and move it to `plan`.
 * This happens when the model ignores the separate `plan` parameter and stuffs the
 * structured plan template into the `description` field.
 */
function normalizePlanFromDescription(args: CreateWorkItemArgs): CreateWorkItemArgs {
    if (args.plan?.trim()) return args; // plan already provided — nothing to do
    const desc = (args.description ?? '').trim();
    if (!desc) return args;
    // Heuristic: if description contains plan-template headings or task checkboxes, treat it as plan
    const looksPlan = /^##\s+(Objective|Steps|Background|Acceptance Criteria|Notes)\b/im.test(desc)
        || /^\s*-\s+\[[ x]\]/im.test(desc);
    if (!looksPlan) return args;
    return { ...args, plan: desc, description: '' };
}

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
            'or save a task for later execution. ' +
            'IMPORTANT: Before calling this tool, you MUST first present a draft summary to the user ' +
            'and only call this tool once the user confirms. ' +
            'Once confirmed, IMMEDIATELY call this tool — do not deliberate or plan further. ' +
            'Always include a `plan` field using the standard template: ' +
            '## Objective, ## Background, ## Steps (with checkboxes), ## Acceptance Criteria, ## Notes. ' +
            `Template:\n${WORK_ITEM_PLAN_TEMPLATE}`,
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
                plan: {
                    type: 'string',
                    description:
                        'Markdown plan following the standard template sections: ' +
                        '## Objective, ## Background, ## Steps (with - [ ] checkboxes), ' +
                        '## Acceptance Criteria, ## Notes.',
                },
            },
            required: ['title', 'plan'],
        },
        handler: async (rawArgs: CreateWorkItemArgs) => {
            const args = normalizePlanFromDescription(rawArgs);
            const now = new Date().toISOString();
            const hasPlan = !!(args.plan && args.plan.trim());
            const status: WorkItemStatus = hasPlan ? 'planning' : 'created';

            const item = {
                id: crypto.randomUUID(),
                repoId,
                title: args.title,
                description: args.description ?? '',
                status,
                createdAt: now,
                updatedAt: now,
                source: 'chat' as const,
                priority: (args.priority ?? 'normal') as WorkItemPriority,
                tags: args.tags,
                ...(hasPlan ? {
                    plan: {
                        version: 1,
                        content: args.plan!.trim(),
                        updatedAt: now,
                        resolvedBy: 'ai' as const,
                    },
                } : {}),
            };

            await store.addWorkItem(item);

            if (hasPlan) {
                await store.savePlanVersion(item.id, {
                    version: 1,
                    content: args.plan!.trim(),
                    createdAt: now,
                    resolvedBy: 'ai',
                    summary: 'Initial plan from chat',
                });
            }

            broadcastFn?.({ type: 'work-item-added', workspaceId: repoId, item });

            return { created: true, id: item.id, title: item.title };
        },
    });

    return { tool };
}
