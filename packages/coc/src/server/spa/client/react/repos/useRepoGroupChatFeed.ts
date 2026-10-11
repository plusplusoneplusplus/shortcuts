/**
 * useRepoGroupChatFeed — live, paginated read of a repo group's aggregated chats.
 *
 * Reads `GET /api/repo-groups/:id/chats` from the group's OWNING server (`baseUrl`
 * for a remote group, the local server otherwise) and keeps the list current:
 *
 * - Every request carries a generation; a response that arrives after the group,
 *   server, filters or a newer refresh superseded it is dropped, so a slow reply
 *   can never overwrite newer membership or query results.
 * - "Load more" follows the server cursor. A cursor rejected as stale (409, after a
 *   membership or filter change) or a page with a new membership key restarts
 *   from the first page instead of mixing orderings.
 * - Process/queue events of any source workspace on the owning server's socket
 *   schedule a debounced refresh that keeps the loaded depth, as does that
 *   server's socket reconnecting.
 *
 * Read-only: the hook never mutates chats or queues.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RepoGroupChatFeedQuery } from '@plusplusoneplusplus/coc-client';
import { useQueueOptional } from '../contexts/QueueContext';
import { getRepoGroupChats } from './repoGroupService';
import {
    allRepoGroupChatRows,
    appendRepoGroupChatFeedPage,
    buildRepoGroupChatFeedModel,
    isRepoGroupChatFeedMessage,
    type RepoGroupChatFeedModel,
} from './repoGroupChatFeed';

export const REPO_GROUP_CHAT_FEED_PAGE_SIZE = 50;
/** Server-side cap on one page; a refresh never asks for more. */
export const REPO_GROUP_CHAT_FEED_MAX_PAGE = 200;
export const REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS = 250;

export type RepoGroupChatFeedFilters = Omit<RepoGroupChatFeedQuery, 'cursor' | 'limit'>;

export interface UseRepoGroupChatFeedOptions {
    groupId: string;
    /** Owning server's base URL; absent for a group in the local registry. */
    baseUrl?: string;
    /** Server identity used in row keys (`local` or the remote server id). */
    serverKey: string;
    enabled: boolean;
    filters?: RepoGroupChatFeedFilters;
    pageSize?: number;
}

export interface RepoGroupChatFeedState {
    model: RepoGroupChatFeedModel | null;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error?: string;
    loadingMore: boolean;
    loadMore: () => Promise<void>;
    refresh: () => Promise<void>;
}

