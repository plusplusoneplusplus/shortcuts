import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
    DEFAULT_WATCHDOG_LIMITS,
    getDeliveryWatchdogStatus,
    resumeDeliveryWatchdog,
    requestDeliveryWatchdogStop,
    startDeliveryWatchdog,
    validateDeliveryWatchdogConfig,
    type DeliveryWatchdogConfig,
    type ResumeDeliveryWatchdogOptions,
    type ResumeDeliveryWatchdogResult,
    type DeliveryWatchdogStatus,
} from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../config';

type OutputStream = NodeJS.WritableStream;

export interface ReliabilityWatchdogStartOptions {
    workspaceId?: string;
    processId?: string;
    worktree?: string;
    ledger?: string;
    promptFile?: string;
    stateDir?: string;
    dataDir?: string;
    serverUrl?: string;
    mode?: string;
    ralphSessionId?: string;
    completeMarker?: string;
    blockedMarker?: string;
    pollInterval?: string | number;
    idlePolls?: string | number;
    cooldown?: string | number;
    ttl?: string | number;
    maxResumes?: string | number;
    heartbeatInterval?: string | number;
}

export interface ReliabilityWatchdogStateOptions {
    stateDir?: string;
}

export interface ReliabilityWatchdogResumeOptions extends ReliabilityWatchdogStateOptions {
    serverUrl?: string;
}

export interface ReliabilityWatchdogDependencies {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    config?: Pick<CLIConfig, 'serve'>;
    stdout?: OutputStream;
    stderr?: OutputStream;
    start?: (config: DeliveryWatchdogConfig) => Promise<{ pid: number; stateFile: string }>;
    resume?: (
        stateDir: string,
        options: ResumeDeliveryWatchdogOptions,
    ) => Promise<ResumeDeliveryWatchdogResult>;
    status?: (stateDir: string) => DeliveryWatchdogStatus | Promise<DeliveryWatchdogStatus>;
    stop?: (stateDir: string) => { requested: boolean; pid: number } | Promise<{ requested: boolean; pid: number }>;
}

export function buildDeliveryWatchdogConfig(
    opts: ReliabilityWatchdogStartOptions,
    deps: Pick<ReliabilityWatchdogDependencies, 'cwd' | 'env' | 'config'> = {},
): DeliveryWatchdogConfig {
    const cwd = deps.cwd ?? process.cwd();
    const env = deps.env ?? process.env;
    const mode = requiredEnum(opts.mode ?? 'autopilot', ['autopilot', 'ralph'] as const, 'mode');
    const configuredDataDir = deps.config?.serve?.dataDir ?? path.join(os.homedir(), '.coc');
    const configuredHost = clientHost(deps.config?.serve?.host ?? '127.0.0.1');
    const configuredPort = deps.config?.serve?.port ?? 4000;

    const config: DeliveryWatchdogConfig = {
        workspaceId: requiredString(opts.workspaceId, 'workspace-id'),
        processId: requiredString(opts.processId, 'process-id'),
        worktree: canonicalizePath(resolvePath(cwd, requiredString(opts.worktree, 'worktree'))),
        ledgerPath: resolvePath(cwd, requiredString(opts.ledger, 'ledger')),
        promptFile: resolvePath(cwd, requiredString(opts.promptFile, 'prompt-file')),
        stateDir: resolvePath(cwd, requiredString(opts.stateDir, 'state-dir')),
        dataDir: resolvePath(cwd, opts.dataDir ?? configuredDataDir),
        serverUrl: (
            optionalString(opts.serverUrl)
            ?? optionalString(env.COC_SERVER_URL)
            ?? `http://${configuredHost}:${configuredPort}`
        ).replace(/\/+$/, ''),
        mode,
        ...(mode === 'ralph'
            ? { ralphSessionId: requiredString(opts.ralphSessionId, 'ralph-session-id') }
            : {}),
        completeMarker: requiredString(opts.completeMarker, 'complete-marker'),
        blockedMarker: requiredString(opts.blockedMarker, 'blocked-marker'),
        limits: {
            pollIntervalMs: positiveInteger(opts.pollInterval, 'poll-interval', DEFAULT_WATCHDOG_LIMITS.pollIntervalMs),
            idlePolls: positiveInteger(opts.idlePolls, 'idle-polls', DEFAULT_WATCHDOG_LIMITS.idlePolls),
            cooldownMs: positiveInteger(opts.cooldown, 'cooldown', DEFAULT_WATCHDOG_LIMITS.cooldownMs),
            ttlMs: positiveInteger(opts.ttl, 'ttl', DEFAULT_WATCHDOG_LIMITS.ttlMs),
            maxResumes: positiveInteger(opts.maxResumes, 'max-resumes', DEFAULT_WATCHDOG_LIMITS.maxResumes),
            heartbeatIntervalMs: positiveInteger(
                opts.heartbeatInterval,
                'heartbeat-interval',
                DEFAULT_WATCHDOG_LIMITS.heartbeatIntervalMs,
            ),
        },
    };
    validateDeliveryWatchdogConfig(config);
    return config;
}

