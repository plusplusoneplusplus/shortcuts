import { useEffect, useState } from 'react';
import { getSpaCocClient } from '../../api/cocClient';
import type { AttachedContextItem } from './hooks/useAttachedContext';
import {
    GIT_COMMIT_CONTEXT_DRAG_KIND,
    GIT_RANGE_CONTEXT_DRAG_KIND,
    POINTER_CONTEXT_DRAG_MIME,
    PULL_REQUEST_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_MIME,
    SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_MIME,
    WORK_ITEM_CONTEXT_DRAG_KIND,
    type GitCommitContextDragPayload,
    type GitRangeContextDragPayload,
    type PointerContextDragPayload,
    type PullRequestContextDragPayload,
    type RalphSessionContextDragPayload,
    type RalphSessionContextPhase,
    type SessionContextAttachmentDragPayload,
    type SessionContextDragPayload,
    type SessionContextSourceStatus,
    type WorkItemContextDragPayload,
} from './sessionContextDrag';

export const MAX_ATTACHED_CONTEXT_ITEMS = 3;
export const MAX_SESSION_CONTEXT_ATTACHMENTS = MAX_ATTACHED_CONTEXT_ITEMS;

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

type AttachedLogicalContextItem =
    | AttachedLogicalSessionContextItem
    | Extract<AttachedContextItem, { kind: 'work-item' }>
    | Extract<AttachedContextItem, { kind: 'commit' }>
    | Extract<AttachedContextItem, { kind: 'range' }>
    | Extract<AttachedContextItem, { kind: 'pull-request' }>;

function isLogicalSessionContextItem(item: AttachedContextItem): item is AttachedLogicalSessionContextItem {
    return item.kind === 'session' || item.kind === 'ralph-session';
}

function isLogicalContextItem(item: AttachedContextItem): item is AttachedLogicalContextItem {
    return isLogicalSessionContextItem(item)
        || item.kind === 'work-item'
        || item.kind === 'commit'
        || item.kind === 'range'
        || item.kind === 'pull-request';
}

function getLogicalContextItems(items: AttachedContextItem[]): AttachedLogicalContextItem[] {
    return items.filter(isLogicalContextItem);
}

