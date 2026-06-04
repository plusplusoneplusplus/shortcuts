import { ensureQueueProcessId } from '../../utils/queue-process-id';

export const SESSION_CONTEXT_DRAG_MIME = 'application/vnd.coc.session-context+json';
export const SESSION_CONTEXT_DRAG_KIND = 'coc.session-context';
export const RALPH_SESSION_CONTEXT_DRAG_MIME = 'application/vnd.coc.ralph-session-context+json';
export const RALPH_SESSION_CONTEXT_DRAG_KIND = 'coc.ralph-session-context';

export type SessionContextSourceStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RalphSessionContextPhase = 'grilling' | 'executing' | 'complete' | 'failed';

export interface SessionContextDragPayload {
    kind: typeof SESSION_CONTEXT_DRAG_KIND;
    version: 1;
    sourceWorkspaceId: string;
    sourceProcessId: string;
    title: string;
    status: SessionContextSourceStatus;
    lastActivityAt: string;
}

export interface RalphSessionContextDragPayload {
    kind: typeof RALPH_SESSION_CONTEXT_DRAG_KIND;
    version: 1;
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
}

export type SessionContextAttachmentDragPayload = SessionContextDragPayload | RalphSessionContextDragPayload;

export interface CreateSessionContextDragPayloadOptions {
    activeWorkspaceId?: string | null;
    idSource?: 'process' | 'queue-task';
}

export interface CreateRalphSessionContextDragPayloadOptions {
    activeWorkspaceId?: string | null;
}

type DragDataTransfer = {
    setData: (format: string, data: string) => void;
    effectAllowed?: DataTransfer['effectAllowed'];
};

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

function getNestedValue(source: any, path: string[]): unknown {
    let current = source;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = current[segment];
    }
    return current;
}

