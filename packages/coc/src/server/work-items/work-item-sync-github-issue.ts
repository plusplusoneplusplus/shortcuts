import {
    getEffectiveType,
    WORK_ITEM_STATUSES,
    WORK_ITEM_TYPES,
    type WorkItem,
    type WorkItemPriority,
    type WorkItemStatus,
    type WorkItemSyncParentReference,
    type WorkItemSyncRemoteIdentity,
    type WorkItemType,
} from './types';

const COC_LABEL_PREFIX = 'coc:';
const COC_TYPE_LABEL_PREFIX = 'coc:type:';
const COC_STATUS_LABEL_PREFIX = 'coc:status:';
const COC_PRIORITY_LABEL_PREFIX = 'coc:priority:';
const METADATA_MARKER = 'coc-work-item-sync';
const GITHUB_WORK_ITEM_METADATA_SCHEMA_VERSION = 1;
const WORK_ITEM_PRIORITIES: readonly WorkItemPriority[] = ['high', 'normal', 'low'];

export type GitHubIssueLabel = string | { name?: string | null };

export interface GitHubWorkItemIssueSnapshot {
    id?: string | number;
    number?: number;
    htmlUrl?: string;
    url?: string;
    labels?: GitHubIssueLabel[];
    body?: string | null;
    updatedAt?: string;
}

export interface GitHubWorkItemSyncMetadata {
    schemaVersion: 1;
    provider: 'github';
    remote: WorkItemSyncRemoteIdentity & { owner: string; repo: string };
    workItemId?: string;
    parent?: WorkItemSyncParentReference;
    type: WorkItemType;
    status: WorkItemStatus;
    lastSyncedAt: string;
}

export interface ParseGitHubWorkItemSyncMetadataResult {
    metadata?: GitHubWorkItemSyncMetadata;
    metadataBlocks: GitHubWorkItemSyncMetadata[];
    invalidBlocks: number;
    bodyWithoutMetadata: string;
}

export interface ParsedGitHubWorkItemIssue {
    type?: WorkItemType;
    status?: WorkItemStatus;
    priority?: WorkItemPriority;
    tags: string[];
    metadata?: GitHubWorkItemSyncMetadata;
    metadataBlocks: GitHubWorkItemSyncMetadata[];
    invalidMetadataBlocks: number;
    unknownCocLabels: string[];
    bodyWithoutMetadata: string;
}

export interface BuildGitHubWorkItemSyncMetadataOptions {
    workItem: Pick<WorkItem, 'id' | 'type' | 'status' | 'parentId'>;
    remote: WorkItemSyncRemoteIdentity & { owner: string; repo: string };
    lastSyncedAt: string;
    parent?: WorkItemSyncParentReference;
}

export interface BuildGitHubWorkItemIssueUpdateOptions {
    workItem: Pick<WorkItem, 'id' | 'type' | 'status' | 'priority' | 'tags' | 'description' | 'parentId'>;
    remote: WorkItemSyncRemoteIdentity & { owner: string; repo: string };
    lastSyncedAt: string;
    parent?: WorkItemSyncParentReference;
    existingIssue?: GitHubWorkItemIssueSnapshot;
}

export interface GitHubWorkItemIssueUpdate {
    labels: string[];
    body: string;
    metadata: GitHubWorkItemSyncMetadata;
}

