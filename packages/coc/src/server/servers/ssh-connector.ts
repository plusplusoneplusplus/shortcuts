import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { RemoteServer, RemoteServerRuntimeStatus, SshRemoteServer } from './remote-server-types';

export type SshProcessStarter = (command: string, args: string[]) => SshChildProcess;
export type SshHealthChecker = (url: string, signal?: AbortSignal) => Promise<boolean>;

export interface SshChildProcess {
    pid?: number;
    kill(signal?: NodeJS.Signals | number): boolean;
    once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    once(event: 'error', listener: (error: Error) => void): this;
}

export interface SshConnectorOptions {
    processStarter?: SshProcessStarter;
    healthChecker?: SshHealthChecker;
    readinessTimeoutMs?: number;
    readinessPollMs?: number;
    initialReconnectBackoffMs?: number;
    maxReconnectBackoffMs?: number;
}

export interface SshConnectionState {
    serverId: string;
    host: string;
    localPort: number;
    effectiveUrl?: string;
    status: RemoteServerRuntimeStatus;
    lastError?: string;
    startedAt?: number;
    lastChecked?: number;
}

interface ManagedSshConnection {
    state: SshConnectionState;
    child?: SshChildProcess;
    pending?: Promise<SshConnectionState>;
    intentionalStop?: boolean;
    reconnectBackoffMs?: number;
    reconnectTimer?: ReturnType<typeof setTimeout>;
}

function startProcess(command: string, args: string[]): SshChildProcess {
    return spawn(command, args, {
        windowsHide: true,
        stdio: 'ignore',
    }) as ChildProcess as SshChildProcess;
}

async function defaultHealthChecker(url: string, signal?: AbortSignal): Promise<boolean> {
    const res = await fetch(`${url}/api/health`, { signal });
    return res.ok;
}

async function waitForHealth(
    url: string,
    checker: SshHealthChecker,
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
    throw new Error(lastError
        ? `SSH tunnel did not become healthy within ${timeoutMs}ms: ${lastError}`
        : 'SSH tunnel did not become healthy within 15s');
}

export class SshConnector {
    private readonly connections = new Map<string, ManagedSshConnection>();
    private readonly processStarter: SshProcessStarter;
    private readonly healthChecker: SshHealthChecker;
    private readonly readinessTimeoutMs: number;
    private readonly readinessPollMs: number;
    private readonly initialReconnectBackoffMs: number;
    private readonly maxReconnectBackoffMs: number;

    constructor(options: SshConnectorOptions = {}) {
        this.processStarter = options.processStarter ?? startProcess;
        this.healthChecker = options.healthChecker ?? defaultHealthChecker;
        this.readinessTimeoutMs = options.readinessTimeoutMs ?? 15_000;
        this.readinessPollMs = options.readinessPollMs ?? 500;
        this.initialReconnectBackoffMs = options.initialReconnectBackoffMs ?? 2_000;
        this.maxReconnectBackoffMs = options.maxReconnectBackoffMs ?? 30_000;
    }

    getState(serverId: string): SshConnectionState | undefined {
        const entry = this.connections.get(serverId);
        return entry ? { ...entry.state } : undefined;
    }

    getStates(): SshConnectionState[] {
        return Array.from(this.connections.values()).map(entry => ({ ...entry.state }));
    }

    async connect(server: SshRemoteServer): Promise<SshConnectionState> {
        const entry = this.getOrCreateConnection(server);
        if (entry.pending) {
            return entry.pending;
        }
        if (entry.state.status === 'online' && entry.child && entry.state.effectiveUrl) {
            return { ...entry.state };
        }

        entry.pending = this.connectInternal(server, entry).finally(() => {
            entry.pending = undefined;
        });
        return entry.pending;
    }

    async connectConfigured(servers: RemoteServer[]): Promise<SshConnectionState[]> {
        const sshServers = servers.filter((s): s is SshRemoteServer => s.kind === 'ssh');
        return Promise.all(
            sshServers.map(s =>
                this.connect(s).catch(() => this.getOrCreateConnection(s).state),
            ),
        );
    }

    async reconnect(server: SshRemoteServer): Promise<SshConnectionState> {
        const entry = this.getOrCreateConnection(server);

        entry.intentionalStop = true;
        if (entry.reconnectTimer) {
            clearTimeout(entry.reconnectTimer);
            entry.reconnectTimer = undefined;
        }
        if (entry.child) {
            entry.child.kill();
            entry.child = undefined;
        }
        entry.pending = undefined;

        entry.state = {
            serverId: server.id,
            host: server.host,
            localPort: server.localPort,
            status: 'connecting',
            lastChecked: Date.now(),
        };

        entry.pending = this.connectInternal(server, entry).finally(() => {
            entry.pending = undefined;
        });
        return entry.pending;
    }

