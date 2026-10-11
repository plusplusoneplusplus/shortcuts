/**
 * repoGroupChatFeed — pure model for a repo group's aggregated chat list.
 *
 * The group's owning server answers `GET /api/repo-groups/:id/chats` with rows
 * from the group itself and every explicit member. This module turns those pages
 * into rows with a stable identity and keeps them consistent while pages are
 * appended and the list refreshes live:
 *
 * - Identity is `serverKey | ownerWorkspaceId | canonicalChatId`. Titles, URLs and
 *   list positions never identify a chat, so an equal id or title under another
 *   owner (or another server) stays a separate row.
 * - A chat moving queued → running → history keeps one canonical id (the queue
 *   task's `processId`, else its `queue_<taskId>` alias), so it shows once, in the
 *   most active section it is in.
 *
 * Nothing here moves, merges or re-owns chats — it is navigation state only.
 */
import type {
    RepoGroupChatCounts,
    RepoGroupChatFeedResponse,
    RepoGroupChatSource,
} from '@plusplusoneplusplus/coc-client';
import { ensureQueueProcessId } from '../utils/queue-process-id';

export type RepoGroupChatSection = 'running' | 'queued' | 'history';

export interface RepoGroupChatRow {
    /** Stable identity: `serverKey|ownerWorkspaceId|canonicalId`. */
    key: string;
    serverKey: string;
    ownerWorkspaceId: string;
    /** `group` for chats owned by the viewed group workspace itself. */
    ownerRole: 'group' | 'member';
    ownerName?: string;
    /** Process id the owner's chat routes use (queue rows: `processId` or `queue_<id>`). */
    canonicalId: string;
    /** Actual queue task id, absent for process-store-only active rows. */
    queueTaskId?: string;
    section: RepoGroupChatSection;
    /** The owner's native row (queue task summary or process history item). */
    item: any;
}

export interface RepoGroupChatFeedModel {
    groupId: string;
    serverKey: string;
    membershipKey: string;
    sources: RepoGroupChatSource[];
    running: RepoGroupChatRow[];
    queued: RepoGroupChatRow[];
    history: RepoGroupChatRow[];
    hasMore: boolean;
    nextCursor?: string;
    counts: RepoGroupChatCounts;
    snippets?: Record<string, Record<string, string>>;
}

/** Server identity for the dashboard's own registry. */
export const LOCAL_CHAT_FEED_SERVER_KEY = 'local';

export function repoGroupChatKey(serverKey: string, ownerWorkspaceId: string, canonicalId: string): string {
    return `${serverKey}|${ownerWorkspaceId}|${canonicalId}`;
}

/** Canonical chat id of a feed row; `undefined` for malformed rows. */
export function canonicalChatId(item: any, section: RepoGroupChatSection): string | undefined {
    if (!item || typeof item !== 'object') return undefined;
    if (section === 'history') return typeof item.id === 'string' && item.id ? item.id : undefined;
    if (typeof item.processId === 'string' && item.processId) return item.processId;
    return typeof item.id === 'string' && item.id ? ensureQueueProcessId(item.id) : undefined;
}

function toRows(
    items: any[] | undefined,
    section: RepoGroupChatSection,
    serverKey: string,
    sources: Map<string, RepoGroupChatSource>,
): RepoGroupChatRow[] {
    const rows: RepoGroupChatRow[] = [];
    for (const item of items ?? []) {
        const owner = typeof item?.ownerWorkspaceId === 'string' ? item.ownerWorkspaceId : undefined;
        const canonicalId = canonicalChatId(item, section);
        if (!owner || !canonicalId) continue;
        const source = sources.get(owner);
        rows.push({
            key: repoGroupChatKey(serverKey, owner, canonicalId),
            serverKey,
            ownerWorkspaceId: owner,
            ownerRole: source?.role ?? 'member',
            ...(source?.name ? { ownerName: source.name } : {}),
            canonicalId,
            ...(section !== 'history' && typeof item.queueTaskId === 'string' && item.queueTaskId
                ? { queueTaskId: item.queueTaskId } : {}),
            section,
            item,
        });
    }
    return rows;
}

