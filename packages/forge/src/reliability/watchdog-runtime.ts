import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import {
    buildRecoveryRequest,
    confirmWatchdogRecovery,
    createWatchdogState,
    evaluateWatchdogPoll,
    probeDeliveryWatchdogDatabase,
    readTerminalMarker,
    validateDeliveryWatchdogConfig,
    type DeliveryWatchdogConfig,
    type WatchdogProbe,
    type WatchdogState,
} from './delivery-watchdog';

export const WATCHDOG_CONFIG_FILENAME = 'watchdog-config.json';
export const WATCHDOG_STATE_FILENAME = 'watchdog-state.json';
export const WATCHDOG_STOP_FILENAME = 'stop-request.json';
export const WATCHDOG_LOG_FILENAME = 'watchdog.log';
export const WATCHDOG_LOCK_FILENAME = 'watchdog-control.db';

export type DeliveryWatchdogRunStatus =
    | 'starting'
    | 'running'
    | 'stop-requested'
    | 'stopped'
    | 'complete'
    | 'blocked'
    | 'failed'
    | 'ttl'
    | 'max-resumes'
    | 'binding-changed';

export interface DeliveryWatchdogPersistentState extends WatchdogState {
    instanceId: string;
    pid: number;
    status: DeliveryWatchdogRunStatus;
    workspaceId: string;
    processId: string;
    worktree: string;
    mode: string;
    lastHeartbeatAtMs: number;
    lastProbe: WatchdogProbe | null;
    lastAction: string;
    error?: string;
}

interface WatchdogDeploymentFile {
    instanceId: string;
    config: DeliveryWatchdogConfig;
    requiresParentHandoff?: boolean;
}

export interface DeliveryWatchdogStatus {
    running: boolean;
    pid: number;
    status: DeliveryWatchdogRunStatus;
    workspaceId: string;
    processId: string;
    worktree: string;
    mode: string;
    resumeCount: number;
    idleStreak: number;
    startedAt: string;
    lastHeartbeatAt: string;
    lastAction: string;
    error?: string;
}

export interface WatchdogRuntimeDependencies {
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    probe?: (config: DeliveryWatchdogConfig, nowMs: number) => WatchdogProbe;
    postJson?: (url: string, body: Record<string, unknown>) => Promise<string>;
    verifyServer?: (config: DeliveryWatchdogConfig) => Promise<void>;
    spawnDetached?: (runnerScript: string, configFile: string) => number;
    isProcessAlive?: (pid: number) => boolean;
}

