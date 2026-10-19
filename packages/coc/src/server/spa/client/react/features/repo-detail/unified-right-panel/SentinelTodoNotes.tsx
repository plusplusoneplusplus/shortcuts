import { useMemo, type KeyboardEvent, type MouseEvent } from 'react';
import { renderAskUserMarkdownInline } from '../../../features/chat/AskUserMarkdown';
import { requestPanelBrowserTab } from '../../../shared/file-path/browser-bridge';
import { buildRemoteCloneKey, parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { decodeSegment, encodeSegment } from '../../../layout/routePath';
import type { SentinelTodoOwner } from './sentinelTodoPanelModel';

type FollowLink = (event: MouseEvent<HTMLAnchorElement>, linkKey: string, href?: string) => void;

/**
 * Inline Markdown for a To-do's notes through the AskUser safe renderer: raw
 * HTML stays escaped and unsafe URL schemes become `#`. A remote ledger's bare
 * `#repos/<ws>/…` links stay on that ledger's server.
 */
export function sentinelTodoNotesHtml(notes: string, owner: SentinelTodoOwner, itemId: string): string {
    const remote = parseRemoteCloneKey(owner.ownerRoutingRef);
    let index = 0;
    return renderAskUserMarkdownInline(notes).replace(/<a href="([^"]*)"/g, (_match, href: string) => {
        const repo = remote && /^#repos\/([^/?"]+)(.*)$/.exec(href);
        let target = href;
        if (repo) {
            try {
                const workspaceId = decodeSegment(repo[1]);
                if (!parseRemoteCloneKey(workspaceId)) {
                    target = `#repos/${encodeSegment(buildRemoteCloneKey(remote.serverId, workspaceId))}${repo[2]}`;
                }
            } catch { /* keep the malformed link as written */ }
        }
        return `<a href="${target}" data-todo-link="${itemId.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}|note:${index++}"`;
    });
}

/** Notes keep the raw text layout; links navigate without reaching the row. */
export function SentinelTodoNotes({ id, notes, owner, itemId, onFollowLink }: {
    id: string; notes: string; owner: SentinelTodoOwner; itemId: string; onFollowLink: FollowLink;
}) {
    const html = useMemo(() => sentinelTodoNotesHtml(notes, owner, itemId),
        [notes, owner.ownerRoutingRef, itemId]);
    const link = (event: { target: EventTarget }) =>
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    const click = (event: MouseEvent<HTMLDivElement>) => {
        const anchor = link(event);
        if (!anchor) return;
        event.stopPropagation();
        const href = anchor.getAttribute('href') ?? '';
        const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
        if (href.startsWith('#')) {
            if (href === '#') { event.preventDefault(); return; }
            onFollowLink(event as unknown as MouseEvent<HTMLAnchorElement>, anchor.dataset.todoLink ?? `${itemId}|note`, href);
        } else if (plain && /^https?:\/\//i.test(href) && requestPanelBrowserTab(href)) {
            event.preventDefault();
        }
    };
    const key = (event: KeyboardEvent<HTMLDivElement>) => { if (link(event)) event.stopPropagation(); };
    return <div id={id} data-testid={`sentinel-todo-notes-${itemId}`} onClick={click} onKeyDown={key} onKeyUp={key}
        className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] [&_a]:rounded [&_a]:text-[#0078d4] [&_a]:underline [&_a:focus-visible]:outline-none [&_a:focus-visible]:ring-1 [&_a:focus-visible]:ring-[#0078d4] dark:[&_a]:text-[#3794ff] [&_code]:rounded [&_code]:bg-black/[0.06] [&_code]:px-0.5 [&_code]:font-mono dark:[&_code]:bg-white/[0.08]"
        dangerouslySetInnerHTML={{ __html: html }} />;
}
