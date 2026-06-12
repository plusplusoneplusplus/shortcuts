/**
 * task-group-grouping — shared engine for grouping chat history around
 * hierarchical task groups (For Each runs, Map Reduce runs, Ralph sessions,
 * and future group types).
 *
 * Pure utility: no React, no side effects.
 *
 * Two grouping shapes exist:
 *  - Seeded groups ({@link groupBySeededTaskGroups}): groups are seeded from
 *    persisted run summaries; tasks nest by group-id resolution (the generic
 *    `taskGroup` tag, a feature-specific legacy context, or origin-process
 *    matching). For Each and Map Reduce use this.
 *  - Tag-derived groups: groups are formed purely from the tasks themselves
 *    (Ralph sessions). Ralph keeps its bespoke phase/title logic in
 *    ralph-session-grouping but shares the helpers below.
 */

/** Generic task-group membership tag (`payload.context.taskGroup` on live tasks, `taskGroup` on history items). */
export interface TaskGroupTaskRef {
    groupId: string;
    groupType: string;
    role?: string;
    itemKey?: string;
    workspaceId?: string;
}

export function getTaskGroupRef(task: any): TaskGroupTaskRef | undefined {
    const ref = task?.payload?.context?.taskGroup ?? task?.taskGroup;
    if (!ref || typeof ref !== 'object') {return undefined;}
    const candidate = ref as Partial<TaskGroupTaskRef>;
    if (typeof candidate.groupId !== 'string' || !candidate.groupId.trim()) {return undefined;}
    if (typeof candidate.groupType !== 'string' || !candidate.groupType.trim()) {return undefined;}
    return candidate as TaskGroupTaskRef;
}

/** Resolve the group ID a task belongs to for one specific group type, from the generic tag. */
export function getTaskGroupIdForType(task: any, groupType: string): string | undefined {
    const ref = getTaskGroupRef(task);
    return ref && ref.groupType === groupType ? ref.groupId : undefined;
}

/** Activity timestamp: prefers live conversation activity, falls back to lifecycle times. */
export function getTaskTimestamp(task: any): number {
    const ts = task?.lastActivityAt
        ?? task?.endTime
        ?? task?.completedAt
        ?? task?.startedAt
        ?? task?.startTime
        ?? task?.createdAt
        ?? 0;
    return typeof ts === 'number' ? ts : +new Date(ts);
}

/**
 * End timestamp: ignores `lastActivityAt` so finished groups stop floating
 * when late server-side turn appends bump activity after completion.
 */
export function getTaskEndTimestamp(task: any): number {
    const ts = task?.endTime
        ?? task?.completedAt
        ?? task?.startedAt
        ?? task?.startTime
        ?? task?.createdAt
        ?? 0;
    return typeof ts === 'number' ? ts : +new Date(ts);
}

export function getTaskIds(task: any): string[] {
    return [task?.id, task?.processId].filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export function isUnseenTask(task: any, unseenIds?: Set<string>): boolean {
    if (!unseenIds) {return false;}
    return getTaskIds(task).some(id => unseenIds.has(id));
}

/**
 * One seeded group entry. The field names intentionally match the legacy
 * per-feature group interfaces (`runId`/`run`) so existing consumers and
 * row components keep working unchanged.
 */
export interface SeededTaskGroup<TKind extends string, TData> {
    kind: TKind;
    runId: string;
    run: TData;
    children: any[];
    latestTimestamp: number;
    hasUnseen: boolean;
}

export interface SeededGroupingOptions<TKind extends string, TData> {
    /** History-entry discriminator (e.g. 'for-each-run'). */
    kind: TKind;
    /** Stable group ID of a seed (run summary). */
    getSeedId(data: TData): string;
    /** Base timestamp of a seed, used when it has no (newer) children. */
    getSeedTimestamp(data: TData): number;
    /** Origin chat process IDs (e.g. the plan-generation chat) that nest under the seed. */
    getSeedOriginProcessIds?(data: TData): string[];
    /**
     * Resolve the group ID a task belongs to (generic tag and/or legacy
     * feature context). Origin-process matching is applied afterwards.
     */
    resolveTaskGroupId(task: any): string | undefined;
}

/**
 * Group a flat task/history list around persisted group seeds.
 * Tasks that match no seed stay standalone. Matches legacy per-feature
 * behavior exactly: with no seeds the input is returned untouched, children
 * sort oldest-first, and entries sort by latest activity descending.
 */
export function groupBySeededTaskGroups<TKind extends string, TData>(
    items: any[],
    seeds: TData[],
    options: SeededGroupingOptions<TKind, TData>,
    unseenIds?: Set<string>,
): Array<SeededTaskGroup<TKind, TData> | any> {
    if (seeds.length === 0) {return items;}

    const groups = new Map<string, SeededTaskGroup<TKind, TData>>();
    const groupIdByOriginProcessId = new Map<string, string>();
    for (const seed of seeds) {
        const groupId = options.getSeedId(seed);
        groups.set(groupId, {
            kind: options.kind,
            runId: groupId,
            run: seed,
            children: [],
            latestTimestamp: options.getSeedTimestamp(seed),
            hasUnseen: false,
        });
        for (const originId of options.getSeedOriginProcessIds?.(seed) ?? []) {
            groupIdByOriginProcessId.set(originId, groupId);
        }
    }

    const standalone: any[] = [];
    for (const item of items) {
        const groupId = options.resolveTaskGroupId(item)
            ?? matchByOriginProcess(item, groupIdByOriginProcessId);
        const group = groupId ? groups.get(groupId) : undefined;
        if (!group) {
            standalone.push(item);
            continue;
        }
        group.children.push(item);
    }

    for (const group of groups.values()) {
        group.children.sort((a, b) => getTaskTimestamp(a) - getTaskTimestamp(b));
        const childTimestamps = group.children.map(getTaskTimestamp).filter(Number.isFinite);
        group.latestTimestamp = Math.max(options.getSeedTimestamp(group.run), ...childTimestamps);
        group.hasUnseen = group.children.some(child => isUnseenTask(child, unseenIds));
    }

    const entries: Array<SeededTaskGroup<TKind, TData> | any> = [...groups.values(), ...standalone];
    entries.sort((a, b) => getSeededEntryTimestamp(b, options.kind) - getSeededEntryTimestamp(a, options.kind));
    return entries;
}

function matchByOriginProcess(task: any, groupIdByOriginProcessId: Map<string, string>): string | undefined {
    for (const id of getTaskIds(task)) {
        const groupId = groupIdByOriginProcessId.get(id);
        if (groupId) {return groupId;}
    }
    return undefined;
}

function getSeededEntryTimestamp(entry: any, kind: string): number {
    if (entry?.kind === kind) {return entry.latestTimestamp as number;}
    return getTaskTimestamp(entry);
}