export async function startDeliveryWatchdog(
    config: DeliveryWatchdogConfig,
    runnerScript: string,
    deps: WatchdogRuntimeDependencies = {},
): Promise<{ pid: number; stateFile: string }> {
    validateDeliveryWatchdogConfig(config);
    validateInputFiles(config);
    fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
    validateDeliveryWatchdogConfig(config);

    const stateFile = path.join(config.stateDir, WATCHDOG_STATE_FILENAME);
    const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
    const now = deps.now?.() ?? Date.now();
    const claim = acquireStartClaim(config.stateDir, now, isProcessAlive);
    try {
        const existingState = readJsonFile<DeliveryWatchdogPersistentState>(stateFile);
        if (
            existingState
            && ['starting', 'running', 'stop-requested'].includes(existingState.status)
            && isProcessAlive(existingState.pid)
        ) {
            throw new Error(`A watchdog is already active in ${config.stateDir}`);
        }

        const probe = (deps.probe ?? probeDeliveryWatchdogDatabase)(config, now);
        if (!probe.bindingMatches) {
            throw new Error('Target process does not match the configured workspace, worktree, and mode');
        }
        if (probe.duplicateWriterTaskIds.length > 0) {
            throw new Error(`Duplicate writers target the worktree: ${probe.duplicateWriterTaskIds.join(', ')}`);
        }
        await (deps.verifyServer ?? defaultVerifyServer)(config);

        const configFile = path.join(config.stateDir, WATCHDOG_CONFIG_FILENAME);
        writeWatchdogJsonAtomic(configFile, {
            instanceId: claim.instanceId,
            config,
            requiresParentHandoff: true,
        } satisfies WatchdogDeploymentFile);
        fs.rmSync(path.join(config.stateDir, WATCHDOG_STOP_FILENAME), { force: true });

        const priorState = existingState && sameTarget(existingState, config)
            ? existingState
            : null;
        writePersistentState(config.stateDir, {
            ...(priorState
                ? {
                    startedAtMs: priorState.startedAtMs,
                    idleStreak: 0,
                    resumeCount: priorState.resumeCount,
                    lastRecoveryAtMs: priorState.lastRecoveryAtMs,
                }
                : createWatchdogState(now)),
            instanceId: claim.instanceId,
            pid: process.pid,
            status: 'starting',
            workspaceId: config.workspaceId,
            processId: config.processId,
            worktree: canonicalFilesystemPath(config.worktree),
            mode: config.mode,
            lastHeartbeatAtMs: now,
            lastProbe: probe,
            lastAction: 'awaiting child launch',
        });

        let spawnedPid: number;
        try {
            spawnedPid = (deps.spawnDetached ?? defaultSpawnDetached)(runnerScript, configFile);
            if (!Number.isSafeInteger(spawnedPid) || spawnedPid <= 0) {
                throw new Error('Detached watchdog did not return a valid PID');
            }
            acknowledgeChildLaunch(config.stateDir, claim.instanceId, spawnedPid);
        } catch (error) {
            const current = readJsonFile<DeliveryWatchdogPersistentState>(stateFile);
            if (current?.instanceId === claim.instanceId && current.status === 'starting') {
                writePersistentState(config.stateDir, {
                    ...current,
                    status: 'failed',
                    lastAction: 'child launch failed',
                    error: errorMessage(error),
                });
            }
            throw error;
        }

        if (!deps.spawnDetached) {
            await waitForStartup(stateFile, claim.instanceId, spawnedPid, isProcessAlive);
        }
        return { pid: spawnedPid, stateFile };
    } finally {
        releaseStartClaim(config.stateDir, claim.instanceId);
    }
}

export function getDeliveryWatchdogStatus(
    stateDir: string,
    deps: Pick<WatchdogRuntimeDependencies, 'isProcessAlive'> = {},
): DeliveryWatchdogStatus {
    const state = requireState(stateDir);
    const processAlive = (deps.isProcessAlive ?? defaultIsProcessAlive)(state.pid);
    return {
        running: processAlive && ['starting', 'running', 'stop-requested'].includes(state.status),
        pid: state.pid,
        status: state.status,
        workspaceId: state.workspaceId,
        processId: state.processId,
        worktree: state.worktree,
        mode: state.mode,
        resumeCount: state.resumeCount,
        idleStreak: state.idleStreak,
        startedAt: new Date(state.startedAtMs).toISOString(),
        lastHeartbeatAt: new Date(state.lastHeartbeatAtMs).toISOString(),
        lastAction: state.lastAction,
        ...(state.error ? { error: state.error } : {}),
    };
}

export function requestDeliveryWatchdogStop(
    stateDir: string,
): { requested: boolean; pid: number } {
    const state = requireState(stateDir);
    writeWatchdogJsonAtomic(path.join(stateDir, WATCHDOG_STOP_FILENAME), {
        instanceId: state.instanceId,
        requestedAt: new Date().toISOString(),
    });
    return { requested: true, pid: state.pid };
}

