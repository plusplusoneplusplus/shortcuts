import { useState, useCallback, useRef } from 'react';
import {
    GIT_COMMIT_CONTEXT_DRAG_KIND,
    GIT_RANGE_CONTEXT_DRAG_KIND,
    PULL_REQUEST_CONTEXT_DRAG_KIND,
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    SESSION_CONTEXT_DRAG_KIND,
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
} from '../sessionContextDrag';

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

export interface AttachedRalphSessionContextItem {
    kind: 'ralph-session';
    id: string;
    sourceWorkspaceId: string;
    sourceRalphSessionId: string;
    title: string;
    displayLabel: string;
    phase: RalphSessionContextPhase;
    status: SessionContextSourceStatus;
    lastActivityAt: string;
    childProcessIds: string[];
    processCount: number;
    iterationCount: number;
    preview: string;
}

export interface AttachedWorkItemContextItem {
    kind: 'work-item';
    id: string;
    sourceWorkspaceId: string;
    workItemId: string;
    workItemNumber?: number;
    label: string;
    title?: string;
    status?: string;
    type?: string;
    preview: string;
}

export interface AttachedGitCommitContextItem {
    kind: 'commit';
    id: string;
    sourceWorkspaceId: string;
    commitHash: string;
    shortHash: string;
    label: string;
    subject?: string;
    title?: string;
    preview: string;
}

export interface AttachedGitRangeContextItem {
    kind: 'range';
    id: string;
    sourceWorkspaceId: string;
    baseRef: string;
    headRef: string;
    label: string;
    title?: string;
    branchName?: string;
    mergeBase?: string;
    commitCount?: number;
    fileCount?: number;
    preview: string;
}

export interface AttachedPullRequestContextItem {
    kind: 'pull-request';
    id: string;
    sourceWorkspaceId: string;
    pullRequestId: string;
    number?: number;
    label: string;
    title?: string;
    status?: string;
    preview: string;
}

export type AttachedPointerContextItem =
    | AttachedWorkItemContextItem
    | AttachedGitCommitContextItem
    | AttachedGitRangeContextItem
    | AttachedPullRequestContextItem;

export type AttachedContextItem =
    | AttachedTurnContextItem
    | AttachedSessionContextItem
    | AttachedRalphSessionContextItem
    | AttachedPointerContextItem;

const PREVIEW_LENGTH = 100;
const ATTACHED_CONTEXT_BLOCK_PATTERN = /<attached_session_context\s+version="1">[\s\S]*?<\/attached_session_context>|<attached_ralph_session_context\s+version="1">[\s\S]*?<\/attached_ralph_session_context>|<attached_pointer_context\s+version="1">[\s\S]*?<\/attached_pointer_context>/g;
const SESSION_CONTEXT_BLOCK_PATTERN = /^<attached_session_context\s+version="1">\s*<source\s+([^>]*)>\s*<title>([\s\S]*?)<\/title>\s*<instruction>[\s\S]*?<\/instruction>\s*<\/source>\s*<\/attached_session_context>$/;
const RALPH_SESSION_CONTEXT_BLOCK_PATTERN = /^<attached_ralph_session_context\s+version="1">\s*<source\s+([^>]*)>\s*<title>([\s\S]*?)<\/title>\s*<display_label>([\s\S]*?)<\/display_label>\s*<child_process_ids>\s*([\s\S]*?)\s*<\/child_process_ids>\s*<instruction>[\s\S]*?<\/instruction>\s*<\/source>\s*<\/attached_ralph_session_context>$/;
const POINTER_CONTEXT_BLOCK_PATTERN = /^<attached_pointer_context\s+version="1">\s*<source\s+([^>]*)>\s*<title>([\s\S]*?)<\/title>\s*<instruction>[\s\S]*?<\/instruction>\s*<\/source>\s*<\/attached_pointer_context>$/;
const CHILD_PROCESS_ID_PATTERN = /<process_id>([\s\S]*?)<\/process_id>/g;

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

function looksLikeLocalPath(value: string): boolean {
    return value.startsWith('/')
        || value.startsWith('~/')
        || /^[A-Za-z]:[\\/]/.test(value)
        || value.includes('\\');
}

