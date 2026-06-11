import { execFile } from 'child_process';
import * as crypto from 'crypto';
import { promisify } from 'util';
import type { WorkItemSyncProviderStatus } from '@plusplusoneplusplus/coc-client';
import {
    buildGitHubWorkItemIssueUpdate,
    buildGitHubWorkItemLabels,
    buildGitHubWorkItemSyncMetadata,
    parseGitHubWorkItemIssue,
    upsertGitHubWorkItemSyncMetadataBlock,
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
    WorkItemStore,
    WorkItemSyncParentReference,
    WorkItemSyncRemoteIdentity,
    WorkItemType,
} from './types';
import {
    getEffectiveType,
    isTerminalStatus,
    isValidParentChildTypes,
} from './types';
import {
    WORK_ITEM_SYNC_MAX_ITEMS,
    type WorkItemSyncProviderAdapter,
    type WorkItemSyncProviderContext,
} from './work-item-sync-provider';

export type AvailableGitHubWorkItemSyncRepo = Extract<GitHubWorkItemSyncRepo, { available: true }>;
type UnavailableGitHubWorkItemSyncRepo = Exclude<GitHubWorkItemSyncRepo, AvailableGitHubWorkItemSyncRepo>;

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

export interface GitHubWorkItemIssueListFilters {
    labels?: string[];
    q?: string;
    limit?: number;
}

export interface GitHubWorkItemIssueTransport {
    getRepository(repo: AvailableGitHubWorkItemSyncRepo): Promise<void>;
    listIssues(repo: AvailableGitHubWorkItemSyncRepo, filters?: GitHubWorkItemIssueListFilters): Promise<GitHubWorkItemIssue[]>;
    getIssue(repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number): Promise<GitHubWorkItemIssue | undefined>;
    createIssue(repo: AvailableGitHubWorkItemSyncRepo, input: GitHubWorkItemIssueCreateInput): Promise<GitHubWorkItemIssue>;
    updateIssue(repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number, input: GitHubWorkItemIssueUpdateInput): Promise<GitHubWorkItemIssue>;
    setIssueParent?(repo: AvailableGitHubWorkItemSyncRepo, issueNumber: number, parent: WorkItemSyncParentReference): Promise<void>;
}

