/**
 * Repo-group chat feed — read-only aggregation of the chats owned by a repo
 * group and by each of its explicit members, all from the one server whose
 * registry owns the group.
 *
 * Discovery only: rows keep their owner's native shape and gain
 * `ownerWorkspaceId`. Nothing here enqueues, moves or re-owns work. Each
 * source is read through the same queue snapshot and terminal-history query
 * its own repo list uses, so visibility rules are unchanged.
 *
 * History pages merge eligible metadata snapshots by latest activity. Cursors
 * bind per-source offsets to membership, query and snapshot identities; changed
 * activity restarts pagination rather than skipping conversations.
 */

import { createHash } from 'crypto';
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type {
    RepoGroupChatArchivedFilter,
    RepoGroupChatCounts,
    RepoGroupChatFeedQuery,
    RepoGroupChatFeedResponse,
    RepoGroupChatSource,
    RepoGroupChatStatus,
} from '@plusplusoneplusplus/coc-client';
import { toProcessHistoryItem, type ProcessHistoryItem } from '../shared/process-history-item';
import type { RepoGroupMember } from './repo-group-workspace';
import { getTaskDef } from '../tasks/task-types';

export const REPO_GROUP_CHAT_STATUSES: readonly RepoGroupChatStatus[] = ['running', 'queued', 'completed', 'failed', 'cancelled'];
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;
type TerminalStatus = typeof TERMINAL_STATUSES[number];

export const REPO_GROUP_CHAT_DEFAULT_LIMIT = 50;
export const REPO_GROUP_CHAT_MAX_LIMIT = 200;

type FeedStore = ProcessStore & {
    getSeenMap?: (workspaceId: string) => Record<string, string>;
    getUnseenCount?: (workspaceId: string) => number;
    getDatabase?: () => NativeDatabase;
};

export interface RepoGroupChatFeedDeps {
    store: FeedStore;
    /** One workspace's queue in `GET /api/queue?repoId=` shape; absent ⇒ no active rows. */
    readQueue?: (workspaceId: string) => Promise<{ running: Record<string, unknown>[]; queued: Record<string, unknown>[] }>;
    botControlEnabled?: boolean;
}

export interface NormalizedFeedQuery {
    limit: number;
    cursor?: string;
    owners?: string[];
    statuses: RepoGroupChatStatus[];
    archived: RepoGroupChatArchivedFilter;
    type?: string;
    q?: string;
}

/** Raised for a cursor from another membership/filter set; the client restarts from page one. */
export class StaleRepoGroupCursorError extends Error {
    readonly code = 'STALE_CURSOR';
    constructor() {
        super('The chat list changed; reload from the first page.');
        this.name = 'StaleRepoGroupCursorError';
    }
}

export class InvalidRepoGroupChatQueryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidRepoGroupChatQueryError';
    }
}

function splitList(value: string | null): string[] | undefined {
    if (value === null) return undefined;
    return value.split(',').map(part => part.trim()).filter(Boolean);
}

/** Parse and validate the feed's query string. */
export function parseRepoGroupChatFeedQuery(params: URLSearchParams): NormalizedFeedQuery {
    const rawLimit = params.get('limit');
    const limit = rawLimit === null ? REPO_GROUP_CHAT_DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) {
        throw new InvalidRepoGroupChatQueryError('Invalid "limit" parameter');
    }
    const statuses = splitList(params.get('statuses')) ?? [...REPO_GROUP_CHAT_STATUSES];
    for (const status of statuses) {
        if (!REPO_GROUP_CHAT_STATUSES.includes(status as RepoGroupChatStatus)) {
            throw new InvalidRepoGroupChatQueryError(`Invalid status filter: ${status}`);
        }
    }
    const archived = (params.get('archived') ?? 'exclude') as RepoGroupChatArchivedFilter;
    if (!['exclude', 'only', 'include'].includes(archived)) {
        throw new InvalidRepoGroupChatQueryError(`Invalid archived filter: ${archived}`);
    }
    const owners = splitList(params.get('owners'));
    return {
        limit: Math.min(limit, REPO_GROUP_CHAT_MAX_LIMIT),
        ...(params.get('cursor') ? { cursor: params.get('cursor')! } : {}),
        ...(owners && owners.length > 0 ? { owners: [...new Set(owners)].sort() } : {}),
        statuses: [...new Set(statuses as RepoGroupChatStatus[])].sort(),
        archived,
        ...(params.get('type') ? { type: params.get('type')! } : {}),
        ...(params.get('q')?.trim() ? { q: params.get('q')!.trim() } : {}),
    };
}

function shortHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 16);
}

interface FeedCursor {
    v: 1;
    m: string;
    f: string;
    o: Record<string, number>;
    snapshot?: string;
}

function encodeCursor(cursor: FeedCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string, membershipKey: string, filterKey: string, snapshot?: string): Record<string, number> {
    let parsed: FeedCursor;
    try {
        parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as FeedCursor;
    } catch {
        throw new InvalidRepoGroupChatQueryError('Invalid "cursor" parameter');
    }
    if (!parsed || parsed.v !== 1 || typeof parsed.o !== 'object' || parsed.o === null) {
        throw new InvalidRepoGroupChatQueryError('Invalid "cursor" parameter');
    }
    if (parsed.m !== membershipKey || parsed.f !== filterKey || parsed.snapshot !== snapshot) throw new StaleRepoGroupCursorError();
    return parsed.o;
}

function activityMs(proc: AIProcess): number {
    const value = proc.lastEventAt ?? proc.endTime ?? proc.startTime;
    const ms = value instanceof Date ? value.getTime() : new Date(value as unknown as string).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function matchesArchived(archived: boolean | undefined, filter: RepoGroupChatArchivedFilter): boolean {
    if (filter === 'include') return true;
    return filter === 'only' ? archived === true : archived !== true;
}

function eligibleProcess(type: unknown, metadata: unknown): boolean {
    if (typeof type === 'string' && getTaskDef(type)?.visible === false) return false;
    return !metadata || typeof metadata !== 'object' || !('dreamStep' in metadata);
}

function activeProcessId(task: Record<string, unknown>): string | undefined {
    if (typeof task.processId === 'string') return task.processId;
    return typeof task.id === 'string' ? toQueueProcessId(task.id) : undefined;
}

type OwnedTask = Record<string, unknown> & { ownerWorkspaceId: string };

function activeActivityMs(task: OwnedTask): number {
    const value = task.lastActivityAt ?? task.endTime ?? task.completedAt
        ?? task.startedAt ?? task.startTime ?? task.createdAt;
    const ms = typeof value === 'number' ? value
        : typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
}

interface SourceState {
    source: RepoGroupChatSource;
    activeIds: Set<string>;
    running: OwnedTask[];
    queued: OwnedTask[];
    history?: AIProcess[];
    hits?: Map<string, string>;
}

/** Walks one eligible, deterministically ordered source snapshot. */
class SourceHistoryStream {
    constructor(private readonly rows: AIProcess[], private nextRaw: number) {}

    async peek(): Promise<{ proc: AIProcess; rawIndex: number } | undefined> {
        const proc = this.rows[this.nextRaw];
        return proc ? { proc, rawIndex: this.nextRaw } : undefined;
    }

    take(): void {
        this.nextRaw++;
    }
}

function compareHeads(
    a: { ms: number; workspaceId: string; id: string },
    b: { ms: number; workspaceId: string; id: string },
): number {
    return b.ms - a.ms
        || a.workspaceId.localeCompare(b.workspaceId)
        || a.id.localeCompare(b.id);
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Reuse the existing FTS index; eligibility and archive rules are applied by the feed. */
function searchFeedBodies(store: FeedStore, workspaceId: string, query: string): Map<string, string> {
    const db = store.getDatabase?.();
    if (!db) throw new Error('Conversation search requires the process search index.');
    const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (!terms.length) return new Map();
    const match = terms.map(term => `"${term}"`).join(' AND ');
    const rows = db.prepare(`
        SELECT t.process_id AS processId,
            snippet(conversation_search, 0, '', '', '...', 32) AS snippet
        FROM conversation_search
        JOIN conversation_turns t ON t.id = conversation_search.rowid
        JOIN processes p ON p.id = t.process_id
        WHERE conversation_search MATCH ? AND p.workspace_id = ? AND t.interrupted = 0
        ORDER BY t.turn_index DESC
    `).all(match, workspaceId) as Array<{ processId: string; snippet: string }>;
    const hits = new Map<string, string>();
    for (const row of rows) if (!hits.has(row.processId)) hits.set(row.processId, row.snippet);
    return hits;
}

/**
 * Build one page of the group's aggregated chat list. `members` comes from
 * the owning server's registry (`resolveRepoGroupMembers`); the group's own
 * workspace is always the first source.
 */
export async function buildRepoGroupChatFeed(
    deps: RepoGroupChatFeedDeps,
    groupId: string,
    members: readonly RepoGroupMember[],
    query: NormalizedFeedQuery,
): Promise<RepoGroupChatFeedResponse<Record<string, unknown>, ProcessHistoryItem>> {
    const allSources: RepoGroupChatSource[] = [
        { workspaceId: groupId, role: 'group', available: true },
        ...members
            .filter(member => member.workspaceId !== groupId)
            .map((member): RepoGroupChatSource => ({
                workspaceId: member.workspaceId,
                role: 'member',
                ...(member.name ? { name: member.name } : {}),
                ...(member.stale ? { stale: true, staleReason: member.staleReason } : {}),
                available: true,
            })),
    ];
    const membershipKey = shortHash(allSources.map(source => source.workspaceId));
    const filterKey = shortHash({ owners: query.owners, statuses: query.statuses, archived: query.archived, type: query.type, q: query.q });
    const firstPage = !query.cursor;

    const ownerFilter = query.owners ? new Set(query.owners) : undefined;
    const wantRunning = query.statuses.includes('running') && query.archived !== 'only';
    const wantQueued = query.statuses.includes('queued') && query.archived !== 'only';
    const terminal = TERMINAL_STATUSES.filter(status => query.statuses.includes(status));

    // Active rows from each source's own queue. Reading them is needed even when
    // running/queued are filtered out, so a re-queued follow-up never also
    // appears as a history row.
    const states: SourceState[] = await Promise.all(allSources.map(async (source): Promise<SourceState> => {
        const state: SourceState = { source, activeIds: new Set(), running: [], queued: [] };
        if (!deps.readQueue) return state;
        try {
            const snapshot = await deps.readQueue(source.workspaceId);
            const tag = (task: Record<string, unknown>): OwnedTask => ({
                ...task, ownerWorkspaceId: source.workspaceId,
                queueTaskId: typeof task.id === 'string' ? task.id : undefined,
            });
            const represented = new Set<string>();
            const unique = (items: Record<string, unknown>[]) => items.filter(item => {
                if (!eligibleProcess(item.type, item.metadata)) return false;
                const id = activeProcessId(item);
                if (!id || represented.has(id)) return false;
                represented.add(id);
                return true;
            });
            state.running = unique(snapshot.running).map(tag);
            // Pause markers are queue controls, which stay owner-specific.
            state.queued = unique(snapshot.queued.filter(item => item.kind !== 'pause-marker')).map(tag);
            for (const task of [...state.running, ...state.queued]) {
                const id = activeProcessId(task);
                if (id) state.activeIds.add(id);
            }
        } catch (err) {
            source.available = false;
            source.error = errorMessage(err);
        }
        return state;
    }));
    const selected = states.filter(state => !ownerFilter || ownerFilter.has(state.source.workspaceId));
    const matchesType = (task: Record<string, unknown>) => !query.type || task.type === query.type;
    const snippets: Record<string, Record<string, string>> = {};
    const parentOwners = new Map<string, string>();
    for (const state of states) for (const task of [...state.running, ...state.queued]) {
        const id = activeProcessId(task);
        if (id) parentOwners.set(id, state.source.workspaceId);
    }
    // Counts and ordering share one eligible snapshot. Stable ties inside each
    // owner are essential: sorting only page-sized chunks can skip equal times.
    for (const state of selected) {
        if (!state.source.available) continue;
        try {
            const processes = await deps.store.getAllProcesses({
                workspaceId: state.source.workspaceId,
                status: ['running', 'queued', ...TERMINAL_STATUSES], exclude: ['conversation'],
            });
            const queueRows = new Map([...state.running, ...state.queued].map(task => [activeProcessId(task), task]));
            for (const proc of processes) {
                if (!eligibleProcess(proc.type, proc.metadata)) continue;
                if (queueRows.has(proc.id) || proc.status === 'running' || proc.status === 'queued') {
                    parentOwners.set(proc.id, state.source.workspaceId);
                }
                const represented = queueRows.get(proc.id);
                if (represented) {
                    // Follow-ups can still have terminal durable status; queue identity/status stay authoritative.
                    represented.lastActivityAt = activityMs(proc);
                    const presentation = toProcessHistoryItem(proc, undefined, deps.botControlEnabled);
                    for (const field of ['parentProcessId', 'ralph', 'forEach', 'mapReduce', 'taskGroup'] as const) {
                        if (presentation[field] !== undefined) represented[field] = presentation[field];
                    }
                    continue;
                }
                if (proc.status !== 'running' && proc.status !== 'queued') continue;
                const task: OwnedTask = {
                    ...toProcessHistoryItem(proc, undefined, deps.botControlEnabled),
                    processId: proc.id, ownerWorkspaceId: state.source.workspaceId,
                };
                if (proc.status === 'running') state.running.push(task);
                else state.queued.push(task);
                state.activeIds.add(proc.id);
                parentOwners.set(proc.id, state.source.workspaceId);
            }
            if (query.q) {
                state.hits = searchFeedBodies(deps.store, state.source.workspaceId, query.q);
            }
            state.history = processes.filter(proc => terminal.some(status => status === proc.status)
                && (!query.type || proc.type === query.type));
            for (const proc of state.history) if (eligibleProcess(proc.type, proc.metadata)) {
                parentOwners.set(proc.id, state.source.workspaceId);
            }
            state.history = state.history
                .filter(proc => eligibleProcess(proc.type, proc.metadata) && matchesArchived(proc.archived, query.archived)
                    && !state.activeIds.has(proc.id) && (!state.hits || state.hits.has(proc.id)))
                .sort((a, b) => activityMs(b) - activityMs(a) || a.id.localeCompare(b.id));
            if (query.q) {
                const matches = (task: OwnedTask) => {
                    const id = activeProcessId(task);
                    if (id && state.hits?.has(id)) return true;
                    const payload = task.payload && typeof task.payload === 'object' ? task.payload as Record<string, unknown> : {};
                    const text = [task.title, task.promptPreview, task.fullPrompt, payload.prompt, payload.promptContent]
                        .filter((value): value is string => typeof value === 'string').join('\n').toLocaleLowerCase();
                    const terms = query.q!.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
                    return terms.length > 0 && terms.every(term => text.includes(term));
                };
                state.running = state.running.filter(matches);
                state.queued = state.queued.filter(matches);
            }
        } catch (err) {
            state.source.available = false;
            state.source.error = errorMessage(err);
        }
    }
    const snapshot = shortHash(selected.map(state => [
        state.source.workspaceId, state.source.available,
        state.history?.map(proc => [proc.id, activityMs(proc), proc.pinnedAt, proc.archived]),
        state.running.map(task => [activeProcessId(task), activeActivityMs(task)]),
        state.queued.map(task => [activeProcessId(task), activeActivityMs(task)]),
    ]));
    const offsets = query.cursor ? decodeCursor(query.cursor, membershipKey, filterKey, snapshot) : {};

    let running = wantRunning ? selected.flatMap(state => state.running.filter(matchesType)) : [];
    let queued = wantQueued ? selected.flatMap(state => state.queued.filter(matchesType)) : [];
    const parentContext = (parentProcessId: unknown) => typeof parentProcessId === 'string' && parentOwners.has(parentProcessId)
        ? { parentOwnerWorkspaceId: parentOwners.get(parentProcessId), groupWorkspaceId: groupId } : {};
    for (const task of [...running, ...queued]) Object.assign(task, parentContext(task.parentProcessId));

    // History page: k-way merge of each source's activity-ordered stream.
    const history: Array<ProcessHistoryItem & { ownerWorkspaceId: string }> = [];
    const nextOffsets: Record<string, number> = { ...offsets };
    // One seen-map read per owner workspace per request; rows look up in it.
    const seenMaps = new Map<string, Record<string, string>>();
    const seenMapFor = (workspaceId: string) => {
        let seenMap = seenMaps.get(workspaceId);
        if (!seenMap) {
            seenMap = deps.store.getSeenMap?.(workspaceId) ?? {};
            seenMaps.set(workspaceId, seenMap);
        }
        return seenMap;
    };
    let hasMore = false;
    if (query.q) {
        // One search page is a prefix of all statuses, not a history page plus active pins.
        const matches = [
            ...running.map(task => ({ section: 'running' as const, task, ms: activeActivityMs(task),
                workspaceId: task.ownerWorkspaceId, id: activeProcessId(task)! })),
            ...queued.map(task => ({ section: 'queued' as const, task, ms: activeActivityMs(task),
                workspaceId: task.ownerWorkspaceId, id: activeProcessId(task)! })),
            ...selected.filter(state => state.source.available).flatMap(state =>
                (state.history ?? []).map(proc => ({ section: 'history' as const, proc, ms: activityMs(proc),
                    workspaceId: state.source.workspaceId, id: proc.id }))),
        ].sort(compareHeads);
        const offset = Math.max(0, Math.floor(offsets.search ?? 0));
        const page = matches.slice(offset, offset + query.limit);
        running = [];
        queued = [];
        for (const match of page) {
            if (match.section === 'history') {
                history.push({
                    ...toProcessHistoryItem(match.proc, seenMapFor(match.workspaceId)[match.id], deps.botControlEnabled),
                    ownerWorkspaceId: match.workspaceId,
                    ...parentContext(match.proc.parentProcessId),
                });
            } else if (match.section === 'running') running.push(match.task);
            else queued.push(match.task);
        }
        nextOffsets.search = offset + page.length;
        hasMore = nextOffsets.search < matches.length;
    } else if (terminal.length > 0) {
        const streams = selected
            .filter(state => state.source.available)
            .map(state => ({
                state,
                stream: new SourceHistoryStream(
                    (state.history ?? []).filter(proc => !proc.pinnedAt || proc.archived || !!query.q),
                    Math.max(0, Math.floor(offsets[state.source.workspaceId] ?? 0)),
                ),
            }));
        const failed = new Set<typeof streams[number]>();
        const peek = async (entry: typeof streams[number]) => {
            if (failed.has(entry)) return undefined;
            try {
                return await entry.stream.peek();
            } catch (err) {
                failed.add(entry);
                entry.state.source.available = false;
                entry.state.source.error = errorMessage(err);
                return undefined;
            }
        };
        while (history.length < query.limit) {
            let best: { entry: typeof streams[number]; head: { proc: AIProcess; rawIndex: number }; ms: number } | undefined;
            for (const entry of streams) {
                const head = await peek(entry);
                if (!head) continue;
                const ms = activityMs(head.proc);
                if (!best || compareHeads(
                    { ms, workspaceId: entry.state.source.workspaceId, id: head.proc.id },
                    { ms: best.ms, workspaceId: best.entry.state.source.workspaceId, id: best.head.proc.id },
                ) < 0) {
                    best = { entry, head, ms };
                }
            }
            if (!best) break;
            best.entry.stream.take();
            const workspaceId = best.entry.state.source.workspaceId;
            nextOffsets[workspaceId] = best.head.rawIndex + 1;
            history.push({
                ...toProcessHistoryItem(best.head.proc, seenMapFor(workspaceId)[best.head.proc.id], deps.botControlEnabled),
                ownerWorkspaceId: workspaceId,
                ...parentContext(best.head.proc.parentProcessId),
            });
        }
        for (const entry of streams) {
            if (await peek(entry)) { hasMore = true; break; }
        }
    }

    if (firstPage && !query.q) {
        const pinned = selected.filter(state => state.source.available).flatMap(state =>
            (state.history ?? []).filter(proc => proc.pinnedAt && !proc.archived).map(proc => ({
                ...toProcessHistoryItem(proc, seenMapFor(state.source.workspaceId)[proc.id], deps.botControlEnabled),
                ownerWorkspaceId: state.source.workspaceId,
                ...parentContext(proc.parentProcessId),
            })));
        pinned.sort((a, b) => new Date(b.pinnedAt!).getTime() - new Date(a.pinnedAt!).getTime()
            || a.ownerWorkspaceId.localeCompare(b.ownerWorkspaceId) || a.id.localeCompare(b.id));
        history.unshift(...pinned);
    }
    const counts = await countFeed(deps.store, states, selected, query, terminal, { wantRunning, wantQueued, matchesType });
    const db = deps.store.getDatabase?.();
    if (db) for (const state of selected) {
        const folders = db.prepare(`
            SELECT m.process_id AS processId, g.group_id AS folderId, g.title AS folderName
            FROM task_groups g JOIN task_group_members m
                ON m.workspace_id = g.workspace_id AND m.group_id = g.group_id
            WHERE g.workspace_id = ? AND g.type = 'chat-folder' AND g.hidden = 0
        `).all(state.source.workspaceId) as Array<{ processId: string; folderId: string; folderName: string }>;
        const byId = new Map(folders.map(folder => [folder.processId, folder]));
        for (const row of [...history, ...running, ...queued]) {
            if (row.ownerWorkspaceId !== state.source.workspaceId) continue;
            const id = 'startTime' in row ? String(row.id) : activeProcessId(row);
            const folder = id ? byId.get(id) : undefined;
            if (folder) Object.assign(row, { folderId: folder.folderId, folderName: folder.folderName });
        }
    }
    if (query.q) {
        for (const state of selected) {
            const visibleIds = new Set([
                ...history.filter(row => row.ownerWorkspaceId === state.source.workspaceId).map(row => row.id),
                ...running.filter(row => row.ownerWorkspaceId === state.source.workspaceId).map(activeProcessId),
                ...queued.filter(row => row.ownerWorkspaceId === state.source.workspaceId).map(activeProcessId),
            ]);
            snippets[state.source.workspaceId] = Object.fromEntries(
                [...state.hits ?? []].filter(([id]) => visibleIds.has(id)));
        }
    }
    return {
        groupId,
        membershipKey,
        sources: allSources,
        running: firstPage || query.q ? running : [],
        queued: firstPage || query.q ? queued : [],
        history,
        ...(query.q ? { snippets } : {}),
        hasMore,
        ...(hasMore ? { nextCursor: encodeCursor({ v: 1, m: membershipKey, f: filterKey, o: nextOffsets, snapshot }) } : {}),
        counts,
    };
}

async function countFeed(
    store: FeedStore,
    all: SourceState[],
    selected: SourceState[],
    query: NormalizedFeedQuery,
    terminal: TerminalStatus[],
    active: {
        wantRunning: boolean;
        wantQueued: boolean;
        matchesType: (task: Record<string, unknown>) => boolean;
    },
): Promise<RepoGroupChatCounts> {
    const byOwner: Record<string, number> = {};
    let running = 0;
    let queued = 0;
    let historyCount = 0;
    for (const state of selected) {
        const id = state.source.workspaceId;
        const ownerRunning = active.wantRunning ? state.running.filter(active.matchesType).length : 0;
        const ownerQueued = active.wantQueued ? state.queued.filter(active.matchesType).length : 0;
        let ownerHistory = 0;
        if (terminal.length > 0 && state.source.available) {
            try {
                ownerHistory = state.history?.length ?? await countHistory(store, id, terminal, query, state.activeIds);
            } catch (err) {
                state.source.available = false;
                state.source.error = errorMessage(err);
            }
        }
        running += ownerRunning;
        queued += ownerQueued;
        historyCount += ownerHistory;
        byOwner[id] = ownerRunning + ownerQueued + ownerHistory;
    }
    // The group badge: unread chats across the group and its current members,
    // independent of the list filters, in each owner's own read state.
    let unread: number | undefined = typeof store.getSeenMap === 'function' ? 0 : undefined;
    for (const state of all) {
        if (unread === undefined || !state.source.available) continue;
        try {
            const seen = store.getSeenMap!(state.source.workspaceId);
            const rows = await store.getAllProcesses({
                workspaceId: state.source.workspaceId, status: ['completed', 'failed'], exclude: ['conversation'],
            });
            unread += new Set(rows.filter(proc => !proc.archived && eligibleProcess(proc.type, proc.metadata)
                && proc.endTime && seen[proc.id] !== new Date(proc.endTime).toISOString()).map(proc => proc.id)).size;
        } catch (err) {
            state.source.available = false;
            state.source.error = errorMessage(err);
        }
    }
    return {
        total: running + queued + historyCount,
        running,
        queued,
        history: historyCount,
        ...(unread !== undefined ? { unread } : {}),
        byOwner,
        partial: all.some(state => !state.source.available),
    };
}

async function countHistory(
    store: FeedStore,
    workspaceId: string,
    statuses: TerminalStatus[],
    query: NormalizedFeedQuery,
    activeIds: Set<string>,
): Promise<number> {
    const filter = {
        workspaceId,
        status: statuses,
        ...(query.type ? { type: query.type as AIProcess['type'] } : {}),
    };
    if (typeof store.getProcessSummaries === 'function') {
        const { entries } = await store.getProcessSummaries(filter);
        return entries.filter(entry => matchesArchived(entry.archived, query.archived) && !activeIds.has(entry.id)).length;
    }
    const rows = await store.getAllProcesses({ ...filter, exclude: ['conversation'] });
    return rows.filter(proc => matchesArchived(proc.archived, query.archived) && !activeIds.has(proc.id)).length;
}
