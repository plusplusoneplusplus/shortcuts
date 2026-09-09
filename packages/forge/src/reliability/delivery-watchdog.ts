import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

export type DeliveryWatchdogMode = 'autopilot' | 'ralph';

export interface WatchdogLimits {
    pollIntervalMs: number;
    idlePolls: number;
    cooldownMs: number;
    ttlMs: number;
    maxResumes: number;
    heartbeatIntervalMs: number;
}

export const DEFAULT_WATCHDOG_LIMITS: WatchdogLimits = {
    pollIntervalMs: 60_000,
    idlePolls: 3,
    cooldownMs: 15 * 60_000,
    ttlMs: 72 * 60 * 60_000,
    maxResumes: 12,
    heartbeatIntervalMs: 15 * 60_000,
};

export interface DeliveryWatchdogConfig {
    workspaceId: string;
    processId: string;
    worktree: string;
    ledgerPath: string;
    promptFile: string;
    stateDir: string;
    dataDir: string;
    serverUrl: string;
    mode: DeliveryWatchdogMode;
    ralphSessionId?: string;
    completeMarker: string;
    blockedMarker: string;
    limits: WatchdogLimits;
}

export interface WatchdogProcessSnapshot {
    id: string;
    workspaceId: string;
    status: string;
    endTime: string | null;
    error: string | null;
    workingDirectory: string | null;
    metadata?: unknown;
}

export interface WatchdogTaskSnapshot {
    id: string;
    processId: string | null;
    repoId: string;
    status: 'queued' | 'running';
    folderPath: string | null;
    payload: unknown;
    repoRootPath?: string | null;
    processWorkingDirectory?: string | null;
}

export interface WatchdogWakeupSnapshot {
    processId: string;
    status: string;
    firesAt: string;
    ralphSessionId?: string;
}

export interface WatchdogSnapshot {
    process: WatchdogProcessSnapshot | null;
    activeTasks: WatchdogTaskSnapshot[];
    pendingWakeups: WatchdogWakeupSnapshot[];
}

export interface WatchdogProbe {
    processStatus: string;
    bindingMatches: boolean;
    targetInflight: number;
    pendingWakeups: number;
    splitBrain: boolean;
    duplicateWriterTaskIds: string[];
}

export interface WatchdogState {
    startedAtMs: number;
    idleStreak: number;
    resumeCount: number;
    lastRecoveryAtMs: number | null;
}

export type WatchdogDecision =
    | { kind: 'wait'; reason: 'activity' | 'activity-during-recheck' | 'cooldown' | 'idle' | 'split-brain'; state: WatchdogState }
    | { kind: 'recheck'; state: WatchdogState }
    | { kind: 'recover'; state: WatchdogState }
    | { kind: 'reject'; reason: 'duplicate-writer'; state: WatchdogState }
    | { kind: 'stop'; reason: 'binding-changed' | 'max-resumes' | 'ttl'; state: WatchdogState };

export interface RecoveryRequest {
    url: string;
    body: Record<string, unknown>;
}

export function createWatchdogState(startedAtMs: number): WatchdogState {
    return {
        startedAtMs,
        idleStreak: 0,
        resumeCount: 0,
        lastRecoveryAtMs: null,
    };
}

export function hasExactTerminalMarker(content: string, marker: string): boolean {
    return content.split(/\r?\n/).some(line => line.trim() === marker);
}

