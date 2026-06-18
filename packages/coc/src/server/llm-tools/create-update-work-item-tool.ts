/**
 * Create/Update Work Item Tool
 *
 * Factory that creates a `create_update_work_item` custom tool for the Copilot SDK.
 * The model calls this tool to create a new chat-sourced work item (optionally as a
 * child in the hierarchy), patch common fields, save a complete revised plan as the
 * next version, or move/unlink an existing work item in the Epic → Feature → PBI →
 * Work Item/Bug/Goal hierarchy.
 *
 * Hierarchy-sensitive operations (create-with-parent, reparent, unlink) and all
 * creates run through the shared work-item command service so the tool reuses the
 * same validation, remote-provider sync, cache invalidation, and dashboard
 * broadcast behavior as the Work Items REST routes.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { resolveConfig, CONFIG_FILE_NAME } from '../../config';
import { APIError } from '../errors';
import { FileWorkItemStore } from '../work-items/work-item-store';
import type { WorkItem, WorkItemPriority, WorkItemStatus, WorkItemStore, WorkItemType } from '../work-items/types';
import { WORK_ITEM_TYPES } from '../work-items/types';
import { WORK_ITEM_PLAN_TEMPLATE } from '../work-items/plan-template';
import {
    createWorkItemCommand,
    updateWorkItemCommand,
    type UpdateWorkItemCommandInput,
    type WorkItemCommandContext,
} from '../work-items/work-item-commands';
import type { GitHubWorkItemIssueTransport } from '../work-items/work-item-sync-github-provider';
import type { AzureBoardsWorkItemTransport } from '../work-items/work-item-sync-azure-boards-provider';
import type { WorkItemSyncProviderAdapter } from '../work-items/work-item-sync-provider';

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
    /** Parent work item UUID for hierarchy linking. On update, `null` (or '') unlinks the item. */
    parentId?: string | null;
    /** Parent work item UUID or WI-N target. An empty string unlinks on update. */
    parentTarget?: string;
    /** Parent sequential work item number, e.g. 12 or "WI-12". */
    parentWorkItemNumber?: number | string;
}

export type BroadcastWorkItemFn = (event: {
    type: 'work-item-added' | 'work-item-updated';
    workspaceId: string;
    item: unknown;
}) => void;

/**
 * Optional server-side dependencies. When omitted, the tool falls back to a
 * dataDir-backed store and reads feature flags from `<dataDir>/config.yaml`.
 */
export interface CreateUpdateWorkItemToolDeps {
    workItemStore?: WorkItemStore;
    /** Required for provider-backed (GitHub/Azure Boards) hierarchy operations. */
    processStore?: ProcessStore;
    getHierarchyEnabled?: () => boolean;
    getSyncEnabled?: () => boolean;
    githubTransport?: GitHubWorkItemIssueTransport;
    azureBoardsTransport?: AzureBoardsWorkItemTransport;
    azureBoardsProvider?: WorkItemSyncProviderAdapter;
}

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
    store: WorkItemStore,
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
// Parent (hierarchy link) helpers
// ============================================================================

/** How the model asked the hierarchy link to change. */
type ParentSpec =
    | { kind: 'none' }
    | { kind: 'unlink' }
    | { kind: 'ref'; value: string };

function hasParentField(args: CreateUpdateWorkItemArgs): boolean {
    return hasOwn(args, 'parentId') || hasOwn(args, 'parentTarget') || hasOwn(args, 'parentWorkItemNumber');
}