function metadataBlockPattern(): RegExp {
    return /<!--\s*coc-work-item-sync\s+([\s\S]*?)\s*-->/g;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkItemType(value: unknown): value is WorkItemType {
    return typeof value === 'string' && WORK_ITEM_TYPES.includes(value as WorkItemType);
}

function isWorkItemStatus(value: unknown): value is WorkItemStatus {
    return typeof value === 'string' && WORK_ITEM_STATUSES.includes(value as WorkItemStatus);
}

function isWorkItemPriority(value: unknown): value is WorkItemPriority {
    return typeof value === 'string' && WORK_ITEM_PRIORITIES.includes(value as WorkItemPriority);
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeIssueId(value: string | number | undefined): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return optionalString(value);
}

function parseRemoteIdentity(value: unknown, requireOwnerRepo: true): (WorkItemSyncRemoteIdentity & { owner: string; repo: string }) | undefined;
function parseRemoteIdentity(value: unknown, requireOwnerRepo?: false): WorkItemSyncRemoteIdentity | undefined;
function parseRemoteIdentity(value: unknown, requireOwnerRepo = false): WorkItemSyncRemoteIdentity | undefined {
    if (!isRecord(value)) return undefined;
    const owner = optionalString(value.owner);
    const repo = optionalString(value.repo);
    if (requireOwnerRepo && (!owner || !repo)) return undefined;

    const remote: WorkItemSyncRemoteIdentity = {};
    if (owner) remote.owner = owner;
    if (repo) remote.repo = repo;
    const projectId = optionalString(value.projectId);
    if (projectId) remote.projectId = projectId;
    const issueId = optionalString(value.issueId);
    if (issueId) remote.issueId = issueId;
    const issueNumber = optionalNumber(value.issueNumber);
    if (issueNumber !== undefined) remote.issueNumber = issueNumber;
    const issueUrl = optionalString(value.issueUrl);
    if (issueUrl) remote.issueUrl = issueUrl;
    return remote;
}

function parseParentReference(value: unknown): WorkItemSyncParentReference | undefined {
    if (!isRecord(value)) return undefined;
    const parent: WorkItemSyncParentReference = {};
    const workItemId = optionalString(value.workItemId);
    if (workItemId) parent.workItemId = workItemId;
    const issueId = optionalString(value.issueId);
    if (issueId) parent.issueId = issueId;
    const issueNumber = optionalNumber(value.issueNumber);
    if (issueNumber !== undefined) parent.issueNumber = issueNumber;
    const issueUrl = optionalString(value.issueUrl);
    if (issueUrl) parent.issueUrl = issueUrl;
    const owner = optionalString(value.owner);
    if (owner) parent.owner = owner;
    const repo = optionalString(value.repo);
    if (repo) parent.repo = repo;
    return Object.keys(parent).length > 0 ? parent : undefined;
}

function parseMetadataValue(value: unknown): GitHubWorkItemSyncMetadata | undefined {
    if (!isRecord(value)) return undefined;
    if (value.schemaVersion !== GITHUB_WORK_ITEM_METADATA_SCHEMA_VERSION || value.provider !== 'github') {
        return undefined;
    }

    const remote = parseRemoteIdentity(value.remote, true);
    const type = isWorkItemType(value.type) ? value.type : undefined;
    const status = isWorkItemStatus(value.status) ? value.status : undefined;
    const lastSyncedAt = optionalString(value.lastSyncedAt);
    if (!remote || !type || !status || !lastSyncedAt) return undefined;

    const metadata: GitHubWorkItemSyncMetadata = {
        schemaVersion: GITHUB_WORK_ITEM_METADATA_SCHEMA_VERSION,
        provider: 'github',
        remote,
        type,
        status,
        lastSyncedAt,
    };
    const workItemId = optionalString(value.workItemId);
    if (workItemId) metadata.workItemId = workItemId;
    const parent = parseParentReference(value.parent);
    if (parent) metadata.parent = parent;
    return metadata;
}

function labelName(label: GitHubIssueLabel): string | undefined {
    const name = typeof label === 'string' ? label : label.name;
    const trimmed = name?.trim();
    return trimmed ? trimmed : undefined;
}

function addUnique(labels: string[], seen: Set<string>, label: string | undefined): void {
    const trimmed = label?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    labels.push(trimmed);
}

function nonCocLabels(labels: readonly GitHubIssueLabel[] | undefined): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const label of labels ?? []) {
        const name = labelName(label);
        if (!name || name.toLowerCase().startsWith(COC_LABEL_PREFIX)) continue;
        addUnique(result, seen, name);
    }
    return result;
}

