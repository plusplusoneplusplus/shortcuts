/**
 * Create/Update Work Item Tool
 *
 * Factory that creates a `create_update_work_item` custom tool for the Copilot SDK.
 * The model calls this tool to either create a new chat-sourced work item or save
 * a complete revised plan as the next version for an existing work item.
 */

import * as crypto from 'crypto';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import { FileWorkItemStore } from '../work-items/work-item-store';
import type { WorkItem, WorkItemPriority, WorkItemStatus } from '../work-items/types';
import { WORK_ITEM_PLAN_TEMPLATE } from '../work-items/plan-template';

// ============================================================================
// Types
// ============================================================================

export interface CreateUpdateWorkItemArgs {
    /** Existing work item UUID, or a chat-friendly WI-N target. Omit for create mode. */
    workItemId?: string;
    /** Existing work item UUID, WI-N, or number. Omit for create mode. */
    target?: string;
    /** Existing sequential work item number. Omit for create mode. */
    workItemNumber?: number | string;
    title?: string;
    description?: string;
    priority?: 'high' | 'normal' | 'low';
    tags?: string[];
    /** Complete markdown plan. Required when updating an existing work item. */
    plan?: string;
    /** Optional plan version summary for update mode. */
    summary?: string;
}

export type BroadcastWorkItemFn = (event: {
    type: 'work-item-added' | 'work-item-updated';
    workspaceId: string;
    item: unknown;
}) => void;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect when a model puts the plan markdown into `description` and move it to `plan`.
 * This happens when the model ignores the separate `plan` parameter and stuffs the
 * structured plan template into the `description` field.
 */
function normalizePlanFromDescription(args: CreateUpdateWorkItemArgs): CreateUpdateWorkItemArgs {
    if (args.plan?.trim()) return args;
    const desc = (args.description ?? '').trim();
    if (!desc) return args;
    const looksPlan = /^##\s+(Objective|Steps|Background|Acceptance Criteria|Notes)\b/im.test(desc)
        || /^\s*-\s+\[[ x]\]/im.test(desc);
    if (!looksPlan) return args;
    return { ...args, plan: desc, description: '' };
}

function parseWorkItemNumber(value: string | number | undefined): number | undefined {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value > 0 ? value : undefined;
    }
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    const match = trimmed.match(/^(?:WI-)?(\d+)$/i);
    if (!match) return undefined;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getExistingTarget(args: CreateUpdateWorkItemArgs): string | number | undefined {
    return args.workItemId?.trim()
        || args.target?.trim()
        || args.workItemNumber;
}