export async function runDeliveryWatchdog(
    configFile: string,
    deps: WatchdogRuntimeDependencies = {},
): Promise<void> {
    const deployment = readJsonFile<WatchdogDeploymentFile>(configFile);
    if (!deployment) {
        throw new Error(`Watchdog config not found: ${configFile}`);
    }
    const { config, instanceId } = deployment;
    validateDeliveryWatchdogConfig(config);
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? defaultSleep;
    const probe = deps.probe ?? probeDeliveryWatchdogDatabase;
    const postJson = deps.postJson ?? defaultPostJson;
    const verifyServer = deps.verifyServer ?? defaultVerifyServer;
    const stateDir = config.stateDir;
    if (deployment.requiresParentHandoff) {
        await waitForParentHandoff(
            path.join(stateDir, WATCHDOG_STATE_FILENAME),
            instanceId,
            process.pid,
            sleep,
        );
    }
    const previous = readJsonFile<DeliveryWatchdogPersistentState>(
        path.join(stateDir, WATCHDOG_STATE_FILENAME),
    );
    const baseState = previous && sameTarget(previous, config)
        ? {
            startedAtMs: previous.startedAtMs,
            idleStreak: 0,
            resumeCount: previous.resumeCount,
            lastRecoveryAtMs: previous.lastRecoveryAtMs,
        }
        : createWatchdogState(now());
    let state: DeliveryWatchdogPersistentState = {
        ...baseState,
        instanceId,
        pid: process.pid,
        status: 'running',
        workspaceId: config.workspaceId,
        processId: config.processId,
        worktree: canonicalFilesystemPath(config.worktree),
        mode: config.mode,
        lastHeartbeatAtMs: now(),
        lastProbe: null,
        lastAction: 'startup',
    };

    try {
        const initialProbe = probe(config, now());
        if (!initialProbe.bindingMatches) {
            throw new Error('Target process binding changed before watchdog startup');
        }
        if (initialProbe.duplicateWriterTaskIds.length > 0) {
            throw new Error(`Duplicate writers target the worktree: ${initialProbe.duplicateWriterTaskIds.join(', ')}`);
        }
        state = { ...state, lastProbe: initialProbe };
        persistAndLog(config, state, `startup heartbeat ${formatProbe(initialProbe)}`);

        while (state.status === 'running') {
            const preSleepStop = readStopRequest(stateDir, instanceId);
            if (preSleepStop) {
                state = finish(config, state, 'stopped', 'stop request observed');
                break;
            }
            const terminal = readTerminalMarker(
                config.ledgerPath,
                config.completeMarker,
                config.blockedMarker,
            );
            if (terminal) {
                state = finish(config, state, terminal, `${terminal} terminal marker observed`);
                break;
            }

            await sleep(config.limits.pollIntervalMs);
            const currentTime = now();
            if (readStopRequest(stateDir, instanceId)) {
                state = finish(config, state, 'stopped', 'stop request observed');
                break;
            }
            const postSleepTerminal = readTerminalMarker(
                config.ledgerPath,
                config.completeMarker,
                config.blockedMarker,
            );
            if (postSleepTerminal) {
                state = finish(
                    config,
                    state,
                    postSleepTerminal,
                    `${postSleepTerminal} terminal marker observed`,
                );
                break;
            }
            if (currentTime - state.startedAtMs >= config.limits.ttlMs) {
                state = finish(config, state, 'ttl', 'ttl');
                break;
            }

            let currentProbe: WatchdogProbe;
            try {
                currentProbe = probe(config, currentTime);
            } catch {
                appendLog(config, 'probe failed; skipping poll');
                state = {
                    ...state,
                    lastAction: 'probe failed',
                };
                writePersistentState(stateDir, state);
                continue;
            }

            let decision = evaluateWatchdogPoll(state, currentProbe, currentTime, config.limits);
            state = {
                ...state,
                ...decision.state,
                lastProbe: currentProbe,
                lastAction: decision.kind === 'wait' ? decision.reason : decision.kind,
            };

            if (currentTime - state.lastHeartbeatAtMs >= config.limits.heartbeatIntervalMs) {
                state.lastHeartbeatAtMs = currentTime;
                appendLog(config, `heartbeat ${formatProbe(currentProbe)} resumes=${state.resumeCount}`);
            }
            if (decision.kind === 'wait' && decision.reason === 'split-brain') {
                appendLog(
                    config,
                    'queue/process split-brain; bounded wait continues because cancellation does not release the limiter slot',
                );
            } else if (decision.kind === 'wait' && decision.reason === 'idle') {
                appendLog(config, `idle poll ${state.idleStreak}/${config.limits.idlePolls}`);
            }

            if (decision.kind === 'recheck') {
                try {
                    const prompt = readBoundedPrompt(config.promptFile);
                    const request = buildRecoveryRequest(config, prompt);
                    await verifyServer(config);

                    const dispatchTime = now();
                    if (readStopRequest(stateDir, instanceId)) {
                        state = finish(config, state, 'stopped', 'stop request observed');
                        break;
                    }
                    if (dispatchTime - state.startedAtMs >= config.limits.ttlMs) {
                        state = finish(config, state, 'ttl', 'ttl');
                        break;
                    }
                    const recheckProbe = probe(config, dispatchTime);
                    const terminalDuringRecheck = readTerminalMarker(
                        config.ledgerPath,
                        config.completeMarker,
                        config.blockedMarker,
                    );
                    if (terminalDuringRecheck) {
                        state = finish(
                            config,
                            state,
                            terminalDuringRecheck,
                            `${terminalDuringRecheck} terminal marker observed during immediate recheck`,
                        );
                        break;
                    }

                    decision = confirmWatchdogRecovery(
                        state,
                        recheckProbe,
                        dispatchTime,
                        config.limits,
                    );
                    state = {
                        ...state,
                        ...decision.state,
                        lastProbe: recheckProbe,
                        lastAction: decision.kind === 'wait' || decision.kind === 'reject'
                            ? decision.reason
                            : decision.kind,
                    };

                    if (decision.kind === 'recover') {
                        state.lastAction = `recovery-intent-${state.resumeCount}`;
                        writePersistentState(stateDir, state);
                        const response = await postJson(request.url, request.body);
                        state.lastAction = `recovery ${state.resumeCount} enqueued`;
                        appendLog(
                            config,
                            `recovery ${state.resumeCount} enqueued mode=${config.mode}`
                                + formatRecoveryAcknowledgement(response),
                        );
                    } else if (decision.kind === 'reject') {
                        appendLog(
                            config,
                            `duplicate-writer guard rejected recovery: ${recheckProbe.duplicateWriterTaskIds.join(', ')}`,
                        );
                    } else if (decision.kind === 'wait') {
                        appendLog(config, `immediate recheck rejected recovery: ${decision.reason}`);
                    }
                } catch {
                    state = {
                        ...state,
                        idleStreak: 0,
                        lastAction: 'recovery preparation failed',
                    };
                    appendLog(config, state.lastAction);
                }
            }

            if (decision.kind === 'stop') {
                const status = decision.reason === 'ttl'
                    ? 'ttl'
                    : decision.reason === 'max-resumes'
                        ? 'max-resumes'
                        : 'binding-changed';
                state = finish(config, state, status, decision.reason);
                break;
            }
            writePersistentState(stateDir, state);
        }
    } catch {
        state = {
            ...state,
            status: 'failed',
            lastAction: 'failed',
            error: 'watchdog failed',
        };
        persistAndLog(config, state, 'fatal: watchdog failed');
        throw new Error('Delivery watchdog failed');
    }
}

