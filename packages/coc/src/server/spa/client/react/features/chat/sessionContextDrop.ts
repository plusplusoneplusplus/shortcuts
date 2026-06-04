import { useEffect, useState } from 'react';
import { getSpaCocClient } from '../../api/cocClient';
import type { AttachedContextItem } from './hooks/useAttachedContext';
import {
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    type SessionContextDragPayload,
    type SessionContextSourceStatus,
} from './sessionContextDrag';

export const MAX_SESSION_CONTEXT_ATTACHMENTS = 3;

const ATTACHABLE_STATUSES = new Set<SessionContextSourceStatus>([
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled',
]);

const MAX_TITLE_LENGTH = 160;

type SessionContextDataTransfer = Pick<DataTransfer, 'getData'> & {
    types?: Iterable<string>;
    dropEffect?: DataTransfer['dropEffect'];
};

export type SessionContextDropValidation =
    | { ok: true; payload: SessionContextDragPayload }
    | { ok: false; error: string };

function getSessionContextItems(items: AttachedContextItem[]): Extract<AttachedContextItem, { kind: 'session' }>[] {
    return items.filter((item): item is Extract<AttachedContextItem, { kind: 'session' }> => item.kind === 'session');
}

function looksLikeLocalPath(value: string): boolean {
    return value.startsWith('/')
        || value.startsWith('~/')
        || /^[A-Za-z]:[\\/]/.test(value)
        || value.includes('\\');
}

