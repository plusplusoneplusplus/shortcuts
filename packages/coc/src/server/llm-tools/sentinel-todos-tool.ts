/**
 * Factory for the `sentinel_todos` tool: a Sentinel chat's bookkeeping view of
 * its own to-do ledger. Writes go through the same {@link SentinelTodoService}
 * REST uses, bound to the invoking chat — the model never names an owner, so
 * it cannot reach another chat's ledger. Nothing here starts, retries, or
 * cancels a job, and archiving stays a user action.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import {
    SentinelTodoError,
    type SentinelTodoItem,
    type SentinelTodoOwner,
    type SentinelTodoPatch,
    type SentinelTodoPriority,
    type SentinelTodoStatus,
    type SentinelTodoType,
} from '../sentinel-todos/sentinel-todo-store';
import type { SentinelTodoItemView, SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import type { SendToConversationTodoTracking } from './send-to-conversation-tool';

export const SENTINEL_TODOS_TOOL_NAME = 'sentinel_todos';

export const MANUAL_TRACKING_GUIDANCE =
    'Manual items (`type: manual`) are tracking only: never execute or delegate them, link jobs, or automatically ' +
    'review job results for them. Requests to execute a manual item require clarification from the user before any ' +
    'execution. Never bypass this by creating a normal-item copy; conversion and handoff are not supported. ' +
    'You may create/edit manual items and change their status; Done requires an explained reason based on available ' +
    'evidence against Done when (`completionCondition`), or the title/notes when Done when is omitted. ' +
    'Archive/restore remain user-only.';

export interface SentinelTodosToolDeps {
    service: Pick<SentinelTodoService, 'list' | 'create' | 'update' | 'linkJob'>;
    /** The invoking Sentinel chat; every call is scoped to this ledger. */
    owner: SentinelTodoOwner;
}

interface TargetRepoArg { workspaceId: string; serverId?: string; label?: string }

export interface SentinelTodosArgs {
    action: 'list' | 'create' | 'update';
    type?: SentinelTodoType;
    includeArchived?: boolean;
    itemId?: string;
    expectedRevision?: number;
    title?: string;
    completionCondition?: string;
    notes?: string;
    targetRepo?: TargetRepoArg;
    status?: SentinelTodoStatus;
    priority?: SentinelTodoPriority;
    reason?: string;
    outcome?: string;
    reviewedJobs?: { processId: string; terminalEventId: string }[];
    idempotencyKey?: string;
}

export type SentinelTodosResult =
    | { items: SentinelTodoItemView[]; ledgerRevision: number; archivedCount: number }
    | { item: SentinelTodoItem; created?: boolean }
    | { error: string; code?: string; current?: SentinelTodoItem };

/** Statuses Sentinel may only set with a short reviewed reason. */
const REASON_REQUIRED: ReadonlySet<SentinelTodoStatus> = new Set(['done', 'needs_attention']);

const DESCRIPTION =
    'Read and maintain this Sentinel chat\'s to-do ledger (bookkeeping only — it never starts, retries, or ' +
    'cancels jobs). `list` returns active items (add `includeArchived: true` for archived ones). `create` needs ' +
    '`title`; normal items also need a brief `completionCondition` covering the intended feature/outcome\'s final deliverable, not just ' +
    'the next phase (an explicitly design-only/interview-only request may end at its agreed artifact). Reuse the same ' +
    'item across grilling, implementation, and review; preserve phase milestones and spec/artifact links in `notes`. ' +
    'Pass a stable `idempotencyKey` so a retried call cannot duplicate the item. ' +
    '`priority` (`high` or default `regular`) is ledger metadata only, independent of status and job order. ' +
    '`update` needs `itemId` and the item\'s current `revision` as `expectedRevision`; a `conflict` ' +
    'error returns the newer `current` item — re-read it and only reapply your change if it still makes sense. ' +
    'Setting `status` to `done` or `needs_attention` requires a short `reason`; `done` records that reason as the ' +
    'reviewed outcome unless you pass `outcome`. Only mark `done` after checking evidence against the completion ' +
    'condition. Choose status from the overall outcome, not linked job completion: successful intermediate phases are ' +
    'neither `done` nor failures. Use `todo` for pending next steps/approval, `in_progress` for continuing authorized ' +
    'work, and `needs_attention` for failed, cancelled, blocked, or incomplete final work. After successful grilling, ' +
    'leave/return the feature item to `todo` with reason "Spec ready; awaiting implementation approval"; do not launch ' +
    'implementation without user authorization. Re-read before review updates and honor manual user verdicts and latest instructions. ' +
    'Linked `jobs` show each job\'s `execution` separately: a completed job is evidence to review, not a ' +
    'verdict. After assessing a local result, pass `reviewedJobs: [{processId, terminalEventId}]` from its ' +
    '`execution.review` together with the overall `status` and a short `reason`. Delivery alone never acknowledges ' +
    'assessment; acknowledge only the results you actually judged, not running follow-ups. Unrelated edits do not ' +
    'clear pending reviews. A newer user verdict supersedes stale job reviews; preserve it. ' +
    'For remote evidence, inspect `unavailable` (remote) jobs in their owning chat and record the reviewed state explicitly. ' +
    MANUAL_TRACKING_GUIDANCE + ' Create manual items with `type: manual`; Notes and Done when are optional. ' +
    'Item type is immutable; existing items remain normal. If a call fails, tell the user the item is not tracked.';

