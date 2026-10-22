import { execFile, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { parseDevTunnelForwardedPort, parseDevTunnelHttpPortInfo } from './devtunnel-port-parser';
import type { DevTunnelConnectionState, RemoteServer, ManagedChildProcess, ProcessStarter, HealthChecker } from './types';
import { defaultHealthChecker, waitForHealth } from './health';

export type DevTunnelCommandRunner = (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface DevTunnelConnectorOptions {
    commandRunner?: DevTunnelCommandRunner;
    processStarter?: ProcessStarter;
    healthChecker?: HealthChecker;
    readinessTimeoutMs?: number;
    readinessPollMs?: number;
    forwardReadyTimeoutMs?: number;
    healthRequestTimeoutMs?: number;
}

interface ManagedConnection {
    state: DevTunnelConnectionState;
    child?: ManagedChildProcess;
    pending?: Promise<DevTunnelConnectionState>;
    intentionalStop?: boolean;
    generation: number;
    renewalTimer?: ReturnType<typeof setTimeout>;
    forwardedPort?: number;
    forwardBuffer?: string;
}

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                reject(Object.assign(error, { stdout, stderr }));
                return;
            }
            resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        });
    });
}

// `devtunnel connect` prints the forwarded local port to stdout, so pipe it (the shared
// startProcess uses stdio:'ignore' and would discard that output).
function startDevTunnelProcess(command: string, args: string[]): ManagedChildProcess {
    return spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    }) as ChildProcess as ManagedChildProcess;
}

function classifyCommandError(error: unknown): string {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (err.code === 'ENOENT') {
        return 'devtunnel CLI is not installed or not on PATH';
    }
    const text = `${err.message ?? ''}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`;
    if (/login|auth|sign in|unauthori[sz]ed|forbidden/i.test(text)) {
        return 'devtunnel CLI is not authenticated';
    }
    return text.trim() || 'devtunnel command failed';
}

export class DevTunnelConnector {
    private disposed = false;
    private readonly connections = new Map<string, ManagedConnection>();
    private readonly commandRunner: DevTunnelCommandRunner;
    private readonly processStarter: ProcessStarter;
    private readonly healthChecker: HealthChecker;
    private readonly readinessTimeoutMs: number;
    private readonly readinessPollMs: number;
    private readonly forwardReadyTimeoutMs: number;
    private readonly healthRequestTimeoutMs: number;

    constructor(options: DevTunnelConnectorOptions = {}) {
        this.commandRunner = options.commandRunner ?? runCommand;
        this.processStarter = options.processStarter ?? startDevTunnelProcess;
        this.healthChecker = options.healthChecker ?? defaultHealthChecker;
        this.readinessTimeoutMs = options.readinessTimeoutMs ?? 20_000;
        this.readinessPollMs = options.readinessPollMs ?? 500;
        this.forwardReadyTimeoutMs = options.forwardReadyTimeoutMs ?? 10_000;
        this.healthRequestTimeoutMs = options.healthRequestTimeoutMs ?? 5_000;
    }

    getState(tunnelId: string): DevTunnelConnectionState {
        return this.getConnection(tunnelId).state;
    }

    getStates(): DevTunnelConnectionState[] {
        return Array.from(this.connections.values()).map(entry => ({ ...entry.state }));
    }

    async connect(tunnelId: string): Promise<DevTunnelConnectionState> {
        const entry = this.getConnection(tunnelId);
        if (entry.pending) {
            return entry.pending;
        }
        if (entry.state.status === 'online' && entry.child && entry.state.effectiveUrl) {
            return { ...entry.state };
        }

        const generation = entry.generation;
        const pending = this.connectInternal(tunnelId, entry, generation).finally(() => {
            if (entry.pending === pending) {
                entry.pending = undefined;
            }
        });
        entry.pending = pending;
        return pending;
    }

    async connectConfigured(servers: RemoteServer[]): Promise<DevTunnelConnectionState[]> {
        const tunnelIds = Array.from(new Set(servers.filter((s): s is RemoteServer & { kind: 'devtunnel'; tunnelId: string } => s.kind === 'devtunnel').map(s => s.tunnelId)));
        return Promise.all(tunnelIds.map(tunnelId => this.connect(tunnelId).catch(() => {
            // Shutdown can revoke a startup attempt and remove its entry.
            return { ...(this.connections.get(tunnelId)?.state ?? { tunnelId, status: 'idle' as const }) };
        })));
    }

    async reconnect(tunnelId: string): Promise<DevTunnelConnectionState> {
        const entry = this.getConnection(tunnelId);

        // Manual requests and scheduled renewal share any attempt already in progress.
        if (entry.pending) {
            return entry.pending;
        }
        this.disconnect(tunnelId);
        return this.connect(tunnelId);
    }

    disconnect(tunnelId: string): DevTunnelConnectionState {
        const entry = this.getConnection(tunnelId);
        entry.generation++;
        this.clearRenewal(entry);
        entry.intentionalStop = true;
        entry.child?.kill();
        this.clearChild(entry);
        entry.state = {
            tunnelId,
            status: 'idle',
            lastChecked: Date.now(),
        };
        entry.pending = undefined;
        return { ...entry.state };
    }

    dispose(): void {
        for (const tunnelId of this.connections.keys()) {
            this.disconnect(tunnelId);
        }
        this.disposed = true;
        this.connections.clear();
    }

