import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';

export type DeliveryWatchdogMode = 'autopilot' | 'ralph';
export type WatchdogFailureClass = 'none' | 'ordinary-failure' | 'classifier-rejection';
export type ClassifierCircuitState = 'closed' | 'attempted' | 'open';

const CLASSIFIER_COMPACTION_PROVIDERS = new Set(['copilot', 'codex', 'claude']);
const CLASSIFIER_COMPACT_INSTRUCTIONS =
    'Keep only authoritative delivery state, file references, and one bounded next action. '
    + 'Omit dense diagnostics and prior rejected content.';

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
    sdkSessionId?: string | null;
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
    failureClass: WatchdogFailureClass;
    failureOccurrenceId: string | null;
    provider: string | null;
    hasSdkSession: boolean;
}

export interface WatchdogState {
    startedAtMs: number;
    idleStreak: number;
    resumeCount: number;
    lastRecoveryAtMs: number | null;
    classifierCircuit: ClassifierCircuitState;
    classifierRejectionCount: number;
    classifierCompactionAttempts: number;
    classifierLastOccurrenceId: string | null;
}

export type WatchdogDecision =
    | { kind: 'wait'; reason: 'activity' | 'activity-during-recheck' | 'classifier-occurrence-seen' | 'cooldown' | 'idle' | 'split-brain'; state: WatchdogState }
    | { kind: 'recheck'; state: WatchdogState }
    | { kind: 'recover'; state: WatchdogState }
    | { kind: 'classifier-attempt'; state: WatchdogState }
    | {
        kind: 'handoff-required';
        reason:
            | 'classifier-circuit-open'
            | 'classifier-occurrence-unavailable'
            | 'classifier-recurred'
            | 'classifier-compaction-unsupported'
            | 'classifier-session-missing';
        state: WatchdogState;
    }
    | { kind: 'reject'; reason: 'duplicate-writer'; state: WatchdogState }
    | { kind: 'stop'; reason: 'binding-changed' | 'max-resumes' | 'ttl'; state: WatchdogState };

export interface RecoveryRequest {
    url: string;
    body: Record<string, unknown>;
}

export interface ClassifierRecoveryPlan {
    kind: 'attempt' | 'handoff-required';
    reason?: 'classifier-compaction-unsupported' | 'classifier-session-missing';
    compactRequest?: RecoveryRequest;
    recoveryRequest?: RecoveryRequest;
}

export interface ClassifierHandoffInput {
    ledgerCheckpointed: boolean;
    targetInflight: number;
    pendingWakeups: number;
    duplicateWriterTaskIds: string[];
    successorProcessId?: string;
    successorWriterCount: number;
    successorMode: string;
    successorWorkspaceId: string;
    successorWorktree: string;
    watchdogProcessId: string;
}

export interface ClassifierHandoffPlan {
    kind: 'ready' | 'fail-closed';
    reason?:
        | 'ledger-not-checkpointed'
        | 'old-writer-active'
        | 'pending-wakeup'
        | 'duplicate-writer'
        | 'fresh-writer-required'
        | 'successor-binding-mismatch'
        | 'watchdog-not-retargeted';
    action?: string;
    prompt?: string;
    lineage?: {
        predecessorProcessId: string;
        successorProcessId: string;
    };
}

export function createWatchdogState(startedAtMs: number): WatchdogState {
    return {
        startedAtMs,
        idleStreak: 0,
        resumeCount: 0,
        lastRecoveryAtMs: null,
        classifierCircuit: 'closed',
        classifierRejectionCount: 0,
        classifierCompactionAttempts: 0,
        classifierLastOccurrenceId: null,
    };
}

export function hasExactTerminalMarker(content: string, marker: string): boolean {
    return content.split(/\r?\n/).some(line => line.trim() === marker);
}