function isStaleCursorError(err: unknown): boolean {
    const e = err as { status?: number; code?: string } | null;
    return !!e && (e.status === 409 || e.code === 'STALE_CURSOR');
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function filtersKey(filters: RepoGroupChatFeedFilters | undefined): string {
    if (!filters) return '';
    return JSON.stringify({
        owners: filters.owners ? [...filters.owners].sort() : undefined,
        statuses: filters.statuses ? [...filters.statuses].sort() : undefined,
        archived: filters.archived,
        type: filters.type,
    });
}

export function useRepoGroupChatFeed(options: UseRepoGroupChatFeedOptions): RepoGroupChatFeedState {
    const { groupId, baseUrl, serverKey, enabled } = options;
    const pageSize = options.pageSize ?? REPO_GROUP_CHAT_FEED_PAGE_SIZE;
    const fKey = filtersKey(options.filters);
    // Filters are compared by value so a fresh object each render does not refetch.
    const filters = useMemo(() => options.filters, [fKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const [model, setModel] = useState<RepoGroupChatFeedModel | null>(null);
    const [status, setStatus] = useState<RepoGroupChatFeedState['status']>('idle');
    const [error, setError] = useState<string | undefined>(undefined);
    const [loadingMore, setLoadingMore] = useState(false);

    const generationRef = useRef(0);
    const modelRef = useRef<RepoGroupChatFeedModel | null>(null);
    modelRef.current = model;
    const abortRef = useRef<AbortController | null>(null);

    const fetchFirstPage = useCallback(async (keepDepth: boolean) => {
        const generation = ++generationRef.current;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const loaded = keepDepth ? modelRef.current?.history.length ?? 0 : 0;
        const limit = Math.min(REPO_GROUP_CHAT_FEED_MAX_PAGE, Math.max(pageSize, loaded));
        if (!keepDepth || !modelRef.current) setStatus('loading');
        try {
            const response = await getRepoGroupChats(groupId, { ...filters, limit }, baseUrl, controller.signal);
            if (generation !== generationRef.current) return;
            setModel(buildRepoGroupChatFeedModel(response, serverKey));
            setStatus('ready');
            setError(undefined);
        } catch (err) {
            if (generation !== generationRef.current) return;
            // Keep the last good rows on a failed live refresh; only a cold load errors out.
            setError(errorMessage(err));
            setStatus(modelRef.current ? 'ready' : 'error');
        }
    }, [groupId, baseUrl, serverKey, filters, pageSize]);

    // Group, server or filters changed: drop the old rows (another scope's
    // identities must never linger) and load the first page.
    useEffect(() => {
        if (!enabled) {
            generationRef.current++;
            abortRef.current?.abort();
            setModel(null);
            setStatus('idle');
            setError(undefined);
            return;
        }
        setModel(null);
        modelRef.current = null;
        void fetchFirstPage(false);
    }, [enabled, fetchFirstPage]);

    useEffect(() => () => {
        generationRef.current++;
        abortRef.current?.abort();
    }, []);

    const refresh = useCallback(() => fetchFirstPage(true), [fetchFirstPage]);

    const loadMore = useCallback(async () => {
        const current = modelRef.current;
        if (!enabled || !current?.hasMore || !current.nextCursor || loadingMore) return;
        const generation = generationRef.current;
        setLoadingMore(true);
        try {
            const response = await getRepoGroupChats(
                groupId, { ...filters, limit: pageSize, cursor: current.nextCursor }, baseUrl,
            );
            // A refresh landed meanwhile: this page continues the old ordering.
            if (generation !== generationRef.current || modelRef.current?.nextCursor !== current.nextCursor) return;
            if (response.membershipKey !== current.membershipKey) {
                await fetchFirstPage(false);
                return;
            }
            setModel(prev => (prev ? appendRepoGroupChatFeedPage(prev, response) : prev));
            setError(undefined);
        } catch (err) {
            if (generation !== generationRef.current) return;
            if (isStaleCursorError(err)) {
                await fetchFirstPage(false);
                return;
            }
            setError(errorMessage(err));
        } finally {
            setLoadingMore(false);
        }
    }, [enabled, groupId, baseUrl, filters, pageSize, loadingMore, fetchFirstPage]);

    // ── Live refresh ────────────────────────────────────────────────────────
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleRefresh = useCallback(() => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
            refreshTimerRef.current = null;
            void fetchFirstPage(true);
        }, REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS);
    }, [fetchFirstPage]);
    useEffect(() => () => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    }, [scheduleRefresh]);

    const sourceIds = useMemo(
        () => new Set((model?.sources ?? []).map(source => source.workspaceId)),
        [model?.sources],
    );
    const shownIds = useMemo(
        () => new Set(model ? allRepoGroupChatRows(model).map(row => row.canonicalId) : []),
        [model],
    );
    const liveRef = useRef({ sourceIds, shownIds });
    liveRef.current = { sourceIds, shownIds };

    // Owning server's socket: the local socket for a local group, that remote
    // server's socket otherwise — never another server's events.
    useEffect(() => {
        if (!enabled) return;
        const messageEvent = baseUrl ? 'coc-remote-ws-message' : 'coc-local-ws-message';
        const onMessage = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (baseUrl && detail?.baseUrl !== baseUrl) return;
            const message = baseUrl ? detail?.message : detail;
            if (isRepoGroupChatFeedMessage(message, liveRef.current.sourceIds, liveRef.current.shownIds)) {
                scheduleRefresh();
            }
        };
        const onConnect = (event: Event) => {
            if ((event as CustomEvent).detail?.baseUrl === baseUrl) scheduleRefresh();
        };
        window.addEventListener(messageEvent, onMessage);
        if (baseUrl) window.addEventListener('coc-remote-ws-connect', onConnect);
        return () => {
            window.removeEventListener(messageEvent, onMessage);
            if (baseUrl) window.removeEventListener('coc-remote-ws-connect', onConnect);
        };
    }, [enabled, baseUrl, scheduleRefresh]);

    // Local queue changes reach the SPA only through QueueContext (the local
    // socket's `queue-updated` is not rebroadcast). Remote groups skip this: the
    // shared map can also hold another server's rows under an equal id.
    const queue = useQueueOptional();
    const repoQueueMap = queue?.state.repoQueueMap;
    const queueSignature = useMemo(() => {
        if (baseUrl || !repoQueueMap) return '';
        return [...sourceIds].sort().map(id => {
            const entry = repoQueueMap[id];
            if (!entry) return `${id}:-`;
            const ids = [...(entry.running ?? []), ...(entry.queued ?? [])]
                .map((task: any) => task?.processId ?? task?.id).join(',');
            return `${id}:${ids}`;
        }).join(';');
    }, [baseUrl, repoQueueMap, sourceIds]);
    const lastQueueSignatureRef = useRef<string | null>(null);
    useEffect(() => {
        if (!enabled || !queueSignature) return;
        const previous = lastQueueSignatureRef.current;
        lastQueueSignatureRef.current = queueSignature;
        if (previous !== null && previous !== queueSignature) scheduleRefresh();
    }, [enabled, queueSignature, scheduleRefresh]);

    return { model, status, error, loadingMore, loadMore, refresh };
}
