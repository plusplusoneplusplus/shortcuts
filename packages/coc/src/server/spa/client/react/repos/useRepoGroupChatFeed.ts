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
const historyCache = new Map<string, RepoGroupChatFeedModel>();

export function resetRepoGroupChatFeedCacheForTests(): void { historyCache.clear(); }

function unavailableModel(model: RepoGroupChatFeedModel, error: string): RepoGroupChatFeedModel {
    return {
        ...model, running: [], queued: [], hasMore: false, nextCursor: undefined,
        sources: model.sources.map(source => ({ ...source, available: false, error })),
        counts: { ...model.counts, partial: true },
    };
}

export type RepoGroupChatFeedFilters = Omit<RepoGroupChatFeedQuery, 'cursor' | 'limit'>;

export interface UseRepoGroupChatFeedOptions {
    groupId: string;
    /** Owning server's base URL; absent for a group in the local registry. */
    baseUrl?: string;
    /** Server identity used in row keys (`local` or the remote server id). */
    serverKey: string;
    enabled: boolean;
    /** Connection availability is separate from a retained remote endpoint. */
    ownerAvailable?: boolean;
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
        q: filters.q,
    });
}

export function useRepoGroupChatFeed(options: UseRepoGroupChatFeedOptions): RepoGroupChatFeedState {
    const { groupId, baseUrl, serverKey, enabled, ownerAvailable = true } = options;
    const pageSize = options.pageSize ?? REPO_GROUP_CHAT_FEED_PAGE_SIZE;
    const fKey = filtersKey(options.filters);
    const cacheKey = `${serverKey}|${groupId}|${fKey}|${pageSize}`;
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
    const pageAbortRef = useRef<AbortController | null>(null);

    const fetchFirstPage = useCallback(async (keepDepth: boolean) => {
        const generation = ++generationRef.current;
        abortRef.current?.abort();
        pageAbortRef.current?.abort();
        setLoadingMore(false);
        const controller = new AbortController();
        abortRef.current = controller;
        const current = modelRef.current;
        const loaded = keepDepth && current ? current.history.length
            + (filters?.q?.trim() ? current.running.length + current.queued.length : 0) : 0;
        const limit = Math.min(REPO_GROUP_CHAT_FEED_MAX_PAGE, Math.max(pageSize, loaded));
        if (!keepDepth || !modelRef.current) setStatus('loading');
        try {
            if (!ownerAvailable || serverKey !== 'local' && !baseUrl) throw new Error('The owning server is unavailable.');
            const response = await getRepoGroupChats(groupId, { ...filters, limit }, baseUrl, controller.signal);
            if (generation !== generationRef.current) return;
            let next = buildRepoGroupChatFeedModel(response, serverKey);
            const cached = historyCache.get(cacheKey);
            const unavailable = new Set(next.sources.filter(source => !source.available).map(source => source.workspaceId));
            if (cached && unavailable.size) {
                const keys = new Set(allRepoGroupChatRows(next).map(row => row.key));
                next = { ...next, history: [...next.history, ...cached.history.filter(row =>
                    unavailable.has(row.ownerWorkspaceId) && !keys.has(row.key))] };
            }
            historyCache.set(cacheKey, next);
            if (historyCache.size > 50) historyCache.delete(historyCache.keys().next().value!);
            setModel(next);
            setStatus('ready');
            setError(undefined);
        } catch (err) {
            if (generation !== generationRef.current) return;
            // Keep the last good rows on a failed live refresh; only a cold load errors out.
            setError(errorMessage(err));
            const cached = modelRef.current ?? historyCache.get(cacheKey);
            if (cached) setModel(unavailableModel(cached, errorMessage(err)));
            setStatus(cached ? 'ready' : 'error');
        }
    }, [groupId, baseUrl, serverKey, filters, pageSize, cacheKey, ownerAvailable]);

    // Group, server or filters changed: drop the old rows (another scope's
    // identities must never linger) and load the first page.
    useEffect(() => {
        if (!enabled) {
            generationRef.current++;
            abortRef.current?.abort();
            pageAbortRef.current?.abort();
            setModel(null);
            setStatus('idle');
            setError(undefined);
            return;
        }
        const cached = historyCache.get(cacheKey) ?? null;
        setModel(cached);
        modelRef.current = cached;
        void fetchFirstPage(false);
    }, [enabled, fetchFirstPage, cacheKey]);

    useEffect(() => () => {
        generationRef.current++;
        abortRef.current?.abort();
        pageAbortRef.current?.abort();
    }, []);

    const refresh = useCallback(() => fetchFirstPage(true), [fetchFirstPage]);

    const loadMore = useCallback(async () => {
        const current = modelRef.current;
        if (!enabled || !ownerAvailable || !current?.hasMore || !current.nextCursor || loadingMore) return;
        const generation = generationRef.current;
        const controller = new AbortController();
        pageAbortRef.current = controller;
        setLoadingMore(true);
        try {
            const response = await getRepoGroupChats(
                groupId, { ...filters, limit: pageSize, cursor: current.nextCursor }, baseUrl, controller.signal,
            );
            // A refresh landed meanwhile: this page continues the old ordering.
            if (generation !== generationRef.current || modelRef.current?.nextCursor !== current.nextCursor) return;
            if (response.membershipKey !== current.membershipKey) {
                await fetchFirstPage(false);
                return;
            }
            setModel(prev => {
                if (!prev) return prev;
                const next = appendRepoGroupChatFeedPage(prev, response);
                historyCache.set(cacheKey, next);
                return next;
            });
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
    }, [enabled, ownerAvailable, groupId, baseUrl, filters, pageSize, loadingMore, fetchFirstPage, cacheKey]);

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
        if (!enabled || !ownerAvailable || serverKey !== 'local' && !baseUrl) return;
        const messageEvent = baseUrl ? 'coc-remote-ws-message' : 'coc-local-ws-message';
        const onMessage = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (baseUrl && detail?.baseUrl !== baseUrl) return;
            const message = baseUrl ? detail?.message : detail;
            if (message?.type === 'workspace-topology-changed') {
                generationRef.current++;
                abortRef.current?.abort();
                scheduleRefresh();
            } else if (isRepoGroupChatFeedMessage(message, liveRef.current.sourceIds, liveRef.current.shownIds)) {
                scheduleRefresh();
            }
        };
        const onConnect = (event: Event) => {
            if ((event as CustomEvent).detail?.baseUrl === baseUrl) scheduleRefresh();
        };
        const onSeen = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.baseUrl === baseUrl && liveRef.current.sourceIds.has(detail.workspaceId)) scheduleRefresh();
        };
        window.addEventListener(messageEvent, onMessage);
        window.addEventListener('coc-group-chat-seen', onSeen);
        if (baseUrl) window.addEventListener('coc-remote-ws-connect', onConnect);
        else window.addEventListener('coc-local-ws-connect', onConnect);
        return () => {
            window.removeEventListener(messageEvent, onMessage);
            window.removeEventListener('coc-group-chat-seen', onSeen);
            if (baseUrl) window.removeEventListener('coc-remote-ws-connect', onConnect);
            else window.removeEventListener('coc-local-ws-connect', onConnect);
        };
    }, [enabled, ownerAvailable, serverKey, baseUrl, scheduleRefresh]);

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

    return {
        model: model && !ownerAvailable ? unavailableModel(model, 'The owning server is unavailable.') : model,
        status, error, loadingMore, loadMore, refresh,
    };
}