    disconnect(serverId: string): SshConnectionState {
        const entry = this.connections.get(serverId);
        if (!entry) {
            return { serverId, host: '', localPort: 0, status: 'idle' };
        }
        entry.intentionalStop = true;
        if (entry.reconnectTimer) {
            clearTimeout(entry.reconnectTimer);
            entry.reconnectTimer = undefined;
        }
        if (entry.child) {
            entry.child.kill();
            entry.child = undefined;
        }
        entry.state = {
            ...entry.state,
            status: 'idle',
            lastChecked: Date.now(),
        };
        entry.pending = undefined;
        return { ...entry.state };
    }

    dispose(): void {
        for (const [serverId] of this.connections) {
            this.disconnect(serverId);
        }
        this.connections.clear();
    }

    private async connectInternal(server: SshRemoteServer, entry: ManagedSshConnection): Promise<SshConnectionState> {
        entry.state = {
            ...entry.state,
            serverId: server.id,
            host: server.host,
            localPort: server.localPort,
            status: 'connecting',
            lastError: undefined,
            lastChecked: Date.now(),
        };

        const effectiveUrl = `http://127.0.0.1:${server.localPort}`;

        try {
            if (!entry.child) {
                entry.intentionalStop = false;
                const child = this.processStarter('ssh', ['-N', server.host]);
                entry.child = child;

                child.once('exit', (code, signal) => {
                    if (entry.intentionalStop || entry.child !== child) {
                        return;
                    }
                    entry.child = undefined;
                    entry.state = {
                        ...entry.state,
                        status: 'failed',
                        lastError: `ssh process exited unexpectedly${code !== null ? ` with code ${code}` : ''}${signal ? ` signal ${signal}` : ''}`,
                        lastChecked: Date.now(),
                    };
                    this.scheduleReconnect(server, entry);
                });
                child.once('error', (error) => {
                    if (entry.child !== child) {
                        return;
                    }
                    entry.child = undefined;
                    const message = (error as NodeJS.ErrnoException).code === 'ENOENT'
                        ? 'ssh binary not found on PATH'
                        : error.message;
                    entry.state = {
                        ...entry.state,
                        status: 'failed',
                        lastError: message,
                        lastChecked: Date.now(),
                    };
                });
            }

            await waitForHealth(effectiveUrl, this.healthChecker, this.readinessTimeoutMs, this.readinessPollMs);

            entry.state = {
                serverId: server.id,
                host: server.host,
                localPort: server.localPort,
                effectiveUrl,
                status: 'online',
                startedAt: entry.state.startedAt ?? Date.now(),
                lastChecked: Date.now(),
            };
            return { ...entry.state };
        } catch (error) {
            if (entry.child) {
                entry.intentionalStop = true;
                entry.child.kill();
                entry.child = undefined;
            }
            // Prefer a process-level error (e.g. ENOENT) that was already captured on entry.state
            const message = entry.state.lastError ?? (error instanceof Error ? error.message : String(error));
            entry.state = {
                ...entry.state,
                status: 'failed',
                lastError: message,
                lastChecked: Date.now(),
            };
            throw new Error(message);
        }
    }

    private scheduleReconnect(server: SshRemoteServer, entry: ManagedSshConnection): void {
        if (entry.intentionalStop) return;
        if (entry.reconnectTimer) {
            clearTimeout(entry.reconnectTimer);
        }
        const backoff = entry.reconnectBackoffMs ?? this.initialReconnectBackoffMs;
        entry.reconnectTimer = setTimeout(() => {
            entry.reconnectTimer = undefined;
            if (entry.intentionalStop || entry.pending) return;
            entry.reconnectBackoffMs = Math.min(backoff * 2, this.maxReconnectBackoffMs);
            entry.pending = this.connectInternal(server, entry)
                .then(state => {
                    entry.reconnectBackoffMs = this.initialReconnectBackoffMs;
                    return state;
                })
                .finally(() => {
                    entry.pending = undefined;
                });
        }, backoff);
    }

    private getOrCreateConnection(server: SshRemoteServer): ManagedSshConnection {
        let entry = this.connections.get(server.id);
        if (!entry) {
            entry = {
                state: {
                    serverId: server.id,
                    host: server.host,
                    localPort: server.localPort,
                    status: 'idle',
                },
            };
            this.connections.set(server.id, entry);
        }
        return entry;
    }
}