/** Drop rows whose key is in `taken` or repeats inside `rows`; records kept keys in `taken`. */
function uniqueRows(rows: RepoGroupChatRow[], taken: Set<string>): RepoGroupChatRow[] {
    const kept: RepoGroupChatRow[] = [];
    for (const row of rows) {
        if (taken.has(row.key)) continue;
        taken.add(row.key);
        kept.push(row);
    }
    return kept;
}

/**
 * Build the model from a first page. Each chat appears once: running wins over
 * queued, queued over history (a queued follow-up of a finished chat shares the
 * chat's process id).
 */
export function buildRepoGroupChatFeedModel(
    response: RepoGroupChatFeedResponse<object, object>,
    serverKey: string,
): RepoGroupChatFeedModel {
    const sources = new Map(response.sources.map(source => [source.workspaceId, source]));
    const taken = new Set<string>();
    const running = uniqueRows(toRows(response.running, 'running', serverKey, sources), taken);
    const queued = uniqueRows(toRows(response.queued, 'queued', serverKey, sources), taken);
    const history = uniqueRows(toRows(response.history, 'history', serverKey, sources), taken);
    return {
        groupId: response.groupId,
        serverKey,
        membershipKey: response.membershipKey,
        sources: response.sources,
        running,
        queued,
        history,
        hasMore: response.hasMore,
        ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
        counts: response.counts,
        snippets: response.snippets,
    };
}

/**
 * Append a "Load more" page. Rows already shown (in any section) are
 * skipped, so an overlap between pages never duplicates a chat. Sources and
 * counts come from the newer page.
 */
export function appendRepoGroupChatFeedPage(
    model: RepoGroupChatFeedModel,
    response: RepoGroupChatFeedResponse<object, object>,
): RepoGroupChatFeedModel {
    const sources = new Map(response.sources.map(source => [source.workspaceId, source]));
    const taken = new Set<string>([
        ...model.running.map(row => row.key),
        ...model.queued.map(row => row.key),
        ...model.history.map(row => row.key),
    ]);
    const running = uniqueRows(toRows(response.running, 'running', model.serverKey, sources), taken);
    const queued = uniqueRows(toRows(response.queued, 'queued', model.serverKey, sources), taken);
    const more = uniqueRows(toRows(response.history, 'history', model.serverKey, sources), taken);
    const { nextCursor: _previousCursor, ...rest } = model;
    return {
        ...rest,
        sources: response.sources,
        running: running.length ? [...model.running, ...running] : model.running,
        queued: queued.length ? [...model.queued, ...queued] : model.queued,
        history: [...model.history, ...more],
        snippets: Object.fromEntries(response.sources.map(source => [source.workspaceId, {
            ...model.snippets?.[source.workspaceId], ...response.snippets?.[source.workspaceId],
        }])),
        hasMore: response.hasMore,
        ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
        counts: response.counts,
    };
}

/** Every row in display-section order (running, queued, history). */
export function allRepoGroupChatRows(model: RepoGroupChatFeedModel): RepoGroupChatRow[] {
    return [...model.running, ...model.queued, ...model.history];
}

/**
 * Whether a socket message from the group's owning server can change the list:
 * process lifecycle or queue changes for any source workspace, or removal of a
 * chat the list currently shows.
 */
export function isRepoGroupChatFeedMessage(
    message: any,
    sourceWorkspaceIds: ReadonlySet<string>,
    shownCanonicalIds: ReadonlySet<string>,
): boolean {
    if (!message || typeof message.type !== 'string') return false;
    switch (message.type) {
        case 'process-added':
        case 'process-updated': {
            const workspaceId = message.process?.workspaceId;
            return typeof workspaceId === 'string' && sourceWorkspaceIds.has(workspaceId);
        }
        case 'process-removed':
            return typeof message.processId === 'string' && shownCanonicalIds.has(message.processId);
        case 'queue-updated': {
            const repoId = message.queue?.repoId;
            return typeof repoId === 'string' && sourceWorkspaceIds.has(repoId);
        }
        default:
            return false;
    }
}
