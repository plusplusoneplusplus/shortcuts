import { execFile } from 'child_process';
import * as crypto from 'crypto';
import { promisify } from 'util';
import type {
    WorkItemSyncApplyResponse,
    WorkItemSyncConflict,
    WorkItemSyncConflictResolution,
    WorkItemSyncPreviewOperation,
    WorkItemSyncPreviewResponse,
    WorkItemSyncProviderStatus,
    WorkItemSyncRemoteFilter,
    WorkItemSyncRemoteIdentity,
    WorkItemSyncWarning,
} from '@plusplusoneplusplus/coc-client';
import {
    buildGitHubWorkItemIssueUpdate,
    parseGitHubWorkItemIssue,
    type GitHubIssueLabel,
    type GitHubWorkItemIssueSnapshot,
    type ParsedGitHubWorkItemIssue,
} from './work-item-sync-github-issue';
import {
    resolveGitHubWorkItemSyncRepo,
    type GitHubWorkItemSyncRepo,
} from './work-item-sync-github-repo';
import type {
    WorkItem,
    WorkItemIndexEntry,
    WorkItemSyncLink,
    WorkItemSyncParentReference,
} from './types';
import {
    ALLOWED_PARENT_TYPES,
    getEffectiveType,
    isValidParentChildTypes,
} from './types';
import {
    WORK_ITEM_SYNC_MAX_ITEMS,
    type WorkItemSyncProviderAdapter,
    type WorkItemSyncProviderApplyContext,
    type WorkItemSyncProviderContext,
    type WorkItemSyncProviderPreviewContext,
} from './work-item-sync-provider';

type AvailableGitHubWorkItemSyncRepo = Extract<GitHubWorkItemSyncRepo, { available: true }>;
type UnavailableGitHubWorkItemSyncRepo = Exclude<GitHubWorkItemSyncRepo, AvailableGitHubWorkItemSyncRepo>;
type WorkItemSyncFieldChanges = NonNullable<WorkItemSyncPreviewOperation['fields']>;

export interface GitHubWorkItemIssueCreateInput {
    title: string;
    body: string;
    labels: string[];
}

export interface GitHubWorkItemIssueUpdateInput extends GitHubWorkItemIssueCreateInput {
    state: 'open' | 'closed';
}

export interface GitHubWorkItemIssue extends GitHubWorkItemIssueSnapshot {
    number: number;
    title: string;
}

export interface GitHubWorkItemIssueListFilters extends WorkItemSyncRemoteFilter {
    limit?: number;
}

export interface GitHubWorkItemIssueTransport {
    getRepository(repo: AvailableGitHubWorkItemSyncRepo): Promise<void>;
    listIssues(repo: AvailableGitHubWorkItemSyncRepo, filters?: GitHubWorkItemIssueListFilters): Promise<GitHubWorkItemIssue[]>;
    getIssue(repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number): Promise<GitHubWorkItemIssue | undefined>;
    createIssue(repo: AvailableGitHubWorkItemSyncRepo, input: GitHubWorkItemIssueCreateInput): Promise<GitHubWorkItemIssue>;
    updateIssue(repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number, input: GitHubWorkItemIssueUpdateInput): Promise<GitHubWorkItemIssue>;
}

export interface CreateGitHubWorkItemSyncProviderOptions {
    transport?: GitHubWorkItemIssueTransport;
    now?: () => string;
    createPreviewId?: (operation: WorkItemSyncProviderPreviewContext['operation']) => string;
}

interface GitHubRestIssue {
    id?: number | string;
    node_id?: string;
    number?: number;
    title?: string;
    state?: string;
    html_url?: string;
    url?: string;
    labels?: GitHubIssueLabel[];
    body?: string | null;
    updated_at?: string;
    pull_request?: unknown;
}