    private async connectInternal(tunnelId: string, entry: ManagedConnection, generation: number): Promise<DevTunnelConnectionState> {
        entry.state = {
            ...entry.state,
            tunnelId,
            status: 'connecting',
            lastError: undefined,
            lastChecked: Date.now(),
        };

        try {
            const { stdout, stderr } = await this.commandRunner('devtunnel', ['port', 'list', tunnelId]);
            this.assertCurrent(tunnelId, entry, generation);
            const { port, publicUrl } = parseDevTunnelHttpPortInfo(`${stdout}\n${stderr}`);

            if (!entry.child) {
                entry.intentionalStop = false;
                this.clearChild(entry);
                const child = this.processStarter('devtunnel', ['connect', tunnelId]);
                entry.child = child;
                this.attachForwardListener(entry, child, port);
                child.once('exit', (code, signal) => {
                    if (entry.intentionalStop || entry.child !== child) {
                        return;
                    }
                    entry.generation++;
                    this.clearRenewal(entry);
                    this.clearChild(entry);
                    entry.state = {
                        ...entry.state,
                        status: 'failed',
                        lastError: `devtunnel connect exited unexpectedly${code !== null ? ` with code ${code}` : ''}${signal ? ` signal ${signal}` : ''}`,
                        lastChecked: Date.now(),
                    };
                });
                child.once('error', (error) => {
                    if (entry.intentionalStop || entry.child !== child) {
                        return;
                    }
                    entry.generation++;
                    this.clearRenewal(entry);
                    this.clearChild(entry);
                    entry.state = {
                        ...entry.state,
                        status: 'failed',
                        lastError: error.message,
                        lastChecked: Date.now(),
                    };
                });
            }

            // `devtunnel connect` forwards the remote HTTP port to a possibly-different local port,
            // so health-check the actual forwarded local port (falling back to the configured port).
            const localPort = await this.resolveForwardedPort(entry, port);
            this.assertCurrent(tunnelId, entry, generation);
            const effectiveUrl = `http://127.0.0.1:${localPort}`;

            await waitForHealth(effectiveUrl, this.healthChecker, this.readinessTimeoutMs, this.readinessPollMs, 'DevTunnel', this.healthRequestTimeoutMs);
            this.assertCurrent(tunnelId, entry, generation);
            entry.state = {
                tunnelId,
                port: localPort,
                effectiveUrl,
                publicUrl,
                status: 'online',
                startedAt: Date.now(),
                lastChecked: Date.now(),
            };
            this.scheduleRenewal(tunnelId, entry, generation);
            return { ...entry.state };
        } catch (error) {
            this.assertCurrent(tunnelId, entry, generation);
            entry.intentionalStop = true;
            entry.child?.kill();
            this.clearChild(entry);
            entry.state = {
                ...entry.state,
                tunnelId,
                status: 'failed',
                lastError: error instanceof Error && error.name === 'DevTunnelPortParseError'
                    ? error.message
                    : classifyCommandError(error),
                lastChecked: Date.now(),
            };
            throw new Error(entry.state.lastError);
        }
    }

    private assertCurrent(tunnelId: string, entry: ManagedConnection, generation: number): void {
        if (this.disposed || this.connections.get(tunnelId) !== entry || entry.generation !== generation) {
            throw new Error('DevTunnel connection attempt cancelled');
        }
    }

    private clearRenewal(entry: ManagedConnection): void {
        clearTimeout(entry.renewalTimer);
        entry.renewalTimer = undefined;
    }

    private scheduleRenewal(tunnelId: string, entry: ManagedConnection, generation: number): void {
        this.clearRenewal(entry);
        entry.renewalTimer = setTimeout(() => {
            entry.renewalTimer = undefined;
            if (this.disposed || this.connections.get(tunnelId) !== entry
                || entry.generation !== generation || entry.state.status !== 'online') {
                return;
            }
            // connectInternal publishes failures. Like other DevTunnel failures, recovery
            // requires a subsequent explicit connect/health request; do not retry in a loop.
            void this.reconnect(tunnelId).catch(() => {});
        }, 6 * 60 * 60 * 1000);
        entry.renewalTimer.unref();
    }

    private clearChild(entry: ManagedConnection): void {
        entry.child = undefined;
        entry.forwardedPort = undefined;
        entry.forwardBuffer = undefined;
    }

    private attachForwardListener(entry: ManagedConnection, child: ManagedChildProcess, hostPort: number): void {
        const onData = (chunk: Buffer | string): void => {
            if (entry.child !== child || entry.forwardedPort !== undefined) {
                return; // stale child or already learned — keep draining the pipe, do nothing
            }
            entry.forwardBuffer = `${entry.forwardBuffer ?? ''}${chunk.toString()}`.slice(-65536);
            const local = parseDevTunnelForwardedPort(entry.forwardBuffer, hostPort);
            if (local !== undefined) {
                entry.forwardedPort = local;
                entry.forwardBuffer = undefined;
            }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
    }

    private async resolveForwardedPort(entry: ManagedConnection, configuredPort: number): Promise<number> {
        const child = entry.child;
        if (!child || (!child.stdout && !child.stderr)) {
            return entry.forwardedPort ?? configuredPort;
        }
        const deadline = Date.now() + this.forwardReadyTimeoutMs;
        while (entry.forwardedPort === undefined && entry.child === child && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, this.readinessPollMs));
        }
        return entry.forwardedPort ?? configuredPort;
    }

    private getConnection(tunnelId: string): ManagedConnection {
        if (this.disposed) {
            throw new Error('DevTunnel connector is disposed');
        }
        let entry = this.connections.get(tunnelId);
        if (!entry) {
            entry = { state: { tunnelId, status: 'idle' }, generation: 0 };
            this.connections.set(tunnelId, entry);
        }
        return entry;
    }
}