export interface CreateGitHubWorkItemSyncProviderOptions {
    transport?: GitHubWorkItemIssueTransport;
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

export interface ImportGitHubEpicTreeResult {
    root: WorkItem;
    items: WorkItem[];
    created: number;
    updated: number;
    deleted: number;
    deletedItemIds: string[];
}

export interface ImportGitHubEpicTreeOptions {
    pruneMissing?: boolean;
    /**
     * When true, do not create new local mirrors for closed GitHub issues that
     * have no existing local item. Used by the pull poller so that deleting a
     * closed work item locally is durable and is not undone on the next sync.
     * The Epic root and any issue that still has a local mirror are unaffected.
     */
    skipClosedWithoutLocal?: boolean;
}

export interface CreateGitHubIssueForLocalChildOptions {
    repo: AvailableGitHubWorkItemSyncRepo;
    transport: GitHubWorkItemIssueTransport;
    item: WorkItem;
    parent: WorkItem;
    now?: () => string;
}

export interface CreateGitHubIssueForLocalChildResult {
    issue: GitHubWorkItemIssue;
    githubMirror: NonNullable<WorkItem['githubMirror']>;
}

export interface CreateGitHubIssueForLocalEpicRootOptions {
    repo: AvailableGitHubWorkItemSyncRepo;
    transport: GitHubWorkItemIssueTransport;
    item: WorkItem;
    now?: () => string;
}

export interface UpdateGitHubIssueForLocalMirrorOptions {
    repo: AvailableGitHubWorkItemSyncRepo;
    transport: GitHubWorkItemIssueTransport;
    item: WorkItem;
    issueNumber: number;
    /** Current remote issue snapshot, used to preserve non-CoC labels and prose. */
    existingIssue?: GitHubWorkItemIssue;
    /**
     * Provider-native parent reference to encode in the issue metadata.
     * `null` clears the parent (root Epic), `undefined` derives it from the item's parentId.
     */
    parent?: WorkItemSyncParentReference | null;
    now?: () => string;
}

export interface UpdateGitHubIssueForLocalMirrorResult {
    issue: GitHubWorkItemIssue;
    githubMirror: NonNullable<WorkItem['githubMirror']>;
}

export interface ConvertGitHubEpicTreeTrackerResult {
    root: WorkItem;
    items: WorkItem[];
    remoteCreated: number;
    localUpdated: number;
}

// Resolve child_process.execFile lazily so importing this module has no
// load-time side effects (tests with partial child_process mocks would
// otherwise fail on the export access before any transport is used).
let lazyExecFileAsync: ExecFileAsync | undefined;
const execFileAsync: ExecFileAsync = (file, args, options) => {
    lazyExecFileAsync ??= promisify(execFile) as ExecFileAsync;
    return lazyExecFileAsync(file, args, options);
};

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

function remoteIdentity(repo: AvailableGitHubWorkItemSyncRepo, issue?: GitHubWorkItemIssue): WorkItemSyncRemoteIdentity {
    const remote: WorkItemSyncRemoteIdentity = {
        owner: repo.owner,
        repo: repo.repo,
    };
    const issueId = issue?.id;
    if (issueId !== undefined) remote.issueId = String(issueId);
    const issueNumber = issue?.number;
    if (issueNumber !== undefined) remote.issueNumber = issueNumber;
    const issueUrl = issue?.htmlUrl ?? issue?.url;
    if (issueUrl) remote.issueUrl = issueUrl;
    return remote;
}

function sameGithubMirror(
    mirror: WorkItem['githubMirror'] | undefined,
    issue: Pick<GitHubWorkItemIssue, 'id' | 'number' | 'htmlUrl' | 'url'>,
): boolean {
    if (!mirror) return false;
    if (mirror.issueNumber === issue.number) return true;
    if (mirror.issueId !== undefined && issue.id !== undefined && mirror.issueId === String(issue.id)) return true;
    return Boolean(mirror.issueUrl && (mirror.issueUrl === issue.htmlUrl || mirror.issueUrl === issue.url));
}

function githubMirrorForIssue(issue: GitHubWorkItemIssue, pulledAt: string): NonNullable<WorkItem['githubMirror']> {
    return {
        issueId: issue.id !== undefined ? String(issue.id) : undefined,
        issueNumber: issue.number,
        issueUrl: issue.htmlUrl ?? issue.url,
        state: issue.state,
        updatedAt: issue.updatedAt,
        lastPulledAt: pulledAt,
    };
}

function labelsForNewGitHubMirrorIssue(item: WorkItem): string[] {
    return buildGitHubWorkItemLabels({
        workItem: { ...item, status: 'created' },
    }).filter(label => !label.toLowerCase().startsWith('coc:status:'));
}

export function parentReferenceForGitHubMirrorChild(
    parent: WorkItem,
    repo: AvailableGitHubWorkItemSyncRepo,
): WorkItemSyncParentReference {
    if (!parent.githubMirror?.issueNumber) {
        throw new Error(`Parent work item '${parent.id}' is not mirrored to GitHub.`);
    }
    return {
        workItemId: parent.id,
        issueId: parent.githubMirror.issueId,
        issueNumber: parent.githubMirror.issueNumber,
        issueUrl: parent.githubMirror.issueUrl,
        owner: repo.owner,
        repo: repo.repo,
    };
}

function bodyForNewGitHubMirrorIssue(
    item: WorkItem,
    repo: AvailableGitHubWorkItemSyncRepo,
    parent: WorkItemSyncParentReference | null | undefined,
    syncedAt: string,
    issue?: GitHubWorkItemIssue,
): string {
    const issueRemote = remoteIdentity(repo, issue);
    const metadata = buildGitHubWorkItemSyncMetadata({
        workItem: {
            id: item.id,
            type: item.type,
            status: 'created',
            parentId: item.parentId,
        },
        remote: {
            owner: repo.owner,
            repo: repo.repo,
            issueId: issueRemote.issueId,
            issueNumber: issueRemote.issueNumber,
            issueUrl: issueRemote.issueUrl,
        },
        lastSyncedAt: syncedAt,
        parent,
    });
    return upsertGitHubWorkItemSyncMetadataBlock(item.description ?? '', metadata);
}

export async function createGitHubIssueForLocalChild(
    options: CreateGitHubIssueForLocalChildOptions,
): Promise<CreateGitHubIssueForLocalChildResult> {
    const syncedAt = (options.now ?? (() => new Date().toISOString()))();
    const parent = parentReferenceForGitHubMirrorChild(options.parent, options.repo);
    const labels = labelsForNewGitHubMirrorIssue(options.item);
    const created = await options.transport.createIssue(options.repo, {
        title: options.item.title,
        body: bodyForNewGitHubMirrorIssue(options.item, options.repo, parent, syncedAt),
        labels,
    });
    const updated = await options.transport.updateIssue(options.repo, created.number, {
        title: options.item.title,
        body: bodyForNewGitHubMirrorIssue(options.item, options.repo, parent, syncedAt, created),
        labels,
        state: 'open',
    });
    return {
        issue: updated,
        githubMirror: githubMirrorForIssue(updated, syncedAt),
    };
}

export async function createGitHubIssueForLocalEpicRoot(
    options: CreateGitHubIssueForLocalEpicRootOptions,
): Promise<CreateGitHubIssueForLocalChildResult> {
    const syncedAt = (options.now ?? (() => new Date().toISOString()))();
    const labels = labelsForNewGitHubMirrorIssue(options.item);
    const created = await options.transport.createIssue(options.repo, {
        title: options.item.title,
        body: bodyForNewGitHubMirrorIssue(options.item, options.repo, null, syncedAt),
        labels,
    });
    const updated = await options.transport.updateIssue(options.repo, created.number, {
        title: options.item.title,
        body: bodyForNewGitHubMirrorIssue(options.item, options.repo, null, syncedAt, created),
        labels,
        state: 'open',
    });
    return {
        issue: updated,
        githubMirror: githubMirrorForIssue(updated, syncedAt),
    };
}

/** Map a CoC work-item status to a GitHub issue open/closed state. */
function githubStateForStatus(status: WorkItem['status']): 'open' | 'closed' {
    return isTerminalStatus(status) ? 'closed' : 'open';
}

/**
 * Push provider-owned local edits of an already-mirrored item to its backing
 * GitHub issue, then return the refreshed mirror metadata. This is the GitHub
 * equivalent of {@link updateAzureBoardsWorkItemForLocalMirror}: provider-native
 * fields (title, body, status/state, priority, tags, parent) are written via the
 * existing issue update/metadata helpers so labels and the hidden
 * `coc-work-item-sync` block stay canonical.
 */
export async function updateGitHubIssueForLocalMirror(
    options: UpdateGitHubIssueForLocalMirrorOptions,
): Promise<UpdateGitHubIssueForLocalMirrorResult> {
    const syncedAt = (options.now ?? (() => new Date().toISOString()))();
    // Preserve the remote identity and non-CoC labels from the current issue, but
    // drive the body prose from the local (provider-owned) description so a CoC
    // save overwrites the backing issue body rather than retaining stale remote text.
    const existingIssueForUpdate: GitHubWorkItemIssueSnapshot | undefined = options.existingIssue
        ? { ...options.existingIssue, body: undefined }
        : undefined;
    const update = buildGitHubWorkItemIssueUpdate({
        workItem: options.item,
        remote: {
            owner: options.repo.owner,
            repo: options.repo.repo,
            issueId: options.item.githubMirror?.issueId,
            issueNumber: options.issueNumber,
            issueUrl: options.item.githubMirror?.issueUrl,
        },
        lastSyncedAt: syncedAt,
        parent: options.parent,
        existingIssue: existingIssueForUpdate,
    });
    const updated = await options.transport.updateIssue(options.repo, options.issueNumber, {
        title: options.item.title,
        body: update.body,
        labels: update.labels,
        state: githubStateForStatus(options.item.status),
    });
    return {
        issue: updated,
        githubMirror: githubMirrorForIssue(updated, syncedAt),
    };
}

function metadataParentForIssue(parsed: ParsedGitHubWorkItemIssue): WorkItemSyncParentReference | undefined {
    return parsed.metadata?.parent;
}

function parentOwnerRepoMatches(
    parent: WorkItemSyncParentReference,
    repo: AvailableGitHubWorkItemSyncRepo,
): boolean {
    return (!parent.owner || parent.owner.toLowerCase() === repo.owner.toLowerCase())
        && (!parent.repo || parent.repo.toLowerCase() === repo.repo.toLowerCase());
}

function parentReferenceTargetsIssue(
    parent: WorkItemSyncParentReference | undefined,
    repo: AvailableGitHubWorkItemSyncRepo,
    issue: GitHubWorkItemIssue,
    parsed: ParsedGitHubWorkItemIssue,
): boolean {
    if (!parent || !parentOwnerRepoMatches(parent, repo)) return false;
    if (parent.issueNumber !== undefined && parent.issueNumber === issue.number) return true;
    if (parent.issueId !== undefined && issue.id !== undefined && parent.issueId === String(issue.id)) return true;
    if (parent.issueUrl !== undefined && (parent.issueUrl === issue.htmlUrl || parent.issueUrl === issue.url)) return true;
    return Boolean(parent.workItemId && parsed.metadata?.workItemId === parent.workItemId);
}

function issueMapKey(issue: GitHubWorkItemIssue): string {
    return `number:${issue.number}`;
}

function uniqueIssues(rootIssue: GitHubWorkItemIssue, candidates: readonly GitHubWorkItemIssue[]): GitHubWorkItemIssue[] {
    const result: GitHubWorkItemIssue[] = [];
    const seen = new Set<string>();
    for (const issue of [rootIssue, ...candidates]) {
        const key = issueMapKey(issue);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(issue);
    }
    return result;
}

function collectGitHubEpicTreeIssues(
    repo: AvailableGitHubWorkItemSyncRepo,
    rootIssue: GitHubWorkItemIssue,
    candidates: readonly GitHubWorkItemIssue[],
): Array<{ issue: GitHubWorkItemIssue; parsed: ParsedGitHubWorkItemIssue }> {
    const allIssues = uniqueIssues(rootIssue, candidates);
    const parsedByNumber = new Map<number, ParsedGitHubWorkItemIssue>();
    for (const issue of allIssues) {
        parsedByNumber.set(issue.number, parseGitHubWorkItemIssue(issue));
    }

    const included = new Set<number>([rootIssue.number]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const issue of allIssues) {
            if (included.has(issue.number)) continue;
            const parsed = parsedByNumber.get(issue.number)!;
            const parent = metadataParentForIssue(parsed);
            const hasIncludedParent = allIssues.some(candidate => {
                if (!included.has(candidate.number)) return false;
                return parentReferenceTargetsIssue(parent, repo, candidate, parsedByNumber.get(candidate.number)!);
            });
            if (hasIncludedParent) {
                included.add(issue.number);
                changed = true;
            }
        }
    }

