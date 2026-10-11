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
 * History pages merge every source by latest activity. The cursor records how
 * far each source has been consumed (k-way merge over per-source offsets), so
 * consecutive pages neither skip nor repeat a chat; it also pins the source
 * set and filters, so a page for an older membership or query is rejected.
 */

import { createHash } from 'crypto';
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
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

export const REPO_GROUP_CHAT_STATUSES: readonly RepoGroupChatStatus[] = ['running', 'queued', 'completed', 'failed', 'cancelled'];
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;
type TerminalStatus = typeof TERMINAL_STATUSES[number];

export const REPO_GROUP_CHAT_DEFAULT_LIMIT = 50;
export const REPO_GROUP_CHAT_MAX_LIMIT = 200;

type FeedStore = ProcessStore & {
    getSeenMap?: (workspaceId: string) => Record<string, string>;
    getUnseenCount?: (workspaceId: string) => number;
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
}

function encodeCursor(cursor: FeedCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string, membershipKey: string, filterKey: string): Record<string, number> {
    let parsed: FeedCursor;
    try {
        parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as FeedCursor;
    } catch {
        throw new InvalidRepoGroupChatQueryError('Invalid "cursor" parameter');
    }
    if (!parsed || parsed.v !== 1 || typeof parsed.o !== 'object' || parsed.o === null) {
        throw new InvalidRepoGroupChatQueryError('Invalid "cursor" parameter');
    }
    if (parsed.m !== membershipKey || parsed.f !== filterKey) throw new StaleRepoGroupCursorError();
    return parsed.o;
}

function activityMs(proc: AIProcess): number {
    const value = proc.lastEventAt ?? proc.startTime;
    const ms = value instanceof Date ? value.getTime() : new Date(value as unknown as string).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function matchesArchived(archived: boolean | undefined, filter: RepoGroupChatArchivedFilter): boolean {
    if (filter === 'include') return true;
    return filter === 'only' ? archived === true : archived !== true;
}

function activeProcessId(task: Record<string, unknown>): string | undefined {
    if (typeof task.processId === 'string') return task.processId;
    return typeof task.id === 'string' ? toQueueProcessId(task.id) : undefined;
}

type OwnedTask = Record<string, unknown> & { ownerWorkspaceId: string };

interface SourceState {
    source: RepoGroupChatSource;
    activeIds: Set<string>;
    running: OwnedTask[];
    queued: OwnedTask[];
}

/**
 * Lazily pulls one source's terminal history in its store order (latest
 * activity first), skipping rows hidden by the archive filter or currently
 * shown as running/queued. `rawIndex` is the row's position in the unfiltered
 * terminal query, which is what the cursor records.
 */
class SourceHistoryStream {
    private buffer: Array<{ proc: AIProcess; rawIndex: number }> = [];
    private nextRaw: number;
    private exhausted = false;

    constructor(
        private readonly store: FeedStore,
        private readonly workspaceId: string,
        private readonly statuses: TerminalStatus[],
        private readonly query: NormalizedFeedQuery,
        private readonly activeIds: Set<string>,
        startRaw: number,
        private readonly chunk: number,
    ) {
        this.nextRaw = startRaw;
    }

    async peek(): Promise<{ proc: AIProcess; rawIndex: number } | undefined> {
        while (this.buffer.length === 0 && !this.exhausted) {
            const rows = await this.store.getAllProcesses({
                workspaceId: this.workspaceId,
                status: this.statuses,
                exclude: ['conversation'],
                ...(this.query.type ? { type: this.query.type as AIProcess['type'] } : {}),
                limit: this.chunk,
                offset: this.nextRaw,
            });
            rows.forEach((proc, index) => {
                if (!matchesArchived(proc.archived, this.query.archived)) return;
                if (this.activeIds.has(proc.id)) return;
                this.buffer.push({ proc, rawIndex: this.nextRaw + index });
            });
            this.nextRaw += rows.length;
            if (rows.length < this.chunk) this.exhausted = true;
        }
        return this.buffer[0];
    }

    take(): void {
        this.buffer.shift();
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
    const filterKey = shortHash({ owners: query.owners, statuses: query.statuses, archived: query.archived, type: query.type });
    const offsets = query.cursor ? decodeCursor(query.cursor, membershipKey, filterKey) : {};
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
            const tag = (task: Record<string, unknown>): OwnedTask => ({ ...task, ownerWorkspaceId: source.workspaceId });
            state.running = snapshot.running.map(tag);
            // Pause markers are queue controls, which stay owner-specific.
            state.queued = snapshot.queued.filter(item => item.kind !== 'pause-marker').map(tag);
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

    const running = wantRunning ? selected.flatMap(state => state.running.filter(matchesType)) : [];
    const queued = wantQueued ? selected.flatMap(state => state.queued.filter(matchesType)) : [];

    // History page: k-way merge of each source's activity-ordered stream.
    const history: Array<ProcessHistoryItem & { ownerWorkspaceId: string }> = [];
    const nextOffsets: Record<string, number> = { ...offsets };
    let hasMore = false;
    if (terminal.length > 0) {
        const streams = selected
            .filter(state => state.source.available)
            .map(state => ({
                state,
                stream: new SourceHistoryStream(
                    deps.store, state.source.workspaceId, terminal, query, state.activeIds,
                    Math.max(0, Math.floor(offsets[state.source.workspaceId] ?? 0)), query.limit + 1,
                ),
            }));
        const seenMaps = new Map<string, Record<string, string>>();
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
            let seenMap = seenMaps.get(workspaceId);
            if (!seenMap) {
                seenMap = deps.store.getSeenMap?.(workspaceId) ?? {};
                seenMaps.set(workspaceId, seenMap);
            }
            history.push({
                ...toProcessHistoryItem(best.head.proc, seenMap[best.head.proc.id], deps.botControlEnabled),
                ownerWorkspaceId: workspaceId,
            });
        }
        for (const entry of streams) {
            if (await peek(entry)) { hasMore = true; break; }
        }
    }

    const counts = await countFeed(deps.store, states, selected, query, terminal, { wantRunning, wantQueued, matchesType });
    return {
        groupId,
        membershipKey,
        sources: allSources,
        running: firstPage ? running : [],
        queued: firstPage ? queued : [],
        history,
        hasMore,
        ...(hasMore ? { nextCursor: encodeCursor({ v: 1, m: membershipKey, f: filterKey, o: nextOffsets }) } : {}),
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
                ownerHistory = await countHistory(store, id, terminal, query, state.activeIds);
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
    let unread: number | undefined = typeof store.getUnseenCount === 'function' ? 0 : undefined;
    for (const state of all) {
        if (unread === undefined || !state.source.available) continue;
        try {
            unread += store.getUnseenCount!(state.source.workspaceId);
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
