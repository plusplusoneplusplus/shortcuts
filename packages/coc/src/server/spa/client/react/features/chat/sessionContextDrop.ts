import { useEffect, useState } from 'react';
import { getSpaCocClient } from '../../api/cocClient';
import type { AttachedContextItem } from './hooks/useAttachedContext';
import {
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    type RalphSessionContextDragPayload,
    type RalphSessionContextPhase,
    type SessionContextAttachmentDragPayload,
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

const RALPH_SESSION_PHASES = new Set<RalphSessionContextPhase>([
    'grilling',
    'executing',
    'complete',
    'failed',
]);

const MAX_TITLE_LENGTH = 160;

type SessionContextDataTransfer = Pick<DataTransfer, 'getData'> & {
    types?: Iterable<string>;
    dropEffect?: DataTransfer['dropEffect'];
};

export type SessionContextDropValidation =
    | { ok: true; payload: SessionContextAttachmentDragPayload }
    | { ok: false; error: string };

type AttachedLogicalSessionContextItem =
    | Extract<AttachedContextItem, { kind: 'session' }>
    | Extract<AttachedContextItem, { kind: 'ralph-session' }>;

function isLogicalSessionContextItem(item: AttachedContextItem): item is AttachedLogicalSessionContextItem {
    return item.kind === 'session' || item.kind === 'ralph-session';
}

function getSessionContextItems(items: AttachedContextItem[]): AttachedLogicalSessionContextItem[] {
    return items.filter(isLogicalSessionContextItem);
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

function normalizeNonNegativeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeChildProcessIds(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const childProcessIds: string[] = [];
    for (const child of value) {
        const childProcessId = normalizeString(child);
        if (!childProcessId || looksLikeLocalPath(childProcessId)) return null;
        childProcessIds.push(childProcessId);
    }
    return childProcessIds;
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

function normalizeRalphSessionContextPayload(value: unknown): RalphSessionContextDragPayload | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<RalphSessionContextDragPayload>;
    const sourceWorkspaceId = normalizeString(record.sourceWorkspaceId);
    const sourceRalphSessionId = normalizeString(record.sourceRalphSessionId);
    const title = normalizeString(record.title);
    const displayLabel = normalizeString(record.displayLabel);
    const phase = normalizeString(record.phase);
    const status = normalizeString(record.status);
    const lastActivityAt = normalizeTimestamp(record.lastActivityAt);
    const childProcessIds = normalizeChildProcessIds(record.childProcessIds);
    const processCount = normalizeNonNegativeInteger(record.processCount);
    const iterationCount = normalizeNonNegativeInteger(record.iterationCount);

    if (
        record.kind !== RALPH_SESSION_CONTEXT_DRAG_KIND
        || record.version !== 1
        || !sourceWorkspaceId
        || !sourceRalphSessionId
        || !title
        || !displayLabel
        || !phase
        || !RALPH_SESSION_PHASES.has(phase as RalphSessionContextPhase)
        || !status
        || !ATTACHABLE_STATUSES.has(status as SessionContextSourceStatus)
        || !lastActivityAt
        || !childProcessIds
        || processCount === null
        || processCount !== childProcessIds.length
        || iterationCount === null
        || looksLikeLocalPath(sourceWorkspaceId)
        || looksLikeLocalPath(sourceRalphSessionId)
    ) {
        return null;
    }

    return {
        kind: RALPH_SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId,
        sourceRalphSessionId,
        title: sanitizeDisplayText(title),
        displayLabel: sanitizeDisplayText(displayLabel),
        phase: phase as RalphSessionContextPhase,
        status: status as SessionContextSourceStatus,
        lastActivityAt,
        childProcessIds,
        processCount,
        iterationCount,
    };
}

export function dataTransferHasSessionContext(dataTransfer: SessionContextDataTransfer | null | undefined): boolean {
    if (!dataTransfer) return false;
    const types = Array.from(dataTransfer.types ?? []);
    return types.includes(SESSION_CONTEXT_DRAG_MIME) || types.includes(RALPH_SESSION_CONTEXT_DRAG_MIME);
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

export function readRalphSessionContextDragPayload(dataTransfer: SessionContextDataTransfer): RalphSessionContextDragPayload | null {
    const raw = dataTransfer.getData(RALPH_SESSION_CONTEXT_DRAG_MIME);
    if (!raw) return null;
    try {
        return normalizeRalphSessionContextPayload(JSON.parse(raw));
    } catch {
        return null;
    }
}

export function readSessionContextDropPayload(dataTransfer: SessionContextDataTransfer): SessionContextAttachmentDragPayload | null {
    return readRalphSessionContextDragPayload(dataTransfer) ?? readSessionContextDragPayload(dataTransfer);
}

function payloadIncludesProcess(payload: SessionContextAttachmentDragPayload, processId: string | null | undefined): boolean {
    if (!processId) return false;
    return payload.kind === SESSION_CONTEXT_DRAG_KIND
        ? payload.sourceProcessId === processId
        : payload.childProcessIds.includes(processId);
}

function isDuplicatePayload(existingItems: AttachedLogicalSessionContextItem[], payload: SessionContextAttachmentDragPayload): boolean {
    if (payload.kind === SESSION_CONTEXT_DRAG_KIND) {
        return existingItems.some(item =>
            item.kind === 'session'
            && item.sourceWorkspaceId === payload.sourceWorkspaceId
            && item.sourceProcessId === payload.sourceProcessId
        );
    }

    return existingItems.some(item =>
        item.kind === 'ralph-session'
        && item.sourceWorkspaceId === payload.sourceWorkspaceId
        && item.sourceRalphSessionId === payload.sourceRalphSessionId
    );
}

export function validateSessionContextDrop(options: {
    payload: SessionContextAttachmentDragPayload | null;
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
        return { ok: false, error: 'Drop a CoC session or Ralph session group from this workspace to attach it as context.' };
    }
    if (!options.activeWorkspaceId) {
        return { ok: false, error: 'Open a workspace before attaching session context.' };
    }
    if (options.payload.sourceWorkspaceId !== options.activeWorkspaceId) {
        return { ok: false, error: 'Only sessions from the active workspace can be attached as context.' };
    }
    if (payloadIncludesProcess(options.payload, options.currentProcessId)) {
        return {
            ok: false,
            error: options.payload.kind === RALPH_SESSION_CONTEXT_DRAG_KIND
                ? 'A follow-up cannot attach a Ralph session that includes the current chat.'
                : 'A follow-up cannot attach its own current session as context.',
        };
    }

    const sessionItems = getSessionContextItems(options.existingItems);
    if (isDuplicatePayload(sessionItems, options.payload)) {
        return {
            ok: false,
            error: options.payload.kind === RALPH_SESSION_CONTEXT_DRAG_KIND
                ? 'This Ralph session is already attached to the message.'
                : 'This session is already attached to the message.',
        };
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
    const selfAttachedItem = sessionItems.find(item =>
        item.kind === 'session'
            ? item.sourceProcessId === options.currentProcessId
            : options.currentProcessId ? item.childProcessIds.includes(options.currentProcessId) : false
    );
    if (selfAttachedItem) {
        return selfAttachedItem.kind === 'ralph-session'
            ? 'A follow-up cannot attach a Ralph session that includes the current chat.'
            : 'A follow-up cannot attach its own current session as context.';
    }
    if (sessionItems.length > MAX_SESSION_CONTEXT_ATTACHMENTS) {
        return `You can attach up to ${MAX_SESSION_CONTEXT_ATTACHMENTS} sessions as context.`;
    }

    const seenSessions = new Set<string>();
    const seenRalphSessions = new Set<string>();
    for (const item of sessionItems) {
        if (item.kind === 'session') {
            const key = `${item.sourceWorkspaceId}\0${item.sourceProcessId}`;
            if (seenSessions.has(key)) {
                return 'This session is already attached to the message.';
            }
            seenSessions.add(key);
            continue;
        }

        const key = `${item.sourceWorkspaceId}\0${item.sourceRalphSessionId}`;
        if (seenRalphSessions.has(key)) {
            return 'This Ralph session is already attached to the message.';
        }
        seenRalphSessions.add(key);
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
