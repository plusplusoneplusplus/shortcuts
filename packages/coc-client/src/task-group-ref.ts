/**
 * task-group-ref — derive a uniform {@link TaskGroupRef} from any task or
 * history item, including legacy records that predate the unified `group`
 * field.
 *
 * Resolution order:
 *   1. An explicit `payload.context.group` / top-level `group` ref (tasks
 *      created by the task-group framework emit this directly).
 *   2. Legacy per-feature contexts (for-each / map-reduce / ralph / dream), so
 *      already-persisted conversations keep grouping after upgrade.
 *
 * Pure: no React, no Node, no side effects. Inputs are intentionally loosely
 * typed because callers pass both live `queue_tasks` (with `payload.context.*`)
 * and `ProcessHistoryItem`s (with top-level context fields).
 */

import {
    isTaskGroupRef,
    normalizeTaskGroupRef,
    type TaskGroupRef,
    type TaskGroupRole,
} from './contracts/task-groups';

type AnyTask = Record<string, any> | null | undefined;

/** Read a context object from either the live (`payload.context.x`) or history (`x`) location. */
function readContext(task: AnyTask, key: string): any {
    return (task as any)?.payload?.context?.[key] ?? (task as any)?.[key];
}

function nonEmpty(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Derive the explicit unified ref, if the task already carries one. */
function explicitRef(task: AnyTask): TaskGroupRef | undefined {
    const direct = (task as any)?.payload?.context?.group ?? (task as any)?.group;
    return isTaskGroupRef(direct) ? normalizeTaskGroupRef(direct) : undefined;
}

function forEachRef(task: AnyTask): TaskGroupRef | undefined {
    const ctx = readContext(task, 'forEach');
    if (!ctx || typeof ctx !== 'object') return undefined;
    const groupId = nonEmpty(ctx.runId);
    if (!groupId) return undefined;
    const role: TaskGroupRole = ctx.kind === 'generation' ? 'anchor' : 'child';
    const itemId = nonEmpty(ctx.itemId);
    return { kind: 'for-each', groupId, role, ...(itemId ? { itemId } : {}) };
}

function mapReduceRef(task: AnyTask): TaskGroupRef | undefined {
    const ctx = readContext(task, 'mapReduce');
    if (!ctx || typeof ctx !== 'object') return undefined;
    const groupId = nonEmpty(ctx.runId);
    if (!groupId) return undefined;
    const role: TaskGroupRole = ctx.kind === 'generation' ? 'anchor' : 'child';
    const itemId = nonEmpty(ctx.itemId);
    return { kind: 'map-reduce', groupId, role, ...(itemId ? { itemId } : {}) };
}

function ralphRef(task: AnyTask): TaskGroupRef | undefined {
    const ctx = readContext(task, 'ralph');
    if (!ctx || typeof ctx !== 'object') return undefined;
    const groupId = nonEmpty(ctx.sessionId);
    if (!groupId) return undefined;
    // The grilling process is the session's visible anchor; every other process
    // (iterations, follow-ups) is a child.
    const role: TaskGroupRole = ctx.phase === 'grilling' ? 'anchor' : 'child';
    return { kind: 'ralph', groupId, role };
}

function dreamRef(task: AnyTask): TaskGroupRef | undefined {
    // Legacy dream linkage lives on the internal step's process metadata
    // (`metadata.dreamStep`) keyed by `runId`; the outer run job is the anchor.
    const step = (task as any)?.metadata?.dreamStep ?? (task as any)?.payload?.context?.dreamStep;
    if (!step || typeof step !== 'object') return undefined;
    const groupId = nonEmpty(step.runId);
    if (!groupId) return undefined;
    const itemId = nonEmpty(step.kind); // 'analyzer' | 'critic'
    return { kind: 'dream', groupId, role: 'child', ...(itemId ? { itemId } : {}) };
}

const LEGACY_DERIVERS: Array<(task: AnyTask) => TaskGroupRef | undefined> = [
    forEachRef,
    mapReduceRef,
    ralphRef,
    dreamRef,
];

/**
 * Derive the {@link TaskGroupRef} for a task/history item, or `undefined` if it
 * does not participate in any group. An explicit unified ref always wins over
 * legacy per-feature contexts.
 */
export function deriveTaskGroupRef(task: AnyTask): TaskGroupRef | undefined {
    if (!task || typeof task !== 'object') return undefined;
    const explicit = explicitRef(task);
    if (explicit) return explicit;
    for (const derive of LEGACY_DERIVERS) {
        const ref = derive(task);
        if (ref) return ref;
    }
    return undefined;
}

/** Convenience: the group id a task belongs to, if any. */
export function getTaskGroupId(task: AnyTask): string | undefined {
    return deriveTaskGroupRef(task)?.groupId;
}

/** Convenience: whether a task participates in a hierarchical group. */
export function isGroupedTask(task: AnyTask): boolean {
    return !!deriveTaskGroupRef(task);
}