    const childrenByParentNumber = new Map<number, GitHubWorkItemIssue[]>();
    for (const issue of allIssues) {
        if (!included.has(issue.number) || issue.number === rootIssue.number) continue;
        const parsed = parsedByNumber.get(issue.number)!;
        const parent = metadataParentForIssue(parsed);
        const parentIssue = allIssues.find(candidate =>
            included.has(candidate.number)
            && parentReferenceTargetsIssue(parent, repo, candidate, parsedByNumber.get(candidate.number)!),
        );
        if (!parentIssue) continue;
        const siblings = childrenByParentNumber.get(parentIssue.number) ?? [];
        siblings.push(issue);
        childrenByParentNumber.set(parentIssue.number, siblings);
    }

    const ordered: GitHubWorkItemIssue[] = [];
    const visited = new Set<number>();
    function visit(issue: GitHubWorkItemIssue): void {
        if (visited.has(issue.number)) return;
        visited.add(issue.number);
        ordered.push(issue);
        for (const child of [...(childrenByParentNumber.get(issue.number) ?? [])].sort((a, b) => a.number - b.number)) {
            visit(child);
        }
    }
    visit(rootIssue);
    return ordered.map(issue => ({ issue, parsed: parsedByNumber.get(issue.number)! }));
}

interface RemoteLocalMaps {
    byIssueNumber: Map<number, string>;
    byIssueId: Map<string, string>;
    byIssueUrl: Map<string, string>;
    byWorkItemId: Map<string, string>;
}

