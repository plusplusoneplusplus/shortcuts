import {
    getEffectiveType,
    isKnownWorkItemStatus,
    type KnownWorkItemStatus,
    type WorkItemPriority,
    type WorkItemStatus,
    type WorkItemType,
} from './types';

export const AZURE_BOARDS_TAG_SEPARATOR = '; ';
export const AZURE_BOARDS_COC_TYPE_TAG_PREFIX = 'coc:type:';
export const AZURE_BOARDS_UNKNOWN_TYPE_TAG_PREFIX = 'azure:type:';
export const AZURE_BOARDS_UNKNOWN_PRIORITY_TAG_PREFIX = 'azure:priority:';

const AZURE_TYPE_CANDIDATES_BY_COC_TYPE: Record<WorkItemType, readonly string[]> = {
    epic: ['Epic'],
    feature: ['Feature'],
    pbi: ['Product Backlog Item', 'User Story'],
    'work-item': ['Task'],
    bug: ['Bug'],
    goal: ['Task'],
};

const COC_STATUS_TO_AZURE_STATE: Record<KnownWorkItemStatus, string> = {
    created: 'New',
    drafting: 'New',
    planning: 'New',
    readyToExecute: 'Active',
    executing: 'Active',
    aiDone: 'Resolved',
    aiFailed: 'Active',
    done: 'Closed',
    failed: 'Removed',
};

const AZURE_STATE_TO_COC_STATUS: Record<string, WorkItemStatus> = {
    new: 'created',
    proposed: 'created',
    todo: 'created',
    'to do': 'created',
    approved: 'planning',
    committed: 'readyToExecute',
    active: 'executing',
    doing: 'executing',
    'in progress': 'executing',
    resolved: 'aiDone',
    closed: 'done',
    completed: 'done',
    done: 'done',
    removed: 'failed',
};

const AZURE_PRIORITY_TO_COC_PRIORITY: Record<string, WorkItemPriority> = {
    '1': 'high',
    high: 'high',
    critical: 'high',
    '2': 'normal',
    normal: 'normal',
    medium: 'normal',
    '3': 'low',
    '4': 'low',
    low: 'low',
};

export interface AzureBoardsTypeMapping {
    workItemType: string;
    tags: string[];
}

export interface AzureBoardsRemoteTypeMapping {
    type: WorkItemType;
    tags: string[];
}

export interface AzureBoardsPriorityMapping {
    priority?: WorkItemPriority;
    tags: string[];
}

function normalizedKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function addUnique(values: string[], seen: Set<string>, value: string | undefined): void {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = normalizedKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    values.push(trimmed);
}

function isCocTypeTag(tag: string): boolean {
    return normalizedKey(tag).startsWith(AZURE_BOARDS_COC_TYPE_TAG_PREFIX);
}

function cocTypeFromTag(tag: string): WorkItemType | undefined {
    const lower = normalizedKey(tag);
    if (!lower.startsWith(AZURE_BOARDS_COC_TYPE_TAG_PREFIX)) return undefined;
    const value = lower.slice(AZURE_BOARDS_COC_TYPE_TAG_PREFIX.length);
    return value === 'goal' ? 'goal' : undefined;
}

function pickAzureType(cocType: WorkItemType, availableTypes?: readonly string[]): string {
    const candidates = AZURE_TYPE_CANDIDATES_BY_COC_TYPE[cocType];
    const available = (availableTypes ?? [])
        .map(type => type.trim())
        .filter(Boolean);
    if (available.length === 0) return candidates[0];

    const byKey = new Map(available.map(type => [normalizedKey(type), type]));
    for (const candidate of candidates) {
        const match = byKey.get(normalizedKey(candidate));
        if (match) return match;
    }
    return candidates[0];
}

export function parseAzureBoardsTags(value: string | readonly string[] | undefined | null): string[] {
    const raw = Array.isArray(value) ? value : String(value ?? '').split(';');
    const tags: string[] = [];
    const seen = new Set<string>();
    for (const tag of raw) {
        addUnique(tags, seen, tag);
    }
    return tags;
}