export function validateDeliveryWatchdogConfig(config: DeliveryWatchdogConfig): void {
    for (const [name, value] of [
        ['workspaceId', config.workspaceId],
        ['processId', config.processId],
        ['worktree', config.worktree],
        ['ledgerPath', config.ledgerPath],
        ['promptFile', config.promptFile],
        ['stateDir', config.stateDir],
        ['dataDir', config.dataDir],
        ['serverUrl', config.serverUrl],
        ['completeMarker', config.completeMarker],
        ['blockedMarker', config.blockedMarker],
    ] as const) {
        if (!value.trim()) {
            throw new Error(`${name} is required`);
        }
    }

    if (config.mode !== 'autopilot' && config.mode !== 'ralph') {
        throw new Error(`Unsupported watchdog mode: ${String(config.mode)}`);
    }
    if (config.mode === 'ralph' && !config.ralphSessionId?.trim()) {
        throw new Error('ralph-session-id is required when mode is ralph');
    }
    if (config.completeMarker === config.blockedMarker) {
        throw new Error('complete-marker and blocked-marker must differ');
    }
    for (const [name, marker] of [
        ['complete-marker', config.completeMarker],
        ['blocked-marker', config.blockedMarker],
    ] as const) {
        if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(marker)) {
            throw new Error(`${name} must be one uppercase standalone token`);
        }
    }

    let serverUrl: URL;
    try {
        serverUrl = new URL(config.serverUrl);
    } catch {
        throw new Error('server-url must be a valid HTTP or HTTPS URL');
    }
    if (!['http:', 'https:'].includes(serverUrl.protocol)) {
        throw new Error('server-url must use HTTP or HTTPS');
    }
    if (serverUrl.username || serverUrl.password) {
        throw new Error('server-url must not contain credentials');
    }
    if (serverUrl.search || serverUrl.hash) {
        throw new Error('server-url must not contain a query or fragment');
    }
    if (serverUrl.pathname !== '/' && serverUrl.pathname !== '') {
        throw new Error('server-url must not contain a path');
    }

    for (const [name, value] of [
        ['ledger', config.ledgerPath],
        ['prompt-file', config.promptFile],
        ['state-dir', config.stateDir],
    ] as const) {
        if (isSameOrChildPath(canonicalPath(value), canonicalPath(config.worktree))) {
            throw new Error(`${name} must be outside the target worktree`);
        }
    }

    for (const [name, value] of Object.entries(config.limits)) {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`${name} must be a positive integer`);
        }
    }
    if (config.limits.heartbeatIntervalMs < config.limits.pollIntervalMs) {
        throw new Error('heartbeatIntervalMs must be at least pollIntervalMs');
    }
}

export function deriveWatchdogProbe(
    snapshot: WatchdogSnapshot,
    config: DeliveryWatchdogConfig,
    nowMs: number,
): WatchdogProbe {
    const targetTaskId = config.processId.startsWith('queue_')
        ? config.processId.slice('queue_'.length)
        : config.processId;
    let targetInflight = 0;
    let sameProcessInflight = 0;
    const duplicateWriterTaskIds: string[] = [];
    const processMetadata = toRecord(snapshot.process?.metadata);
    const processRalph = toRecord(processMetadata.ralph);

    for (const task of snapshot.activeTasks) {
        const payload = toRecord(task.payload);
        const context = toRecord(payload.context);
        const ralph = toRecord(context.ralph);
        const sameProcess = (
            task.id === targetTaskId
            || task.processId === config.processId
            || payload.processId === config.processId
        );
        const sameRalphSession = (
            config.mode === 'ralph'
            && typeof config.ralphSessionId === 'string'
            && ralph.sessionId === config.ralphSessionId
        );
        const isTarget = sameProcess || sameRalphSession;

        if (isTarget) {
            targetInflight++;
            if (sameProcess) {
                sameProcessInflight++;
            }
            continue;
        }

        if (
            (payload.mode === 'autopilot' || payload.mode === 'ralph')
            && (
                samePath(task.folderPath, config.worktree)
                || samePath(payload.workingDirectory, config.worktree)
                || samePath(task.repoRootPath, config.worktree)
                || samePath(task.processWorkingDirectory, config.worktree)
            )
        ) {
            duplicateWriterTaskIds.push(task.id);
        }
    }

    const processTerminalOrErrored = Boolean(
        snapshot.process
        && (
            ['completed', 'failed', 'cancelled'].includes(snapshot.process.status)
            || snapshot.process.endTime
            || snapshot.process.error
        )
    );
    const pendingWakeups = snapshot.pendingWakeups.filter(wakeup => (
        wakeup.status === 'pending'
        && (
            wakeup.processId === config.processId
            || (
                config.mode === 'ralph'
                && wakeup.ralphSessionId === config.ralphSessionId
            )
        )
    )).length;
    const modeMatches = processMetadata.mode === config.mode;
    const ralphSessionMatches = config.mode !== 'ralph'
        || processRalph.sessionId === config.ralphSessionId;

    return {
        processStatus: snapshot.process?.status ?? 'missing',
        bindingMatches: Boolean(
            snapshot.process
            && snapshot.process.workspaceId === config.workspaceId
            && samePath(snapshot.process.workingDirectory, config.worktree)
            && modeMatches
            && ralphSessionMatches
        ),
        targetInflight,
        pendingWakeups,
        splitBrain: processTerminalOrErrored && sameProcessInflight > 0,
        duplicateWriterTaskIds: duplicateWriterTaskIds.sort(),
    };
}