function emptyRemoteLocalMaps(): RemoteLocalMaps {
    return {
        byIssueNumber: new Map(),
        byIssueId: new Map(),
        byIssueUrl: new Map(),
        byWorkItemId: new Map(),
    };
}

function rememberRemoteLocal(
    maps: RemoteLocalMaps,
    issue: GitHubWorkItemIssue,
    parsed: ParsedGitHubWorkItemIssue,
    localId: string,
): void {
    maps.byIssueNumber.set(issue.number, localId);
    if (issue.id !== undefined) maps.byIssueId.set(String(issue.id), localId);
    if (issue.htmlUrl) maps.byIssueUrl.set(issue.htmlUrl, localId);
    if (issue.url) maps.byIssueUrl.set(issue.url, localId);
    if (parsed.metadata?.workItemId) maps.byWorkItemId.set(parsed.metadata.workItemId, localId);
}

function localParentIdForMetadataParent(
    parent: WorkItemSyncParentReference | undefined,
    maps: RemoteLocalMaps,
): string | undefined {
    if (!parent) return undefined;
    if (parent.workItemId && maps.byWorkItemId.has(parent.workItemId)) return maps.byWorkItemId.get(parent.workItemId);
    if (parent.issueNumber !== undefined && maps.byIssueNumber.has(parent.issueNumber)) return maps.byIssueNumber.get(parent.issueNumber);
    if (parent.issueId && maps.byIssueId.has(parent.issueId)) return maps.byIssueId.get(parent.issueId);
    if (parent.issueUrl && maps.byIssueUrl.has(parent.issueUrl)) return maps.byIssueUrl.get(parent.issueUrl);
    return undefined;
}

