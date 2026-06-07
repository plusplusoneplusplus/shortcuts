import {
    DEFAULT_MAP_REDUCE_MAX_PARALLEL,
    MAP_REDUCE_ITEM_STATUSES,
    MAP_REDUCE_REDUCE_STEP_STATUSES,
} from './types';
import type {
    MapReduceItem,
    MapReduceItemStatus,
    MapReduceReduceStep,
    MapReduceReduceStepStatus,
} from './types';

export interface NormalizedMapReducePlan {
    items: MapReduceItem[];
    reduceInstructions: string;
    maxParallel: number;
}

const ITEM_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const ITEM_STATUS_SET = new Set<MapReduceItemStatus>(MAP_REDUCE_ITEM_STATUSES);
const REDUCE_STEP_STATUS_SET = new Set<MapReduceReduceStepStatus>(MAP_REDUCE_REDUCE_STEP_STATUSES);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error(`${fieldName} must be an array of item IDs`);
    }
    const result = value.map((entry, index) => {
        if (typeof entry !== 'string' || !entry.trim()) {
            throw new Error(`${fieldName}[${index}] must be a non-empty string`);
        }
        return entry.trim();
    });
    return result.length > 0 ? result : undefined;
}

function copyOptionalString(
    target: MapReduceItem | MapReduceReduceStep,
    key: 'childProcessId' | 'childTaskId' | 'startedAt' | 'completedAt' | 'error',
    raw: Record<string, unknown>,
): void {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) {
        target[key] = value.trim();
    }
}

function assertAcyclicDependencies(items: MapReduceItem[]): void {
    const byId = new Map(items.map(item => [item.id, item]));
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (item: MapReduceItem, path: string[]): void => {
        if (visited.has(item.id)) {
            return;
        }
        if (visiting.has(item.id)) {
            throw new Error(`Map Reduce item dependency cycle detected: ${[...path, item.id].join(' -> ')}`);
        }

        visiting.add(item.id);
        for (const dependencyId of item.dependsOn ?? []) {
            const dependency = byId.get(dependencyId);
            if (dependency) {
                visit(dependency, [...path, item.id]);
            }
        }
        visiting.delete(item.id);
        visited.add(item.id);
    };

    for (const item of items) {
        visit(item, []);
    }
}

export function normalizeMapReducePlanItems(rawItems: unknown): MapReduceItem[] {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new Error('Map Reduce item plan must contain a non-empty items array');
    }

    const seenIds = new Set<string>();
    const items = rawItems.map((raw, index): MapReduceItem => {
        if (!isPlainRecord(raw)) {
            throw new Error(`items[${index}] must be an object`);
        }

        const id = typeof raw.id === 'string' ? raw.id.trim() : '';
        if (!id) {
            throw new Error(`items[${index}].id is required`);
        }
        if (!ITEM_ID_PATTERN.test(id)) {
            throw new Error(`items[${index}].id may only contain letters, numbers, dot, underscore, or dash`);
        }
        if (seenIds.has(id)) {
            throw new Error(`Duplicate Map Reduce item id: ${id}`);
        }
        seenIds.add(id);

        const title = typeof raw.title === 'string' ? raw.title.trim() : '';
        if (!title) {
            throw new Error(`items[${index}].title is required`);
        }

        const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
        if (!prompt) {
            throw new Error(`items[${index}].prompt is required`);
        }

        const status = raw.status;
        if (!ITEM_STATUS_SET.has(status as MapReduceItemStatus)) {
            throw new Error(`items[${index}].status must be one of: ${MAP_REDUCE_ITEM_STATUSES.join(', ')}`);
        }

        const dependsOn = normalizeOptionalStringArray(raw.dependsOn, `items[${index}].dependsOn`);
        const metadata = raw.metadata === undefined
            ? undefined
            : isPlainRecord(raw.metadata)
                ? raw.metadata
                : undefined;
        if (raw.metadata !== undefined && metadata === undefined) {
            throw new Error(`items[${index}].metadata must be an object`);
        }

        const item: MapReduceItem = {
            id,
            title,
            prompt,
            status: status as MapReduceItemStatus,
        };
        if (dependsOn) {
            item.dependsOn = dependsOn;
        }
        if (metadata) {
            item.metadata = metadata;
        }
        if (raw.output !== undefined) {
            item.output = raw.output;
        }
        copyOptionalString(item, 'childProcessId', raw);
        copyOptionalString(item, 'childTaskId', raw);
        copyOptionalString(item, 'startedAt', raw);
        copyOptionalString(item, 'completedAt', raw);
        copyOptionalString(item, 'error', raw);
        return item;
    });

    const ids = new Set(items.map(item => item.id));
    for (const item of items) {
        for (const dependency of item.dependsOn ?? []) {
            if (!ids.has(dependency)) {
                throw new Error(`Map Reduce item '${item.id}' depends on unknown item '${dependency}'`);
            }
            if (dependency === item.id) {
                throw new Error(`Map Reduce item '${item.id}' cannot depend on itself`);
            }
        }
    }
    assertAcyclicDependencies(items);

    return items;
}

