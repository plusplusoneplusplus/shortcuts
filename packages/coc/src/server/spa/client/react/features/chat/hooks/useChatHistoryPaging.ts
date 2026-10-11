import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PAGE_TURNS } from '@plusplusoneplusplus/forge/history-paging';
import type { CocClient, ConversationTurn } from '@plusplusoneplusplus/coc-client';
import type { ClientConversationTurn } from '../../../types/dashboard';

export interface ChatHistoryPage {
    oldestTurnIndex: number | null;
    hasMore: boolean;
    totalTurns: number;
    historyRevision: number;
}

type TurnSetter = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;
const timelineSelector = '[data-turn-index]:not([data-pinned-section] *)';
function clientTurns(turns: Array<ConversationTurn | ClientConversationTurn>): ClientConversationTurn[] {
    return turns.map(turn => ({
        ...turn,
        timestamp: turn.timestamp instanceof Date ? turn.timestamp.toISOString() : turn.timestamp,
        timeline: Array.isArray(turn.timeline) ? turn.timeline : [],
    } as ClientConversationTurn));
}

export function mergeHistoryTurns(older: ClientConversationTurn[], newer: ClientConversationTurn[]): ClientConversationTurn[] {
    const indexed = new Map<number, ClientConversationTurn>();
    for (const turn of [...older, ...newer]) {
        if (turn.turnIndex != null) indexed.set(turn.turnIndex, turn);
    }
    return [...indexed.values()].sort((a, b) => a.turnIndex! - b.turnIndex!);
}