async function findLocalMirrorForIssue(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    repo: AvailableGitHubWorkItemSyncRepo,
    entries: readonly WorkItemIndexEntry[],
    issue: GitHubWorkItemIssue,
    parsed: ParsedGitHubWorkItemIssue,
): Promise<WorkItem | undefined> {
    if (parsed.metadata?.workItemId) {
        const item = await context.workItemStore.getWorkItem(parsed.metadata.workItemId, context.workspaceId);
        if (item) return item;
    }
    const entry = entries.find(candidate => sameGithubMirror(candidate.githubMirror, issue));
    return entry ? context.workItemStore.getWorkItem(entry.id, context.workspaceId) : undefined;
}

function githubBackedTrackerForRoot(issue: GitHubWorkItemIssue, pulledAt: string): WorkItem['tracker'] {
    return {
        kind: 'github-backed',
        provider: 'github',
        github: {
            issueId: issue.id !== undefined ? String(issue.id) : undefined,
            issueNumber: issue.number,
            issueUrl: issue.htmlUrl ?? issue.url,
            lastPulledAt: pulledAt,
        },
    };
}

function mirrorTypeForIssue(
    issue: GitHubWorkItemIssue,
    rootIssue: GitHubWorkItemIssue,
    parsed: ParsedGitHubWorkItemIssue,
): WorkItemType {
    if (issue.number === rootIssue.number) return 'epic';
    return parsed.type ?? 'work-item';
}

function tagsForMirror(parsed: ParsedGitHubWorkItemIssue): string[] | undefined {
    return parsed.tags.length > 0 ? parsed.tags : undefined;
}

