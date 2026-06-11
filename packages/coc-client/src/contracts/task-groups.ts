/**
 * task-groups — shared contract for hierarchical task relationships.
 *
 * A "task group" is the common shape behind For Each runs, Map Reduce runs,
 * Ralph sessions, and Dream runs: a single visible `anchor` process plus a set
 * of `child` sub-tasks that all share one `groupId`. Every participating
 * task/process carries a {@link TaskGroupRef} so the chat list can group them
 * uniformly without per-feature logic.
 *
 * Pure types + data tables + tiny guards: no React, no Node, no side effects.
 */

/**
 * Hierarchical task-group kind. The known kinds are listed for autocomplete,
 * but the type is intentionally open (`string & {}`) so a new feature can
 * introduce its own kind without editing this union — it only needs to add a
 * {@link TaskGroupKindSpec}.
 */
export type TaskGroupKind = 'for-each' | 'map-reduce' | 'ralph' | 'dream' | (string & {});

/** Role of a process/task within its group. */
export type TaskGroupRole = 'anchor' | 'child';

/**
 * Uniform parent↔child relationship carried by every task/process that belongs
 * to a hierarchical group. This is the single grouping signal; features keep
 * their own rich metadata (item plans, candidates) alongside it.
 *
 * Emitted on live queue tasks at `payload.context.group` and surfaced on
 * history items at the top-level `group` field.
 */
export interface TaskGroupRef {
    /** Group kind — selects the registered {@link TaskGroupKindSpec}. */
    kind: TaskGroupKind;
    /** Identifier shared by every member of the group (runId / sessionId / dreamRunId). */
    groupId: string;
    /** Whether this member is the visible anchor or a child sub-task. */
    role: TaskGroupRole;
    /** Optional per-item linkage within the group (for-each itemId, dream step id, …). */
    itemId?: string;
    /** Optional stable ordering hint within the group (ascending). */
    order?: number;
}

/**
 * Static description of a task-group kind shared by backend (pin persistence)
 * and frontend (grouping + rendering). Richer presentation (title/progress
 * derivation, React row) is layered on top in the SPA; this contract stays
 * data-only so it can be imported from either side.
 */
export interface TaskGroupKindSpec {
    /** Group kind (matches {@link TaskGroupRef.kind}). */
    kind: TaskGroupKind;
    /**
     * Persisted pin-type string for {@link ProcessGroupPin}. Kept stable and
     * distinct from `kind` for backward compatibility with already-persisted
     * `group-pins.json` files (e.g. kind `for-each` ↔ pinType `for-each-run`).
     */
    pinType: string;
}

/**
 * Registry of known task-group kinds — the single source of truth mapping a
 * {@link TaskGroupKind} to its persisted pin-type. New kinds append here.
 */
export const TASK_GROUP_KIND_SPECS: readonly TaskGroupKindSpec[] = [
    { kind: 'ralph', pinType: 'ralph-session' },
    { kind: 'for-each', pinType: 'for-each-run' },
    { kind: 'map-reduce', pinType: 'map-reduce-run' },
    { kind: 'dream', pinType: 'dream-run' },
];

/** All known persisted pin-type strings, derived from {@link TASK_GROUP_KIND_SPECS}. */
export const GROUP_PIN_TYPES: readonly string[] = TASK_GROUP_KIND_SPECS.map(spec => spec.pinType);

/**
 * Persisted pin-type discriminator for {@link ProcessGroupPin}. Known values are
 * listed for autocomplete; open (`string & {}`) so new kinds need no edit here.
 */
export type ProcessGroupPinType =
    | 'ralph-session'
    | 'for-each-run'
    | 'map-reduce-run'
    | 'dream-run'
    | (string & {});

const PIN_TYPE_BY_KIND = new Map<string, string>(TASK_GROUP_KIND_SPECS.map(spec => [spec.kind, spec.pinType]));
const KIND_BY_PIN_TYPE = new Map<string, TaskGroupKind>(TASK_GROUP_KIND_SPECS.map(spec => [spec.pinType, spec.kind]));

/** Resolve the persisted pin-type for a group kind, if registered. */
export function pinTypeForKind(kind: TaskGroupKind): ProcessGroupPinType | undefined {
    return PIN_TYPE_BY_KIND.get(kind) as ProcessGroupPinType | undefined;
}

/** Resolve the group kind for a persisted pin-type, if registered. */
export function kindForPinType(pinType: string): TaskGroupKind | undefined {
    return KIND_BY_PIN_TYPE.get(pinType);
}

/** Returns true if `value` is a registered task-group kind. */
export function isTaskGroupKind(value: unknown): value is TaskGroupKind {
    return typeof value === 'string' && PIN_TYPE_BY_KIND.has(value);
}

/** Returns true if `value` is a registered persisted pin-type. */
export function isGroupPinType(value: unknown): value is ProcessGroupPinType {
    return typeof value === 'string' && KIND_BY_PIN_TYPE.has(value);
}

/** Returns true if `value` is a structurally valid {@link TaskGroupRef}. */
export function isTaskGroupRef(value: unknown): value is TaskGroupRef {
    if (!value || typeof value !== 'object') return false;
    const ref = value as Partial<TaskGroupRef>;
    return typeof ref.kind === 'string' && ref.kind.trim().length > 0
        && typeof ref.groupId === 'string' && ref.groupId.trim().length > 0
        && (ref.role === 'anchor' || ref.role === 'child');
}

/**
 * Coerce a parsed/derived value into a clean {@link TaskGroupRef}, trimming
 * strings and dropping malformed optional fields. Returns `undefined` if the
 * value is not a structurally valid ref.
 */
export function normalizeTaskGroupRef(value: unknown): TaskGroupRef | undefined {
    if (!isTaskGroupRef(value)) return undefined;
    const ref = value as TaskGroupRef;
    const normalized: TaskGroupRef = {
        kind: ref.kind.trim(),
        groupId: ref.groupId.trim(),
        role: ref.role,
    };
    if (typeof ref.itemId === 'string' && ref.itemId.trim()) {
        normalized.itemId = ref.itemId.trim();
    }
    if (typeof ref.order === 'number' && Number.isFinite(ref.order)) {
        normalized.order = ref.order;
    }
    return normalized;
}