export function useChatHistoryPaging({
    enabled, scopeKey, client, workspaceId, processId, turns, turnsRef, setTurns,
    scrollRef, onReset,
}: {
    enabled: boolean | null;
    scopeKey: string;
    client: CocClient;
    workspaceId?: string;
    processId: string | null;
    turns: ClientConversationTurn[];
    turnsRef: React.MutableRefObject<ClientConversationTurn[]>;
    setTurns: TurnSetter;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    onReset: () => void;
}) {
    const [history, setHistory] = useState<ChatHistoryPage | null>(null);
    const historyRef = useRef<ChatHistoryPage | null>(null);
    const latestBoundary = useRef<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [target, setTarget] = useState<number | null>(null);
    const [pins, setPins] = useState<ClientConversationTurn[]>([]);
    const [sentinel, sentinelRef] = useState<HTMLDivElement | null>(null);
    const requests = useRef(new Set<AbortController>());
    const pinsRequest = useRef<AbortController | null>(null);
    const generation = useRef(0);
    const inflight = useRef<Promise<boolean> | null>(null);
    const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
    const failures = useRef(0);
    const intersecting = useRef(false);
    const navigation = useRef<number | null>(null);
    const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const anchor = useRef<{ index: string; offset: number; bottom: boolean } | null>(null);
    const callbacks = useRef({ setTurns, onReset });
    callbacks.current = { setTurns, onReset };
    const identity = `${scopeKey}|${enabled}`;
    const identityRef = useRef(identity);
    // Revoke reads synchronously, before passive cleanup on an owner switch.
    if (identityRef.current !== identity) {
        identityRef.current = identity;
        generation.current++;
        for (const request of requests.current) request.abort();
        historyRef.current = null;
        latestBoundary.current = null;
        inflight.current = null;
        navigation.current = null;
        anchor.current = null;
    }
    useEffect(() => {
        setHistory(null);
        setLoading(false);
        setError(false);
        setTarget(null);
        failures.current = 0;
        setPins([]);
        failures.current = 0;
        intersecting.current = false;
        return () => {
            generation.current++;
            for (const request of requests.current) request.abort();
            requests.current.clear();
            if (retry.current) clearTimeout(retry.current);
            if (highlightTimer.current) clearTimeout(highlightTimer.current);
        };
    }, [identity, client]);

    const publish = useCallback((page: ChatHistoryPage) => {
        historyRef.current = page;
        setHistory(page);
    }, []);

    const acceptSnapshot = useCallback((newTurns: ClientConversationTurn[], page?: ChatHistoryPage) => {
        if (!enabled || !page) return newTurns;
        const previous = historyRef.current;
        const changed = previous != null && previous.historyRevision !== page.historyRevision;
        if (changed) {
            generation.current++;
            for (const request of requests.current) request.abort();
            inflight.current = null;
            navigation.current = null;
            anchor.current = null;
            if (retry.current) clearTimeout(retry.current);
            setLoading(false);
            setError(false);
            setTarget(null);
            callbacks.current.onReset();
        }
        latestBoundary.current = page.oldestTurnIndex;
        const retained = !changed && previous && page.oldestTurnIndex != null
            ? turnsRef.current.filter(t => t.turnIndex != null && t.turnIndex < page.oldestTurnIndex!)
            : [];
        publish(retained.length ? {
            ...page, oldestTurnIndex: previous!.oldestTurnIndex, hasMore: previous!.hasMore,
        } : page);
        return mergeHistoryTurns(retained, newTurns);
    }, [enabled, publish, turnsRef]);

    const readProcess = useCallback(async (id: string) => {
        const controller = new AbortController();
        const epoch = generation.current;
        requests.current.add(controller);
        try {
            const options = { ...(workspaceId ? { workspace: workspaceId } : {}), ...(enabled ? { turnsLimit: PAGE_TURNS } : {}) };
            const data = enabled
                ? await client.processes.get(id, options, { signal: controller.signal })
                : workspaceId ? await client.processes.get(id, options) : await client.processes.get(id);
            if (controller.signal.aborted || epoch !== generation.current) throw new DOMException('Chat changed', 'AbortError');
            if (enabled && data.history && data.process) {
                return { ...data, process: { ...data.process, conversationTurns: acceptSnapshot(clientTurns(data.process.conversationTurns ?? []), data.history) } };
            }
            return data;
        } finally {
            requests.current.delete(controller);
        }
    }, [client, workspaceId, enabled, acceptSnapshot]);

    const captureAnchor = useCallback(() => {
        const sc = scrollRef.current;
        if (!sc) return;
        const top = sc.getBoundingClientRect().top;
        const first = Array.from(sc.querySelectorAll<HTMLElement>(timelineSelector))
            .find(el => el.getBoundingClientRect().bottom > top);
        if (first) anchor.current = {
            index: first.dataset.turnIndex!, offset: first.getBoundingClientRect().top - top,
            bottom: sc.scrollHeight - sc.scrollTop - sc.clientHeight < 100,
        };
    }, [scrollRef]);
    useLayoutEffect(() => {
        const saved = anchor.current;
        const sc = scrollRef.current;
        if (!saved || !sc) return;
        anchor.current = null;
        if (saved.bottom) {
            sc.scrollTop = sc.scrollHeight;
        } else {
            const el = sc.querySelector<HTMLElement>(`[data-turn-index="${saved.index}"]:not([data-pinned-section] *)`);
            if (el) sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - saved.offset;
        }
    }, [turns, scrollRef]);

    const loadOlderRef = useRef<() => Promise<boolean>>(async () => false);
    const loadOlder = useCallback((): Promise<boolean> => {
        if (inflight.current) return inflight.current;
        const current = historyRef.current;
        if (!enabled || !processId || !current?.hasMore || current.oldestTurnIndex == null) return Promise.resolve(false);
        if (retry.current) clearTimeout(retry.current);
        const controller = new AbortController();
        const epoch = generation.current;
        const ownerIdentity = identityRef.current;
        requests.current.add(controller);
        setLoading(true);
        setError(false);
        let promise: Promise<boolean>;
        promise = Promise.resolve().then(async () => {
            try {
                const page = await client.processes.listTurns(processId, { workspace: workspaceId, beforeTurnIndex: current.oldestTurnIndex!, limit: PAGE_TURNS }, { signal: controller.signal });
                if (controller.signal.aborted || epoch !== generation.current) return false;
                if (page.historyRevision !== historyRef.current?.historyRevision) {
                    inflight.current = null;
                    const latest = await readProcess(processId);
                    if (ownerIdentity === identityRef.current && latest.process) callbacks.current.setTurns(clientTurns(latest.process.conversationTurns ?? []));
                    return false;
                }
                // An empty/non-advancing page cannot create a gap or a retry loop.
                if (!page.turns.length || page.oldestTurnIndex == null || page.oldestTurnIndex >= current.oldestTurnIndex!) {
                    publish({ ...current, hasMore: false });
                    return false;
                }
                captureAnchor();
                publish(page);
                callbacks.current.setTurns(prev => mergeHistoryTurns(clientTurns(page.turns), prev));
                failures.current = 0;
                return true;
            } catch {
                if (controller.signal.aborted || epoch !== generation.current) return false;
                setError(true);
                const delay = Math.min(1000 * 2 ** failures.current++, 30000);
                retry.current = setTimeout(() => {
                    if (epoch === generation.current && (intersecting.current || navigation.current != null)) {
                        if (navigation.current != null) void navigateRef.current(navigation.current);
                        else void loadOlderRef.current();
                    }
                }, delay);
                return false;
            } finally {
                requests.current.delete(controller);
                if (inflight.current === promise) {
                    inflight.current = null;
                    if (ownerIdentity === identityRef.current) setLoading(false);
                }
            }
        });
        inflight.current = promise;
        return promise;
    }, [enabled, processId, client, workspaceId, publish, captureAnchor, readProcess]);
    loadOlderRef.current = loadOlder;

    const navigateRef = useRef<(index: number) => Promise<void>>(async () => {});
    const navigateToTurn = useCallback(async (index: number) => {
        if (!Number.isInteger(index) || index < 0) return;
        const epoch = generation.current;
        navigation.current = index;
        if (!turnsRef.current.some(t => t.turnIndex === index)) setTarget(index);
        while (epoch === generation.current && navigation.current === index && !turnsRef.current.some(t => t.turnIndex === index) && historyRef.current?.hasMore) {
            if (!await loadOlder()) {
                if (!historyRef.current?.hasMore) break;
                return;
            }
        }
        if (epoch !== generation.current || navigation.current !== index) return;
        navigation.current = null;
        setTarget(null);
        requestAnimationFrame(() => {
            if (epoch !== generation.current) return;
            const sc = scrollRef.current;
            const el = sc?.querySelector<HTMLElement>(`[data-turn-index="${index}"]:not([data-pinned-section] *)`);
            if (!sc || !el) return;
            const top = Math.max(0, sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 14);
            if (typeof sc.scrollTo === 'function') sc.scrollTo({ top, behavior: 'smooth' });
            else sc.scrollTop = top;
            el.classList.add('minimap-highlight-pulse');
            highlightTimer.current = setTimeout(() => el.classList.remove('minimap-highlight-pulse'), 1100);
        });
    }, [loadOlder, scrollRef, turnsRef]);
    navigateRef.current = navigateToTurn;

    useEffect(() => {
        const sc = scrollRef.current;
        if (!enabled || !history?.hasMore || !sc || !sentinel || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(entries => {
            intersecting.current = entries.some(entry => entry.isIntersecting);
            if (intersecting.current) {
                if (navigation.current != null) void navigateRef.current(navigation.current);
                else void loadOlderRef.current();
            }
        }, { root: sc, rootMargin: `${sc.clientHeight || 600}px 0px 0px 0px` });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [enabled, history?.hasMore, history?.oldestTurnIndex, scrollRef, sentinel]);

    const refreshPins = useCallback(() => {
        if (!enabled || !processId) return;
        pinsRequest.current?.abort();
        const controller = new AbortController();
        pinsRequest.current = controller;
        const epoch = generation.current;
        requests.current.add(controller);
        void client.processes.pinnedTurns(processId, { workspace: workspaceId }, { signal: controller.signal })
            .then(data => {
                if (!controller.signal.aborted && epoch === generation.current) setPins(clientTurns(data.turns));
            }).catch(() => {}).finally(() => requests.current.delete(controller));
    }, [enabled, processId, client, workspaceId]);
    useEffect(() => {
        if (history) refreshPins();
    }, [refreshPins, history?.historyRevision]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        history, loading, error, target, pins, sentinelRef, readProcess, acceptSnapshot, navigateToTurn, refreshPins,
        cacheTurns: (all: ClientConversationTurn[]) => {
            if (!enabled) return all;
            const latest = latestBoundary.current == null ? [] : all.filter(t => t.turnIndex != null && t.turnIndex >= latestBoundary.current!);
            let start = Math.max(0, latest.length - PAGE_TURNS);
            if (start > 0 && latest[start].role === 'assistant' && latest[start - 1].role === 'user') start--;
            return latest.slice(start);
        },
    };
}