type ExecFileAsync = (
    file: string,
    args: string[],
    options: { encoding: 'utf8'; windowsHide: true; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile) as ExecFileAsync;

function repoApiPath(repo: AvailableGitHubWorkItemSyncRepo, suffix = ''): string {
    return `repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
    if (!isRecord(error)) return false;
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
    return message.includes('404') || message.includes('not found');
}

function normalizeRestIssue(issue: GitHubRestIssue): GitHubWorkItemIssue | undefined {
    if (issue.pull_request !== undefined) return undefined;
    if (typeof issue.number !== 'number' || !Number.isInteger(issue.number) || issue.number <= 0) return undefined;
    const title = issue.title?.trim();
    if (!title) return undefined;
    return {
        id: issue.node_id ?? issue.id,
        number: issue.number,
        title,
        state: issue.state,
        htmlUrl: issue.html_url,
        url: issue.url,
        labels: issue.labels,
        body: issue.body,
        updatedAt: issue.updated_at,
    };
}

function matchesTextFilter(issue: GitHubWorkItemIssue, q: string | undefined): boolean {
    const needle = q?.trim().toLowerCase();
    if (!needle) return true;
    return [
        issue.title,
        issue.body ?? '',
        String(issue.number),
    ].some(value => value.toLowerCase().includes(needle));
}

export class GhCliGitHubWorkItemIssueTransport implements GitHubWorkItemIssueTransport {
    constructor(private readonly run: ExecFileAsync = execFileAsync) {}

    async getRepository(repo: AvailableGitHubWorkItemSyncRepo): Promise<void> {
        await this.ghJson(repo, [repoApiPath(repo)]);
    }

    async listIssues(repo: AvailableGitHubWorkItemSyncRepo, filters: GitHubWorkItemIssueListFilters = {}): Promise<GitHubWorkItemIssue[]> {
        const limit = Math.max(1, Math.min(filters.limit ?? WORK_ITEM_SYNC_MAX_ITEMS, WORK_ITEM_SYNC_MAX_ITEMS));
        const labels = filters.labels?.map(label => label.trim()).filter(Boolean);
        const result: GitHubWorkItemIssue[] = [];
        let page = 1;

        while (result.length < limit) {
            const rawIssues = await this.ghJson<GitHubRestIssue[]>(repo, [
                repoApiPath(repo, '/issues'),
                '--method', 'GET',
                '-f', 'state=all',
                '-F', 'per_page=100',
                '-F', `page=${page}`,
                ...(labels?.length ? ['-f', `labels=${labels.join(',')}`] : []),
            ]);
            const normalized = rawIssues
                .map(normalizeRestIssue)
                .filter((issue): issue is GitHubWorkItemIssue => issue !== undefined)
                .filter(issue => matchesTextFilter(issue, filters.q));
            result.push(...normalized.slice(0, limit - result.length));
            if (rawIssues.length < 100) break;
            page++;
        }

        return result;
    }

    async getIssue(repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number): Promise<GitHubWorkItemIssue | undefined> {
        try {
            return normalizeRestIssue(await this.ghJson<GitHubRestIssue>(repo, [
                repoApiPath(repo, `/issues/${issueNumber}`),
            ]));
        } catch (error) {
            if (isNotFoundError(error)) return undefined;
            throw error;
        }
    }

    async createIssue(repo: AvailableGitHubWorkItemSyncRepo, input: GitHubWorkItemIssueCreateInput): Promise<GitHubWorkItemIssue> {
        const issue = normalizeRestIssue(await this.ghJson<GitHubRestIssue>(repo, [
            repoApiPath(repo, '/issues'),
            '--method', 'POST',
            ...this.issueFields(input),
        ]));
        if (!issue) throw new Error(`GitHub API for ${repo.owner}/${repo.repo} did not return a created issue.`);
        return issue;
    }

    async updateIssue(repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number, input: GitHubWorkItemIssueUpdateInput): Promise<GitHubWorkItemIssue> {
        const issue = normalizeRestIssue(await this.ghJson<GitHubRestIssue>(repo, [
            repoApiPath(repo, `/issues/${issueNumber}`),
            '--method', 'PATCH',
            ...this.issueFields(input),
            '-f', `state=${input.state}`,
        ]));
        if (!issue) throw new Error(`GitHub API for ${repo.owner}/${repo.repo} did not return an updated issue.`);
        return issue;
    }

    private async ghJson<T>(repo: AvailableGitHubWorkItemSyncRepo, args: string[]): Promise<T> {
        const { stdout } = await this.run('gh', ['api', ...args], {
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
        });
        try {
            return JSON.parse(stdout) as T;
        } catch {
            throw new Error(`GitHub API for ${repo.owner}/${repo.repo} returned invalid JSON.`);
        }
    }

    private issueFields(input: GitHubWorkItemIssueCreateInput): string[] {
        const args = [
            '-f', `title=${input.title}`,
            '-f', `body=${input.body}`,
        ];
        for (const label of input.labels) {
            args.push('-f', `labels[]=${label}`);
        }
        return args;
    }
}

function unavailableRepoStatus(repo: UnavailableGitHubWorkItemSyncRepo): WorkItemSyncProviderStatus {
    const messageByReason: Record<UnavailableGitHubWorkItemSyncRepo['reason'], string> = {
        'incomplete-preference': 'GitHub sync owner/repo preference must include both owner and repo.',
        'missing-workspace': 'GitHub sync could not resolve the current workspace.',
        'missing-origin': 'GitHub sync could not find a git origin remote for this workspace.',
        'non-github-origin': 'GitHub sync requires a GitHub origin remote or workspace owner/repo override.',
    };
    return {
        provider: 'github',
        available: false,
        reason: repo.reason,
        message: messageByReason[repo.reason],
        auth: {
            mode: 'external',
            authenticated: false,
            message: 'GitHub sync uses external authentication; run gh auth login or set GITHUB_TOKEN for the server process.',
        },
    };
}

function availableRepoStatus(repo: AvailableGitHubWorkItemSyncRepo): WorkItemSyncProviderStatus {
    return {
        provider: 'github',
        available: true,
        repository: {
            provider: 'github',
            owner: repo.owner,
            repo: repo.repo,
            url: repo.url,
            source: repo.source,
        },
        auth: {
            mode: 'external',
            authenticated: true,
            message: 'GitHub sync is using external GitHub authentication.',
        },
    };
}

function authUnavailableStatus(repo: AvailableGitHubWorkItemSyncRepo): WorkItemSyncProviderStatus {
    return {
        provider: 'github',
        available: false,
        reason: 'auth-unavailable',
        message: `GitHub sync could not reach ${repo.owner}/${repo.repo} using external authentication.`,
        repository: {
            provider: 'github',
            owner: repo.owner,
            repo: repo.repo,
            url: repo.url,
            source: repo.source,
        },
        auth: {
            mode: 'external',
            authenticated: false,
            message: 'Run gh auth login or set GITHUB_TOKEN for the server process.',
        },
    };
}

function resolveRepo(context: Pick<WorkItemSyncProviderContext, 'workspace' | 'preferences'>): GitHubWorkItemSyncRepo {
    return resolveGitHubWorkItemSyncRepo({
        workspace: context.workspace,
        preferences: context.preferences,
    });
}

function getGithubSyncLink(item: WorkItem): WorkItemSyncLink | undefined {
    return item.syncLinks?.find(link => link.provider === 'github');
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
    return [...(tags ?? [])].map(tag => tag.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function remoteStatus(issue: GitHubWorkItemIssue, parsed: ParsedGitHubWorkItemIssue): WorkItem['status'] {
    return parsed.status ?? (issue.state === 'closed' ? 'done' : 'created');
}

function remotePriority(parsed: ParsedGitHubWorkItemIssue): WorkItem['priority'] {
    return parsed.priority ?? 'normal';
}

function syncFingerprintForFields(fields: {
    title: string;
    description: string;
    type: WorkItem['type'];
    status: WorkItem['status'];
    priority?: WorkItem['priority'];
    tags?: readonly string[];
    parentId?: string;
}): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify({
            title: fields.title,
            description: fields.description ?? '',
            type: getEffectiveType(fields.type),
            status: fields.status,
            priority: fields.priority ?? 'normal',
            tags: normalizeTags(fields.tags),
            parentId: fields.parentId ?? null,
        }))
        .digest('hex');
}

function syncFingerprintForWorkItem(item: WorkItem): string {
    return syncFingerprintForFields({
        title: item.title,
        description: item.description ?? '',
        type: item.type,
        status: item.status,
        priority: item.priority,
        tags: item.tags,
        parentId: item.parentId,
    });
}

function syncFingerprintForIssue(issue: GitHubWorkItemIssue, parsed: ParsedGitHubWorkItemIssue, parentId?: string): string {
    return syncFingerprintForFields({
        title: issue.title,
        description: parsed.bodyWithoutMetadata,
        type: parsed.type ?? 'work-item',
        status: remoteStatus(issue, parsed),
        priority: remotePriority(parsed),
        tags: parsed.tags,
        parentId,
    });
}

function localChangedSinceLastSync(item: WorkItem, link: WorkItemSyncLink): boolean {
    if (link.lastSyncedFingerprint) {
        return syncFingerprintForWorkItem(item) !== link.lastSyncedFingerprint;
    }
    const lastSyncedAt = link.lastSyncedAt ?? link.remoteUpdatedAt;
    return Boolean(lastSyncedAt && item.updatedAt > lastSyncedAt);
}

function remoteChangedSinceLastSync(issue: GitHubWorkItemIssue, link: WorkItemSyncLink): boolean {
    return Boolean(link.remoteUpdatedAt && issue.updatedAt && issue.updatedAt > link.remoteUpdatedAt);
}

function githubIssueStateForWorkItem(item: WorkItem): 'open' | 'closed' {
    return item.status === 'done' ? 'closed' : 'open';
}

function remoteIdentity(repo: AvailableGitHubWorkItemSyncRepo, issue?: GitHubWorkItemIssue, link?: WorkItemSyncLink): WorkItemSyncRemoteIdentity {
    const remote: WorkItemSyncRemoteIdentity = {
        owner: repo.owner,
        repo: repo.repo,
    };
    const issueId = issue?.id ?? link?.remote.issueId;
    if (issueId !== undefined) remote.issueId = String(issueId);
    const issueNumber = issue?.number ?? link?.remote.issueNumber;
    if (issueNumber !== undefined) remote.issueNumber = issueNumber;
    const issueUrl = issue?.htmlUrl ?? issue?.url ?? link?.remote.issueUrl;
    if (issueUrl) remote.issueUrl = issueUrl;
    return remote;
}

function sameRemote(link: WorkItemSyncLink | undefined, repo: AvailableGitHubWorkItemSyncRepo, issue: GitHubWorkItemIssue): boolean {
    if (!link || link.provider !== 'github') return false;
    if (link.remote.owner && link.remote.owner !== repo.owner) return false;
    if (link.remote.repo && link.remote.repo !== repo.repo) return false;
    if (link.remote.issueNumber !== undefined && link.remote.issueNumber === issue.number) return true;
    if (link.remote.issueId !== undefined && issue.id !== undefined && link.remote.issueId === String(issue.id)) return true;
    return false;
}

function fieldsForRemoteDraft(issue: GitHubWorkItemIssue, parsed: ParsedGitHubWorkItemIssue): WorkItemSyncFieldChanges {
    return [
        { field: 'title', remoteValue: issue.title, proposedValue: issue.title },
        { field: 'description', remoteValue: parsed.bodyWithoutMetadata, proposedValue: parsed.bodyWithoutMetadata },
        { field: 'type', remoteValue: parsed.type, proposedValue: parsed.type ?? 'work-item' },
        { field: 'status', remoteValue: parsed.status, proposedValue: parsed.status ?? (issue.state === 'closed' ? 'done' : 'created') },
        { field: 'priority', remoteValue: parsed.priority, proposedValue: parsed.priority ?? 'normal' },
        { field: 'tags', remoteValue: parsed.tags, proposedValue: parsed.tags },
        { field: 'parentId', remoteValue: parsed.metadata?.parent, proposedValue: parsed.metadata?.parent?.workItemId },
    ];
}

function changedLocalFields(item: WorkItem, issue: GitHubWorkItemIssue, parsed: ParsedGitHubWorkItemIssue): WorkItemSyncFieldChanges {
    const fields: WorkItemSyncFieldChanges = [];
    const remoteType = parsed.type ?? 'work-item';
    const remoteStatus = parsed.status ?? (issue.state === 'closed' ? 'done' : 'created');
    const remotePriority = parsed.priority ?? 'normal';
    if (item.title !== issue.title) fields.push({ field: 'title', cocValue: item.title, remoteValue: issue.title, proposedValue: issue.title });
    if ((item.description ?? '') !== parsed.bodyWithoutMetadata) fields.push({ field: 'description', cocValue: item.description ?? '', remoteValue: parsed.bodyWithoutMetadata, proposedValue: parsed.bodyWithoutMetadata });
    if (getEffectiveType(item.type) !== remoteType) fields.push({ field: 'type', cocValue: getEffectiveType(item.type), remoteValue: remoteType, proposedValue: remoteType });
    if (item.status !== remoteStatus) fields.push({ field: 'status', cocValue: item.status, remoteValue: remoteStatus, proposedValue: remoteStatus });
    if ((item.priority ?? 'normal') !== remotePriority) fields.push({ field: 'priority', cocValue: item.priority ?? 'normal', remoteValue: remotePriority, proposedValue: remotePriority });
    if (JSON.stringify(item.tags ?? []) !== JSON.stringify(parsed.tags)) fields.push({ field: 'tags', cocValue: item.tags ?? [], remoteValue: parsed.tags, proposedValue: parsed.tags });
    return fields;
}

function changedRemoteFields(item: WorkItem, issue: GitHubWorkItemIssue, parsed: ParsedGitHubWorkItemIssue): WorkItemSyncFieldChanges {
    const fields: WorkItemSyncFieldChanges = [];
    const localType = getEffectiveType(item.type);
    if (issue.title !== item.title) fields.push({ field: 'title', cocValue: item.title, remoteValue: issue.title, proposedValue: item.title });
    if (parsed.type !== localType) fields.push({ field: 'type', cocValue: localType, remoteValue: parsed.type, proposedValue: localType });
    if (parsed.status !== item.status) fields.push({ field: 'status', cocValue: item.status, remoteValue: parsed.status, proposedValue: item.status });
    if ((parsed.priority ?? 'normal') !== (item.priority ?? 'normal')) fields.push({ field: 'priority', cocValue: item.priority ?? 'normal', remoteValue: parsed.priority ?? 'normal', proposedValue: item.priority ?? 'normal' });
    if (JSON.stringify(parsed.tags) !== JSON.stringify(item.tags ?? [])) fields.push({ field: 'tags', cocValue: item.tags ?? [], remoteValue: parsed.tags, proposedValue: item.tags ?? [] });
    return fields;
}

function conflictForItem(
    item: WorkItem,
    issue: GitHubWorkItemIssue,
    parsed: ParsedGitHubWorkItemIssue,
    remote: WorkItemSyncRemoteIdentity,
): WorkItemSyncConflict | undefined {
    const fields = changedLocalFields(item, issue, parsed);
    if (fields.length === 0) return undefined;
    return {
        id: `conflict-${item.id}`,
        message: `Work item '${item.title}' and GitHub issue #${issue.number} both changed since the last sync.`,
        workItemId: item.id,
        remote,
        fields,
        allowedResolutions: ['use-coc', 'use-provider', 'skip'],
    };
}

