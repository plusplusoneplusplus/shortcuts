import { ensureQueueProcessId } from '../../utils/queue-process-id';

export const SESSION_CONTEXT_DRAG_MIME = 'application/vnd.coc.session-context+json';
export const SESSION_CONTEXT_DRAG_KIND = 'coc.session-context';

export type SessionContextSourceStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SessionContextDragPayload {
    kind: typeof SESSION_CONTEXT_DRAG_KIND;
    version: 1;
    sourceWorkspaceId: string;
    sourceProcessId: string;
    title: string;
    status: SessionContextSourceStatus;
    lastActivityAt: string;
}

export interface CreateSessionContextDragPayloadOptions {
    activeWorkspaceId?: string | null;
    idSource?: 'process' | 'queue-task';
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

export function writeSessionContextDragData(dataTransfer: DragDataTransfer, payload: SessionContextDragPayload): void {
    dataTransfer.effectAllowed = 'copy';
    dataTransfer.setData(SESSION_CONTEXT_DRAG_MIME, JSON.stringify(payload));
    dataTransfer.setData('text/plain', `CoC session context: ${payload.title} [${payload.status}] ${payload.sourceProcessId}`);
}