function getParentSpec(args: CreateUpdateWorkItemArgs): ParentSpec | { error: string } {
    if (!hasParentField(args)) {
        return { kind: 'none' };
    }
    if (hasOwn(args, 'parentId')) {
        if (args.parentId === null) return { kind: 'unlink' };
        if (typeof args.parentId !== 'string') {
            return { error: 'Invalid parentId: must be a parent work item UUID string, or null to unlink' };
        }
        const trimmed = args.parentId.trim();
        return trimmed ? { kind: 'ref', value: trimmed } : { kind: 'unlink' };
    }
    if (hasOwn(args, 'parentTarget')) {
        if (args.parentTarget === null) return { kind: 'unlink' };
        if (typeof args.parentTarget !== 'string') {
            return { error: 'Invalid parentTarget: must be a parent work item UUID or WI-N string' };
        }
        const trimmed = args.parentTarget.trim();
        return trimmed ? { kind: 'ref', value: trimmed } : { kind: 'unlink' };
    }
    if (args.parentWorkItemNumber === null) return { kind: 'unlink' };
    const parsed = parseWorkItemNumber(args.parentWorkItemNumber);
    if (parsed === undefined) {
        return { error: `Invalid parentWorkItemNumber: ${String(args.parentWorkItemNumber)}` };
    }
    return { kind: 'ref', value: String(parsed) };
}

/**
 * Resolve a parent reference (UUID, WI-N, or sequential number) to a work item
 * in the current workspace.
 */
async function resolveParentWorkItem(
    store: WorkItemStore,
    repoId: string,
    ref: string,
): Promise<{ item: WorkItem } | { error: string }> {
    const parentNumber = parseWorkItemNumber(ref);
    if (parentNumber !== undefined) {
        const { items } = await store.listWorkItems({ repoId });
        const match = items.find(item => item.workItemNumber === parentNumber);
        const item = match ? await store.getWorkItem(match.id, repoId) : undefined;
        return item ? { item } : { error: `Parent work item not found: ${ref}` };
    }
    const item = await store.getWorkItem(ref, repoId);
    return item ? { item } : { error: `Parent work item not found: ${ref}` };
}

function commandErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
 * @param deps        - Optional server-side dependencies (store, process store, feature flags, transports).
 */
export function createCreateUpdateWorkItemTool(
    dataDir: string,
    repoId: string,
    broadcastFn?: BroadcastWorkItemFn,
    deps?: CreateUpdateWorkItemToolDeps,
) {
    const store: WorkItemStore = deps?.workItemStore ?? new FileWorkItemStore({ dataDir });
    const configPath = path.join(dataDir, CONFIG_FILE_NAME);
    const commandCtx: WorkItemCommandContext = {
        workItemStore: store,
        processStore: deps?.processStore,
        dataDir,
        getHierarchyEnabled: deps?.getHierarchyEnabled
            ?? (() => resolveConfig(configPath).workItems.hierarchy.enabled),
        getSyncEnabled: deps?.getSyncEnabled
            ?? (() => resolveConfig(configPath).workItems.sync.enabled),
        githubTransport: deps?.githubTransport,
        azureBoardsTransport: deps?.azureBoardsTransport,
        azureBoardsProvider: deps?.azureBoardsProvider,
        broadcast: broadcastFn,
    };

    const tool = defineTool<CreateUpdateWorkItemArgs>('create_update_work_item', {
        description:
            'Create a new typed work item, patch common fields on an existing item, update an existing plan, or ' +
            'link/move/unlink an item in the work-item hierarchy in this repository. ' +
            'Create mode: omit `workItemId`, `target`, and `workItemNumber`; include a non-blank `title`, optional `type` ' +
            '(`work-item`, `bug`, `goal`, `epic`, `feature`, or `pbi`, default `work-item`), optional `description`, ' +
            '`priority`, `tags`, and a full `plan` when available. Use `type: "bug"` to file bugs. ' +
            'To create the item as a child of an existing parent (Epic → Feature → PBI → Work Item/Bug/Goal), also pass ' +
            '`parentId` (UUID), `parentTarget` (UUID or WI-N), or `parentWorkItemNumber`; no REST call is needed. ' +
            'Field-update mode: provide `workItemId`, `target` (UUID or WI-N), or `workItemNumber`, and one or more of ' +
            '`title`, `description`, `priority`, or `tags`; this preserves status and does not create a plan version. ' +
            'Update-plan mode: provide an existing target and the complete revised Markdown plan in `plan`; this saves a new ' +
            'plan version, resets status to `planning`, opens a change record, and broadcasts a dashboard update. ' +
            'Hierarchy-link mode: provide an existing target plus `parentId`/`parentTarget`/`parentWorkItemNumber` to move ' +
            'the item under a new valid parent, or `parentId: null` to unlink it from its current parent. Link updates can ' +
            'be combined with field or plan updates and are validated against the allowed parent/child type hierarchy. ' +
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
                parentId: {
                    oneOf: [{ type: 'string' }, { type: 'null' }],
                    description:
                        'Parent work item UUID for hierarchy linking. On create, places the new item under this parent. ' +
                        'On update, moves the item under this parent; pass null to unlink the item from its current parent. ' +
                        'Omit when not changing the parent.',
                },
                parentTarget: {
                    type: 'string',
                    description: 'Parent work item UUID or WI-N target (e.g. "WI-12"). Alternative to parentId when only a chat-friendly target is known.',
                },
                parentWorkItemNumber: {
                    oneOf: [{ type: 'number' }, { type: 'string' }],
                    description: 'Parent sequential work item number, e.g. 12 or "WI-12". Alternative to parentId.',
                },
            },
            required: [],
        },
        handler: async (rawArgs: CreateUpdateWorkItemArgs) => {
            const args = normalizePlanFromDescription(rawArgs);
            const existingTarget = getExistingTarget(args);
            if (existingTarget !== undefined && String(existingTarget).trim() !== '') {
                return updateExistingWorkItem(commandCtx, repoId, args);
            }
            return createNewWorkItem(commandCtx, repoId, args);
        },
    });

    return { tool };
}