function orderParentFirst(items: readonly WorkItem[]): WorkItem[] {
    const byId = new Map(items.map(item => [item.id, item]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ordered: WorkItem[] = [];

    function visit(item: WorkItem): void {
        if (visited.has(item.id)) return;
        if (visiting.has(item.id)) return;
        visiting.add(item.id);
        const parent = item.parentId ? byId.get(item.parentId) : undefined;
        if (parent) visit(parent);
        visiting.delete(item.id);
        visited.add(item.id);
        ordered.push(item);
    }

    for (const item of items) visit(item);
    return ordered;
}

function parentWarnings(items: readonly WorkItem[]): WorkItemSyncWarning[] {
    const byId = new Map(items.map(item => [item.id, item]));
    const warnings: WorkItemSyncWarning[] = [];
    for (const item of items) {
        const type = getEffectiveType(item.type);
        if (!item.parentId && ALLOWED_PARENT_TYPES[type].length > 0) {
            warnings.push({
                id: `missing-parent-${item.id}`,
                message: `${type} item '${item.title}' has no parent; export will preserve it as unparented metadata until a parent is linked.`,
                workItemId: item.id,
                severity: 'warning',
            });
            continue;
        }
        if (!item.parentId) continue;
        const parent = byId.get(item.parentId);
        if (!parent) continue;
        const parentType = getEffectiveType(parent.type);
        if (!isValidParentChildTypes(type, parentType)) {
            warnings.push({
                id: `invalid-parent-${item.id}`,
                message: `${type} item '${item.title}' cannot be parented by ${parentType} item '${parent.title}'.`,
                workItemId: item.id,
                severity: 'warning',
            });
        }
    }
    return warnings;
}

async function loadLocalEntries(context: WorkItemSyncProviderContext): Promise<WorkItemIndexEntry[]> {
    return (await context.workItemStore.listWorkItems({ repoId: context.workspaceId })).items;
}

async function findLocalForIssue(
    context: WorkItemSyncProviderContext,
    repo: AvailableGitHubWorkItemSyncRepo,
    issue: GitHubWorkItemIssue,
    parsed: ParsedGitHubWorkItemIssue,
): Promise<WorkItem | undefined> {
    if (parsed.metadata?.workItemId) {
        const item = await context.workItemStore.getWorkItem(parsed.metadata.workItemId, context.workspaceId);
        if (item) return item;
    }

    for (const entry of await loadLocalEntries(context)) {
        if (entry.syncLinks?.some(link => sameRemote(link, repo, issue))) {
            return context.workItemStore.getWorkItem(entry.id, context.workspaceId);
        }
    }
    return undefined;
}

function hasGithubSyncLink(item: WorkItem, repo: AvailableGitHubWorkItemSyncRepo, issue: GitHubWorkItemIssue): boolean {
    return item.syncLinks?.some(link => sameRemote(link, repo, issue)) ?? false;
}

function shouldImportIssue(parsed: ParsedGitHubWorkItemIssue): boolean {
    return parsed.metadata !== undefined
        || parsed.type !== undefined
        || parsed.status !== undefined
        || parsed.priority !== undefined
        || parsed.unknownCocLabels.length > 0;
}

function warningForUnknownLabels(issue: GitHubWorkItemIssue, parsed: ParsedGitHubWorkItemIssue, repo: AvailableGitHubWorkItemSyncRepo): WorkItemSyncWarning[] {
    if (parsed.unknownCocLabels.length === 0) return [];
    return [{
        id: `unknown-coc-labels-${issue.number}`,
        message: `GitHub issue #${issue.number} has unknown coc: labels: ${parsed.unknownCocLabels.join(', ')}.`,
        remote: remoteIdentity(repo, issue),
        severity: 'warning',
    }];
}

function parentImportWarnings(issue: GitHubWorkItemIssue, parsed: ParsedGitHubWorkItemIssue, parentItem: WorkItem | undefined, repo: AvailableGitHubWorkItemSyncRepo): WorkItemSyncWarning[] {
    const type = parsed.type ?? 'work-item';
    const warnings: WorkItemSyncWarning[] = [];
    if (!parsed.metadata?.parent && ALLOWED_PARENT_TYPES[type].length > 0) {
        warnings.push({
            id: `missing-import-parent-${issue.number}`,
            message: `GitHub issue #${issue.number} is a ${type} without parent metadata; it will preview as unparented.`,
            remote: remoteIdentity(repo, issue),
            severity: 'warning',
        });
    }
    if (parsed.metadata?.parent && !parentItem) {
        warnings.push({
            id: `unresolved-import-parent-${issue.number}`,
            message: `GitHub issue #${issue.number} references a parent that is not linked locally; it will preview as unparented.`,
            remote: remoteIdentity(repo, issue),
            severity: 'warning',
        });
    }
    if (parentItem && !isValidParentChildTypes(type, getEffectiveType(parentItem.type))) {
        warnings.push({
            id: `invalid-import-parent-${issue.number}`,
            message: `GitHub issue #${issue.number} has parent metadata that would violate the CoC hierarchy type rules.`,
            remote: remoteIdentity(repo, issue),
            workItemId: parentItem.id,
            severity: 'warning',
        });
    }
    return warnings;
}

async function resolveMetadataParent(
    context: WorkItemSyncProviderContext,
    repo: AvailableGitHubWorkItemSyncRepo,
    parent: WorkItemSyncParentReference | undefined,
): Promise<WorkItem | undefined> {
    if (!parent) return undefined;
    if (parent.workItemId) {
        const item = await context.workItemStore.getWorkItem(parent.workItemId, context.workspaceId);
        if (item) return item;
    }
    for (const entry of await loadLocalEntries(context)) {
        const link = entry.syncLinks?.find(candidate => {
            if (candidate.provider !== 'github') return false;
            if (candidate.remote.owner && candidate.remote.owner !== (parent.owner ?? repo.owner)) return false;
            if (candidate.remote.repo && candidate.remote.repo !== (parent.repo ?? repo.repo)) return false;
            return (parent.issueNumber !== undefined && candidate.remote.issueNumber === parent.issueNumber)
                || (parent.issueId !== undefined && candidate.remote.issueId === parent.issueId);
        });
        if (link) return context.workItemStore.getWorkItem(entry.id, context.workspaceId);
    }
    return undefined;
}

async function loadImportIssues(
    transport: GitHubWorkItemIssueTransport,
    repo: AvailableGitHubWorkItemSyncRepo,
    filters: WorkItemSyncRemoteFilter | undefined,
): Promise<{ issues: GitHubWorkItemIssue[]; warnings: WorkItemSyncWarning[] }> {
    const warnings: WorkItemSyncWarning[] = [];
    if (filters?.issueNumbers?.length) {
        const issues: GitHubWorkItemIssue[] = [];
        for (const issueNumber of filters.issueNumbers) {
            const issue = await transport.getIssue(repo, issueNumber);
            if (issue) {
                issues.push(issue);
            } else {
                warnings.push({
                    id: `missing-remote-${issueNumber}`,
                    message: `GitHub issue #${issueNumber} was not found or is inaccessible.`,
                    remote: { owner: repo.owner, repo: repo.repo, issueNumber },
                    severity: 'warning',
                });
            }
        }
        return { issues, warnings };
    }

    const issues = await transport.listIssues(repo, {
        ...filters,
        limit: WORK_ITEM_SYNC_MAX_ITEMS,
    });
    return {
        issues: issues.filter(issue => shouldImportIssue(parseGitHubWorkItemIssue(issue))),
        warnings,
    };
}

function conflictResolutionMap(context: WorkItemSyncProviderApplyContext): Map<string, WorkItemSyncConflictResolution> {
    return new Map((context.request.conflictResolutions ?? []).map(entry => [entry.conflictId, entry.resolution]));
}

function makePreviewBase(context: WorkItemSyncProviderPreviewContext, providerNow: string, previewId: string): WorkItemSyncPreviewResponse {
    return {
        provider: 'github',
        operation: context.operation,
        previewId,
        generatedAt: providerNow,
        itemCount: 0,
        maxItems: WORK_ITEM_SYNC_MAX_ITEMS,
        creates: [],
        updates: [],
        links: [],
        noOps: [],
        warnings: [],
        conflicts: [],
    };
}

function makeApplyBase(context: WorkItemSyncProviderApplyContext): WorkItemSyncApplyResponse {
    return {
        provider: 'github',
        operation: context.operation,
        applied: 0,
        skipped: 0,
        failed: 0,
        rows: [],
        warnings: [],
        conflicts: [],
    };
}

function rowRemoteOperationInput(
    item: WorkItem,
    repo: AvailableGitHubWorkItemSyncRepo,
    issue: GitHubWorkItemIssue | undefined,
    parent: WorkItemSyncParentReference | undefined,
    syncedAt: string,
): GitHubWorkItemIssueUpdateInput {
    const update = buildGitHubWorkItemIssueUpdate({
        workItem: item,
        remote: {
            owner: repo.owner,
            repo: repo.repo,
            issueId: issue?.id !== undefined ? String(issue.id) : undefined,
            issueNumber: issue?.number,
            issueUrl: issue?.htmlUrl ?? issue?.url,
        },
        lastSyncedAt: syncedAt,
        parent,
        existingIssue: issue,
    });
    return {
        title: item.title,
        body: update.body,
        labels: update.labels,
        state: githubIssueStateForWorkItem(item),
    };
}

function rowFailureMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown sync apply failure';
}

function upsertGithubSyncLink(
    item: WorkItem,
    repo: AvailableGitHubWorkItemSyncRepo,
    issue: GitHubWorkItemIssue,
    syncedAt: string,
    fingerprint: string,
    parent: WorkItemSyncParentReference | undefined,
): WorkItemSyncLink[] {
    const nextLink: WorkItemSyncLink = {
        provider: 'github',
        remote: remoteIdentity(repo, issue),
        remoteRevision: issue.id !== undefined ? String(issue.id) : undefined,
        remoteUpdatedAt: issue.updatedAt,
        lastSyncedAt: syncedAt,
        lastSyncedFingerprint: fingerprint,
        dirty: false,
        conflict: false,
        parent,
    };
    return [
        ...(item.syncLinks ?? []).filter(link => link.provider !== 'github'),
        nextLink,
    ];
}

async function parentReferenceForItem(
    context: WorkItemSyncProviderContext,
    repo: AvailableGitHubWorkItemSyncRepo,
    item: WorkItem,
    localItems: Map<string, WorkItem>,
): Promise<WorkItemSyncParentReference | undefined> {
    if (!item.parentId) return undefined;
    const parent = localItems.get(item.parentId)
        ?? await context.workItemStore.getWorkItem(item.parentId, context.workspaceId);
    const parentLink = parent ? getGithubSyncLink(parent) : undefined;
    const reference: WorkItemSyncParentReference = { workItemId: item.parentId };
    if (parentLink?.remote.issueId) reference.issueId = parentLink.remote.issueId;
    if (parentLink?.remote.issueNumber !== undefined) reference.issueNumber = parentLink.remote.issueNumber;
    if (parentLink?.remote.issueUrl) reference.issueUrl = parentLink.remote.issueUrl;
    reference.owner = parentLink?.remote.owner ?? repo.owner;
    reference.repo = parentLink?.remote.repo ?? repo.repo;
    return reference;
}

async function wouldCreateParentCycle(context: WorkItemSyncProviderContext, itemId: string, parentId: string): Promise<boolean> {
    const seen = new Set<string>();
    let cursor: string | undefined = parentId;
    while (cursor) {
        if (cursor === itemId) return true;
        if (seen.has(cursor)) return true;
        seen.add(cursor);
        const parent = await context.workItemStore.getWorkItem(cursor, context.workspaceId);
        cursor = parent?.parentId;
    }
    return false;
}

async function validMetadataParentId(
    context: WorkItemSyncProviderContext,
    repo: AvailableGitHubWorkItemSyncRepo,
    parsed: ParsedGitHubWorkItemIssue,
    childType: WorkItem['type'],
    itemId?: string,
): Promise<string | undefined> {
    const parentItem = await resolveMetadataParent(context, repo, parsed.metadata?.parent);
    if (!parentItem) return undefined;
    if (!isValidParentChildTypes(getEffectiveType(childType), getEffectiveType(parentItem.type))) return undefined;
    if (itemId && await wouldCreateParentCycle(context, itemId, parentItem.id)) return undefined;
    return parentItem.id;
}

async function applyCreateLocalIssue(
    context: WorkItemSyncProviderApplyContext,
    repo: AvailableGitHubWorkItemSyncRepo,
    issue: GitHubWorkItemIssue,
    syncedAt: string,
): Promise<WorkItem> {
    const parsed = parseGitHubWorkItemIssue(issue);
    const desiredId = parsed.metadata?.workItemId;
    const existing = desiredId ? await context.workItemStore.getWorkItem(desiredId, context.workspaceId) : undefined;
    const id = existing ? crypto.randomUUID() : desiredId ?? crypto.randomUUID();
    const type = parsed.type ?? 'work-item';
    const parentId = await validMetadataParentId(context, repo, parsed, type, id);
    const item: WorkItem = {
        id,
        repoId: context.workspaceId,
        title: issue.title,
        description: parsed.bodyWithoutMetadata,
        status: remoteStatus(issue, parsed),
        type,
        parentId,
        createdAt: syncedAt,
        updatedAt: syncedAt,
        source: 'manual',
        priority: remotePriority(parsed),
        tags: parsed.tags,
    };
    item.syncLinks = upsertGithubSyncLink(
        item,
        repo,
        issue,
        syncedAt,
        syncFingerprintForWorkItem(item),
        parsed.metadata?.parent,
    );
    await context.workItemStore.addWorkItem(item);
    return item;
}

async function applyLocalIssueUpdate(
    context: WorkItemSyncProviderApplyContext,
    repo: AvailableGitHubWorkItemSyncRepo,
    item: WorkItem,
    issue: GitHubWorkItemIssue,
    syncedAt: string,
): Promise<WorkItem | undefined> {
    const parsed = parseGitHubWorkItemIssue(issue);
    const type = parsed.type ?? 'work-item';
    const parentId = parsed.metadata?.parent
        ? await validMetadataParentId(context, repo, parsed, type, item.id)
        : item.parentId;
    const nextItem: WorkItem = {
        ...item,
        title: issue.title,
        description: parsed.bodyWithoutMetadata,
        type,
        status: remoteStatus(issue, parsed),
        priority: remotePriority(parsed),
        tags: parsed.tags,
        parentId,
    };
    const syncLinks = upsertGithubSyncLink(
        nextItem,
        repo,
        issue,
        syncedAt,
        syncFingerprintForWorkItem(nextItem),
        parsed.metadata?.parent,
    );
    return context.workItemStore.updateWorkItem(item.id, {
        title: nextItem.title,
        description: nextItem.description,
        type: nextItem.type,
        status: nextItem.status,
        priority: nextItem.priority,
        tags: nextItem.tags,
        parentId: nextItem.parentId,
        syncLinks,
    });
}

async function applyGithubLinkOnly(
    context: WorkItemSyncProviderApplyContext,
    repo: AvailableGitHubWorkItemSyncRepo,
    item: WorkItem,
    issue: GitHubWorkItemIssue,
    syncedAt: string,
): Promise<WorkItem | undefined> {
    const parsed = parseGitHubWorkItemIssue(issue);
    const syncLinks = upsertGithubSyncLink(
        item,
        repo,
        issue,
        syncedAt,
        syncFingerprintForIssue(issue, parsed, item.parentId),
        parsed.metadata?.parent,
    );
    return context.workItemStore.updateWorkItem(item.id, { syncLinks });
}

async function applyRemoteIssueCreate(
    context: WorkItemSyncProviderApplyContext,
    repo: AvailableGitHubWorkItemSyncRepo,
    transport: GitHubWorkItemIssueTransport,
    item: WorkItem,
    localItems: Map<string, WorkItem>,
    syncedAt: string,
): Promise<GitHubWorkItemIssue> {
    const parent = await parentReferenceForItem(context, repo, item, localItems);
    const initialInput = rowRemoteOperationInput(item, repo, undefined, parent, syncedAt);
    const created = await transport.createIssue(repo, {
        title: initialInput.title,
        body: initialInput.body,
        labels: initialInput.labels,
    });
    const completeInput = rowRemoteOperationInput(item, repo, created, parent, syncedAt);
    const updated = await transport.updateIssue(repo, created.number, completeInput);
    const updatedItem = await context.workItemStore.updateWorkItem(item.id, {
        syncLinks: upsertGithubSyncLink(item, repo, updated, syncedAt, syncFingerprintForWorkItem(item), parent),
    });
    if (updatedItem) localItems.set(updatedItem.id, updatedItem);
    return updated;
}

async function applyRemoteIssueUpdate(
    context: WorkItemSyncProviderApplyContext,
    repo: AvailableGitHubWorkItemSyncRepo,
    transport: GitHubWorkItemIssueTransport,
    item: WorkItem,
    issue: GitHubWorkItemIssue,
    localItems: Map<string, WorkItem>,
    syncedAt: string,
): Promise<GitHubWorkItemIssue> {
    const parent = await parentReferenceForItem(context, repo, item, localItems);
    const input = rowRemoteOperationInput(item, repo, issue, parent, syncedAt);
    const updated = await transport.updateIssue(repo, issue.number, input);
    const updatedItem = await context.workItemStore.updateWorkItem(item.id, {
        syncLinks: upsertGithubSyncLink(item, repo, updated, syncedAt, syncFingerprintForWorkItem(item), parent),
    });
    if (updatedItem) localItems.set(updatedItem.id, updatedItem);
    return updated;
}

export function createGitHubWorkItemSyncProviderAdapter(options: CreateGitHubWorkItemSyncProviderOptions = {}): WorkItemSyncProviderAdapter {
    const transport = options.transport ?? new GhCliGitHubWorkItemIssueTransport();
    const now = options.now ?? (() => new Date().toISOString());
    const createPreviewId = options.createPreviewId ?? ((operation: WorkItemSyncProviderPreviewContext['operation']) => `github-${operation}-${Date.now()}`);

    async function getAvailableRepo(context: WorkItemSyncProviderContext): Promise<AvailableGitHubWorkItemSyncRepo | undefined> {
        const repo = resolveRepo(context);
        return repo.available ? repo : undefined;
    }

    async function previewImport(context: WorkItemSyncProviderPreviewContext, repo: AvailableGitHubWorkItemSyncRepo, response: WorkItemSyncPreviewResponse): Promise<WorkItemSyncPreviewResponse> {
        const { issues, warnings } = await loadImportIssues(transport, repo, context.request.filters);
        response.warnings.push(...warnings);
        response.itemCount = issues.length;

        for (const issue of issues) {
            const parsed = parseGitHubWorkItemIssue(issue);
            response.warnings.push(...warningForUnknownLabels(issue, parsed, repo));
            const parentItem = await resolveMetadataParent(context, repo, parsed.metadata?.parent);
            response.warnings.push(...parentImportWarnings(issue, parsed, parentItem, repo));
            const local = await findLocalForIssue(context, repo, issue, parsed);
            const remote = remoteIdentity(repo, issue);

            if (!local) {
                response.creates.push({
                    id: `create-local-${issue.number}`,
                    kind: 'create-local',
                    title: issue.title,
                    remote,
                    itemType: parsed.type ?? 'work-item',
                    status: parsed.status ?? (issue.state === 'closed' ? 'done' : 'created'),
                    fields: fieldsForRemoteDraft(issue, parsed),
                });
                continue;
            }

            const fields = changedLocalFields(local, issue, parsed);
            if (fields.length > 0) {
                response.updates.push({
                    id: `update-local-${local.id}`,
                    kind: 'update-local',
                    title: issue.title,
                    workItemId: local.id,
                    remote,
                    itemType: parsed.type ?? getEffectiveType(local.type),
                    status: parsed.status ?? local.status,
                    fields,
                });
            } else if (!hasGithubSyncLink(local, repo, issue)) {
                response.links.push({
                    id: `link-${local.id}-${issue.number}`,
                    kind: 'link',
                    title: issue.title,
                    workItemId: local.id,
                    remote,
                    itemType: getEffectiveType(local.type),
                    status: local.status,
                    fields: [{ field: 'syncLinks', remoteValue: remote, proposedValue: remote }],
                });
            } else {
                response.noOps.push({
                    id: `noop-${local.id}`,
                    kind: 'noop',
                    title: local.title,
                    workItemId: local.id,
                    remote,
                    itemType: getEffectiveType(local.type),
                    status: local.status,
                });
            }
        }
        return response;
    }

    async function previewExport(context: WorkItemSyncProviderPreviewContext, repo: AvailableGitHubWorkItemSyncRepo, response: WorkItemSyncPreviewResponse): Promise<WorkItemSyncPreviewResponse> {
        const items = orderParentFirst(context.items);
        response.itemCount = items.length;
        response.warnings.push(...parentWarnings(items));

        for (const item of items) {
            const link = getGithubSyncLink(item);
            const issue = link?.remote.issueNumber
                ? await transport.getIssue(repo, link.remote.issueNumber)
                : undefined;
            const remote = remoteIdentity(repo, issue, link);

            if (!link) {
                response.creates.push({
                    id: `create-remote-${item.id}`,
                    kind: 'create-remote',
                    title: item.title,
                    workItemId: item.id,
                    remote,
                    itemType: getEffectiveType(item.type),
                    status: item.status,
                    fields: [
                        { field: 'title', cocValue: item.title, proposedValue: item.title },
                        { field: 'type', cocValue: getEffectiveType(item.type), proposedValue: getEffectiveType(item.type) },
                        { field: 'status', cocValue: item.status, proposedValue: item.status },
                        { field: 'priority', cocValue: item.priority ?? 'normal', proposedValue: item.priority ?? 'normal' },
                        { field: 'parentId', cocValue: item.parentId, proposedValue: item.parentId },
                    ],
                });
                continue;
            }

            if (!issue) {
                response.warnings.push({
                    id: `missing-linked-remote-${item.id}`,
                    message: `Linked GitHub issue for '${item.title}' was not found or is inaccessible.`,
                    workItemId: item.id,
                    remote,
                    severity: 'warning',
                });
                continue;
            }

            const parsed = parseGitHubWorkItemIssue(issue);
            const update = buildGitHubWorkItemIssueUpdate({
                workItem: item,
                remote: {
                    owner: repo.owner,
                    repo: repo.repo,
                    issueId: remote.issueId,
                    issueNumber: remote.issueNumber,
                    issueUrl: remote.issueUrl,
                },
                lastSyncedAt: now(),
                existingIssue: issue,
            });
            const fields = changedRemoteFields(item, issue, parsed);
            if (fields.length > 0 || !update.metadata.parent && item.parentId) {
                response.updates.push({
                    id: `update-remote-${item.id}`,
                    kind: 'update-remote',
                    title: item.title,
                    workItemId: item.id,
                    remote,
                    itemType: getEffectiveType(item.type),
                    status: item.status,
                    fields,
                });
            } else {
                response.noOps.push({
                    id: `noop-${item.id}`,
                    kind: 'noop',
                    title: item.title,
                    workItemId: item.id,
                    remote,
                    itemType: getEffectiveType(item.type),
                    status: item.status,
                });
            }
        }
        return response;
    }

    async function previewSyncLinked(context: WorkItemSyncProviderPreviewContext, repo: AvailableGitHubWorkItemSyncRepo, response: WorkItemSyncPreviewResponse): Promise<WorkItemSyncPreviewResponse> {
        response.itemCount = context.items.length;
        for (const item of orderParentFirst(context.items)) {
            const link = getGithubSyncLink(item);
            const issue = link?.remote.issueNumber
                ? await transport.getIssue(repo, link.remote.issueNumber)
                : undefined;
            const remote = remoteIdentity(repo, issue, link);
            if (!link || !issue) {
                response.warnings.push({
                    id: `missing-sync-remote-${item.id}`,
                    message: `Linked GitHub issue for '${item.title}' was not found or is inaccessible.`,
                    workItemId: item.id,
                    remote,
                    severity: 'warning',
                });
                continue;
            }

            const parsed = parseGitHubWorkItemIssue(issue);
            const remoteChanged = remoteChangedSinceLastSync(issue, link);
            const localChanged = localChangedSinceLastSync(item, link);
            if (remoteChanged && !localChanged) {
                const fields = changedLocalFields(item, issue, parsed);
                if (fields.length > 0) {
                    response.updates.push({
                        id: `update-local-${item.id}`,
                        kind: 'update-local',
                        title: issue.title,
                        workItemId: item.id,
                        remote,
                        itemType: parsed.type ?? getEffectiveType(item.type),
                        status: parsed.status ?? item.status,
                        fields,
                    });
                } else {
                    response.noOps.push({
                        id: `noop-${item.id}`,
                        kind: 'noop',
                        title: item.title,
                        workItemId: item.id,
                        remote,
                        itemType: getEffectiveType(item.type),
                        status: item.status,
                    });
                }
            } else if (localChanged && !remoteChanged) {
                const fields = changedRemoteFields(item, issue, parsed);
                if (fields.length > 0) {
                    response.updates.push({
                        id: `update-remote-${item.id}`,
                        kind: 'update-remote',
                        title: item.title,
                        workItemId: item.id,
                        remote,
                        itemType: getEffectiveType(item.type),
                        status: item.status,
                        fields,
                    });
                } else {
                    response.noOps.push({
                        id: `noop-${item.id}`,
                        kind: 'noop',
                        title: item.title,
                        workItemId: item.id,
                        remote,
                        itemType: getEffectiveType(item.type),
                        status: item.status,
                    });
                }
            } else if (remoteChanged && localChanged) {
                const conflict = conflictForItem(item, issue, parsed, remote);
                if (conflict) {
                    response.conflicts.push(conflict);
                } else {
                    response.noOps.push({
                        id: `noop-${item.id}`,
                        kind: 'noop',
                        title: item.title,
                        workItemId: item.id,
                        remote,
                        itemType: getEffectiveType(item.type),
                        status: item.status,
                    });
                }
            } else {
                response.noOps.push({
                    id: `noop-${item.id}`,
                    kind: 'noop',
                    title: item.title,
                    workItemId: item.id,
                    remote,
                    itemType: getEffectiveType(item.type),
                    status: item.status,
                });
            }
        }
        return response;
    }

    async function previewForApply(context: WorkItemSyncProviderApplyContext, repo: AvailableGitHubWorkItemSyncRepo, syncedAt: string): Promise<WorkItemSyncPreviewResponse> {
        const previewContext: WorkItemSyncProviderPreviewContext = {
            ...context,
            request: context.request,
        };
        const response = makePreviewBase(
            previewContext,
            syncedAt,
            context.request.previewId ?? createPreviewId(context.operation),
        );
        if (context.operation === 'import') return previewImport(previewContext, repo, response);
        if (context.operation === 'export-selected') return previewExport(previewContext, repo, response);
        return previewSyncLinked(previewContext, repo, response);
    }

    async function requireLocalItem(context: WorkItemSyncProviderApplyContext, operation: WorkItemSyncPreviewOperation): Promise<WorkItem> {
        const workItemId = operation.workItemId;
        if (!workItemId) throw new Error(`Sync operation '${operation.id}' is missing a work item id.`);
        const item = context.items.find(candidate => candidate.id === workItemId)
            ?? await context.workItemStore.getWorkItem(workItemId, context.workspaceId);
        if (!item) throw new Error(`Work item '${workItemId}' was not found.`);
        return item;
    }

    async function requireRemoteIssue(repo: AvailableGitHubWorkItemSyncRepo, operation: Pick<WorkItemSyncPreviewOperation | WorkItemSyncConflict, 'id' | 'remote'>): Promise<GitHubWorkItemIssue> {
        const issueNumber = operation.remote?.issueNumber;
        if (issueNumber === undefined) throw new Error(`Sync operation '${operation.id}' is missing a GitHub issue number.`);
        const issue = await transport.getIssue(repo, issueNumber);
        if (!issue) throw new Error(`GitHub issue #${issueNumber} was not found or is inaccessible.`);
        return issue;
    }

    async function applyPreviewOperation(
        context: WorkItemSyncProviderApplyContext,
        repo: AvailableGitHubWorkItemSyncRepo,
        result: WorkItemSyncApplyResponse,
        operation: WorkItemSyncPreviewOperation,
        localItems: Map<string, WorkItem>,
        syncedAt: string,
    ): Promise<void> {
        try {
            if (operation.kind === 'create-local') {
                const issue = await requireRemoteIssue(repo, operation);
                const item = await applyCreateLocalIssue(context, repo, issue, syncedAt);
                localItems.set(item.id, item);
                result.rows.push({
                    id: `applied-${operation.id}`,
                    status: 'applied',
                    operationId: operation.id,
                    workItemId: item.id,
                    remote: operation.remote,
                });
                return;
            }

            if (operation.kind === 'update-local') {
                const item = await requireLocalItem(context, operation);
                const issue = await requireRemoteIssue(repo, operation);
                const updated = await applyLocalIssueUpdate(context, repo, item, issue, syncedAt);
                if (updated) localItems.set(updated.id, updated);
                result.rows.push({
                    id: `applied-${operation.id}`,
                    status: 'applied',
                    operationId: operation.id,
                    workItemId: item.id,
                    remote: operation.remote,
                });
                return;
            }

            if (operation.kind === 'link') {
                const item = await requireLocalItem(context, operation);
                const issue = await requireRemoteIssue(repo, operation);
                const updated = await applyGithubLinkOnly(context, repo, item, issue, syncedAt);
                if (updated) localItems.set(updated.id, updated);
                result.rows.push({
                    id: `applied-${operation.id}`,
                    status: 'applied',
                    operationId: operation.id,
                    workItemId: item.id,
                    remote: operation.remote,
                });
                return;
            }

            if (operation.kind === 'create-remote') {
                const item = await requireLocalItem(context, operation);
                const issue = await applyRemoteIssueCreate(context, repo, transport, item, localItems, syncedAt);
                result.rows.push({
                    id: `applied-${operation.id}`,
                    status: 'applied',
                    operationId: operation.id,
                    workItemId: item.id,
                    remote: remoteIdentity(repo, issue),
                });
                return;
            }

            if (operation.kind === 'update-remote') {
                const item = await requireLocalItem(context, operation);
                const issue = await requireRemoteIssue(repo, operation);
                const updated = await applyRemoteIssueUpdate(context, repo, transport, item, issue, localItems, syncedAt);
                result.rows.push({
                    id: `applied-${operation.id}`,
                    status: 'applied',
                    operationId: operation.id,
                    workItemId: item.id,
                    remote: remoteIdentity(repo, updated),
                });
                return;
            }

            result.rows.push({
                id: `skipped-${operation.id}`,
                status: 'skipped',
                operationId: operation.id,
                workItemId: operation.workItemId,
                remote: operation.remote,
                message: 'No changes to apply.',
            });
        } catch (error) {
            result.rows.push({
                id: `failed-${operation.id}`,
                status: 'failed',
                operationId: operation.id,
                workItemId: operation.workItemId,
                remote: operation.remote,
                message: rowFailureMessage(error),
            });
        }
    }

    async function applyConflict(
        context: WorkItemSyncProviderApplyContext,
        repo: AvailableGitHubWorkItemSyncRepo,
        result: WorkItemSyncApplyResponse,
        conflict: WorkItemSyncConflict,
        resolution: WorkItemSyncConflictResolution | undefined,
        localItems: Map<string, WorkItem>,
        syncedAt: string,
    ): Promise<void> {
        if (!resolution) {
            result.conflicts.push(conflict);
            result.rows.push({
                id: `skipped-${conflict.id}`,
                status: 'skipped',
                operationId: conflict.id,
                workItemId: conflict.workItemId,
                remote: conflict.remote,
                message: 'Conflict was not resolved.',
            });
            return;
        }
        if (resolution === 'skip') {
            result.rows.push({
                id: `skipped-${conflict.id}`,
                status: 'skipped',
                operationId: conflict.id,
                workItemId: conflict.workItemId,
                remote: conflict.remote,
                message: 'Conflict skipped by user.',
            });
            return;
        }

        try {
            const operation: WorkItemSyncPreviewOperation = {
                id: conflict.id,
                kind: resolution === 'use-coc' ? 'update-remote' : 'update-local',
                title: conflict.message,
                workItemId: conflict.workItemId,
                remote: conflict.remote,
                fields: conflict.fields,
            };
            await applyPreviewOperation(context, repo, result, operation, localItems, syncedAt);
        } catch (error) {
            result.rows.push({
                id: `failed-${conflict.id}`,
                status: 'failed',
                operationId: conflict.id,
                workItemId: conflict.workItemId,
                remote: conflict.remote,
                message: rowFailureMessage(error),
            });
        }
    }

    async function applyGitHubSync(context: WorkItemSyncProviderApplyContext): Promise<WorkItemSyncApplyResponse> {
        const result = makeApplyBase(context);
        const repo = await getAvailableRepo(context);
        if (!repo) {
            result.rows.push({
                id: 'failed-github-repo-unavailable',
                status: 'failed',
                message: 'GitHub repository is unavailable; check workspace origin or owner/repo preferences.',
            });
            result.failed = 1;
            return result;
        }

        const syncedAt = now();
        const preview = await previewForApply(context, repo, syncedAt);
        result.warnings.push(...preview.warnings);
        const localItems = new Map(context.items.map(item => [item.id, item]));

        for (const operation of [...preview.creates, ...preview.updates, ...preview.links, ...preview.noOps]) {
            await applyPreviewOperation(context, repo, result, operation, localItems, syncedAt);
        }

        const resolutions = conflictResolutionMap(context);
        for (const conflict of preview.conflicts) {
            await applyConflict(context, repo, result, conflict, resolutions.get(conflict.id), localItems, syncedAt);
        }

        result.applied = result.rows.filter(row => row.status === 'applied').length;
        result.skipped = result.rows.filter(row => row.status === 'skipped').length;
        result.failed = result.rows.filter(row => row.status === 'failed').length;
        return result;
    }

    return {
        provider: 'github',
        async getStatus(context) {
            const repo = resolveRepo(context);
            if (!repo.available) return unavailableRepoStatus(repo);
            try {
                await transport.getRepository(repo);
                return availableRepoStatus(repo);
            } catch {
                return authUnavailableStatus(repo);
            }
        },
        async preview(context) {
            const repo = await getAvailableRepo(context);
            if (!repo) {
                return {
                    ...makePreviewBase(context, now(), createPreviewId(context.operation)),
                    warnings: [{
                        id: 'github-repo-unavailable',
                        message: 'GitHub repository is unavailable; check workspace origin or owner/repo preferences.',
                        severity: 'error',
                    }],
                };
            }

            const response = makePreviewBase(context, now(), createPreviewId(context.operation));
            if (context.operation === 'import') return previewImport(context, repo, response);
            if (context.operation === 'export-selected') return previewExport(context, repo, response);
            return previewSyncLinked(context, repo, response);
        },
        async apply(context) {
            return applyGitHubSync(context);
        },
    };
}