function validateInputFiles(config: DeliveryWatchdogConfig): void {
    if (!fs.statSync(config.worktree, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`worktree does not exist: ${config.worktree}`);
    }
    for (const [name, file] of [
        ['ledger', config.ledgerPath],
        ['prompt-file', config.promptFile],
    ] as const) {
        if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
            throw new Error(`${name} does not exist: ${file}`);
        }
    }
    readBoundedPrompt(config.promptFile);
    const terminal = readTerminalMarker(
        config.ledgerPath,
        config.completeMarker,
        config.blockedMarker,
    );
    if (terminal) {
        throw new Error(`ledger already contains the ${terminal} terminal marker`);
    }
}

function readBoundedPrompt(promptFile: string): string {
    const stat = fs.statSync(promptFile);
    if (stat.size > 16 * 1024) {
        throw new Error('prompt-file must be at most 16 KiB');
    }
    const prompt = fs.readFileSync(promptFile, 'utf-8').trim();
    if (!prompt) {
        throw new Error('prompt-file must not be empty');
    }
    return prompt;
}

function sameTarget(
    state: DeliveryWatchdogPersistentState,
    config: DeliveryWatchdogConfig,
): boolean {
    return state.workspaceId === config.workspaceId
        && state.processId === config.processId
        && sameCanonicalPath(state.worktree, config.worktree)
        && state.mode === config.mode;
}