function stringFrom(source: any, paths: string[][]): string | null {
    for (const path of paths) {
        const value = getNestedValue(source, path);
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return null;
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
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
}

function timestampFrom(source: any): string | null {
    const candidates = [
        source?.lastActivityAt,
        source?.lastEventAt,
        source?.completedAt,
        source?.endTime,
        source?.startedAt,
        source?.startTime,
        source?.createdAt,
    ];
    for (const candidate of candidates) {
        const timestamp = normalizeTimestamp(candidate);
        if (timestamp) return timestamp;
    }
    return null;
}

function getRalphSessionChildren(source: any): any[] {
    const children: any[] = [];
    if (source?.grillingProcess && typeof source.grillingProcess === 'object') {
        children.push(source.grillingProcess);
    }
    if (Array.isArray(source?.iterations)) {
        children.push(...source.iterations.filter((item: any) => item && typeof item === 'object'));
    }
    return children;
}

function resolveRalphWorkspaceId(source: any, children: any[], activeWorkspaceId?: string | null): string | null {
    const workspaceIds: string[] = [];
    const sourceWorkspaceId = resolveWorkspaceId(source, activeWorkspaceId);
    if (sourceWorkspaceId) workspaceIds.push(sourceWorkspaceId);

    for (const child of children) {
        const childWorkspaceId = resolveWorkspaceId(child, activeWorkspaceId);
        if (!childWorkspaceId) return null;
        workspaceIds.push(childWorkspaceId);
    }

    const unique = new Set(workspaceIds);
    return unique.size === 1 ? workspaceIds[0] : null;
}

function resolveRalphChildProcessId(source: any): string | null {
    const explicitProcessId = stringFrom(source, [
        ['processId'],
        ['payload', 'processId'],
    ]);
    if (explicitProcessId) return explicitProcessId;

    const id = stringFrom(source, [['id']]);
    if (!id) return null;
    return source?.status === 'queued' ? ensureQueueProcessId(id) : id;
}

function resolveRalphChildProcessIds(children: any[]): string[] | null {
    const childProcessIds: string[] = [];
    for (const child of children) {
        const childProcessId = resolveRalphChildProcessId(child);
        if (!childProcessId || looksLikeLocalPath(childProcessId)) return null;
        childProcessIds.push(childProcessId);
    }
    return childProcessIds.length > 0 ? childProcessIds : null;
}

function resolveRalphStatus(source: any, children: any[]): SessionContextSourceStatus | null {
    const childStatuses = children
        .map(child => typeof child?.status === 'string' ? child.status : '')
        .filter((status): status is SessionContextSourceStatus => ATTACHABLE_STATUSES.has(status as SessionContextSourceStatus));

    if (childStatuses.includes('failed')) return 'failed';
    if (childStatuses.includes('running')) return 'running';
    if (childStatuses.includes('queued')) return 'queued';
    if (childStatuses.includes('cancelled')) return 'cancelled';
    if (source?.phase === 'failed') return 'failed';
    if (source?.phase === 'complete') return 'completed';
    if (source?.phase === 'executing' || source?.phase === 'grilling') return 'running';
    return childStatuses[0] ?? null;
}

function resolveRalphTitle(source: any, children: any[]): string {
    const sources = [source, ...children];
    for (const item of sources) {
        const rawTitle = stringFrom(item, [
            ['customTitle'],
            ['title'],
            ['displayName'],
            ['promptPreview'],
            ['prompt'],
            ['payload', 'promptContent'],
            ['payload', 'prompt'],
        ]);
        const sanitized = rawTitle ? sanitizeDisplayText(rawTitle) : '';
        if (sanitized) return sanitized;
    }
    return 'Ralph Session';
}

function buildRalphDisplayLabel(source: any, title: string, childProcessIds: string[]): string {
    const iterationCount = Array.isArray(source?.iterations) ? source.iterations.length : Math.max(0, childProcessIds.length - (source?.grillingProcess ? 1 : 0));
    const suffix = source?.phase === 'grilling' ? 'Clarifying' : `${iterationCount} iter`;
    return sanitizeDisplayText(`${title} - ${suffix}`);
}

function resolveWorkspaceId(source: any, activeWorkspaceId?: string | null): string | null {
    const explicit = stringFrom(source, [
        ['workspaceId'],
        ['repoId'],
        ['metadata', 'workspaceId'],
        ['payload', 'workspaceId'],
    ]);
    const safeExplicit = explicit && !looksLikeLocalPath(explicit) ? explicit : null;
    const active = activeWorkspaceId && !looksLikeLocalPath(activeWorkspaceId) ? activeWorkspaceId : null;

    if (active && safeExplicit && safeExplicit !== active) return null;
    return active ?? safeExplicit;
}

function resolveProcessId(source: any, idSource: CreateSessionContextDragPayloadOptions['idSource']): string | null {
    const explicitProcessId = stringFrom(source, [
        ['processId'],
        ['payload', 'processId'],
    ]);
    if (explicitProcessId) return explicitProcessId;

    const id = stringFrom(source, [['id']]);
    if (!id) return null;
    return idSource === 'queue-task' ? ensureQueueProcessId(id) : id;
}

function resolveTitle(source: any, processId: string): string {
    const rawTitle = stringFrom(source, [
        ['customTitle'],
        ['title'],
        ['displayName'],
        ['promptPreview'],
        ['prompt'],
        ['payload', 'promptContent'],
        ['payload', 'prompt'],
    ]);
    const sanitized = rawTitle ? sanitizeDisplayText(rawTitle) : '';
    return sanitized || processId;
}

export function createSessionContextDragPayload(
    source: unknown,
    options: CreateSessionContextDragPayloadOptions = {},
): SessionContextDragPayload | null {
    if (!source || typeof source !== 'object') return null;
    const record = source as any;
    const workspaceId = resolveWorkspaceId(record, options.activeWorkspaceId);
    const processId = resolveProcessId(record, options.idSource ?? 'process');
    const status = typeof record.status === 'string' ? record.status : '';
    const lastActivityAt = timestampFrom(record);

    if (!workspaceId || !processId || !ATTACHABLE_STATUSES.has(status as SessionContextSourceStatus) || !lastActivityAt) {
        return null;
    }

    return {
        kind: SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: workspaceId,
        sourceProcessId: processId,
        title: resolveTitle(record, processId),
        status: status as SessionContextSourceStatus,
        lastActivityAt,
    };
}

export function createRalphSessionContextDragPayload(
    source: unknown,
    options: CreateRalphSessionContextDragPayloadOptions = {},
): RalphSessionContextDragPayload | null {
    if (!source || typeof source !== 'object') return null;
    const record = source as any;
    const sessionId = stringFrom(record, [
        ['sessionId'],
        ['ralph', 'sessionId'],
        ['payload', 'context', 'ralph', 'sessionId'],
    ]);
    const phase = typeof record.phase === 'string' && RALPH_SESSION_PHASES.has(record.phase as RalphSessionContextPhase)
        ? record.phase as RalphSessionContextPhase
        : null;
    const children = getRalphSessionChildren(record);
    const workspaceId = resolveRalphWorkspaceId(record, children, options.activeWorkspaceId);
    const childProcessIds = resolveRalphChildProcessIds(children);
    const lastActivityAt = normalizeTimestamp(record.latestTimestamp) ?? timestampFrom(record);
    const status = resolveRalphStatus(record, children);

    if (
        !sessionId
        || !phase
        || !workspaceId
        || !childProcessIds
        || !lastActivityAt
        || !status
        || looksLikeLocalPath(sessionId)
        || looksLikeLocalPath(workspaceId)
    ) {
        return null;
    }

    const title = resolveRalphTitle(record, children);
    const displayLabel = buildRalphDisplayLabel(record, title, childProcessIds);
    const iterationCount = Array.isArray(record.iterations) ? record.iterations.length : Math.max(0, childProcessIds.length - (record.grillingProcess ? 1 : 0));

    return {
        kind: RALPH_SESSION_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: workspaceId,
        sourceRalphSessionId: sessionId,
        title,
        displayLabel,
        phase,
        status,
        lastActivityAt,
        childProcessIds,
        processCount: childProcessIds.length,
        iterationCount,
    };
}

export function writeSessionContextDragData(dataTransfer: DragDataTransfer, payload: SessionContextDragPayload): void {
    dataTransfer.effectAllowed = 'copy';
    dataTransfer.setData(SESSION_CONTEXT_DRAG_MIME, JSON.stringify(payload));
    dataTransfer.setData('text/plain', `CoC session context: ${payload.title} [${payload.status}] ${payload.sourceProcessId}`);
}

export function writeRalphSessionContextDragData(dataTransfer: DragDataTransfer, payload: RalphSessionContextDragPayload): void {
    dataTransfer.effectAllowed = 'copy';
    dataTransfer.setData(RALPH_SESSION_CONTEXT_DRAG_MIME, JSON.stringify(payload));
    dataTransfer.setData('text/plain', `CoC Ralph session context: ${payload.displayLabel} [${payload.phase}/${payload.status}] ${payload.sourceRalphSessionId}`);
}