function sanitizeContextDisplayText(value: string, fallback: string): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    const withoutPaths = compact
        .replace(/(^|\s)~\/[^\s"'`<>]+/g, '$1[path]')
        .replace(/\b[A-Za-z]:[\\/][^\s"'`<>]+/g, '[path]')
        .replace(/(^|\s)\/[^\s"'`<>]+/g, '$1[path]');
    return withoutPaths || fallback;
}

function safeContextPointer(value: string, fallback: string): string {
    const trimmed = value.trim();
    return trimmed && !looksLikeLocalPath(trimmed) ? trimmed : fallback;
}

function safeNonNegativeInteger(value: number): number {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function shortenSessionProcessId(processId: string): string {
    if (processId.length <= 14) return processId;
    return `${processId.slice(0, 8)}…${processId.slice(-4)}`;
}

function unescapeContextText(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function parseSourceAttributes(rawAttributes: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of rawAttributes.matchAll(/([a-z_]+)="([^"]*)"/g)) {
        attrs[match[1]] = unescapeContextText(match[2]);
    }
    return attrs;
}

export interface ParsedSessionContextBlock {
    kind: 'session';
    sourceWorkspaceId: string;
    sourceProcessId: string;
    status: string;
    lastActivityAt: string;
    title: string;
    rawBlock: string;
}

export interface ParsedRalphSessionContextBlock {
    kind: 'ralph-session';
    sourceWorkspaceId: string;
    sourceRalphSessionId: string;
    title: string;
    displayLabel: string;
    phase: string;
    status: string;
    lastActivityAt: string;
    childProcessIds: string[];
    processCount: number;
    iterationCount: number;
    rawBlock: string;
}

export type ParsedPointerContextKind = 'work-item' | 'commit' | 'range' | 'pull-request';

export interface ParsedPointerContextBlock {
    kind: ParsedPointerContextKind;
    sourceWorkspaceId: string;
    label: string;
    title: string;
    workItemId?: string;
    workItemNumber?: number;
    commitHash?: string;
    shortHash?: string;
    baseRef?: string;
    headRef?: string;
    pullRequestId?: string;
    number?: number;
    status?: string;
    type?: string;
    branchName?: string;
    mergeBase?: string;
    commitCount?: number;
    fileCount?: number;
    rawBlock: string;
}

export type ParsedAttachedContextBlock = ParsedSessionContextBlock | ParsedRalphSessionContextBlock | ParsedPointerContextBlock;

export interface ParsedAttachedSessionContextContent {
    attachedContexts: ParsedAttachedContextBlock[];
    sessionContexts: ParsedSessionContextBlock[];
    ralphSessionContexts: ParsedRalphSessionContextBlock[];
    pointerContexts: ParsedPointerContextBlock[];
    remainingContent: string;
}

function parseIntegerAttribute(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseChildProcessIds(rawChildProcessIds: string): string[] {
    return Array.from(rawChildProcessIds.matchAll(CHILD_PROCESS_ID_PATTERN))
        .map(match => unescapeContextText(match[1]).trim())
        .filter(Boolean);
}

function parseSessionContextBlock(rawBlock: string): ParsedSessionContextBlock | null {
    const match = rawBlock.match(SESSION_CONTEXT_BLOCK_PATTERN);
    if (!match) return null;
    const attrs = parseSourceAttributes(match[1]);
    return {
        kind: 'session',
        sourceWorkspaceId: attrs.workspace_id || 'unknown-workspace',
        sourceProcessId: attrs.process_id || 'unknown-process',
        status: attrs.status || 'unknown',
        lastActivityAt: attrs.last_activity_at || 'unknown',
        title: unescapeContextText(match[2]).trim() || attrs.process_id || 'Untitled source session',
        rawBlock,
    };
}

function parseRalphSessionContextBlock(rawBlock: string): ParsedRalphSessionContextBlock | null {
    const match = rawBlock.match(RALPH_SESSION_CONTEXT_BLOCK_PATTERN);
    if (!match) return null;
    const attrs = parseSourceAttributes(match[1]);
    const childProcessIds = parseChildProcessIds(match[4]);
    return {
        kind: 'ralph-session',
        sourceWorkspaceId: attrs.workspace_id || 'unknown-workspace',
        sourceRalphSessionId: attrs.ralph_session_id || 'unknown-ralph-session',
        title: unescapeContextText(match[2]).trim() || attrs.ralph_session_id || 'Untitled Ralph session',
        displayLabel: unescapeContextText(match[3]).trim() || attrs.ralph_session_id || 'Untitled Ralph session',
        phase: attrs.phase || 'unknown',
        status: attrs.status || 'unknown',
        lastActivityAt: attrs.last_activity_at || 'unknown',
        childProcessIds,
        processCount: parseIntegerAttribute(attrs.process_count, childProcessIds.length),
        iterationCount: parseIntegerAttribute(attrs.iteration_count, 0),
        rawBlock,
    };
}

function parsePointerContextKind(value: string | undefined): ParsedPointerContextKind | null {
    if (value === 'work-item' || value === 'commit' || value === 'range' || value === 'pull-request') return value;
    return null;
}

function parsePointerContextBlock(rawBlock: string): ParsedPointerContextBlock | null {
    const match = rawBlock.match(POINTER_CONTEXT_BLOCK_PATTERN);
    if (!match) return null;
    const attrs = parseSourceAttributes(match[1]);
    const kind = parsePointerContextKind(attrs.kind);
    if (!kind) return null;
    const title = unescapeContextText(match[2]).trim();
    return {
        kind,
        sourceWorkspaceId: attrs.workspace_id || 'unknown-workspace',
        label: attrs.label || title || kind,
        title: title || attrs.label || kind,
        ...(attrs.work_item_id ? { workItemId: attrs.work_item_id } : {}),
        ...(attrs.work_item_number ? { workItemNumber: parseIntegerAttribute(attrs.work_item_number, 0) } : {}),
        ...(attrs.commit_hash ? { commitHash: attrs.commit_hash } : {}),
        ...(attrs.short_hash ? { shortHash: attrs.short_hash } : {}),
        ...(attrs.base_ref ? { baseRef: attrs.base_ref } : {}),
        ...(attrs.head_ref ? { headRef: attrs.head_ref } : {}),
        ...(attrs.pull_request_id ? { pullRequestId: attrs.pull_request_id } : {}),
        ...(attrs.number ? { number: parseIntegerAttribute(attrs.number, 0) } : {}),
        ...(attrs.status ? { status: attrs.status } : {}),
        ...(attrs.type ? { type: attrs.type } : {}),
        ...(attrs.branch_name ? { branchName: attrs.branch_name } : {}),
        ...(attrs.merge_base ? { mergeBase: attrs.merge_base } : {}),
        ...(attrs.commit_count ? { commitCount: parseIntegerAttribute(attrs.commit_count, 0) } : {}),
        ...(attrs.file_count ? { fileCount: parseIntegerAttribute(attrs.file_count, 0) } : {}),
        rawBlock,
    };
}

export function parseAttachedSessionContextBlocks(content: string): ParsedAttachedSessionContextContent {
    const attachedContexts: ParsedAttachedContextBlock[] = [];
    const sessionContexts: ParsedSessionContextBlock[] = [];
    const ralphSessionContexts: ParsedRalphSessionContextBlock[] = [];
    const pointerContexts: ParsedPointerContextBlock[] = [];
    const remainingContent = content
        .replace(ATTACHED_CONTEXT_BLOCK_PATTERN, (rawBlock: string) => {
            const parsed = rawBlock.startsWith('<attached_ralph_session_context')
                ? parseRalphSessionContextBlock(rawBlock)
                : rawBlock.startsWith('<attached_pointer_context')
                    ? parsePointerContextBlock(rawBlock)
                    : parseSessionContextBlock(rawBlock);
            if (parsed) {
                attachedContexts.push(parsed);
                if (parsed.kind === 'ralph-session') {
                    ralphSessionContexts.push(parsed);
                } else if (parsed.kind === 'session') {
                    sessionContexts.push(parsed);
                } else {
                    pointerContexts.push(parsed);
                }
                return '';
            }
            return rawBlock;
        })
        .replace(/^(?:[ \t]*\r?\n)+/, '');

    return { attachedContexts, sessionContexts, ralphSessionContexts, pointerContexts, remainingContent };
}

export function buildSessionContextPreview(source: Pick<SessionContextDragPayload, 'title' | 'status' | 'lastActivityAt' | 'sourceProcessId'>): string {
    return `${source.title} · ${source.status} · ${source.lastActivityAt} · ${shortenSessionProcessId(source.sourceProcessId)}`;
}

function formatCount(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

export function buildRalphSessionContextPreview(source: Pick<RalphSessionContextDragPayload, 'displayLabel' | 'phase' | 'status' | 'lastActivityAt' | 'sourceRalphSessionId' | 'processCount' | 'iterationCount'>): string {
    return [
        source.displayLabel,
        `${source.phase}/${source.status}`,
        formatCount(source.processCount, 'process', 'processes'),
        formatCount(source.iterationCount, 'iteration', 'iterations'),
        source.lastActivityAt,
        shortenSessionProcessId(source.sourceRalphSessionId),
    ].join(' · ');
}

function buildPointerContextPreview(source: PointerContextDragPayload): string {
    if (source.kind === WORK_ITEM_CONTEXT_DRAG_KIND) {
        return [source.label, source.title, source.status, source.workItemId].filter(Boolean).join(' · ');
    }
    if (source.kind === GIT_COMMIT_CONTEXT_DRAG_KIND) {
        return [source.label, source.subject].filter(Boolean).join(' · ');
    }
    if (source.kind === GIT_RANGE_CONTEXT_DRAG_KIND) {
        const counts = [
            source.commitCount !== undefined ? formatCount(source.commitCount, 'commit', 'commits') : '',
            source.fileCount !== undefined ? formatCount(source.fileCount, 'file', 'files') : '',
        ].filter(Boolean).join(' · ');
        return [source.label, source.branchName, counts].filter(Boolean).join(' · ');
    }
    return [source.label, source.title, source.status, source.pullRequestId].filter(Boolean).join(' · ');
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

    const addRalphSession = useCallback((source: RalphSessionContextDragPayload) => {
        const item: AttachedRalphSessionContextItem = {
            kind: 'ralph-session',
            id: `ctx-${++nextId}`,
            sourceWorkspaceId: source.sourceWorkspaceId,
            sourceRalphSessionId: source.sourceRalphSessionId,
            title: source.title,
            displayLabel: source.displayLabel,
            phase: source.phase,
            status: source.status,
            lastActivityAt: source.lastActivityAt,
            childProcessIds: source.childProcessIds,
            processCount: source.processCount,
            iterationCount: source.iterationCount,
            preview: buildRalphSessionContextPreview(source),
        };
        setItems(prev => [...prev, item]);
    }, []);

    const addPointerContext = useCallback((source: PointerContextDragPayload) => {
        const base = {
            id: `ctx-${++nextId}`,
            sourceWorkspaceId: source.sourceWorkspaceId,
            label: source.label,
            title: source.title,
            preview: buildPointerContextPreview(source),
        };
        if (source.kind === WORK_ITEM_CONTEXT_DRAG_KIND) {
            const item: AttachedWorkItemContextItem = {
                ...base,
                kind: 'work-item',
                workItemId: source.workItemId,
                workItemNumber: source.workItemNumber,
                status: source.status,
                type: source.type,
            };
            setItems(prev => [...prev, item]);
            return;
        }
        if (source.kind === GIT_COMMIT_CONTEXT_DRAG_KIND) {
            const item: AttachedGitCommitContextItem = {
                ...base,
                kind: 'commit',
                commitHash: source.commitHash,
                shortHash: source.shortHash,
                subject: source.subject,
            };
            setItems(prev => [...prev, item]);
            return;
        }
        if (source.kind === GIT_RANGE_CONTEXT_DRAG_KIND) {
            const item: AttachedGitRangeContextItem = {
                ...base,
                kind: 'range',
                baseRef: source.baseRef,
                headRef: source.headRef,
                branchName: source.branchName,
                mergeBase: source.mergeBase,
                commitCount: source.commitCount,
                fileCount: source.fileCount,
            };
            setItems(prev => [...prev, item]);
            return;
        }
        const item: AttachedPullRequestContextItem = {
            ...base,
            kind: 'pull-request',
            pullRequestId: source.pullRequestId,
            number: source.number,
            status: source.status,
        };
        setItems(prev => [...prev, item]);
    }, []);

    const addSessionContext = useCallback((source: SessionContextAttachmentDragPayload) => {
        if (source.kind === RALPH_SESSION_CONTEXT_DRAG_KIND) {
            addRalphSession(source);
            return;
        }
        if (source.kind === SESSION_CONTEXT_DRAG_KIND) {
            addSession(source);
            return;
        }
        addPointerContext(source);
    }, [addRalphSession, addSession, addPointerContext]);

    const addWorkItem = useCallback((source: WorkItemContextDragPayload) => {
        addPointerContext(source);
    }, [addPointerContext]);

    const addGitCommit = useCallback((source: GitCommitContextDragPayload) => {
        addPointerContext(source);
    }, [addPointerContext]);

    const addGitRange = useCallback((source: GitRangeContextDragPayload) => {
        addPointerContext(source);
    }, [addPointerContext]);

    const addPullRequest = useCallback((source: PullRequestContextDragPayload) => {
        addPointerContext(source);
    }, [addPointerContext]);

    const remove = useCallback((id: string) => {
        setItems(prev => prev.filter(item => item.id !== id));
    }, []);

    const clear = useCallback(() => {
        setItems([]);
    }, []);

    const getItems = useCallback(() => itemsRef.current, []);

    return {
        items,
        add,
        addSession,
        addRalphSession,
        addPointerContext,
        addWorkItem,
        addGitCommit,
        addGitRange,
        addPullRequest,
        addSessionContext,
        remove,
        clear,
        getItems,
    };
}

function formatOptionalAttribute(name: string, value: string | number | undefined): string {
    if (value === undefined || value === null || value === '') return '';
    return ` ${name}="${escapeContextText(String(value))}"`;
}

function formatPointerContextSourceAttributes(item: AttachedPointerContextItem): string {
    const sourceWorkspaceId = safeContextPointer(item.sourceWorkspaceId, 'unknown-workspace');
    const label = sanitizeContextDisplayText(item.label, item.kind);
    if (item.kind === 'work-item') {
        return [
            `workspace_id="${escapeContextText(sourceWorkspaceId)}"`,
            `kind="${item.kind}"`,
            `label="${escapeContextText(label)}"`,
            `work_item_id="${escapeContextText(safeContextPointer(item.workItemId, 'unknown-work-item'))}"`,
            formatOptionalAttribute('work_item_number', item.workItemNumber).trim(),
            formatOptionalAttribute('status', item.status ? sanitizeContextDisplayText(item.status, '') : undefined).trim(),
            formatOptionalAttribute('type', item.type ? sanitizeContextDisplayText(item.type, '') : undefined).trim(),
        ].filter(Boolean).join(' ');
    }
    if (item.kind === 'commit') {
        return [
            `workspace_id="${escapeContextText(sourceWorkspaceId)}"`,
            `kind="${item.kind}"`,
            `label="${escapeContextText(label)}"`,
            `commit_hash="${escapeContextText(safeContextPointer(item.commitHash, 'unknown-commit'))}"`,
            `short_hash="${escapeContextText(safeContextPointer(item.shortHash, 'commit'))}"`,
        ].join(' ');
    }
    if (item.kind === 'range') {
        return [
            `workspace_id="${escapeContextText(sourceWorkspaceId)}"`,
            `kind="${item.kind}"`,
            `label="${escapeContextText(label)}"`,
            `base_ref="${escapeContextText(safeContextPointer(item.baseRef, 'unknown-base'))}"`,
            `head_ref="${escapeContextText(safeContextPointer(item.headRef, 'unknown-head'))}"`,
            formatOptionalAttribute('branch_name', item.branchName ? sanitizeContextDisplayText(item.branchName, '') : undefined).trim(),
            formatOptionalAttribute('merge_base', item.mergeBase ? safeContextPointer(item.mergeBase, '') : undefined).trim(),
            formatOptionalAttribute('commit_count', item.commitCount !== undefined ? safeNonNegativeInteger(item.commitCount) : undefined).trim(),
            formatOptionalAttribute('file_count', item.fileCount !== undefined ? safeNonNegativeInteger(item.fileCount) : undefined).trim(),
        ].filter(Boolean).join(' ');
    }
    return [
        `workspace_id="${escapeContextText(sourceWorkspaceId)}"`,
        `kind="${item.kind}"`,
        `label="${escapeContextText(label)}"`,
        `pull_request_id="${escapeContextText(safeContextPointer(item.pullRequestId, 'unknown-pr'))}"`,
        formatOptionalAttribute('number', item.number).trim(),
        formatOptionalAttribute('status', item.status ? sanitizeContextDisplayText(item.status, '') : undefined).trim(),
    ].filter(Boolean).join(' ');
}

function formatPointerContextTitle(item: AttachedPointerContextItem): string {
    return sanitizeContextDisplayText(item.title || item.label, item.label);
}

function formatPointerContextInstruction(item: AttachedPointerContextItem): string {
    const noun = item.kind === 'work-item'
        ? 'work item'
        : item.kind === 'commit'
            ? 'Git commit'
            : item.kind === 'range'
                ? 'Git branch/range'
                : 'pull request';
    return `Before answering, use the pointer metadata above to retrieve this ${noun} from the active workspace if details are needed. This pointer block contains only stable references and safe display metadata.`;
}

function formatPointerContextBlock(item: AttachedPointerContextItem): string {
    return [
        '<attached_pointer_context version="1">',
        `<source ${formatPointerContextSourceAttributes(item)}>`,
        `<title>${escapeContextText(formatPointerContextTitle(item))}</title>`,
        `<instruction>${escapeContextText(formatPointerContextInstruction(item))}</instruction>`,
        '</source>',
        '</attached_pointer_context>',
    ].join('\n');
}

function isPointerContextItem(item: AttachedContextItem): item is AttachedPointerContextItem {
    return item.kind === 'work-item' || item.kind === 'commit' || item.kind === 'range' || item.kind === 'pull-request';
}

/**
 * Format attached context items into a text block to prepend to the user message.
 */
export function formatAttachedContext(items: AttachedContextItem[]): string {
    if (items.length === 0) return '';
    return items.map(item => {
        if (isPointerContextItem(item)) {
            return formatPointerContextBlock(item);
        }
        if (item.kind === 'session') {
            const sourceWorkspaceId = safeContextPointer(item.sourceWorkspaceId, 'unknown-workspace');
            const sourceProcessId = safeContextPointer(item.sourceProcessId, 'unknown-process');
            return [
                '<attached_session_context version="1">',
                `<source workspace_id="${escapeContextText(sourceWorkspaceId)}" process_id="${escapeContextText(sourceProcessId)}" status="${escapeContextText(item.status)}" last_activity_at="${escapeContextText(item.lastActivityAt)}">`,
                `<title>${escapeContextText(sanitizeContextDisplayText(item.title, 'Untitled source session'))}</title>`,
                '<instruction>Before answering, retrieve and read this source conversation by process ID using the available conversation retrieval tool.</instruction>',
                '</source>',
                '</attached_session_context>',
            ].join('\n');
        }
        if (item.kind === 'ralph-session') {
            const sourceWorkspaceId = safeContextPointer(item.sourceWorkspaceId, 'unknown-workspace');
            const sourceRalphSessionId = safeContextPointer(item.sourceRalphSessionId, 'unknown-ralph-session');
            const childProcessIds = item.childProcessIds
                .map(processId => safeContextPointer(processId, ''))
                .filter(Boolean);
            const processCount = childProcessIds.length;
            const iterationCount = safeNonNegativeInteger(item.iterationCount);
            return [
                '<attached_ralph_session_context version="1">',
                `<source workspace_id="${escapeContextText(sourceWorkspaceId)}" ralph_session_id="${escapeContextText(sourceRalphSessionId)}" phase="${escapeContextText(item.phase)}" status="${escapeContextText(item.status)}" last_activity_at="${escapeContextText(item.lastActivityAt)}" process_count="${processCount}" iteration_count="${iterationCount}">`,
                `<title>${escapeContextText(sanitizeContextDisplayText(item.title, 'Untitled Ralph session'))}</title>`,
                `<display_label>${escapeContextText(sanitizeContextDisplayText(item.displayLabel, 'Untitled Ralph session'))}</display_label>`,
                '<child_process_ids>',
                ...childProcessIds.map(processId => `<process_id>${escapeContextText(processId)}</process_id>`),
                '</child_process_ids>',
                '<instruction>Before answering, retrieve and read the relevant Ralph child conversations by process ID using the available conversation retrieval tool. This pointer block contains only safe metadata.</instruction>',
                '</source>',
                '</attached_ralph_session_context>',
            ].join('\n');
        }

        return `<context from="${item.role}" turn="${item.turnIndex}">\n${item.snippet}\n</context>`;
    }).join('\n\n') + '\n\n';
}
