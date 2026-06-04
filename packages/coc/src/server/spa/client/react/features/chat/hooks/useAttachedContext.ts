import { useState, useCallback, useRef } from 'react';
import type { SessionContextDragPayload, SessionContextSourceStatus } from '../sessionContextDrag';

export interface AttachedTurnContextItem {
    kind: 'turn';
    id: string;
    turnIndex: number;
    role: 'user' | 'assistant';
    snippet: string;
    preview: string;
}

export interface AttachedSessionContextItem {
    kind: 'session';
    id: string;
    sourceWorkspaceId: string;
    sourceProcessId: string;
    title: string;
    status: SessionContextSourceStatus;
    lastActivityAt: string;
    preview: string;
}

export type AttachedContextItem = AttachedTurnContextItem | AttachedSessionContextItem;

const PREVIEW_LENGTH = 100;

function truncatePreview(text: string): string {
    const oneLine = text.replace(/\n/g, ' ').trim();
    if (oneLine.length <= PREVIEW_LENGTH) return oneLine;
    return oneLine.slice(0, PREVIEW_LENGTH) + '…';
}

function escapeContextText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function shortenSessionProcessId(processId: string): string {
    if (processId.length <= 14) return processId;
    return `${processId.slice(0, 8)}…${processId.slice(-4)}`;
}

export function buildSessionContextPreview(source: Pick<SessionContextDragPayload, 'title' | 'status' | 'lastActivityAt' | 'sourceProcessId'>): string {
    return `${source.title} · ${source.status} · ${source.lastActivityAt} · ${shortenSessionProcessId(source.sourceProcessId)}`;
}

let nextId = 0;

export function useAttachedContext() {
    const [items, setItems] = useState<AttachedContextItem[]>([]);
    const itemsRef = useRef<AttachedContextItem[]>([]);
    itemsRef.current = items;

    const add = useCallback((turnIndex: number, role: 'user' | 'assistant', snippet: string) => {
        const item: AttachedTurnContextItem = {
            kind: 'turn',
            id: `ctx-${++nextId}`,
            turnIndex,
            role,
            snippet,
            preview: truncatePreview(snippet),
        };
        setItems(prev => [...prev, item]);
    }, []);

    const addSession = useCallback((source: SessionContextDragPayload) => {
        const item: AttachedSessionContextItem = {
            kind: 'session',
            id: `ctx-${++nextId}`,
            sourceWorkspaceId: source.sourceWorkspaceId,
            sourceProcessId: source.sourceProcessId,
            title: source.title,
            status: source.status,
            lastActivityAt: source.lastActivityAt,
            preview: buildSessionContextPreview(source),
        };
        setItems(prev => [...prev, item]);
    }, []);

    const remove = useCallback((id: string) => {
        setItems(prev => prev.filter(item => item.id !== id));
    }, []);

    const clear = useCallback(() => {
        setItems([]);
    }, []);

    const getItems = useCallback(() => itemsRef.current, []);

    return { items, add, addSession, remove, clear, getItems };
}

/**
 * Format attached context items into a text block to prepend to the user message.
 */
export function formatAttachedContext(items: AttachedContextItem[]): string {
    if (items.length === 0) return '';
    return items.map(item => {
        if (item.kind === 'session') {
            return [
                '<attached_session_context version="1">',
                `<source workspace_id="${escapeContextText(item.sourceWorkspaceId)}" process_id="${escapeContextText(item.sourceProcessId)}" status="${escapeContextText(item.status)}" last_activity_at="${escapeContextText(item.lastActivityAt)}">`,
                `<title>${escapeContextText(item.title)}</title>`,
                '<instruction>Before answering, retrieve and read this source conversation by process ID using the available conversation retrieval tool.</instruction>',
                '</source>',
                '</attached_session_context>',
            ].join('\n');
        }

        return `<context from="${item.role}" turn="${item.turnIndex}">\n${item.snippet}\n</context>`;
    }).join('\n\n') + '\n\n';
}
