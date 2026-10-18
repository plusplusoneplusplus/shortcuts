import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { SentinelTodoConversationReference, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { resolveDashboardChatReference } from '../../../shared/dashboard-discovery/chat-reference';
import { buildRemoteCloneKey, parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { encodeSegment, repoHashBase } from '../../../layout/routePath';
import type { SentinelTodoOwner } from './sentinelTodoPanelModel';

const UNAVAILABLE = 'Referenced chat unavailable. Reconnect its server and try again.';

type FollowLink = (event: MouseEvent<HTMLAnchorElement>, linkKey: string, href?: string) => void;

/** References only navigate; ownership checks never update the ledger. */
export function SentinelTodoConversationReferences({ item, owner, onFollowLink }: {
    item: SentinelTodoItem; owner: SentinelTodoOwner; onFollowLink: FollowLink;
}) {
    const pending = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
    const [opening, setOpening] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cancel = () => {
        if (!pending.current) return;
        pending.current.controller.abort();
        clearTimeout(pending.current.timer);
        pending.current = null;
    };
    useEffect(() => {
        setOpening(null);
        setError(null);
        const leave = () => { cancel(); setOpening(null); };
        window.addEventListener('hashchange', leave);
        window.addEventListener('pagehide', leave);
        return () => {
            cancel();
            window.removeEventListener('hashchange', leave);
            window.removeEventListener('pagehide', leave);
        };
    }, [item.id, owner.ownerWorkspaceId, owner.ownerRoutingRef, owner.processId]);

    const follow = async (event: MouseEvent<HTMLAnchorElement>, ref: SentinelTodoConversationReference, key: string) => {
        if (!ref.serverIdentity || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            onFollowLink(event, key);
            return;
        }
        event.preventDefault();
        cancel();
        setError(null);
        setOpening(key);
        const initialHash = window.location.hash;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            if (pending.current?.controller !== controller) return;
            cancel();
            setOpening(null);
            setError(UNAVAILABLE);
        }, 10_000);
        pending.current = { controller, timer };
        try {
            const result = await resolveDashboardChatReference({
                serverIdentity: ref.serverIdentity, workspaceId: ref.workspaceId, processId: ref.processId,
            }, controller.signal);
            if (controller.signal.aborted || pending.current?.controller !== controller || window.location.hash !== initialHash) return;
            // The event's currentTarget is cleared after dispatch; pass the verified href explicitly.
            onFollowLink(event, key, result.href);
            window.location.hash = result.href;
        } catch {
            if (!controller.signal.aborted && pending.current?.controller === controller) setError(UNAVAILABLE);
        } finally {
            if (pending.current?.controller === controller) {
                clearTimeout(timer);
                pending.current = null;
                setOpening(null);
            }
        }
    };
    const refs = item.references?.filter((ref): ref is SentinelTodoConversationReference => ref.kind === undefined || ref.kind === 'conversation') ?? [];
    if (!refs.length) return null;
    return <div className="px-2 pb-1.5">
        <ul className="flex flex-col gap-0.5" aria-label={`Referenced conversations for ${item.title}`}>
            {refs.map(ref => {
                const identity = JSON.stringify([ref.serverIdentity ?? null, ref.workspaceId, ref.processId]);
                const key = `${item.id}|ref:${identity}`;
                const remoteOwner = parseRemoteCloneKey(owner.ownerRoutingRef);
                const href = ref.serverIdentity ? `#chat-references/${[ref.serverIdentity, ref.workspaceId, ref.processId].map(encodeSegment).join('/')}`
                    : `${repoHashBase(remoteOwner ? buildRemoteCloneKey(remoteOwner.serverId, ref.workspaceId) : ref.workspaceId)}/chats/`
                        + (ref.sessionId ? `ralph/${encodeSegment(ref.sessionId)}` : encodeSegment(ref.processId));
                return <li key={identity} className="flex min-w-0 flex-wrap items-center gap-1" data-testid={`sentinel-todo-reference-${item.id}-${ref.processId}`}>
                    <span className="shrink-0 rounded bg-black/[0.06] px-1 text-[10px] font-medium uppercase tracking-wide text-[#616161] dark:bg-white/[0.08] dark:text-[#a0a0a0]">Ref</span>
                    <a href={href} title={ref.title ?? ref.processId} data-todo-link={key}
                        onClick={event => { void follow(event, ref, key); }}
                        className="min-w-0 truncate text-[#0078d4] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] dark:text-[#3794ff]">
                        {ref.title ?? ref.processId}
                    </a>
                    {(ref.serverLabel || ref.workspaceLabel) && <span className="text-[10px] text-[#616161] dark:text-[#a0a0a0]">{[ref.serverLabel, ref.workspaceLabel].filter(Boolean).join(' · ')}</span>}
                    {ref.verification === 'unverified' && <span className="text-[10px]">Unverified</span>}
                    {opening === key && <span role="status" className="text-[10px]">Checking chat…</span>}
                </li>;
            })}
        </ul>
        {error && <p role="alert" className="text-xs text-[#c72e2e] dark:text-[#f48771]">{error} Click the reference to retry.</p>}
    </div>;
}
