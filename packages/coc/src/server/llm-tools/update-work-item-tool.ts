/**
 * Update Work Item Tool
 *
 * Factory that creates an `update_work_item` custom tool for the Copilot SDK.
 * The model calls this tool when the user asks to update an existing work item
 * during a chat session. The handler patches fields via FileWorkItemStore,
 * creates a new plan version when a plan is provided, always resets status to
 * `planning`, and optionally broadcasts a WebSocket event so connected clients
 * update immediately.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import { FileWorkItemStore } from '../work-items/work-item-store';
import type { WorkItemPriority } from '../work-items/types';
import { WORK_ITEM_PLAN_TEMPLATE } from '../work-items/plan-template';
import type { BroadcastWorkItemFn } from './create-work-item-tool';

// ============================================================================
// Types
// ============================================================================

export interface UpdateWorkItemArgs {
    /** UUID of the work item to update. */
    workItemId: string;
    title?: string;
    description?: string;
    priority?: 'high' | 'normal' | 'low';
    tags?: string[];
    /** Revised markdown plan. If provided, creates a new plan version.
     * Use ## Objective, ## Background, ## Steps (checkboxes), ## Acceptance Criteria, ## Notes */
    plan?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect when a model puts the plan markdown into `description` and move it to `plan`.
 * Mirrors the guard in create-work-item-tool.ts.
 */
function normalizePlanFromDescription(args: UpdateWorkItemArgs): UpdateWorkItemArgs {
    if (args.plan?.trim()) return args;
    const desc = (args.description ?? '').trim();
    if (!desc) return args;
    const looksPlan = /^##\s+(Objective|Steps|Background|Acceptance Criteria|Notes)\b/im.test(desc)
        || /^\s*-\s+\[[ x]\]/im.test(desc);
    if (!looksPlan) return args;
    return { ...args, plan: desc, description: '' };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an `update_work_item` custom tool definition for the Copilot SDK.
 *
 * @param dataDir     - Base data directory (e.g. `~/.coc`).
 * @param repoId      - Workspace / repository ID the item belongs to.
 * @param broadcastFn - Optional function to broadcast a WebSocket event after update.
 */
export function createUpdateWorkItemTool(
    dataDir: string,
    repoId: string,
    broadcastFn?: BroadcastWorkItemFn,
) {
    const store = new FileWorkItemStore({ dataDir });

    const tool = defineTool<UpdateWorkItemArgs>('update_work_item', {
        description:
            'Update an existing work item in the Work Items page for this repository. ' +
            'Patches title, description, priority, and/or tags directly. ' +
            'If a `plan` is provided, it is saved as a new plan version. ' +
            'Status is always reset to `planning` after a successful update. ' +
            'IMPORTANT: Before calling this tool, you MUST first look up the current work item, ' +
            'present a draft summary of the proposed changes to the user, ' +
            'iterate on their feedback, and only call this tool once the user confirms. ' +
            'Only include fields that should change — omit unchanged fields. ' +
            `Plan template:\n${WORK_ITEM_PLAN_TEMPLATE}`,
        parameters: {
            type: 'object',
            properties: {
                workItemId: {
                    type: 'string',
                    description: 'UUID of the work item to update.',
                },
                title: {
                    type: 'string',
                    description: 'New title for the work item (omit to leave unchanged).',
                },
                description: {
                    type: 'string',
                    description: 'New markdown description (omit to leave unchanged).',
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description: 'New priority (omit to leave unchanged).',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Replacement tag list (omit to leave unchanged).',
                },
                plan: {
                    type: 'string',
                    description:
                        'Revised plan content. If provided, creates a new plan version. ' +
                        'Use ## Objective, ## Background, ## Steps (with - [ ] checkboxes), ' +
                        '## Acceptance Criteria, ## Notes.',
                },
            },
            required: ['workItemId'],
        },
        handler: async (rawArgs: UpdateWorkItemArgs) => {
            const args = normalizePlanFromDescription(rawArgs);
            const now = new Date().toISOString();

            const existing = await store.getWorkItem(args.workItemId, repoId);
            if (!existing) {
                return { updated: false, error: `Work item not found: ${args.workItemId}` };
            }

            const hasPlan = !!(args.plan?.trim());
            const currentVersion = existing.plan?.version ?? 0;
            const nextVersion = currentVersion + 1;

            const patch: Parameters<typeof store.updateWorkItem>[1] = {
                status: 'planning',
                ...(args.title !== undefined ? { title: args.title } : {}),
                ...(args.description !== undefined ? { description: args.description } : {}),
                ...(args.priority !== undefined ? { priority: args.priority as WorkItemPriority } : {}),
                ...(args.tags !== undefined ? { tags: args.tags } : {}),
                ...(hasPlan ? {
                    plan: {
                        version: nextVersion,
                        content: args.plan!.trim(),
                        updatedAt: now,
                        resolvedBy: 'ai' as const,
                    },
                } : {}),
            };

            const updated = await store.updateWorkItem(args.workItemId, patch);
            if (!updated) {
                return { updated: false, error: `Failed to update work item: ${args.workItemId}` };
            }

            if (hasPlan) {
                await store.savePlanVersion(args.workItemId, {
                    version: nextVersion,
                    content: args.plan!.trim(),
                    createdAt: now,
                    resolvedBy: 'ai',
                    summary: `Plan updated from chat (v${nextVersion})`,
                });
            }

            // Broadcast a work-item-updated event so connected dashboard clients refresh.
            // Cast needed because BroadcastWorkItemFn is typed for 'work-item-added' events
            // but the runtime WebSocket server accepts 'work-item-updated' as well.
            (broadcastFn as unknown as ((e: { type: string; workspaceId: string; item: unknown }) => void))
                ?.({ type: 'work-item-updated', workspaceId: repoId, item: updated });

            return {
                updated: true,
                id: updated.id,
                title: updated.title,
                status: updated.status,
                planVersion: updated.plan?.version,
            };
        },
    });

    return { tool };
}