export async function executeReliabilityWatchdogStart(
    opts: ReliabilityWatchdogStartOptions,
    deps: ReliabilityWatchdogDependencies = {},
): Promise<number> {
    const stdout = deps.stdout ?? process.stdout;
    const stderr = deps.stderr ?? process.stderr;
    try {
        const config = buildDeliveryWatchdogConfig(opts, deps);
        const start = deps.start ?? ((value: DeliveryWatchdogConfig) => startDeliveryWatchdog(
            value,
            path.join(__dirname, 'reliability-watchdog-runner.js'),
        ));
        const result = await start(config);
        writeLine(stdout, `Watchdog started: PID ${result.pid}`);
        writeLine(stdout, `State: ${result.stateFile}`);
        return 0;
    } catch (error) {
        writeLine(stderr, errorMessage(error));
        return 1;
    }
}

export async function executeReliabilityWatchdogResume(
    opts: ReliabilityWatchdogResumeOptions,
    deps: ReliabilityWatchdogDependencies = {},
): Promise<number> {
    const stdout = deps.stdout ?? process.stdout;
    const stderr = deps.stderr ?? process.stderr;
    try {
        const stateDir = resolveStateDir(opts, deps.cwd ?? process.cwd());
        const serverUrl = resolveResumeServerUrl(opts, deps);
        const options: ResumeDeliveryWatchdogOptions = serverUrl ? { serverUrl } : {};
        const resume = deps.resume ?? ((value: string, resumeOptions: ResumeDeliveryWatchdogOptions) => (
            resumeDeliveryWatchdog(
                value,
                path.join(__dirname, 'reliability-watchdog-runner.js'),
                resumeOptions,
            )
        ));
        const result = await resume(stateDir, options);
        writeLine(
            stdout,
            result.resumed
                ? `Watchdog resumed: PID ${result.pid}`
                : `Watchdog already running: PID ${result.pid}`,
        );
        writeLine(stdout, `State: ${result.stateFile}`);
        return 0;
    } catch (error) {
        writeLine(stderr, errorMessage(error));
        return 1;
    }
}

export async function executeReliabilityWatchdogStatus(
    opts: ReliabilityWatchdogStateOptions,
    deps: ReliabilityWatchdogDependencies = {},
): Promise<number> {
    const stdout = deps.stdout ?? process.stdout;
    const stderr = deps.stderr ?? process.stderr;
    try {
        const stateDir = resolveStateDir(opts, deps.cwd ?? process.cwd());
        const result = await (deps.status ?? getDeliveryWatchdogStatus)(stateDir);
        writeLine(stdout, JSON.stringify(result));
        return 0;
    } catch (error) {
        writeLine(stderr, errorMessage(error));
        return 1;
    }
}

export async function executeReliabilityWatchdogStop(
    opts: ReliabilityWatchdogStateOptions,
    deps: ReliabilityWatchdogDependencies = {},
): Promise<number> {
    const stdout = deps.stdout ?? process.stdout;
    const stderr = deps.stderr ?? process.stderr;
    try {
        const stateDir = resolveStateDir(opts, deps.cwd ?? process.cwd());
        const result = await (deps.stop ?? requestDeliveryWatchdogStop)(stateDir);
        writeLine(stdout, `Stop requested: PID ${result.pid}`);
        return 0;
    } catch (error) {
        writeLine(stderr, errorMessage(error));
        return 1;
    }
}

function resolveStateDir(opts: ReliabilityWatchdogStateOptions, cwd: string): string {
    return resolvePath(cwd, requiredString(opts.stateDir, 'state-dir'));
}

function resolveResumeServerUrl(
    opts: ReliabilityWatchdogResumeOptions,
    deps: Pick<ReliabilityWatchdogDependencies, 'env' | 'config'>,
): string | undefined {
    const env = deps.env ?? process.env;
    const explicitOrEnvironment = optionalString(opts.serverUrl)
        ?? optionalString(env.COC_SERVER_URL);
    if (explicitOrEnvironment) {
        return explicitOrEnvironment.replace(/\/+$/, '');
    }
    const serve = deps.config?.serve;
    if (serve?.host === undefined && serve?.port === undefined) {
        return undefined;
    }
    return `http://${clientHost(serve?.host ?? '127.0.0.1')}:${serve?.port ?? 4000}`;
}

function positiveInteger(
    value: string | number | undefined,
    name: string,
    fallback: number,
): number {
    if (value === undefined || value === '') {
        return fallback;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}

function requiredString(value: string | undefined, name: string): string {
    const resolved = optionalString(value);
    if (!resolved) {
        throw new Error(`${name} is required`);
    }
    return resolved;
}

function optionalString(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function requiredEnum<T extends string>(
    value: string,
    allowed: readonly T[],
    name: string,
): T {
    if (!allowed.includes(value as T)) {
        throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
    }
    return value as T;
}

function resolvePath(cwd: string, value: string): string {
    const expanded = value === '~'
        ? os.homedir()
        : /^~[\\/]/.test(value)
            ? path.join(os.homedir(), value.slice(2))
            : value;
    return path.resolve(cwd, expanded);
}

function canonicalizePath(value: string): string {
    try {
        return fs.realpathSync.native(value);
    } catch {
        return value;
    }
}

function clientHost(host: string): string {
    if (host === '0.0.0.0' || host === '::') {
        return '127.0.0.1';
    }
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function writeLine(stream: OutputStream, value: string): void {
    stream.write(`${value}\n`);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