export function formatAzureBoardsTags(tags: readonly string[] | undefined): string | undefined {
    const normalized = parseAzureBoardsTags(tags);
    return normalized.length > 0 ? normalized.join(AZURE_BOARDS_TAG_SEPARATOR) : undefined;
}

export function mapCocWorkItemTypeToAzureBoardsType(options: {
    type?: WorkItemType;
    tags?: readonly string[];
    availableTypes?: readonly string[];
}): AzureBoardsTypeMapping {
    const type = getEffectiveType(options.type);
    const tags: string[] = [];
    const seen = new Set<string>();
    for (const tag of options.tags ?? []) {
        if (isCocTypeTag(tag)) continue;
        addUnique(tags, seen, tag);
    }
    if (type === 'goal') {
        addUnique(tags, seen, `${AZURE_BOARDS_COC_TYPE_TAG_PREFIX}goal`);
    }
    return {
        workItemType: pickAzureType(type, options.availableTypes),
        tags,
    };
}

export function mapAzureBoardsTypeToCocWorkItemType(
    workItemType: string | undefined | null,
    rawTags?: string | readonly string[] | null,
): AzureBoardsRemoteTypeMapping {
    const tags = parseAzureBoardsTags(rawTags);
    const resultTags: string[] = [];
    const seen = new Set<string>();
    let taggedType: WorkItemType | undefined;

    for (const tag of tags) {
        const typeFromTag = cocTypeFromTag(tag);
        if (typeFromTag) {
            taggedType = typeFromTag;
            continue;
        }
        addUnique(resultTags, seen, tag);
    }

    if (taggedType) {
        return { type: taggedType, tags: resultTags };
    }

    const trimmedType = workItemType?.trim();
    const key = normalizedKey(trimmedType ?? '');
    if (key === 'epic') return { type: 'epic', tags: resultTags };
    if (key === 'feature') return { type: 'feature', tags: resultTags };
    if (key === 'product backlog item' || key === 'user story' || key === 'pbi') {
        return { type: 'pbi', tags: resultTags };
    }
    if (key === 'bug') return { type: 'bug', tags: resultTags };
    if (key === 'task') return { type: 'work-item', tags: resultTags };

    if (trimmedType) {
        addUnique(resultTags, seen, `${AZURE_BOARDS_UNKNOWN_TYPE_TAG_PREFIX}${trimmedType}`);
    }
    return { type: 'work-item', tags: resultTags };
}

export function mapWorkItemStatusToAzureBoardsState(status: WorkItemStatus | undefined): string {
    const trimmed = status?.trim();
    if (!trimmed) return 'New';
    if (!isKnownWorkItemStatus(trimmed)) return trimmed;
    return COC_STATUS_TO_AZURE_STATE[trimmed];
}

export function mapAzureBoardsStateToWorkItemStatus(state: string | undefined | null): WorkItemStatus {
    const trimmed = state?.trim();
    if (!trimmed) return 'created';
    return AZURE_STATE_TO_COC_STATUS[normalizedKey(trimmed)] ?? trimmed;
}

export function mapWorkItemPriorityToAzureBoardsPriority(priority: WorkItemPriority | undefined): number {
    switch (priority ?? 'normal') {
        case 'high':
            return 1;
        case 'low':
            return 3;
        case 'normal':
        default:
            return 2;
    }
}

export function mapAzureBoardsPriorityToWorkItemPriority(priority: unknown): AzureBoardsPriorityMapping {
    if (priority === undefined || priority === null || priority === '') return { tags: [] };
    const value = typeof priority === 'number' && Number.isFinite(priority)
        ? String(priority)
        : String(priority).trim();
    if (!value) return { tags: [] };
    const mapped = AZURE_PRIORITY_TO_COC_PRIORITY[normalizedKey(value)];
    if (mapped) return { priority: mapped, tags: [] };
    return {
        tags: [`${AZURE_BOARDS_UNKNOWN_PRIORITY_TAG_PREFIX}${value}`],
    };
}