function workItemTagsAsLabels(tags: readonly string[] | undefined): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const tag of tags ?? []) {
        if (tag.toLowerCase().startsWith(COC_LABEL_PREFIX)) continue;
        addUnique(result, seen, tag);
    }
    return result;
}

function countMetadataBlocks(body: string): number {
    let count = 0;
    const pattern = metadataBlockPattern();
    while (pattern.exec(body) !== null) count++;
    return count;
}

export function parseGitHubWorkItemSyncMetadataBlocks(body: string | null | undefined): ParseGitHubWorkItemSyncMetadataResult {
    const source = body ?? '';
    const metadataBlocks: GitHubWorkItemSyncMetadata[] = [];
    let invalidBlocks = 0;
    const pattern = metadataBlockPattern();
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            const metadata = parseMetadataValue(parsed);
            if (metadata) {
                metadataBlocks.push(metadata);
            } else {
                invalidBlocks++;
            }
        } catch {
            invalidBlocks++;
        }
    }

    return {
        metadata: metadataBlocks.at(-1),
        metadataBlocks,
        invalidBlocks,
        bodyWithoutMetadata: stripGitHubWorkItemSyncMetadataBlocks(source),
    };
}

export function stripGitHubWorkItemSyncMetadataBlocks(body: string | null | undefined): string {
    return (body ?? '')
        .replace(metadataBlockPattern(), '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function formatGitHubWorkItemSyncMetadataBlock(metadata: GitHubWorkItemSyncMetadata): string {
    return `<!-- ${METADATA_MARKER} ${JSON.stringify(metadata)} -->`;
}

export function upsertGitHubWorkItemSyncMetadataBlock(
    body: string | null | undefined,
    metadata: GitHubWorkItemSyncMetadata,
): string {
    const prose = stripGitHubWorkItemSyncMetadataBlocks(body);
    const block = formatGitHubWorkItemSyncMetadataBlock(metadata);
    return prose ? `${prose}\n\n${block}` : block;
}

export function parseGitHubWorkItemIssue(issue: GitHubWorkItemIssueSnapshot): ParsedGitHubWorkItemIssue {
    const tags: string[] = [];
    const seenTags = new Set<string>();
    const unknownCocLabels: string[] = [];
    let type: WorkItemType | undefined;
    let status: WorkItemStatus | undefined;
    let priority: WorkItemPriority | undefined;

    for (const label of issue.labels ?? []) {
        const name = labelName(label);
        if (!name) continue;
        const lower = name.toLowerCase();
        if (!lower.startsWith(COC_LABEL_PREFIX)) {
            addUnique(tags, seenTags, name);
            continue;
        }
        if (lower.startsWith(COC_TYPE_LABEL_PREFIX)) {
            const value = lower.slice(COC_TYPE_LABEL_PREFIX.length);
            if (isWorkItemType(value)) {
                type = value;
            } else {
                unknownCocLabels.push(name);
            }
            continue;
        }
        if (lower.startsWith(COC_STATUS_LABEL_PREFIX)) {
            const value = lower.slice(COC_STATUS_LABEL_PREFIX.length);
            if (isWorkItemStatus(value)) {
                status = value;
            } else {
                unknownCocLabels.push(name);
            }
            continue;
        }
        if (lower.startsWith(COC_PRIORITY_LABEL_PREFIX)) {
            const value = lower.slice(COC_PRIORITY_LABEL_PREFIX.length);
            if (isWorkItemPriority(value)) {
                priority = value;
            } else {
                unknownCocLabels.push(name);
            }
            continue;
        }
        unknownCocLabels.push(name);
    }

    const metadataResult = parseGitHubWorkItemSyncMetadataBlocks(issue.body);
    return {
        type: type ?? metadataResult.metadata?.type,
        status: status ?? metadataResult.metadata?.status,
        priority,
        tags,
        metadata: metadataResult.metadata,
        metadataBlocks: metadataResult.metadataBlocks,
        invalidMetadataBlocks: metadataResult.invalidBlocks,
        unknownCocLabels,
        bodyWithoutMetadata: metadataResult.bodyWithoutMetadata,
    };
}

export function buildGitHubWorkItemLabels(options: {
    workItem: Pick<WorkItem, 'type' | 'status' | 'priority' | 'tags'>;
    existingLabels?: readonly GitHubIssueLabel[];
}): string[] {
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const label of nonCocLabels(options.existingLabels)) {
        addUnique(labels, seen, label);
    }
    for (const tag of workItemTagsAsLabels(options.workItem.tags)) {
        addUnique(labels, seen, tag);
    }
    addUnique(labels, seen, `${COC_TYPE_LABEL_PREFIX}${getEffectiveType(options.workItem.type)}`);
    addUnique(labels, seen, `${COC_STATUS_LABEL_PREFIX}${options.workItem.status}`);
    addUnique(labels, seen, `${COC_PRIORITY_LABEL_PREFIX}${options.workItem.priority ?? 'normal'}`);
    return labels;
}