function finish(
    config: DeliveryWatchdogConfig,
    state: DeliveryWatchdogPersistentState,
    status: DeliveryWatchdogRunStatus,
    action: string,
): DeliveryWatchdogPersistentState {
    const next = { ...state, status, lastAction: action };
    persistAndLog(config, next, action);
    return next;
}

function persistAndLog(
    config: DeliveryWatchdogConfig,
    state: DeliveryWatchdogPersistentState,
    message: string,
): void {
    writePersistentState(config.stateDir, state);
    appendLog(config, message);
}

function writePersistentState(
    stateDir: string,
    state: DeliveryWatchdogPersistentState,
): void {
    writeWatchdogJsonAtomic(path.join(stateDir, WATCHDOG_STATE_FILENAME), state);
}

function requireState(stateDir: string): DeliveryWatchdogPersistentState {
    const state = readJsonFile<DeliveryWatchdogPersistentState>(
        path.join(stateDir, WATCHDOG_STATE_FILENAME),
    );
    if (!state) {
        throw new Error(`Watchdog state not found in ${stateDir}`);
    }
    return state;
}

function readStopRequest(stateDir: string, instanceId: string): boolean {
    const request = readJsonFile<{ instanceId?: string }>(
        path.join(stateDir, WATCHDOG_STOP_FILENAME),
    );
    return request?.instanceId === instanceId;
}

function appendLog(config: DeliveryWatchdogConfig, message: string): void {
    fs.appendFileSync(
        path.join(config.stateDir, WATCHDOG_LOG_FILENAME),
        `${new Date().toISOString()} ${message}\n`,
        { encoding: 'utf-8', mode: 0o600 },
    );
}

function formatProbe(probe: WatchdogProbe): string {
    return `status=${probe.processStatus}`
        + ` target_inflight=${probe.targetInflight}`
        + ` wakeups=${probe.pendingWakeups}`
        + ` split_brain=${probe.splitBrain}`
        + ` duplicate_writers=${JSON.stringify(probe.duplicateWriterTaskIds)}`;
}