function collectLocalTreeEntries(
    entries: readonly WorkItemIndexEntry[],
    rootId: string,
): Array<{ entry: WorkItemIndexEntry; depth: number }> {
    const childrenByParent = new Map<string, WorkItemIndexEntry[]>();
    for (const entry of entries) {
        if (!entry.parentId) continue;
        const children = childrenByParent.get(entry.parentId) ?? [];
        children.push(entry);
        childrenByParent.set(entry.parentId, children);
    }

    const result: Array<{ entry: WorkItemIndexEntry; depth: number }> = [];
    const stack = [{ id: rootId, depth: 0 }];
    const visited = new Set<string>();
    while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        for (const child of childrenByParent.get(current.id) ?? []) {
            result.push({ entry: child, depth: current.depth + 1 });
            stack.push({ id: child.id, depth: current.depth + 1 });
        }
    }
    return result;
}

async function pruneMissingGitHubMirrorItems(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    rootId: string,
    currentIssueNumbers: ReadonlySet<number>,
): Promise<{ deleted: number; deletedItemIds: string[] }> {
    const entries = (await context.workItemStore.listWorkItems({ repoId: context.workspaceId })).items;
    const descendants = collectLocalTreeEntries(entries, rootId);
    const toDelete = descendants.filter(({ entry }) =>
        entry.githubMirror?.issueNumber !== undefined &&
        !currentIssueNumbers.has(entry.githubMirror.issueNumber),
    );
    if (toDelete.length === 0) {
        return { deleted: 0, deletedItemIds: [] };
    }

    const deleteIds = new Set(toDelete.map(({ entry }) => entry.id));
    for (const { entry } of descendants) {
        if (entry.parentId && deleteIds.has(entry.parentId) && !deleteIds.has(entry.id)) {
            await context.workItemStore.updateWorkItem(entry.id, { parentId: undefined });
        }
    }

    const deletedItemIds: string[] = [];
    for (const { entry } of [...toDelete].sort((a, b) => b.depth - a.depth)) {
        if (await context.workItemStore.removeWorkItem(entry.id)) {
            deletedItemIds.push(entry.id);
        }
    }

    return { deleted: deletedItemIds.length, deletedItemIds };
}

export async function deleteGitHubEpicMirrorTree(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    rootId: string,
): Promise<{ deleted: number; deletedItemIds: string[] }> {
    const entries = (await context.workItemStore.listWorkItems({ repoId: context.workspaceId })).items;
    const rootEntry = entries.find(entry => entry.id === rootId);
    if (!rootEntry) {
        return { deleted: 0, deletedItemIds: [] };
    }

    const tree = [
        { entry: rootEntry, depth: 0 },
        ...collectLocalTreeEntries(entries, rootId),
    ];
    const toDelete = tree.filter(({ entry }) =>
        entry.githubMirror?.issueNumber !== undefined
        || (entry.id === rootId && entry.tracker?.kind === 'github-backed' && entry.tracker.provider === 'github'),
    );
    if (toDelete.length === 0) {
        return { deleted: 0, deletedItemIds: [] };
    }

    const deleteIds = new Set(toDelete.map(({ entry }) => entry.id));
    for (const { entry } of tree) {
        if (entry.parentId && deleteIds.has(entry.parentId) && !deleteIds.has(entry.id)) {
            await context.workItemStore.updateWorkItem(entry.id, { parentId: undefined });
        }
    }

    const deletedItemIds: string[] = [];
    for (const { entry } of [...toDelete].sort((a, b) => b.depth - a.depth)) {
        if (await context.workItemStore.removeWorkItem(entry.id)) {
            deletedItemIds.push(entry.id);
        }
    }

    return { deleted: deletedItemIds.length, deletedItemIds };
}

