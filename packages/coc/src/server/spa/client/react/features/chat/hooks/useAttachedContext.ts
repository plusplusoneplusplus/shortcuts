import { useState, useCallback, useRef } from 'react';
import {
    RALPH_SESSION_CONTEXT_DRAG_KIND,
    type RalphSessionContextDragPayload,
    type RalphSessionContextPhase,
    type SessionContextAttachmentDragPayload,
    type SessionContextDragPayload,
    type SessionContextSourceStatus,
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

export type AttachedContextItem = AttachedTurnContextItem | AttachedSessionContextItem | AttachedRalphSessionContextItem;

const PREVIEW_LENGTH = 100;
const ATTACHED_CONTEXT_BLOCK_PATTERN = /<attached_session_context\s+version="1">[\s\S]*?<\/attached_session_context>|<attached_ralph_session_context\s+version="1">[\s\S]*?<\/attached_ralph_session_context>/g;
const SESSION_CONTEXT_BLOCK_PATTERN = /^<attached_session_context\s+version="1">\s*<source\s+([^>]*)>\s*<title>([\s\S]*?)<\/title>\s*<instruction>[\s\S]*?<\/instruction>\s*<\/source>\s*<\/attached_session_context>$/;
const RALPH_SESSION_CONTEXT_BLOCK_PATTERN = /^<attached_ralph_session_context\s+version="1">\s*<source\s+([^>]*)>\s*<title>([\s\S]*?)<\/title>\s*<display_label>([\s\S]*?)<\/display_label>\s*<child_process_ids>\s*([\s\S]*?)\s*<\/child_process_ids>\s*<instruction>[\s\S]*?<\/instruction>\s*<\/source>\s*<\/attached_ralph_session_context>$/;
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

export type ParsedAttachedContextBlock = ParsedSessionContextBlock | ParsedRalphSessionContextBlock;

export interface ParsedAttachedSessionContextContent {
    attachedContexts: ParsedAttachedContextBlock[];
    sessionContexts: ParsedSessionContextBlock[];
    ralphSessionContexts: ParsedRalphSessionContextBlock[];
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

export function parseAttachedSessionContextBlocks(content: string): ParsedAttachedSessionContextContent {
    const attachedContexts: ParsedAttachedContextBlock[] = [];
    const sessionContexts: ParsedSessionContextBlock[] = [];
    const ralphSessionContexts: ParsedRalphSessionContextBlock[] = [];
    const remainingContent = content
        .replace(ATTACHED_CONTEXT_BLOCK_PATTERN, (rawBlock: string) => {
            const parsed = rawBlock.startsWith('<attached_ralph_session_context')
                ? parseRalphSessionContextBlock(rawBlock)
                : parseSessionContextBlock(rawBlock);
            if (parsed) {
                attachedContexts.push(parsed);
                if (parsed.kind === 'ralph-session') {
                    ralphSessionContexts.push(parsed);
                } else {
                    sessionContexts.push(parsed);
                }
                return '';
            }
            return rawBlock;
        })
        .replace(/^(?:[ \t]*\r?\n)+/, '');

    return { attachedContexts, sessionContexts, ralphSessionContexts, remainingContent };
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

    const addSessionContext = useCallback((source: SessionContextAttachmentDragPayload) => {
        if (source.kind === RALPH_SESSION_CONTEXT_DRAG_KIND) {
            addRalphSession(source);
            return;
        }
        addSession(source);
    }, [addRalphSession, addSession]);

    const remove = useCallback((id: string) => {
        setItems(prev => prev.filter(item => item.id !== id));
    }, []);

    const clear = useCallback(() => {
        setItems([]);
    }, []);

    const getItems = useCallback(() => itemsRef.current, []);

    return { items, add, addSession, addRalphSession, addSessionContext, remove, clear, getItems };
}

/**
 * Format attached context items into a text block to prepend to the user message.
 */
export function formatAttachedContext(items: AttachedContextItem[]): string {
    if (items.length === 0) return '';
    return items.map(item => {
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