async function createNewWorkItem(
    ctx: WorkItemCommandContext,
    repoId: string,
    args: CreateUpdateWorkItemArgs,
) {
    const title = args.title?.trim();
    if (!title) {
        return { created: false, error: 'Missing required field for create mode: title' };
    }
    const createType = resolveCreateType(args);
    if ('error' in createType) {
        return { created: false, error: createType.error };
    }

    // Resolve the optional parent reference; `null`/'' parent specs are meaningless
    // on create (there is nothing to unlink yet) and are treated as "no parent".
    const parentSpec = getParentSpec(args);
    if ('error' in parentSpec) {
        return { created: false, error: parentSpec.error };
    }
    let parent: WorkItem | undefined;
    if (parentSpec.kind === 'ref') {
        const resolved = await resolveParentWorkItem(ctx.workItemStore, repoId, parentSpec.value);
        if ('error' in resolved) {
            return { created: false, error: resolved.error };
        }
        parent = resolved.item;
    }

    const hasPlan = !!(args.plan && args.plan.trim());
    const status: WorkItemStatus = hasPlan ? 'planning' : 'created';

    try {
        const item = await createWorkItemCommand(ctx, repoId, {
            title,
            description: args.description ?? '',
            type: createType.type,
            parentId: parent?.id,
            source: 'chat',
            priority: (args.priority ?? 'normal') as WorkItemPriority,
            tags: args.tags,
            status,
            ...(hasPlan ? {
                plan: {
                    content: args.plan!.trim(),
                    resolvedBy: 'ai' as const,
                    recordInitialVersion: true,
                    reason: 'Initial plan from chat',
                    summary: 'Initial plan from chat',
                },
            } : {}),
        });

        return {
            created: true,
            id: item.id,
            title: item.title,
            ...(parent ? {
                parentId: parent.id,
                parentTitle: parent.title,
                parentWorkItemNumber: parent.workItemNumber,
            } : {}),
        };
    } catch (error) {
        if (error instanceof APIError) {
            return { created: false, error: error.message };
        }
        throw error;
    }
}