export async function convertLocalEpicTreeToGitHubBacked(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    repo: AvailableGitHubWorkItemSyncRepo,
    transport: GitHubWorkItemIssueTransport,
    rootId: string,
    now?: () => string,
): Promise<ConvertGitHubEpicTreeTrackerResult> {
    const convertedAt = (now ?? (() => new Date().toISOString()))();
    const entries = (await context.workItemStore.listWorkItems({ repoId: context.workspaceId })).items;
    const rootEntry = entries.find(entry => entry.id === rootId);
    if (!rootEntry) {
        throw new Error(`Work item not found: ${rootId}`);
    }
    const tree = [
        { entry: rootEntry, depth: 0 },
        ...collectLocalTreeEntries(entries, rootId),
    ].sort((a, b) => a.depth - b.depth || a.entry.createdAt.localeCompare(b.entry.createdAt));

    const convertedById = new Map<string, WorkItem>();
    const items: WorkItem[] = [];
    let remoteCreated = 0;
    let localUpdated = 0;

    for (const { entry, depth } of tree) {
        const item = await context.workItemStore.getWorkItem(entry.id, context.workspaceId);
        if (!item) {
            throw new Error(`Work item indexed but missing: ${entry.id}`);
        }

        if (depth === 0) {
            const result = await createGitHubIssueForLocalEpicRoot({
                repo,
                transport,
                item,
                now: () => convertedAt,
            });
            remoteCreated++;
            const updated = await context.workItemStore.updateWorkItem(item.id, {
                tracker: githubBackedTrackerForRoot(result.issue, convertedAt),
                githubMirror: result.githubMirror,
            });
            if (!updated) {
                throw new Error(`Work item disappeared during GitHub conversion: ${item.id}`);
            }
            localUpdated++;
            convertedById.set(updated.id, updated);
            items.push(updated);
            continue;
        }

        if (!item.parentId) {
            throw new Error(`Work item '${item.id}' is in the Epic tree but has no parent.`);
        }
        const parent = convertedById.get(item.parentId);
        if (!parent) {
            throw new Error(`Parent work item '${item.parentId}' was not converted before child '${item.id}'.`);
        }

        const result = await createGitHubIssueForLocalChild({
            repo,
            transport,
            item,
            parent,
            now: () => convertedAt,
        });
        remoteCreated++;
        const updated = await context.workItemStore.updateWorkItem(item.id, {
            tracker: undefined,
            githubMirror: result.githubMirror,
        });
        if (!updated) {
            throw new Error(`Work item disappeared during GitHub conversion: ${item.id}`);
        }
        localUpdated++;
        convertedById.set(updated.id, updated);
        items.push(updated);
    }

    const root = convertedById.get(rootId);
    if (!root) {
        throw new Error(`Root work item '${rootId}' was not converted.`);
    }

    return {
        root,
        items,
        remoteCreated,
        localUpdated,
    };
}

export async function detachGitHubEpicTreeToLocalOnly(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    rootId: string,
): Promise<ConvertGitHubEpicTreeTrackerResult> {
    const entries = (await context.workItemStore.listWorkItems({ repoId: context.workspaceId })).items;
    const rootEntry = entries.find(entry => entry.id === rootId);
    if (!rootEntry) {
        throw new Error(`Work item not found: ${rootId}`);
    }
    const tree = [
        { entry: rootEntry, depth: 0 },
        ...collectLocalTreeEntries(entries, rootId),
    ].sort((a, b) => a.depth - b.depth || a.entry.createdAt.localeCompare(b.entry.createdAt));

    const items: WorkItem[] = [];
    let localUpdated = 0;

    for (const { entry, depth } of tree) {
        const updates: Partial<Omit<WorkItem, 'id' | 'repoId' | 'createdAt'>> = {
            tracker: depth === 0 ? { kind: 'local-only' } : undefined,
            githubMirror: undefined,
        };
        const updated = await context.workItemStore.updateWorkItem(entry.id, updates);
        if (!updated) {
            throw new Error(`Work item disappeared during GitHub detach: ${entry.id}`);
        }
        localUpdated++;
        items.push(updated);
    }

    const root = items.find(item => item.id === rootId);
    if (!root) {
        throw new Error(`Root work item '${rootId}' was not detached.`);
    }

    return {
        root,
        items,
        remoteCreated: 0,
        localUpdated,
    };
}

export function createGitHubWorkItemSyncProviderAdapter(options: CreateGitHubWorkItemSyncProviderOptions = {}): WorkItemSyncProviderAdapter {
    const transport = options.transport ?? new GhCliGitHubWorkItemIssueTransport();

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
    };
}