export function classifyWatchdogFailure(error: string | null): WatchdogFailureClass {
    if (!error) {
        return 'none';
    }
    const hasClassifierStatus = /(?:CAPIError:\s*|HTTP\s+)(?:400|422)\b/i.test(error);
    const hasClassifierPhrase = /(?:content.{0,48}(?:flagged|blocked|rejected)|possible cybersecurity risk|content policy|safety system)/i.test(error);
    return hasClassifierStatus && hasClassifierPhrase
        ? 'classifier-rejection'
        : 'ordinary-failure';
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
    const provider = typeof processMetadata.provider === 'string'
        ? processMetadata.provider
        : null;

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
    const rawFailureClass = classifyWatchdogFailure(snapshot.process?.error ?? null);
    const failureClass = rawFailureClass === 'classifier-rejection'
        && snapshot.process?.status === 'completed'
        ? 'none'
        : rawFailureClass;
    const failureOccurrenceId = failureClass === 'classifier-rejection'
        ? buildFailureOccurrenceId(snapshot.process)
        : null;

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
        failureClass,
        failureOccurrenceId,
        provider,
        hasSdkSession: Boolean(snapshot.process?.sdkSessionId?.trim()),
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
    if (state.classifierCircuit === 'open') {
        return {
            kind: 'handoff-required',
            reason: 'classifier-circuit-open',
            state: resetIdle(state),
        };
    }
    if (probe.failureClass === 'classifier-rejection') {
        if (state.classifierCircuit === 'attempted') {
            if (!probe.failureOccurrenceId) {
                return {
                    kind: 'handoff-required',
                    reason: 'classifier-occurrence-unavailable',
                    state: {
                        ...resetIdle(state),
                        classifierCircuit: 'open',
                    },
                };
            }
            if (probe.failureOccurrenceId === state.classifierLastOccurrenceId) {
                return {
                    kind: 'wait',
                    reason: 'classifier-occurrence-seen',
                    state: resetIdle(state),
                };
            }
            return {
                kind: 'handoff-required',
                reason: 'classifier-recurred',
                state: {
                    ...resetIdle(state),
                    classifierCircuit: 'open',
                    classifierRejectionCount: state.classifierRejectionCount + 1,
                    classifierLastOccurrenceId: probe.failureOccurrenceId,
                },
            };
        }
        if (!probe.failureOccurrenceId) {
            return {
                kind: 'handoff-required',
                reason: 'classifier-occurrence-unavailable',
                state: {
                    ...resetIdle(state),
                    classifierCircuit: 'open',
                    classifierRejectionCount: state.classifierRejectionCount + 1,
                },
            };
        }
        if (!probe.hasSdkSession) {
            return openClassifierCircuit(
                state,
                'classifier-session-missing',
                probe.failureOccurrenceId,
            );
        }
        if (!probe.provider || !CLASSIFIER_COMPACTION_PROVIDERS.has(probe.provider)) {
            return openClassifierCircuit(
                state,
                'classifier-compaction-unsupported',
                probe.failureOccurrenceId,
            );
        }
        return {
            kind: 'classifier-attempt',
            state: {
                ...resetIdle(state),
                classifierCircuit: 'attempted',
                classifierRejectionCount: state.classifierRejectionCount + 1,
                classifierCompactionAttempts: state.classifierCompactionAttempts + 1,
                classifierLastOccurrenceId: probe.failureOccurrenceId,
            },
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

export function planClassifierRecovery(
    config: DeliveryWatchdogConfig,
    probe: WatchdogProbe,
): ClassifierRecoveryPlan {
    if (!probe.hasSdkSession) {
        return { kind: 'handoff-required', reason: 'classifier-session-missing' };
    }
    if (!probe.provider || !CLASSIFIER_COMPACTION_PROVIDERS.has(probe.provider)) {
        return { kind: 'handoff-required', reason: 'classifier-compaction-unsupported' };
    }

    const baseUrl = config.serverUrl.replace(/\/+$/, '');
    return {
        kind: 'attempt',
        compactRequest: {
            url: `${baseUrl}/api/processes/${encodeURIComponent(config.processId)}/compact`
                + `?workspaceId=${encodeURIComponent(config.workspaceId)}`,
            body: { customInstructions: CLASSIFIER_COMPACT_INSTRUCTIONS },
        },
        recoveryRequest: buildRecoveryRequest(config, buildClassifierHandoffPrompt(config.ledgerPath)),
    };
}

export function planClassifierHandoff(
    config: DeliveryWatchdogConfig,
    input: ClassifierHandoffInput,
): ClassifierHandoffPlan {
    const failClosed = (reason: NonNullable<ClassifierHandoffPlan['reason']>): ClassifierHandoffPlan => ({
        kind: 'fail-closed',
        reason,
        action: 'Checkpoint the ledger, prove the old writer is quiescent, start exactly one fresh '
            + 'Autopilot writer, and retarget the detached watchdog before resuming.',
    });

    if (!input.ledgerCheckpointed) {
        return failClosed('ledger-not-checkpointed');
    }
    if (input.targetInflight > 0) {
        return failClosed('old-writer-active');
    }
    if (input.pendingWakeups > 0) {
        return failClosed('pending-wakeup');
    }
    if (input.duplicateWriterTaskIds.length > 0) {
        return failClosed('duplicate-writer');
    }
    const successorProcessId = input.successorProcessId?.trim();
    if (
        !successorProcessId
        || successorProcessId === config.processId
        || input.successorWriterCount !== 1
    ) {
        return failClosed('fresh-writer-required');
    }
    if (
        input.successorMode !== 'autopilot'
        || input.successorWorkspaceId !== config.workspaceId
        || !samePath(input.successorWorktree, config.worktree)
    ) {
        return failClosed('successor-binding-mismatch');
    }
    if (input.watchdogProcessId !== successorProcessId) {
        return failClosed('watchdog-not-retargeted');
    }
    return {
        kind: 'ready',
        prompt: buildClassifierHandoffPrompt(config.ledgerPath),
        lineage: {
            predecessorProcessId: config.processId,
            successorProcessId,
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
                sdk_session_id AS sdkSessionId,
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
            sdkSessionId: string | null;
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
                sdkSessionId: processRow.sdkSessionId,
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

function openClassifierCircuit(
    state: WatchdogState,
    reason: 'classifier-compaction-unsupported' | 'classifier-session-missing',
    occurrenceId: string,
): WatchdogDecision {
    return {
        kind: 'handoff-required',
        reason,
        state: {
            ...resetIdle(state),
            classifierCircuit: 'open',
            classifierRejectionCount: state.classifierRejectionCount + 1,
            classifierLastOccurrenceId: occurrenceId,
        },
    };
}

function buildFailureOccurrenceId(
    processSnapshot: WatchdogProcessSnapshot | null,
): string | null {
    if (!processSnapshot?.endTime) {
        return null;
    }
    return createHash('sha256')
        .update(processSnapshot.id)
        .update('\0')
        .update(processSnapshot.endTime)
        .digest('hex');
}

function buildClassifierHandoffPrompt(ledgerPath: string): string {
    return `Classifier recovery attempt. Read the authoritative ledger at ${ledgerPath} `
        + 'and perform exactly its Next bounded action. Keep dense diagnostics on disk and '
        + 'reference them only by file path.';
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
