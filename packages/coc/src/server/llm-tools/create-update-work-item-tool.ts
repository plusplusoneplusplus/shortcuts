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
import type { WorkItem, WorkItemPriority, WorkItemStatus, WorkItemType } from '../work-items/types';
import { WORK_ITEM_TYPES } from '../work-items/types';
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
    /** Work item type for create mode. Defaults to 'work-item'. In update mode this is validation-only. */
    type?: WorkItemType;
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

function isWorkItemType(value: unknown): value is WorkItemType {
    return typeof value === 'string' && (WORK_ITEM_TYPES as readonly string[]).includes(value);
}

function resolveCreateType(args: CreateUpdateWorkItemArgs): { type: WorkItemType } | { error: string } {
    if (args.type === undefined) {
        return { type: 'work-item' };
    }
    if (!isWorkItemType(args.type)) {
        return { error: `Unsupported work item type: ${String(args.type)}` };
    }
    return { type: args.type };
}

function hasOwn(args: CreateUpdateWorkItemArgs, key: keyof CreateUpdateWorkItemArgs): boolean {
    return Object.prototype.hasOwnProperty.call(args, key);
}

function buildCommonFieldPatch(
    args: CreateUpdateWorkItemArgs,
): { patch: Partial<Omit<WorkItem, 'id' | 'repoId' | 'createdAt'>>; hasPatch: boolean } | { error: string } {
    const patch: Partial<Omit<WorkItem, 'id' | 'repoId' | 'createdAt'>> = {};

    if (hasOwn(args, 'title') && args.title !== undefined) {
        const title = args.title.trim();
        if (!title) {
            return { error: 'Field update rejected: title must not be blank' };
        }
        patch.title = title;
    }

    if (hasOwn(args, 'description') && args.description !== undefined) {
        patch.description = args.description;
    }

    if (hasOwn(args, 'priority') && args.priority !== undefined) {
        if (!['high', 'normal', 'low'].includes(args.priority)) {
            return { error: `Unsupported work item priority: ${String(args.priority)}` };
        }
        patch.priority = args.priority;
    }

    if (hasOwn(args, 'tags') && args.tags !== undefined) {
        if (!Array.isArray(args.tags) || args.tags.some(tag => typeof tag !== 'string')) {
            return { error: 'Field update rejected: tags must be an array of strings' };
        }
        patch.tags = args.tags;
    }

    return { patch, hasPatch: Object.keys(patch).length > 0 };
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
            'Create a new typed work item, patch common fields on an existing item, or update an existing plan in this repository. ' +
            'Create mode: omit `workItemId`, `target`, and `workItemNumber`; include a non-blank `title`, optional `type` ' +
            '(`work-item`, `bug`, `goal`, `epic`, `feature`, or `pbi`, default `work-item`), optional `description`, ' +
            '`priority`, `tags`, and a full `plan` when available. Use `type: "bug"` to file bugs. ' +
            'Field-update mode: provide `workItemId`, `target` (UUID or WI-N), or `workItemNumber`, and one or more of ' +
            '`title`, `description`, `priority`, or `tags`; this preserves status and does not create a plan version. ' +
            'Update-plan mode: provide an existing target and the complete revised Markdown plan in `plan`; this saves a new ' +
            'plan version, resets status to `planning`, opens a change record, and broadcasts a dashboard update. ' +
            '`type` cannot be changed in update mode; when supplied it must match the existing item type. ' +
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
                type: {
                    type: 'string',
                    enum: [...WORK_ITEM_TYPES],
                    description: 'Work item type for create mode (default: work-item). In update mode this must match the existing item type.',
                },
                title: {
                    type: 'string',
                    description: 'Short, descriptive title for a new work item, or a replacement title for an existing item.',
                },
                description: {
                    type: 'string',
                    description: 'Markdown description with context and details for a new or existing item.',
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'normal', 'low'],
                    description: 'Priority of a new or existing item (create default: normal).',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags for categorization (e.g. ["backend", "planning"]). Supplying tags in update mode replaces the tag list.',
                },
                plan: {
                    type: 'string',
                    description:
                        'Full Markdown plan following the standard template sections. Optional in create mode and update mode. ' +
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
    const createType = resolveCreateType(args);
    if ('error' in createType) {
        return { created: false, error: createType.error };
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
        type: createType.type,
        createdAt: now,
        updatedAt: now,
        source: 'chat',
        priority: (args.priority ?? 'normal') as WorkItemPriority,
        tags: args.tags,
        ...(hasPlan ? {
            plan: {
                version: 1,
                currentVersion: 1,
                content: args.plan!.trim(),
                updatedAt: now,
                resolvedBy: 'ai' as const,
                source: 'ai' as const,
            },
            currentContentVersion: 1,
        } : {}),
    };

    await store.addWorkItem(item);

    if (hasPlan) {
        await store.savePlanVersion(item.id, {
            version: 1,
            content: args.plan!.trim(),
            createdAt: now,
            resolvedBy: 'ai',
            source: 'ai',
            authorType: 'ai',
            reason: 'Initial plan from chat',
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

    if (args.type !== undefined) {
        if (!isWorkItemType(args.type)) {
            return { updated: false, id: existing.id, error: `Unsupported work item type: ${String(args.type)}` };
        }
        const existingType = existing.type ?? 'work-item';
        if (args.type !== existingType) {
            return {
                updated: false,
                id: existing.id,
                error: `Cannot change work item type from ${existingType} to ${args.type}`,
            };
        }
    }

    const patchResult = buildCommonFieldPatch(args);
    if ('error' in patchResult) {
        return { updated: false, id: existing.id, error: patchResult.error };
    }

    const hasPlanField = hasOwn(args, 'plan');
    const content = args.plan?.trim();
    if (hasPlanField && !content) {
        return {
            updated: false,
            id: existing.id,
            error: 'Invalid plan for update mode: plan must contain the complete revised Markdown plan',
        };
    }

    if (!content && !patchResult.hasPatch) {
        return {
            updated: false,
            id: existing.id,
            error: 'No update requested: provide at least one of title, description, priority, tags, or a complete revised plan',
        };
    }

    if (!content) {
        const updated = await store.updateWorkItem(existing.id, patchResult.patch);
        if (!updated) {
            return { updated: false, error: `Failed to update work item: ${existing.id}` };
        }

        broadcastFn?.({ type: 'work-item-updated', workspaceId: repoId, item: updated });

        return {
            updated: true,
            id: updated.id,
            title: updated.title,
            status: updated.status,
            planVersion: updated.plan?.version,
        };
    }

    const now = new Date().toISOString();
    const nextVersion = (existing.plan?.version ?? 0) + 1;
    const planVersion = {
        version: nextVersion,
        content,
        createdAt: now,
        resolvedBy: 'ai' as const,
        source: 'ai' as const,
        authorType: 'ai' as const,
        reason: args.summary ?? `Plan updated from chat (v${nextVersion})`,
        summary: args.summary ?? `Plan updated from chat (v${nextVersion})`,
    };

    await store.savePlanVersion(existing.id, planVersion);
    const updated = await store.updateWorkItem(existing.id, {
        ...patchResult.patch,
        status: 'planning',
        currentContentVersion: nextVersion,
        plan: {
            version: nextVersion,
            currentVersion: nextVersion,
            content,
            updatedAt: now,
            resolvedBy: 'ai',
            source: 'ai',
            reason: planVersion.reason,
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