/**
 * Binds `send_to_conversation` create mode to the invoking Sentinel's ledger:
 * every new handoff names an existing, unarchived item before launch, and the
 * admitted job is linked afterwards. Link failures are reported, never retried.
 */
export function createSentinelTodoTracking(deps: SentinelTodosToolDeps): SendToConversationTodoTracking {
    const { service, owner } = deps;
    return {
        async check(itemId) {
            if (!itemId) {
                return 'This Sentinel chat tracks every handoff: pass `todoItemId` of the to-do item this work serves '
                    + '(create a concrete item with `sentinel_todos` first). Nothing was launched.';
            }
            try {
                const item = (await service.list(owner)).items.find(candidate => candidate.id === itemId);
                if (!item) return `To-do item ${itemId} not found in this chat's ledger. Nothing was launched.`;
                if (item.type === 'manual') return `${MANUAL_TRACKING_GUIDANCE} Nothing was launched.`;
                if (item.archived) return `To-do item ${itemId} is archived; ask the user to restore it first. Nothing was launched.`;
                return undefined;
            } catch (err) {
                return `Could not read the to-do ledger (${err instanceof Error ? err.message : String(err)}). Nothing was launched.`;
            }
        },
        async link(itemId, job) {
            try {
                const { item } = await service.linkJob(owner, itemId, {
                    processId: job.processId,
                    workspaceId: job.workspaceId,
                    kind: job.kind,
                    openLink: job.openLink,
                    ...(job.serverId ? { serverId: job.serverId } : {}),
                    ...(job.sessionId ? { sessionId: job.sessionId } : {}),
                    ...(job.title ? { title: job.title } : {}),
                });
                return { status: 'tracked', itemId: item.id, revision: item.revision };
            } catch (err) {
                return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
            }
        },
    };
}