export function normalizeMapReduceMaxParallel(rawMaxParallel: unknown): number {
    const maxParallel = rawMaxParallel === undefined ? DEFAULT_MAP_REDUCE_MAX_PARALLEL : rawMaxParallel;
    if (typeof maxParallel !== 'number' || !Number.isSafeInteger(maxParallel) || maxParallel < 1) {
        throw new Error('Map Reduce maxParallel must be a positive integer');
    }
    return maxParallel;
}

export function normalizeMapReduceReduceInstructions(rawReduceInstructions: unknown): string {
    const reduceInstructions = typeof rawReduceInstructions === 'string'
        ? rawReduceInstructions.trim()
        : '';
    if (!reduceInstructions) {
        throw new Error('Map Reduce reduceInstructions is required');
    }
    return reduceInstructions;
}

export function createPendingMapReduceReduceStep(): MapReduceReduceStep {
    return { status: 'pending' };
}

export function normalizeMapReduceReduceStep(rawStep: unknown): MapReduceReduceStep {
    if (rawStep === undefined) {
        return createPendingMapReduceReduceStep();
    }
    if (!isPlainRecord(rawStep)) {
        throw new Error('Map Reduce reduceStep must be an object');
    }
    const status = rawStep.status;
    if (!REDUCE_STEP_STATUS_SET.has(status as MapReduceReduceStepStatus)) {
        throw new Error(`reduceStep.status must be one of: ${MAP_REDUCE_REDUCE_STEP_STATUSES.join(', ')}`);
    }

    const reduceStep: MapReduceReduceStep = {
        status: status as MapReduceReduceStepStatus,
    };
    copyOptionalString(reduceStep, 'childProcessId', rawStep);
    copyOptionalString(reduceStep, 'childTaskId', rawStep);
    copyOptionalString(reduceStep, 'startedAt', rawStep);
    copyOptionalString(reduceStep, 'completedAt', rawStep);
    copyOptionalString(reduceStep, 'error', rawStep);
    return reduceStep;
}

export function assertMapReduceDraftStatuses(
    items: MapReduceItem[],
    reduceStep: MapReduceReduceStep = createPendingMapReduceReduceStep(),
): void {
    const nonPending = items.find(item => item.status !== 'pending');
    if (nonPending) {
        throw new Error(`Generated Map Reduce item '${nonPending.id}' must have initial status 'pending'`);
    }
    if (reduceStep.status !== 'pending') {
        throw new Error(`Generated Map Reduce reduce step must have initial status 'pending'`);
    }
}

export function normalizeMapReducePlan(rawPlan: unknown): NormalizedMapReducePlan {
    if (!isPlainRecord(rawPlan)) {
        throw new Error('Map Reduce plan must be a JSON object');
    }
    const items = normalizeMapReducePlanItems(rawPlan.items);
    assertMapReduceDraftStatuses(items);
    return {
        items,
        reduceInstructions: normalizeMapReduceReduceInstructions(rawPlan.reduceInstructions),
        maxParallel: normalizeMapReduceMaxParallel(rawPlan.maxParallel),
    };
}

export function validateMapReduceDraftPlan(rawPlan: unknown):
    | { plan: NormalizedMapReducePlan; error: null }
    | { plan: null; error: string } {
    try {
        return { plan: normalizeMapReducePlan(rawPlan), error: null };
    } catch (err) {
        return { plan: null, error: err instanceof Error ? err.message : String(err) };
    }
}

export {
    assertMapReduceDraftStatuses as assertDraftInitialStatuses,
    normalizeMapReducePlanItems as normalizeMapReduceItems,
};
