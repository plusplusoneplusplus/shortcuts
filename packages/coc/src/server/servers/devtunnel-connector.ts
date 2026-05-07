import { execFile, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { parseDevTunnelHttpPortInfo } from './devtunnel-port-parser';
import type { DevTunnelConnectionState, RemoteServer } from './remote-server-types';

export type DevTunnelCommandRunner = (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
export type DevTunnelProcessStarter = (command: string, args: string[]) => DevTunnelChildProcess;
export type DevTunnelHealthChecker = (url: string, signal?: AbortSignal) => Promise<boolean>;

export interface DevTunnelChildProcess {
    pid?: number;
    kill(signal?: NodeJS.Signals | number): boolean;
    once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    once(event: 'error', listener: (error: Error) => void): this;
}

export interface DevTunnelConnectorOptions {
    commandRunner?: DevTunnelCommandRunner;
    processStarter?: DevTunnelProcessStarter;
    healthChecker?: DevTunnelHealthChecker;
    readinessTimeoutMs?: number;
    readinessPollMs?: number;
}

interface ManagedConnection {
    state: DevTunnelConnectionState;
    child?: DevTunnelChildProcess;
    pending?: Promise<DevTunnelConnectionState>;
    intentionalStop?: boolean;
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

function startProcess(command: string, args: string[]): DevTunnelChildProcess {
    return spawn(command, args, {
        windowsHide: true,
        stdio: 'ignore',
    }) as ChildProcess as DevTunnelChildProcess;
}

async function defaultHealthChecker(url: string, signal?: AbortSignal): Promise<boolean> {
    const res = await fetch(`${url}/api/health`, { signal });
    return res.ok;
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

async function waitForHealth(
    url: string,
    checker: DevTunnelHealthChecker,
    timeoutMs: number,
    pollMs: number,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() <= deadline) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(pollMs, 2_000));
        try {
            if (await checker(url, controller.signal)) {
                clearTimeout(timer);
                return;
            }
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        } finally {
            clearTimeout(timer);
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    throw new Error(lastError ? `Timed out waiting for DevTunnel health: ${lastError}` : 'Timed out waiting for DevTunnel health');
}

export class DevTunnelConnector {
    private readonly connections = new Map<string, ManagedConnection>();
    private readonly commandRunner: DevTunnelCommandRunner;
    private readonly processStarter: DevTunnelProcessStarter;
    private readonly healthChecker: DevTunnelHealthChecker;
    private readonly readinessTimeoutMs: number;
    private readonly readinessPollMs: number;

    constructor(options: DevTunnelConnectorOptions = {}) {
        this.commandRunner = options.commandRunner ?? runCommand;
        this.processStarter = options.processStarter ?? startProcess;
        this.healthChecker = options.healthChecker ?? defaultHealthChecker;
        this.readinessTimeoutMs = options.readinessTimeoutMs ?? 15_000;
        this.readinessPollMs = options.readinessPollMs ?? 500;
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

        entry.pending = this.connectInternal(tunnelId, entry).finally(() => {
            entry.pending = undefined;
        });
        return entry.pending;
    }

    async connectConfigured(servers: RemoteServer[]): Promise<DevTunnelConnectionState[]> {
        const tunnelIds = Array.from(new Set(servers.filter((s): s is RemoteServer & { kind: 'devtunnel'; tunnelId: string } => s.kind === 'devtunnel').map(s => s.tunnelId)));
        return Promise.all(tunnelIds.map(tunnelId => this.connect(tunnelId).catch(() => this.getState(tunnelId))));
    }

    async reconnect(tunnelId: string): Promise<DevTunnelConnectionState> {
        const entry = this.getConnection(tunnelId);

        // Tear down any existing child — same as disconnect but we stay in `connecting`.
        entry.intentionalStop = true;
        if (entry.child) {
            entry.child.kill();
            entry.child = undefined;
        }

        // Drop any in-flight connect promise so we start fresh.
        entry.pending = undefined;

        // Reset state, keeping tunnelId.
        entry.state = {
            tunnelId,
            status: 'connecting',
            lastChecked: Date.now(),
        };

        // Re-run the full connect path (port list + spawn + health).
        entry.pending = this.connectInternal(tunnelId, entry).finally(() => {
            entry.pending = undefined;
        });
        return entry.pending;
    }

    disconnect(tunnelId: string): DevTunnelConnectionState {
        const entry = this.getConnection(tunnelId);
        entry.intentionalStop = true;
        if (entry.child) {
            entry.child.kill();
            entry.child = undefined;
        }
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
        this.connections.clear();
    }

    private async connectInternal(tunnelId: string, entry: ManagedConnection): Promise<DevTunnelConnectionState> {
        entry.state = {
            ...entry.state,
            tunnelId,
            status: 'connecting',
            lastError: undefined,
            lastChecked: Date.now(),
        };

        try {
            const { stdout, stderr } = await this.commandRunner('devtunnel', ['port', 'list', tunnelId]);
            const { port, publicUrl } = parseDevTunnelHttpPortInfo(`${stdout}\n${stderr}`);
            const effectiveUrl = `http://127.0.0.1:${port}`;

            if (!entry.child) {
                entry.intentionalStop = false;
                const child = this.processStarter('devtunnel', ['connect', tunnelId]);
                entry.child = child;
                child.once('exit', (code, signal) => {
                    if (entry.intentionalStop || entry.child !== child) {
                        return;
                    }
                    entry.child = undefined;
                    entry.state = {
                        ...entry.state,
                        status: 'failed',
                        lastError: `devtunnel connect exited unexpectedly${code !== null ? ` with code ${code}` : ''}${signal ? ` signal ${signal}` : ''}`,
                        lastChecked: Date.now(),
                    };
                });
                child.once('error', (error) => {
                    if (entry.child !== child) {
                        return;
                    }
                    entry.child = undefined;
                    entry.state = {
                        ...entry.state,
                        status: 'failed',
                        lastError: error.message,
                        lastChecked: Date.now(),
                    };
                });
            }

            await waitForHealth(effectiveUrl, this.healthChecker, this.readinessTimeoutMs, this.readinessPollMs);
            entry.state = {
                tunnelId,
                port,
                effectiveUrl,
                publicUrl,
                status: 'online',
                startedAt: entry.state.startedAt ?? Date.now(),
                lastChecked: Date.now(),
            };
            return { ...entry.state };
        } catch (error) {
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

    private getConnection(tunnelId: string): ManagedConnection {
        let entry = this.connections.get(tunnelId);
        if (!entry) {
            entry = { state: { tunnelId, status: 'idle' } };
            this.connections.set(tunnelId, entry);
        }
        return entry;
    }
}