export function evaluateWatchdogPoll(
    state: WatchdogState,
    probe: WatchdogProbe,
    nowMs: number,
    limits: WatchdogLimits,
): WatchdogDecision {
    if (nowMs - state.startedAtMs >= limits.ttlMs) {
        return { kind: 'stop', reason: 'ttl', state };
    }
    if (!probe.bindingMatches) {
        return { kind: 'stop', reason: 'binding-changed', state };
    }
    if (probe.splitBrain) {
        return { kind: 'wait', reason: 'split-brain', state: resetIdle(state) };
    }
    if (probe.targetInflight > 0 || probe.pendingWakeups > 0) {
        return { kind: 'wait', reason: 'activity', state: resetIdle(state) };
    }

    const nextState = { ...state, idleStreak: state.idleStreak + 1 };
    if (nextState.idleStreak >= limits.idlePolls) {
        return { kind: 'recheck', state: nextState };
    }
    return { kind: 'wait', reason: 'idle', state: nextState };
}

export function confirmWatchdogRecovery(
    state: WatchdogState,
    probe: WatchdogProbe,
    nowMs: number,
    limits: WatchdogLimits,
): WatchdogDecision {
    if (nowMs - state.startedAtMs >= limits.ttlMs) {
        return { kind: 'stop', reason: 'ttl', state };
    }
    if (!probe.bindingMatches) {
        return { kind: 'stop', reason: 'binding-changed', state };
    }
    if (probe.splitBrain || probe.targetInflight > 0 || probe.pendingWakeups > 0) {
        return {
            kind: 'wait',
            reason: 'activity-during-recheck',
            state: resetIdle(state),
        };
    }
    if (probe.duplicateWriterTaskIds.length > 0) {
        return {
            kind: 'reject',
            reason: 'duplicate-writer',
            state: resetIdle(state),
        };
    }
    if (state.resumeCount >= limits.maxResumes) {
        return { kind: 'stop', reason: 'max-resumes', state };
    }
    if (
        state.lastRecoveryAtMs !== null
        && nowMs - state.lastRecoveryAtMs < limits.cooldownMs
    ) {
        return { kind: 'wait', reason: 'cooldown', state: resetIdle(state) };
    }

    return {
        kind: 'recover',
        state: {
            ...state,
            idleStreak: 0,
            resumeCount: state.resumeCount + 1,
            lastRecoveryAtMs: nowMs,
        },
    };
}

export function buildRecoveryRequest(
    config: DeliveryWatchdogConfig,
    prompt: string,
): RecoveryRequest {
    const baseUrl = config.serverUrl.replace(/\/+$/, '');
    if (config.mode === 'ralph') {
        if (!config.ralphSessionId) {
            throw new Error('ralph-session-id is required when mode is ralph');
        }
        return {
            url: `${baseUrl}/api/workspaces/${encodeURIComponent(config.workspaceId)}`
                + `/ralph-sessions/${encodeURIComponent(config.ralphSessionId)}/resume`,
            body: {},
        };
    }

    return {
        url: `${baseUrl}/api/queue`,
        body: {
            type: 'chat',
            priority: 'high',
            repoId: config.workspaceId,
            displayName: 'Long-running reliability recovery',
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                processId: config.processId,
                workspaceId: config.workspaceId,
                workingDirectory: config.worktree,
                prompt,
            },
        },
    };
}