function getSessionContextItems(items: AttachedContextItem[]): AttachedLogicalSessionContextItem[] {
    return getLogicalContextItems(items).filter(isLogicalSessionContextItem);
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

function normalizeOptionalNonNegativeInteger(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const normalized = normalizeNonNegativeInteger(value);
    return normalized === null ? undefined : normalized;
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

function normalizePointerId(value: unknown): string | null {
    const normalized = normalizeString(value);
    return normalized && !looksLikeLocalPath(normalized) ? normalized : null;
}

function normalizeOptionalDisplayText(value: unknown): string | undefined {
    const normalized = normalizeString(value);
    if (!normalized) return undefined;
    const sanitized = sanitizeDisplayText(normalized);
    return sanitized || undefined;
}

function normalizeWorkItemContextPayload(record: Partial<WorkItemContextDragPayload>, sourceWorkspaceId: string, label: string): WorkItemContextDragPayload | null {
    const workItemId = normalizePointerId(record.workItemId);
    if (!workItemId) return null;
    const workItemNumber = normalizeOptionalNonNegativeInteger(record.workItemNumber);
    const title = normalizeOptionalDisplayText(record.title);
    const status = normalizeOptionalDisplayText(record.status);
    const type = normalizeOptionalDisplayText(record.type);
    return {
        kind: WORK_ITEM_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId,
        workItemId,
        ...(workItemNumber !== undefined ? { workItemNumber } : {}),
        label,
        ...(title ? { title } : {}),
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
    };
}

function normalizeGitCommitContextPayload(record: Partial<GitCommitContextDragPayload>, sourceWorkspaceId: string, label: string): GitCommitContextDragPayload | null {
    const commitHash = normalizePointerId(record.commitHash);
    const shortHash = normalizeOptionalDisplayText(record.shortHash);
    if (!commitHash || !shortHash) return null;
    const subject = normalizeOptionalDisplayText(record.subject ?? record.title);
    return {
        kind: GIT_COMMIT_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId,
        commitHash,
        shortHash,
        label,
        ...(subject ? { subject, title: subject } : {}),
    };
}

function normalizeGitRangeContextPayload(record: Partial<GitRangeContextDragPayload>, sourceWorkspaceId: string, label: string): GitRangeContextDragPayload | null {
    const baseRef = normalizePointerId(record.baseRef);
    const headRef = normalizePointerId(record.headRef);
    if (!baseRef || !headRef) return null;
    const branchName = normalizeOptionalDisplayText(record.branchName ?? record.title);
    const mergeBase = normalizePointerId(record.mergeBase);
    const commitCount = normalizeOptionalNonNegativeInteger(record.commitCount);
    const fileCount = normalizeOptionalNonNegativeInteger(record.fileCount);
    return {
        kind: GIT_RANGE_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId,
        baseRef,
        headRef,
        label,
        ...(branchName ? { branchName, title: branchName } : {}),
        ...(mergeBase ? { mergeBase } : {}),
        ...(commitCount !== undefined ? { commitCount } : {}),
        ...(fileCount !== undefined ? { fileCount } : {}),
    };
}

function normalizePullRequestContextPayload(record: Partial<PullRequestContextDragPayload>, sourceWorkspaceId: string, label: string): PullRequestContextDragPayload | null {
    const pullRequestId = normalizePointerId(record.pullRequestId);
    if (!pullRequestId) return null;
    const number = normalizeOptionalNonNegativeInteger(record.number);
    const title = normalizeOptionalDisplayText(record.title);
    const status = normalizeOptionalDisplayText(record.status);
    return {
        kind: PULL_REQUEST_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId,
        pullRequestId,
        ...(number !== undefined ? { number } : {}),
        label,
        ...(title ? { title } : {}),
        ...(status ? { status } : {}),
    };
}

function normalizePointerContextPayload(value: unknown): PointerContextDragPayload | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<PointerContextDragPayload>;
    const sourceWorkspaceId = normalizePointerId(record.sourceWorkspaceId);
    const label = normalizeOptionalDisplayText(record.label);

    if (record.version !== 1 || !sourceWorkspaceId || !label) return null;

    if (record.kind === WORK_ITEM_CONTEXT_DRAG_KIND) {
        return normalizeWorkItemContextPayload(record, sourceWorkspaceId, label);
    }
    if (record.kind === GIT_COMMIT_CONTEXT_DRAG_KIND) {
        return normalizeGitCommitContextPayload(record, sourceWorkspaceId, label);
    }
    if (record.kind === GIT_RANGE_CONTEXT_DRAG_KIND) {
        return normalizeGitRangeContextPayload(record, sourceWorkspaceId, label);
    }
    if (record.kind === PULL_REQUEST_CONTEXT_DRAG_KIND) {
        return normalizePullRequestContextPayload(record, sourceWorkspaceId, label);
    }
    return null;
}

export function dataTransferHasSessionContext(dataTransfer: SessionContextDataTransfer | null | undefined): boolean {
    if (!dataTransfer) return false;
    const types = Array.from(dataTransfer.types ?? []);
    return types.includes(SESSION_CONTEXT_DRAG_MIME)
        || types.includes(RALPH_SESSION_CONTEXT_DRAG_MIME)
        || types.includes(POINTER_CONTEXT_DRAG_MIME);
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

export function readPointerContextDragPayload(dataTransfer: SessionContextDataTransfer): PointerContextDragPayload | null {
    const raw = dataTransfer.getData(POINTER_CONTEXT_DRAG_MIME);
    if (!raw) return null;
    try {
        return normalizePointerContextPayload(JSON.parse(raw));
    } catch {
        return null;
    }
}

export function readSessionContextDropPayload(dataTransfer: SessionContextDataTransfer): SessionContextAttachmentDragPayload | null {
    return readRalphSessionContextDragPayload(dataTransfer)
        ?? readPointerContextDragPayload(dataTransfer)
        ?? readSessionContextDragPayload(dataTransfer);
}

function payloadIncludesProcess(payload: SessionContextAttachmentDragPayload, processId: string | null | undefined): boolean {
    if (!processId) return false;
    if (payload.kind === SESSION_CONTEXT_DRAG_KIND) return payload.sourceProcessId === processId;
    if (payload.kind === RALPH_SESSION_CONTEXT_DRAG_KIND) return payload.childProcessIds.includes(processId);
    return false;
}

function getPayloadLogicalKey(payload: SessionContextAttachmentDragPayload): string {
    if (payload.kind === SESSION_CONTEXT_DRAG_KIND) {
        return `session\0${payload.sourceWorkspaceId}\0${payload.sourceProcessId}`;
    }
    if (payload.kind === RALPH_SESSION_CONTEXT_DRAG_KIND) {
        return `ralph-session\0${payload.sourceWorkspaceId}\0${payload.sourceRalphSessionId}`;
    }
    if (payload.kind === WORK_ITEM_CONTEXT_DRAG_KIND) {
        return `work-item\0${payload.sourceWorkspaceId}\0${payload.workItemId}`;
    }
    if (payload.kind === GIT_COMMIT_CONTEXT_DRAG_KIND) {
        return `commit\0${payload.sourceWorkspaceId}\0${payload.commitHash}`;
    }
    if (payload.kind === GIT_RANGE_CONTEXT_DRAG_KIND) {
        return `range\0${payload.sourceWorkspaceId}\0${payload.baseRef}\0${payload.headRef}`;
    }
    const pullRequestRef = payload.number !== undefined ? `number:${payload.number}` : `id:${payload.pullRequestId}`;
    return `pull-request\0${payload.sourceWorkspaceId}\0${pullRequestRef}`;
}

function getItemLogicalKey(item: AttachedLogicalContextItem): string {
    if (item.kind === 'session') return `session\0${item.sourceWorkspaceId}\0${item.sourceProcessId}`;
    if (item.kind === 'ralph-session') return `ralph-session\0${item.sourceWorkspaceId}\0${item.sourceRalphSessionId}`;
    if (item.kind === 'work-item') return `work-item\0${item.sourceWorkspaceId}\0${item.workItemId}`;
    if (item.kind === 'commit') return `commit\0${item.sourceWorkspaceId}\0${item.commitHash}`;
    if (item.kind === 'range') return `range\0${item.sourceWorkspaceId}\0${item.baseRef}\0${item.headRef}`;
    const pullRequestRef = item.number !== undefined ? `number:${item.number}` : `id:${item.pullRequestId}`;
    return `pull-request\0${item.sourceWorkspaceId}\0${pullRequestRef}`;
}

function duplicateErrorForPayload(payload: SessionContextAttachmentDragPayload): string {
    if (payload.kind === RALPH_SESSION_CONTEXT_DRAG_KIND) return 'This Ralph session is already attached to the message.';
    if (payload.kind === WORK_ITEM_CONTEXT_DRAG_KIND) return 'This work item is already attached to the message.';
    if (payload.kind === GIT_COMMIT_CONTEXT_DRAG_KIND) return 'This commit is already attached to the message.';
    if (payload.kind === GIT_RANGE_CONTEXT_DRAG_KIND) return 'This range is already attached to the message.';
    if (payload.kind === PULL_REQUEST_CONTEXT_DRAG_KIND) return 'This pull request is already attached to the message.';
    return 'This session is already attached to the message.';
}

function duplicateErrorForItem(item: AttachedLogicalContextItem): string {
    if (item.kind === 'ralph-session') return 'This Ralph session is already attached to the message.';
    if (item.kind === 'work-item') return 'This work item is already attached to the message.';
    if (item.kind === 'commit') return 'This commit is already attached to the message.';
    if (item.kind === 'range') return 'This range is already attached to the message.';
    if (item.kind === 'pull-request') return 'This pull request is already attached to the message.';
    return 'This session is already attached to the message.';
}

function isDuplicatePayload(existingItems: AttachedLogicalContextItem[], payload: SessionContextAttachmentDragPayload): boolean {
    const payloadKey = getPayloadLogicalKey(payload);
    return existingItems.some(item => getItemLogicalKey(item) === payloadKey);
}

function isConversationRetrievalRequired(items: AttachedLogicalContextItem[]): boolean {
    return items.some(isLogicalSessionContextItem);
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
        return { ok: false, error: 'Drop a supported CoC context item from this workspace to attach it as context.' };
    }
    if (!options.activeWorkspaceId) {
        return { ok: false, error: 'Open a workspace before attaching context.' };
    }
    if (options.payload.sourceWorkspaceId !== options.activeWorkspaceId) {
        return { ok: false, error: 'Only context from the active workspace can be attached.' };
    }
    if (payloadIncludesProcess(options.payload, options.currentProcessId)) {
        return {
            ok: false,
            error: options.payload.kind === RALPH_SESSION_CONTEXT_DRAG_KIND
                ? 'A follow-up cannot attach a Ralph session that includes the current chat.'
                : 'A follow-up cannot attach its own current session as context.',
        };
    }

    const contextItems = getLogicalContextItems(options.existingItems);
    if (isDuplicatePayload(contextItems, options.payload)) {
        return { ok: false, error: duplicateErrorForPayload(options.payload) };
    }
    if (contextItems.length >= MAX_ATTACHED_CONTEXT_ITEMS) {
        return { ok: false, error: `You can attach up to ${MAX_ATTACHED_CONTEXT_ITEMS} context items.` };
    }
    const requiresConversationRetrieval = options.payload.kind === SESSION_CONTEXT_DRAG_KIND || options.payload.kind === RALPH_SESSION_CONTEXT_DRAG_KIND;
    if (requiresConversationRetrieval && options.canRetrieveConversations === null) {
        return { ok: false, error: 'Checking conversation retrieval capability. Try again shortly.' };
    }
    if (requiresConversationRetrieval && options.canRetrieveConversations !== true) {
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
    const contextItems = getLogicalContextItems(options.items);
    if (contextItems.length === 0) return null;

    if (!options.featureEnabled) {
        return 'Session context attachments are disabled.';
    }
    if (!options.activeWorkspaceId) {
        return 'Open a workspace before attaching context.';
    }
    if (contextItems.some(item => item.sourceWorkspaceId !== options.activeWorkspaceId)) {
        return 'Only context from the active workspace can be attached.';
    }
    const selfAttachedItem = getSessionContextItems(options.items).find(item =>
        item.kind === 'session'
            ? item.sourceProcessId === options.currentProcessId
            : options.currentProcessId ? item.childProcessIds.includes(options.currentProcessId) : false
    );
    if (selfAttachedItem) {
        return selfAttachedItem.kind === 'ralph-session'
            ? 'A follow-up cannot attach a Ralph session that includes the current chat.'
            : 'A follow-up cannot attach its own current session as context.';
    }
    if (contextItems.length > MAX_ATTACHED_CONTEXT_ITEMS) {
        return `You can attach up to ${MAX_ATTACHED_CONTEXT_ITEMS} context items.`;
    }

    const seenItems = new Map<string, AttachedLogicalContextItem>();
    for (const item of contextItems) {
        const key = getItemLogicalKey(item);
        const duplicate = seenItems.get(key);
        if (duplicate) {
            return duplicateErrorForItem(duplicate);
        }
        seenItems.set(key, item);
    }

    if (isConversationRetrievalRequired(contextItems) && options.canRetrieveConversations == null) {
        return 'Checking conversation retrieval capability. Try again shortly.';
    }
    if (isConversationRetrievalRequired(contextItems) && options.canRetrieveConversations !== true) {
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