/**
 * Import or re-pull a GitHub-backed Epic tree into CoC's read mirror.
 *
 * The tree root is the imported GitHub issue. Descendants are discovered only
 * through hidden `coc-work-item-sync` parent metadata in issue bodies; native
 * GitHub sub-issue links are intentionally ignored for this epic-rooted mirror.
 */
export async function importGitHubEpicTreeAsWorkItems(
    context: { workspaceId: string; workItemStore: WorkItemStore },
    repo: AvailableGitHubWorkItemSyncRepo,
    rootIssue: GitHubWorkItemIssue,
    candidateIssues: readonly GitHubWorkItemIssue[],
    now?: () => string,
    options: ImportGitHubEpicTreeOptions = {},
): Promise<ImportGitHubEpicTreeResult> {
    const pulledAt = (now ?? (() => new Date().toISOString()))();
    const tree = collectGitHubEpicTreeIssues(repo, rootIssue, candidateIssues);
    const index = (await context.workItemStore.listWorkItems({ repoId: context.workspaceId })).items;
    const localByRemote = emptyRemoteLocalMaps();
    const localById = new Map<string, WorkItem>();
    const items: WorkItem[] = [];
    let created = 0;
    let updated = 0;

    for (const { issue, parsed } of tree) {
        const existing = await findLocalMirrorForIssue(context, repo, index, issue, parsed);
        // On re-sync (pull poller), skip recreating a local mirror for a closed
        // GitHub issue that no longer has a local item. Without this, a closed
        // issue would resurrect a work item the user deliberately deleted. The
        // root issue and any issue with an existing local mirror are unaffected,
        // and the issue stays in the prune set so existing mirrors are retained.
        if (options.skipClosedWithoutLocal
            && !existing
            && issue.state === 'closed'
            && issue.number !== rootIssue.number) {
            continue;
        }
        const type = mirrorTypeForIssue(issue, rootIssue, parsed);
        const proposedParentId = issue.number === rootIssue.number
            ? undefined
            : localParentIdForMetadataParent(metadataParentForIssue(parsed), localByRemote);
        const parent = proposedParentId
            ? localById.get(proposedParentId) ?? await context.workItemStore.getWorkItem(proposedParentId, context.workspaceId)
            : undefined;
        const parentId = parent && isValidParentChildTypes(type, getEffectiveType(parent.type))
            ? parent.id
            : undefined;
        const isRoot = issue.number === rootIssue.number;
        const desiredId = existing?.id ?? parsed.metadata?.workItemId ?? crypto.randomUUID();
        const commonFields = {
            title: issue.title,
            description: parsed.bodyWithoutMetadata,
            type,
            parentId,
            tracker: isRoot ? githubBackedTrackerForRoot(issue, pulledAt) : undefined,
            githubMirror: githubMirrorForIssue(issue, pulledAt),
            tags: tagsForMirror(parsed),
        };

        let item: WorkItem;
        if (existing) {
            item = await context.workItemStore.updateWorkItem(existing.id, commonFields) ?? {
                ...existing,
                ...commonFields,
            };
            updated++;
        } else {
            item = {
                id: desiredId,
                repoId: context.workspaceId,
                ...commonFields,
                status: 'created',
                createdAt: pulledAt,
                updatedAt: pulledAt,
                source: 'manual',
                priority: parsed.priority,
            };
            await context.workItemStore.addWorkItem(item);
            created++;
        }

        localById.set(item.id, item);
        rememberRemoteLocal(localByRemote, issue, parsed, item.id);
        items.push(item);
    }

    const root = items.find(item => item.githubMirror?.issueNumber === rootIssue.number);
    if (!root) {
        throw new Error(`GitHub issue #${rootIssue.number} was not imported as the Epic root.`);
    }
    const pruneResult = options.pruneMissing
        ? await pruneMissingGitHubMirrorItems(
            context,
            root.id,
            new Set(tree.map(({ issue }) => issue.number)),
        )
        : { deleted: 0, deletedItemIds: [] };
    return { root, items, created, updated, ...pruneResult };
}