async function resolveExistingWorkItem(
    store: FileWorkItemStore,
    repoId: string,
    args: CreateUpdateWorkItemArgs,
): Promise<WorkItem | undefined> {
    const target = getExistingTarget(args);
    if (target === undefined || target === '') {
        return undefined;
    }

    const targetText = String(target).trim();
    const targetNumber = args.workItemNumber !== undefined
        ? parseWorkItemNumber(args.workItemNumber)
        : parseWorkItemNumber(targetText);

    if (targetNumber !== undefined) {
        const { items } = await store.listWorkItems({ repoId });
        const match = items.find(item => item.workItemNumber === targetNumber);
        return match ? store.getWorkItem(match.id, repoId) : undefined;
    }

    return store.getWorkItem(targetText, repoId);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a `create_update_work_item` custom tool definition for the Copilot SDK.
 *
 * @param dataDir     - Base data directory (e.g. `~/.coc`).
 * @param repoId      - Workspace / repository ID the item belongs to.
 * @param broadcastFn - Optional function to broadcast a WebSocket event after creation/update.
 */
export function createCreateUpdateWorkItemTool(
    dataDir: string,
    repoId: string,
    broadcastFn?: BroadcastWorkItemFn,
) {
    const store = new FileWorkItemStore({ dataDir });

    const tool = defineTool<CreateUpdateWorkItemArgs>('create_update_work_item', {
        description:
            'Create a new work item or update the plan for an existing work item in this repository. ' +
            'Create mode: omit `workItemId`, `target`, and `workItemNumber`; include `title`, optional ' +
            '`description`, `priority`, `tags`, and a full `plan` when available. ' +
            'Update-plan mode: provide `workItemId`, `target` (UUID or WI-N), or `workItemNumber`, and ' +
            'provide the complete revised Markdown plan in `plan`. Update mode saves a new plan version, ' +
            'resets status to `planning`, opens a change record, and broadcasts a dashboard update. ' +
            'Do not append raw text or submit a partial diff for `plan`; always send the full revised plan. ' +
            'IMPORTANT: Before calling this tool, you MUST first present a draft summary to the user ' +
            'and only call this tool once the user confirms. ' +
            'Once confirmed, IMMEDIATELY call this tool — do not deliberate or plan further. ' +
            `Plan template:\n${WORK_ITEM_PLAN_TEMPLATE}`,
        parameters: {
            type: 'object',
            properties: {
                workItemId: {
                    type: 'string',
                    description: 'Existing work item UUID, or WI-N. Omit for create mode.',
                },
                target: {
                    type: 'string',
                    description: 'Existing work item UUID or WI-N target. Omit for create mode.',
                },
                workItemNumber: {
                    oneOf: [{ type: 'number' }, { type: 'string' }],
                    description: 'Existing sequential work item number, e.g. 12 or "WI-12". Omit for create mode.',
                },
                title: {
                    type: 'string',
                    description: 'Short, descriptive title for a new work item.',
                },
                description: {
                    type: 'string',
                    description: 'Markdown description with context and details for a new work item.',
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description: 'Priority of a new work item (default: normal).',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional tags for categorization (e.g. ["backend", "planning"]).',
                },
                plan: {
                    type: 'string',
                    description:
                        'Full Markdown plan following the standard template sections. Required in update-plan mode. ' +
                        'Use ## Objective, ## Background, ## Steps (with - [ ] checkboxes), ' +
                        '## Acceptance Criteria, ## Notes.',
                },
                summary: {
                    type: 'string',
                    description: 'Optional summary for the new plan version in update-plan mode.',
                },
            },
            required: [],
        },
        handler: async (rawArgs: CreateUpdateWorkItemArgs) => {
            const args = normalizePlanFromDescription(rawArgs);
            const existingTarget = getExistingTarget(args);
            if (existingTarget !== undefined && String(existingTarget).trim() !== '') {
                return updateExistingWorkItemPlan(store, repoId, args, broadcastFn);
            }
            return createNewWorkItem(store, repoId, args, broadcastFn);
        },
    });

    return { tool };
}

async function createNewWorkItem(
    store: FileWorkItemStore,
    repoId: string,
    args: CreateUpdateWorkItemArgs,
    broadcastFn?: BroadcastWorkItemFn,
) {
    const title = args.title?.trim();
    if (!title) {
        return { created: false, error: 'Missing required field for create mode: title' };
    }

    const now = new Date().toISOString();
    const hasPlan = !!(args.plan && args.plan.trim());
    const status: WorkItemStatus = hasPlan ? 'planning' : 'created';

    const item: WorkItem = {
        id: crypto.randomUUID(),
        repoId,
        title,
        description: args.description ?? '',
        status,
        createdAt: now,
        updatedAt: now,
        source: 'chat',
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
}

async function updateExistingWorkItemPlan(
    store: FileWorkItemStore,
    repoId: string,
    args: CreateUpdateWorkItemArgs,
    broadcastFn?: BroadcastWorkItemFn,
) {
    const existing = await resolveExistingWorkItem(store, repoId, args);
    const target = getExistingTarget(args);
    if (!existing) {
        return { updated: false, error: `Work item not found: ${String(target)}` };
    }

    const content = args.plan?.trim();
    if (!content) {
        return {
            updated: false,
            id: existing.id,
            error: 'Missing required field for update-plan mode: plan must contain the complete revised Markdown plan',
        };
    }

    const now = new Date().toISOString();
    const nextVersion = (existing.plan?.version ?? 0) + 1;
    const planVersion = {
        version: nextVersion,
        content,
        createdAt: now,
        resolvedBy: 'ai' as const,
        summary: args.summary ?? `Plan updated from chat (v${nextVersion})`,
    };

    await store.savePlanVersion(existing.id, planVersion);
    const updated = await store.updateWorkItem(existing.id, {
        status: 'planning',
        plan: {
            version: nextVersion,
            content,
            updatedAt: now,
            resolvedBy: 'ai',
        },
    });
    if (!updated) {
        return { updated: false, error: `Failed to update work item: ${existing.id}` };
    }

    await store.addChange(existing.id, {
        id: crypto.randomUUID(),
        planVersion: nextVersion,
        commits: [],
        startedAt: now,
        status: 'open',
    });

    broadcastFn?.({ type: 'work-item-updated', workspaceId: repoId, item: updated });

    return {
        updated: true,
        id: updated.id,
        title: updated.title,
        status: updated.status,
        planVersion: updated.plan?.version,
    };
}