export function writeWatchdogJsonAtomic(
    file: string,
    value: unknown,
    renameFile: (oldPath: string, newPath: string) => void = fs.renameSync,
): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp.${process.pid}.${randomUUID()}`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: 0o600,
    });
    try {
        renameFile(temp, file);
    } catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
    }
}

function acquireStartClaim(
    stateDir: string,
    nowMs: number,
    isProcessAlive: (pid: number) => boolean,
): { instanceId: string } {
    const controlFile = path.join(stateDir, WATCHDOG_LOCK_FILENAME);
    let db: Database.Database;
    try {
        db = new Database(controlFile);
        db.pragma('busy_timeout = 5000');
        db.exec(`
            CREATE TABLE IF NOT EXISTS watchdog_claim (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                instance_id TEXT NOT NULL,
                owner_pid INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL
            )
        `);
    } catch (error) {
        throw new Error(`Watchdog start claim is unreadable in ${stateDir}: ${errorMessage(error)}`);
    }
    const instanceId = randomUUID();
    const acquire = db.transaction(() => {
        const existingClaim = db.prepare(`
            SELECT instance_id AS instanceId, owner_pid AS ownerPid
            FROM watchdog_claim
            WHERE singleton = 1
        `).get() as { instanceId: string; ownerPid: number } | undefined;
        const state = readJsonFile<DeliveryWatchdogPersistentState>(
            path.join(stateDir, WATCHDOG_STATE_FILENAME),
        );
        if (
            state
            && ['starting', 'running', 'stop-requested'].includes(state.status)
            && isProcessAlive(state.pid)
        ) {
            throw new Error(`A watchdog is already active in ${stateDir}`);
        }
        if (
            existingClaim
            && (
                existingClaim.ownerPid === process.pid
                || isProcessAlive(existingClaim.ownerPid)
            )
        ) {
            throw new Error(`A watchdog start is already in progress in ${stateDir}`);
        }
        db.prepare(`
            INSERT INTO watchdog_claim (singleton, instance_id, owner_pid, created_at_ms)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(singleton) DO UPDATE SET
                instance_id = excluded.instance_id,
                owner_pid = excluded.owner_pid,
                created_at_ms = excluded.created_at_ms
        `).run(instanceId, process.pid, nowMs);
    });
    try {
        acquire.immediate();
        return { instanceId };
    } finally {
        db.close();
    }
}

function releaseStartClaim(stateDir: string, instanceId: string): void {
    const controlFile = path.join(stateDir, WATCHDOG_LOCK_FILENAME);
    try {
        const db = new Database(controlFile);
        try {
            db.prepare(`
                DELETE FROM watchdog_claim
                WHERE singleton = 1 AND instance_id = ?
            `).run(instanceId);
        } finally {
            db.close();
        }
    } catch {
        // The owner state remains authoritative if best-effort claim release fails.
    }
}

function acknowledgeChildLaunch(
    stateDir: string,
    instanceId: string,
    childPid: number,
): void {
    const stateFile = path.join(stateDir, WATCHDOG_STATE_FILENAME);
    const state = requireState(stateDir);
    if (
        state.instanceId === instanceId
        && state.status === 'running'
        && state.pid === childPid
    ) {
        return;
    }
    if (state.instanceId !== instanceId || state.status !== 'starting') {
        throw new Error('Watchdog child launch state changed before handoff');
    }
    writeWatchdogJsonAtomic(stateFile, {
        ...state,
        pid: childPid,
        lastAction: 'child launch acknowledged',
    });
}

function readJsonFile<T>(file: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

async function waitForStartup(
    stateFile: string,
    instanceId: string,
    pid: number,
    isProcessAlive: (pid: number) => boolean,
): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const state = readJsonFile<DeliveryWatchdogPersistentState>(stateFile);
        if (state?.instanceId === instanceId && state.pid === pid && state.status === 'running') {
            return;
        }
        if (!isProcessAlive(pid)) {
            throw new Error('Detached watchdog exited before startup completed');
        }
        await defaultSleep(50);
    }
    throw new Error('Timed out waiting for detached watchdog startup heartbeat');
}

async function waitForParentHandoff(
    stateFile: string,
    instanceId: string,
    childPid: number,
    sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const state = readJsonFile<DeliveryWatchdogPersistentState>(stateFile);
        if (
            state?.instanceId === instanceId
            && state.status === 'starting'
            && state.pid === childPid
        ) {
            return;
        }
        await sleep(25);
    }
    throw new Error('Timed out waiting for watchdog parent-to-child handoff');
}

function defaultSpawnDetached(runnerScript: string, configFile: string): number {
    if (!fs.statSync(runnerScript, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`Watchdog runner not found: ${runnerScript}`);
    }
    const child = spawn(process.execPath, [runnerScript, configFile], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    if (!child.pid) {
        throw new Error('Failed to spawn detached watchdog');
    }
    child.unref();
    return child.pid;
}

function defaultIsProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

export async function verifyDeliveryWatchdogServer(
    config: DeliveryWatchdogConfig,
    fetchImpl: typeof fetch = fetch,
): Promise<void> {
    const baseUrl = config.serverUrl.replace(/\/+$/, '');
    const healthResponse = await fetchImpl(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(20_000),
    });
    if (!healthResponse.ok) {
        throw new Error(`CoC health check failed with HTTP ${healthResponse.status}`);
    }
    const health = await healthResponse.json() as { status?: unknown };
    if (health.status !== 'ok') {
        throw new Error('CoC health check returned an invalid response');
    }

    const processUrl = `${baseUrl}/api/processes/${encodeURIComponent(config.processId)}`
        + `?workspaceId=${encodeURIComponent(config.workspaceId)}`;
    const processResponse = await fetchImpl(processUrl, {
        signal: AbortSignal.timeout(20_000),
    });
    if (!processResponse.ok) {
        throw new Error(`CoC target process check failed with HTTP ${processResponse.status}`);
    }

    const body = await processResponse.json() as { process?: Record<string, unknown> };
    const processRecord = body.process;
    const metadata = toRecord(processRecord?.metadata);
    const ralph = toRecord(metadata.ralph);
    const modeMatches = metadata.mode === config.mode;
    const ralphMatches = config.mode !== 'ralph' || ralph.sessionId === config.ralphSessionId;
    if (
        processRecord?.id !== config.processId
        || metadata.workspaceId !== config.workspaceId
        || !sameCanonicalPath(processRecord.workingDirectory, config.worktree)
        || !modeMatches
        || !ralphMatches
    ) {
        throw new Error('CoC server target does not match the configured process, store, worktree, and mode');
    }
}

const defaultVerifyServer = verifyDeliveryWatchdogServer;

async function defaultPostJson(url: string, body: Record<string, unknown>): Promise<string> {
    return postDeliveryWatchdogRecovery(url, body);
}

export async function postDeliveryWatchdogRecovery(
    url: string,
    body: Record<string, unknown>,
    fetchImpl: typeof fetch = fetch,
): Promise<string> {
    const headers = new Headers();
    headers.set('content-type', 'application/json');
    const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
    });
    const responseText = await response.text();
    if (!response.ok) {
        throw new Error(`Recovery endpoint returned HTTP ${response.status}`);
    }
    return responseText;
}

function defaultSleep(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function formatRecoveryAcknowledgement(response: string): string {
    try {
        const parsed = JSON.parse(response) as {
            task?: { id?: unknown };
            taskId?: unknown;
            sessionId?: unknown;
        };
        const taskId = typeof parsed.task?.id === 'string'
            ? parsed.task.id
            : typeof parsed.taskId === 'string'
                ? parsed.taskId
                : undefined;
        const sessionId = typeof parsed.sessionId === 'string'
            ? parsed.sessionId
            : undefined;
        return `${taskId ? ` task_id=${taskId}` : ''}`
            + `${sessionId ? ` session_id=${sessionId}` : ''}`;
    } catch {
        return '';
    }
}

function toRecord(value: unknown): Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : {};
}

function sameCanonicalPath(left: unknown, right: string): boolean {
    if (typeof left !== 'string') {
        return false;
    }
    return canonicalFilesystemPath(left) === canonicalFilesystemPath(right);
}

function canonicalFilesystemPath(value: string): string {
    const resolved = path.resolve(value);
    let real = resolved;
    try {
        real = fs.realpathSync.native(resolved);
    } catch {
        // Process paths may disappear after a worktree is removed.
    }
    return process.platform === 'win32' ? real.toLowerCase() : real;
}