export function buildGitHubWorkItemSyncMetadata(options: BuildGitHubWorkItemSyncMetadataOptions): GitHubWorkItemSyncMetadata {
    const remote: WorkItemSyncRemoteIdentity & { owner: string; repo: string } = {
        owner: options.remote.owner,
        repo: options.remote.repo,
    };
    const projectId = optionalString(options.remote.projectId);
    if (projectId) remote.projectId = projectId;
    const issueId = normalizeIssueId(options.remote.issueId);
    if (issueId) remote.issueId = issueId;
    const issueNumber = optionalNumber(options.remote.issueNumber);
    if (issueNumber !== undefined) remote.issueNumber = issueNumber;
    const issueUrl = optionalString(options.remote.issueUrl);
    if (issueUrl) remote.issueUrl = issueUrl;

    const metadata: GitHubWorkItemSyncMetadata = {
        schemaVersion: GITHUB_WORK_ITEM_METADATA_SCHEMA_VERSION,
        provider: 'github',
        remote,
        workItemId: options.workItem.id,
        type: getEffectiveType(options.workItem.type),
        status: options.workItem.status,
        lastSyncedAt: options.lastSyncedAt,
    };
    const parent = options.parent ?? (options.workItem.parentId ? { workItemId: options.workItem.parentId } : undefined);
    if (parent) metadata.parent = parent;
    return metadata;
}

export function buildGitHubWorkItemIssueUpdate(options: BuildGitHubWorkItemIssueUpdateOptions): GitHubWorkItemIssueUpdate {
    const remote = {
        ...options.remote,
        issueId: normalizeIssueId(options.remote.issueId) ?? normalizeIssueId(options.existingIssue?.id),
        issueNumber: options.remote.issueNumber ?? options.existingIssue?.number,
        issueUrl: optionalString(options.remote.issueUrl) ?? optionalString(options.existingIssue?.htmlUrl) ?? optionalString(options.existingIssue?.url),
    };
    const metadata = buildGitHubWorkItemSyncMetadata({
        workItem: options.workItem,
        remote,
        lastSyncedAt: options.lastSyncedAt,
        parent: options.parent,
    });
    const existingBody = options.existingIssue?.body;
    const baseBody = stripGitHubWorkItemSyncMetadataBlocks(existingBody);
    return {
        labels: buildGitHubWorkItemLabels({
            workItem: options.workItem,
            existingLabels: options.existingIssue?.labels,
        }),
        body: upsertGitHubWorkItemSyncMetadataBlock(baseBody || options.workItem.description || '', metadata),
        metadata,
    };
}

export function hasExactlyOneGitHubWorkItemSyncMetadataBlock(body: string | null | undefined): boolean {
    return countMetadataBlocks(body ?? '') === 1;
}