function sanitizeDisplayText(value: string): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    const withoutPaths = compact
        .replace(/(^|\s)~\/[^\s"'`<>]+/g, '$1[path]')
        .replace(/\b[A-Za-z]:[\\/][^\s"'`<>]+/g, '[path]')
        .replace(/(^|\s)\/[^\s"'`<>]+/g, '$1[path]');
    return withoutPaths.length > MAX_TITLE_LENGTH
        ? withoutPaths.slice(0, MAX_TITLE_LENGTH - 1) + '…'
        : withoutPaths;
}

function normalizeTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSessionContextPayload(value: unknown): SessionContextDragPayload | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<SessionContextDragPayload>;
    const sourceWorkspaceId = normalizeString(record.sourceWorkspaceId);
    const sourceProcessId = normalizeString(record.sourceProcessId);
    const title = normalizeString(record.title);
    const status = normalizeString(record.status);
    const lastActivityAt = normalizeTimestamp(record.lastActivityAt);

    if (
        record.kind !== SESSION_CONTEXT_DRAG_KIND
        || record.version !== 1
        || !sourceWorkspaceId
        || !sourceProcessId
        || !status
        || !ATTACHABLE_STATUSES.has(status as SessionContextSourceStatus)
        || !lastActivityAt
        || looksLikeLocalPath(sourceWorkspaceId)
        || looksLikeLocalPath(sourceProcessId)
    ) {
        return null;
    }

    return {
        kind: SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId,
        sourceProcessId,
        title: sanitizeDisplayText(title ?? sourceProcessId),
        status: status as SessionContextSourceStatus,
        lastActivityAt,
    };
}

export function dataTransferHasSessionContext(dataTransfer: SessionContextDataTransfer | null | undefined): boolean {
    if (!dataTransfer) return false;
    return Array.from(dataTransfer.types ?? []).includes(SESSION_CONTEXT_DRAG_MIME);
}

export function readSessionContextDragPayload(dataTransfer: SessionContextDataTransfer): SessionContextDragPayload | null {
    const raw = dataTransfer.getData(SESSION_CONTEXT_DRAG_MIME);
    if (!raw) return null;
    try {
        return normalizeSessionContextPayload(JSON.parse(raw));
    } catch {
        return null;
    }
}

export function validateSessionContextDrop(options: {
    payload: SessionContextDragPayload | null;
    featureEnabled: boolean;
    activeWorkspaceId?: string | null;
    currentProcessId?: string | null;
    existingItems: AttachedContextItem[];
    canRetrieveConversations: boolean | null;
}): SessionContextDropValidation {
    if (!options.featureEnabled) {
        return { ok: false, error: 'Session context attachments are disabled.' };
    }
    if (!options.payload) {
        return { ok: false, error: 'Drop a CoC session from this workspace to attach it as context.' };
    }
    if (!options.activeWorkspaceId) {
        return { ok: false, error: 'Open a workspace before attaching session context.' };
    }
    if (options.payload.sourceWorkspaceId !== options.activeWorkspaceId) {
        return { ok: false, error: 'Only sessions from the active workspace can be attached as context.' };
    }
    if (options.currentProcessId && options.payload.sourceProcessId === options.currentProcessId) {
        return { ok: false, error: 'A follow-up cannot attach its own current session as context.' };
    }

    const sessionItems = getSessionContextItems(options.existingItems);
    if (sessionItems.some(item =>
        item.sourceWorkspaceId === options.payload!.sourceWorkspaceId
        && item.sourceProcessId === options.payload!.sourceProcessId
    )) {
        return { ok: false, error: 'This session is already attached to the message.' };
    }
    if (sessionItems.length >= MAX_SESSION_CONTEXT_ATTACHMENTS) {
        return { ok: false, error: `You can attach up to ${MAX_SESSION_CONTEXT_ATTACHMENTS} sessions as context.` };
    }
    if (options.canRetrieveConversations === null) {
        return { ok: false, error: 'Checking conversation retrieval capability. Try again shortly.' };
    }
    if (options.canRetrieveConversations !== true) {
        return { ok: false, error: 'Conversation retrieval is not available for this chat.' };
    }

    return { ok: true, payload: options.payload };
}

export function validateSessionContextAttachmentsForSend(options: {
    featureEnabled: boolean;
    activeWorkspaceId?: string | null;
    currentProcessId?: string | null;
    items: AttachedContextItem[];
    canRetrieveConversations: boolean | null | undefined;
}): string | null {
    const sessionItems = getSessionContextItems(options.items);
    if (sessionItems.length === 0) return null;

    if (!options.featureEnabled) {
        return 'Session context attachments are disabled.';
    }
    if (!options.activeWorkspaceId) {
        return 'Open a workspace before attaching session context.';
    }
    if (sessionItems.some(item => item.sourceWorkspaceId !== options.activeWorkspaceId)) {
        return 'Only sessions from the active workspace can be attached as context.';
    }
    if (options.currentProcessId && sessionItems.some(item => item.sourceProcessId === options.currentProcessId)) {
        return 'A follow-up cannot attach its own current session as context.';
    }
    if (sessionItems.length > MAX_SESSION_CONTEXT_ATTACHMENTS) {
        return `You can attach up to ${MAX_SESSION_CONTEXT_ATTACHMENTS} sessions as context.`;
    }

    const seen = new Set<string>();
    for (const item of sessionItems) {
        const key = `${item.sourceWorkspaceId}\0${item.sourceProcessId}`;
        if (seen.has(key)) {
            return 'This session is already attached to the message.';
        }
        seen.add(key);
    }

    if (options.canRetrieveConversations == null) {
        return 'Checking conversation retrieval capability. Try again shortly.';
    }
    if (options.canRetrieveConversations !== true) {
        return 'Conversation retrieval is not available for this chat.';
    }

    return null;
}

export function useConversationRetrievalCapability(workspaceId: string | undefined, enabled: boolean): boolean | null {
    const [available, setAvailable] = useState<boolean | null>(enabled && workspaceId ? null : false);

    useEffect(() => {
        if (!enabled || !workspaceId) {
            setAvailable(false);
            return;
        }

        let cancelled = false;
        setAvailable(null);
        getSpaCocClient().preferences.getLlmToolsConfig(workspaceId)
            .then((config) => {
                if (cancelled) return;
                const hasGetConversation = (config.tools ?? []).some(tool => tool.name === 'get_conversation');
                const disabled = config.disabledLlmTools ?? [];
                setAvailable(config.conversationRetrievalAvailable === true
                    && hasGetConversation
                    && !disabled.includes('get_conversation'));
            })
            .catch(() => {
                if (!cancelled) setAvailable(false);
            });

        return () => { cancelled = true; };
    }, [enabled, workspaceId]);

    return available;
}
