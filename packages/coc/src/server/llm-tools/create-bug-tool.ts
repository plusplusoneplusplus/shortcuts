/**
 * Create Bug Tool
 *
 * Factory that creates a `create_bug` custom tool for the Copilot SDK.
 * The model calls this tool when the user asks to file a bug during
 * a chat session. The handler persists the item as a work item with
 * type 'bug' via FileWorkItemStore and optionally broadcasts a
 * WebSocket event so connected clients update immediately.
 */

import * as crypto from 'crypto';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import { FileWorkItemStore } from '../work-items/work-item-store';
import type { WorkItemPriority, WorkItemStatus } from '../work-items/types';
import { WORK_ITEM_PLAN_TEMPLATE } from '../work-items/plan-template';

// ============================================================================
// Types
// ============================================================================

export interface CreateBugArgs {
    title: string;
    description?: string;
    priority?: 'high' | 'normal' | 'low';
    tags?: string[];
    /** Markdown plan for the bug fix. Use the standard template sections:
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
 */
function normalizePlanFromDescription(args: CreateBugArgs): CreateBugArgs {
    if (args.plan?.trim()) return args;
    const desc = (args.description ?? '').trim();
    if (!desc) return args;
    const looksPlan = /^##\s+(Objective|Steps|Background|Acceptance Criteria|Notes)\b/im.test(desc)
        || /^\s*-\s+\[[ x]\]/im.test(desc);
    if (!looksPlan) return args;
    return { ...args, plan: desc, description: '' };
}

/**
 * Create a `create_bug` custom tool definition for the Copilot SDK.
 *
 * @param dataDir     - Base data directory (e.g. `~/.coc`).
 * @param repoId      - Workspace / repository ID the bug belongs to.
 * @param broadcastFn - Optional function to broadcast a WebSocket event after creation.
 */
export function createBugTool(
    dataDir: string,
    repoId: string,
    broadcastFn?: BroadcastWorkItemFn,
) {
    const store = new FileWorkItemStore({ dataDir });

    const tool = defineTool<CreateBugArgs>('create_bug', {
        description:
            'Create a new bug report in the Work Items page for this repository. ' +
            'Use this when the user asks to file a bug, report a defect, or log an issue. ' +
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
                    description: 'Short, descriptive title for the bug.',
                },
                description: {
                    type: 'string',
                    description: 'Markdown description with reproduction steps and context.',
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description: 'Priority of the bug (default: normal).',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional tags for categorization (e.g. ["regression", "ui"]).',
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
        handler: async (rawArgs: CreateBugArgs) => {
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
                type: 'bug' as const,
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