export function createSentinelTodosTool(deps: SentinelTodosToolDeps) {
    const { service, owner } = deps;
    const tool = defineTool<SentinelTodosArgs>(SENTINEL_TODOS_TOOL_NAME, {
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'create', 'update'] },
                type: { type: 'string', enum: ['normal', 'manual'], description: 'create only: immutable item type (default normal); manual items never authorize execution.' },
                includeArchived: { type: 'boolean', description: 'list: include archived items.' },
                itemId: { type: 'string', description: 'update: the item to change.' },
                expectedRevision: { type: 'number', description: 'update: the item revision you last read.' },
                title: { type: 'string', description: 'create/update: short item title.' },
                completionCondition: {
                    type: 'string',
                    description: 'create/update: Done when; optional for manual items. Intended outcome\'s final deliverable, checked before marking done; not just an intermediate phase.',
                },
                notes: { type: 'string', description: 'create/update: phase milestones and spec/artifact links; replaces existing notes, so preserve prior notes.' },
                targetRepo: {
                    type: 'object',
                    description: 'create/update: the repo the work runs in.',
                    properties: {
                        workspaceId: { type: 'string' },
                        serverId: { type: 'string', description: 'Remote server ID for remote repos.' },
                        label: { type: 'string', description: 'Human-readable repo name.' },
                    },
                    required: ['workspaceId'],
                },
                status: { type: 'string', enum: ['todo', 'in_progress', 'needs_attention', 'done'] },
                priority: {
                    type: 'string',
                    enum: ['high', 'regular'],
                    description: 'create/update: ledger priority (default regular); independent of status.',
                },
                reason: { type: 'string', description: 'Required with status `done` or `needs_attention`.' },
                outcome: { type: 'string', description: 'update: the reviewed outcome to record.' },
                reviewedJobs: {
                    type: 'array',
                    description: 'update: exact local terminal evidence assessed; requires status and reason. Never acknowledge unrelated/running jobs.',
                    items: {
                        type: 'object',
                        properties: { processId: { type: 'string' }, terminalEventId: { type: 'string' } },
                        required: ['processId', 'terminalEventId'],
                    },
                },
                idempotencyKey: { type: 'string', description: 'create: stable key that makes retries safe.' },
            },
            required: ['action'],
        },
        handler: async (args: SentinelTodosArgs): Promise<SentinelTodosResult> => {
            try {
                if (args && 'archived' in args) {
                    return { error: 'Archive/restore remain user-only.', code: 'invalid' };
                }
                if (args?.action === 'update' && args.type !== undefined) {
                    return { error: 'Item type is immutable; conversion and handoff are not supported.', code: 'invalid' };
                }
                switch (args?.action) {
                    case 'list': {
                        const ledger = await service.list(owner);
                        const items = args.includeArchived ? ledger.items : ledger.items.filter(item => !item.archived);
                        return {
                            items,
                            ledgerRevision: ledger.revision,
                            archivedCount: ledger.items.filter(item => item.archived).length,
                        };
                    }
                    case 'create': {
                        if (args.type !== 'manual' && !args.completionCondition?.trim()) {
                            return { error: 'create requires a brief completionCondition.', code: 'invalid' };
                        }
                        const status = args.status ?? 'todo';
                        const reason = args.reason?.trim();
                        if (REASON_REQUIRED.has(status) && !reason) {
                            return { error: `status ${status} requires a short reason.`, code: 'invalid' };
                        }
                        const { item, created } = await service.create(owner, {
                            ...(args.type !== undefined ? { type: args.type } : {}),
                            title: args.title ?? '',
                            ...(args.completionCondition !== undefined ? { completionCondition: args.completionCondition.trim() } : {}),
                            ...(args.notes !== undefined ? { notes: args.notes } : {}),
                            ...(args.targetRepo ? { targetRepo: args.targetRepo } : {}),
                            status,
                            ...(reason ? { statusReason: reason } : {}),
                            ...(args.priority !== undefined ? { priority: args.priority } : {}),
                        }, { actor: 'sentinel', idempotencyKey: args.idempotencyKey });
                        return { item, created };
                    }
                    case 'update': {
                        if (!args.itemId || typeof args.expectedRevision !== 'number') {
                            return { error: 'update requires itemId and expectedRevision.', code: 'invalid' };
                        }
                        const reason = args.reason?.trim();
                        if (args.status && REASON_REQUIRED.has(args.status) && !reason) {
                            return { error: `status ${args.status} requires a short reason.`, code: 'invalid' };
                        }
                        const patch: SentinelTodoPatch = {};
                        if (args.title !== undefined) patch.title = args.title;
                        if (args.completionCondition !== undefined) patch.completionCondition = args.completionCondition;
                        if (args.notes !== undefined) patch.notes = args.notes;
                        if (args.targetRepo) patch.targetRepo = args.targetRepo;
                        if (args.status !== undefined) patch.status = args.status;
                        if (args.priority !== undefined) patch.priority = args.priority;
                        if (reason) patch.statusReason = reason;
                        const outcome = args.outcome?.trim() || (args.status === 'done' ? reason : undefined);
                        if (outcome) patch.outcome = outcome;
                        if (args.reviewedJobs !== undefined) patch.reviewedJobs = args.reviewedJobs;
                        if (Object.keys(patch).length === 0) {
                            return { error: 'update needs at least one field to change.', code: 'invalid' };
                        }
                        const { item } = await service.update(owner, args.itemId, args.expectedRevision, patch, 'sentinel');
                        return { item };
                    }
                    default:
                        return { error: 'action must be list, create, or update.', code: 'invalid' };
                }
            } catch (err) {
                if (err instanceof SentinelTodoError) {
                    return { error: err.message, code: err.code, ...(err.current ? { current: err.current } : {}) };
                }
                return { error: `To-do bookkeeping failed: ${err instanceof Error ? err.message : String(err)}` };
            }
        },
    });
    return { tool };
}