async function updateExistingWorkItem(
    ctx: WorkItemCommandContext,
    repoId: string,
    args: CreateUpdateWorkItemArgs,
) {
    const store = ctx.workItemStore;
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

    const parentSpec = getParentSpec(args);
    if ('error' in parentSpec) {
        return { updated: false, id: existing.id, error: parentSpec.error };
    }

    if (parentSpec.kind !== 'none') {
        return updateWorkItemLink(ctx, repoId, args, existing, patchResult.patch, parentSpec, content);
    }

    if (!content && !patchResult.hasPatch) {
        return {
            updated: false,
            id: existing.id,
            error: 'No update requested: provide at least one of title, description, priority, tags, '
                + 'a parent link change, or a complete revised plan',
        };
    }

    if (!content) {
        const updated = await store.updateWorkItem(existing.id, patchResult.patch, repoId);
        if (!updated) {
            return { updated: false, error: `Failed to update work item: ${existing.id}` };
        }

        ctx.broadcast?.({ type: 'work-item-updated', workspaceId: repoId, item: updated });

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

    await store.savePlanVersion(existing.id, planVersion, repoId);
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
    }, repoId);
    if (!updated) {
        return { updated: false, error: `Failed to update work item: ${existing.id}` };
    }

    await store.addChange(existing.id, {
        id: crypto.randomUUID(),
        planVersion: nextVersion,
        commits: [],
        startedAt: now,
        status: 'open',
    }, repoId);

    ctx.broadcast?.({ type: 'work-item-updated', workspaceId: repoId, item: updated });

    return {
        updated: true,
        id: updated.id,
        title: updated.title,
        status: updated.status,
        planVersion: updated.plan?.version,
    };
}

/**
 * Apply a hierarchy link change (reparent or unlink), optionally combined with
 * field and plan updates, through the shared work-item command service. The
 * service performs one coherent update with a single dashboard broadcast and
 * reuses REST-route validation, provider sync, and cache invalidation.
 */
async function updateWorkItemLink(
    ctx: WorkItemCommandContext,
    repoId: string,
    args: CreateUpdateWorkItemArgs,
    existing: WorkItem,
    patch: Partial<Omit<WorkItem, 'id' | 'repoId' | 'createdAt'>>,
    parentSpec: Exclude<ParentSpec, { kind: 'none' }>,
    planContent: string | undefined,
) {
    let parent: WorkItem | undefined;
    if (parentSpec.kind === 'ref') {
        const resolved = await resolveParentWorkItem(ctx.workItemStore, repoId, parentSpec.value);
        if ('error' in resolved) {
            return { updated: false, id: existing.id, error: resolved.error };
        }
        parent = resolved.item;
    }

    const input: UpdateWorkItemCommandInput = {
        ...patch,
        parentId: parent?.id ?? null,
    };
    if (planContent) {
        const nextVersion = (existing.plan?.version ?? 0) + 1;
        const summary = args.summary ?? `Plan updated from chat (v${nextVersion})`;
        input.plan = {
            content: planContent,
            resolvedBy: 'ai',
            reason: summary,
            summary,
        };
        // The tool always resets to planning on plan updates regardless of the
        // current lifecycle state (legacy tool behavior).
        input.status = 'planning';
        input.skipStatusTransitionValidation = true;
    }

    try {
        const updated = await updateWorkItemCommand(ctx, repoId, existing.id, input);
        return {
            updated: true,
            id: updated.id,
            title: updated.title,
            status: updated.status,
            planVersion: updated.plan?.version,
            parentId: updated.parentId ?? null,
            ...(parent ? {
                parentTitle: parent.title,
                parentWorkItemNumber: parent.workItemNumber,
            } : {}),
        };
    } catch (error) {
        if (error instanceof APIError) {
            return { updated: false, id: existing.id, error: error.message };
        }
        throw error;
    }
}