export function probeDeliveryWatchdogDatabase(
    config: DeliveryWatchdogConfig,
    nowMs: number = Date.now(),
): WatchdogProbe {
    const databasePath = path.join(config.dataDir, 'processes.db');
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
        const processRow = db.prepare(`
            SELECT
                id,
                workspace_id AS workspaceId,
                status,
                end_time AS endTime,
                error,
                working_directory AS workingDirectory,
                metadata
            FROM processes
            WHERE id = ?
        `).get(config.processId) as {
            id: string;
            workspaceId: string;
            status: string;
            endTime: string | null;
            error: string | null;
            workingDirectory: string | null;
            metadata: string | null;
        } | undefined;
        const taskRows = db.prepare(`
            SELECT
                task.id,
                task.process_id AS processId,
                task.repo_id AS repoId,
                task.status,
                task.folder_path AS folderPath,
                task.payload,
                repo_path.root_path AS repoRootPath,
                task_process.working_directory AS processWorkingDirectory
            FROM queue_tasks AS task
            LEFT JOIN queue_repo_paths AS repo_path
              ON repo_path.repo_id = task.repo_id
            LEFT JOIN processes AS task_process
              ON task_process.id = COALESCE(task.process_id, 'queue_' || task.id)
            WHERE task.status IN ('queued', 'running')
        `).all() as Array<{
            id: string;
            processId: string | null;
            repoId: string;
            status: 'queued' | 'running';
            folderPath: string | null;
            payload: string;
            repoRootPath: string | null;
            processWorkingDirectory: string | null;
        }>;
        const wakeupRows = db.prepare(`
            SELECT
                wakeup.process_id AS processId,
                wakeup.status,
                wakeup.fires_at AS firesAt,
                process.metadata AS processMetadata
            FROM wakeups AS wakeup
            LEFT JOIN processes AS process
              ON process.id = wakeup.process_id
            WHERE wakeup.status = 'pending'
              AND (wakeup.process_id = ? OR ? = 'ralph')
        `).all(config.processId, config.mode) as Array<{
            processId: string;
            status: string;
            firesAt: string;
            processMetadata: string | null;
        }>;

        return deriveWatchdogProbe({
            process: processRow ? {
                id: processRow.id,
                workspaceId: processRow.workspaceId,
                status: processRow.status,
                endTime: processRow.endTime,
                error: processRow.error,
                workingDirectory: processRow.workingDirectory,
                metadata: parseJsonObject(processRow.metadata ?? ''),
            } : null,
            activeTasks: taskRows.map(row => ({
                id: row.id,
                processId: row.processId,
                repoId: row.repoId,
                status: row.status,
                folderPath: row.folderPath,
                payload: parseJsonObject(row.payload),
                repoRootPath: row.repoRootPath,
                processWorkingDirectory: row.processWorkingDirectory,
            })),
            pendingWakeups: wakeupRows.map(row => ({
                ...(() => {
                    const metadata = parseJsonObject(row.processMetadata ?? '');
                    const ralph = toRecord(metadata.ralph);
                    return typeof ralph.sessionId === 'string'
                        ? { ralphSessionId: ralph.sessionId }
                        : {};
                })(),
                processId: row.processId,
                status: row.status,
                firesAt: row.firesAt,
            })),
        }, config, nowMs);
    } finally {
        db.close();
    }
}

export function readTerminalMarker(
    ledgerPath: string,
    completeMarker: string,
    blockedMarker: string,
): 'complete' | 'blocked' | null {
    const content = fs.readFileSync(ledgerPath, 'utf-8');
    if (hasExactTerminalMarker(content, completeMarker)) {
        return 'complete';
    }
    if (hasExactTerminalMarker(content, blockedMarker)) {
        return 'blocked';
    }
    return null;
}

function resetIdle(state: WatchdogState): WatchdogState {
    return state.idleStreak === 0 ? state : { ...state, idleStreak: 0 };
}

function parseJsonObject(value: string): Record<string, unknown> {
    try {
        return toRecord(JSON.parse(value));
    } catch {
        return {};
    }
}

function toRecord(value: unknown): Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : {};
}

function samePath(left: unknown, right: string): boolean {
    if (typeof left !== 'string' || !left.trim()) {
        return false;
    }
    const normalize = (value: string) => {
        const resolved = path.resolve(value);
        let normalized: string;
        try {
            normalized = fs.realpathSync.native(resolved);
        } catch {
            normalized = resolved;
        }
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    };
    return normalize(left) === normalize(right);
}

function isSameOrChildPath(candidate: string, parent: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === ''
        || (
            relative !== '..'
            && !relative.startsWith(`..${path.sep}`)
            && !path.isAbsolute(relative)
        );
}

function canonicalPath(value: string): string {
    let existing = path.resolve(value);
    const suffix: string[] = [];
    while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) {
            break;
        }
        suffix.unshift(path.basename(existing));
        existing = parent;
    }
    let canonical = existing;
    try {
        canonical = fs.realpathSync.native(existing);
    } catch {
        // The lexical root is the safest available comparison for a missing path.
    }
    const result = path.join(canonical, ...suffix);
    return process.platform === 'win32' ? result.toLowerCase() : result;
}
