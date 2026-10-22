import { useEffect, useRef, type MouseEvent } from 'react';
import { getCocClientFor } from '../../../api/cocClient';
import { parseRepoGroupChatDeepLink } from '../../../layout/dashboardRoutes';
import { decodeSegment, encodeSegment, tokenizeHash } from '../../../layout/routePath';
import { buildRemoteCloneKey, parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { parseDashboardChatReference, resolveDashboardChatReference } from '../../../shared/dashboard-discovery/chat-reference';
import {
    excursionStopIndex, getSentinelTodoExcursion, startSentinelTodoExcursion,
    type SentinelTodoExcursionOrigin,
} from '../../repo-detail/unified-right-panel/sentinelTodoExcursion';

type ResponseLinkOrigin = Omit<SentinelTodoExcursionOrigin, 'href' | 'linkKey'>;

/** Recognize only conversation routes; files, panels and workflow runs keep their own handlers. */
function chatTarget(href: string, source: ResponseLinkOrigin) {
    const { segments, query } = tokenizeHash(href);
    if (segments[0] !== 'repos' || !segments[1]) return null;
    const remote = parseRemoteCloneKey(source.owner.ownerRoutingRef);
    const selection = decodeSegment(segments[1]);
    if (remote && !parseRemoteCloneKey(selection)) {
        segments[1] = encodeSegment(buildRemoteCloneKey(remote.serverId, selection));
        href = '#' + segments.join('/') + (query === null ? '' : `?${query}`);
    }
    const member = parseRepoGroupChatDeepLink(href);
    if (member) return { href, selectionId: member.ownerSelectionId, workspaceId: member.ownerWorkspaceId, processId: member.processId };
    if (segments.length !== 4 || !['chats', 'activity', 'tasks'].includes(segments[2])
        || !segments[3] || ['member', 'ralph', 'for-each', 'map-reduce'].includes(segments[3])) return null;
    const selectionId = decodeSegment(segments[1]);
    return { href, selectionId, workspaceId: parseRemoteCloneKey(selectionId)?.workspaceId ?? selectionId,
        processId: decodeSegment(segments[3]) };
}

const UNAVAILABLE = 'Referenced chat unavailable. Reconnect its server and try again.';

/** Response links join the same per-window excursion as To-do links, after read-only verification. */
export function useSentinelResponseLinks(origin: ResponseLinkOrigin | null, notify: (message: string) => void, ownerKey?: string) {
    const pending = useRef<AbortController | null>(null);
    const cancel = () => { pending.current?.abort(); pending.current = null; };
    useEffect(() => {
        window.addEventListener('hashchange', cancel);
        window.addEventListener('pagehide', cancel);
        return () => {
            cancel();
            window.removeEventListener('hashchange', cancel);
            window.removeEventListener('pagehide', cancel);
        };
    }, [origin?.scopeWorkspaceId, origin?.chatId, origin?.owner.ownerWorkspaceId, origin?.owner.ownerRoutingRef, origin?.owner.processId, ownerKey]);

    return (event: MouseEvent<HTMLDivElement>) => {
        if (!origin || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
            || !(event.target instanceof Element)) return;
        const anchor = event.target.closest<HTMLAnchorElement>('.markdown-body a[href]');
        const bubble = anchor?.closest<HTMLElement>('.chat-message.assistant');
        if (!anchor || !bubble || bubble.dataset.chatId !== origin.chatId || !event.currentTarget.contains(anchor)
            || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self') || event.target.closest('img')) return;
        cancel();
        const href = anchor.getAttribute('href') ?? '';
        if (!href.startsWith('#')) return;
        const reference = parseDashboardChatReference(href);
        let target: ReturnType<typeof chatTarget>;
        try { target = reference ? null : chatTarget(href, origin); } catch { return; }
        if (reference?.artifactPath !== undefined || (!reference && !target)) return;
        event.preventDefault();
        const initialHash = window.location.hash;
        const excursionAtClick = getSentinelTodoExcursion();
        const controller = new AbortController();
        pending.current = controller;
        const timer = setTimeout(() => {
            const admitted = current();
            controller.abort();
            if (pending.current === controller) {
                pending.current = null;
                if (admitted) notify(UNAVAILABLE);
            }
        }, 10_000);
        controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
        const current = () => {
            const excursion = getSentinelTodoExcursion();
            return !controller.signal.aborted && pending.current === controller && window.location.hash === initialHash
                && (excursionAtClick === null ? excursion === null : excursion?.origin.owner === excursionAtClick.origin.owner);
        };
        const linkKey = `response:${bubble.dataset.turnIndex ?? ''}:${href}`;
        void (async () => {
            try {
                if (reference) {
                    target = await resolveDashboardChatReference(reference, controller.signal);
                } else if (target) {
                    // A bare route explicitly names page origin. Never let the active
                    // remote clone steal a local workspace with the same raw id.
                    const remote = parseRemoteCloneKey(target.selectionId);
                    const route = remote ? resolveCloneRoute(target.selectionId) : { kind: 'local' as const };
                    if (route.kind === 'unresolved-remote') throw new Error(UNAVAILABLE);
                    const baseUrl = route.kind === 'remote' ? route.baseUrl : undefined;
                    const result = await getCocClientFor(baseUrl).processes.get(target.processId, {
                        workspace: target.workspaceId, exclude: ['conversation', 'toolCalls'],
                    }, { signal: controller.signal });
                    const latest = remote ? resolveCloneRoute(target.selectionId) : route;
                    if (latest.kind !== route.kind || (latest.kind === 'remote' && latest.baseUrl !== baseUrl)
                        || result.process?.id !== target.processId || result.process.type !== 'chat'
                        || result.process.metadata?.workspaceId !== target.workspaceId) throw new Error(UNAVAILABLE);
                }
                if (!current() || !target) return;
                if (target.workspaceId === origin.owner.ownerWorkspaceId && target.processId === origin.owner.processId
                    && target.selectionId === (origin.owner.ownerRoutingRef ?? origin.owner.ownerWorkspaceId)) return;
                // Navigation must succeed before publishing return state. Hash routing
                // observes both together on the next event, including remote/group owners.
                window.location.hash = target.href;
                const excursion = getSentinelTodoExcursion();
                if (excursionStopIndex(excursion, origin.scopeWorkspaceId, origin.chatId) < 0) {
                    startSentinelTodoExcursion({ ...origin, href: initialHash, linkKey });
                }
            } catch {
                if (current()) notify(UNAVAILABLE);
            } finally {
                clearTimeout(timer);
                if (pending.current === controller) pending.current = null;
            }
        })();
    };
}
