/**
 * SSH Bridge
 *
 * Thin wrapper around forge's SshConnector for the container server.
 * Reuses the exact same SSH tunnel mechanism: spawns `ssh -N <host>`,
 * which relies on ~/.ssh/config having a LocalForward entry, then
 * polls health at http://127.0.0.1:<localPort>/api/health.
 *
 * The agent store persists SSH agents with address `ssh://<host>:<port>`.
 */

import { SshConnector } from '@plusplusoneplusplus/forge/connectors';
import type { SshConnectorOptions, SshConnectionState, SshRemoteServer } from '@plusplusoneplusplus/forge/connectors';

export type { SshConnectionState };

export interface ParsedSshAddress {
    host: string;
    port: number;
}

export function parseSshAddress(address: string): ParsedSshAddress | undefined {
    if (!address.startsWith('ssh://')) return undefined;
    const rest = address.slice(6);
    const colonIdx = rest.lastIndexOf(':');
    if (colonIdx < 0) return undefined;
    const host = rest.slice(0, colonIdx);
    const port = parseInt(rest.slice(colonIdx + 1), 10);
    if (!host || isNaN(port) || port < 1 || port > 65535) return undefined;
    return { host, port };
}

export function isSshAddress(address: string): boolean {
    return parseSshAddress(address) !== undefined;
}

export class SshBridge {
    private readonly connector: SshConnector;

    constructor(options?: SshConnectorOptions) {
        this.connector = new SshConnector(options);
    }

    async connect(agentId: string, address: string): Promise<SshConnectionState | undefined> {
        const parsed = parseSshAddress(address);
        if (!parsed) return undefined;
        const server = this.toSshRemoteServer(agentId, parsed);
        return this.connector.connect(server);
    }

    async reconnect(agentId: string, address: string): Promise<SshConnectionState | undefined> {
        const parsed = parseSshAddress(address);
        if (!parsed) return undefined;
        const server = this.toSshRemoteServer(agentId, parsed);
        return this.connector.reconnect(server);
    }

    disconnect(agentId: string): SshConnectionState {
        return this.connector.disconnect(agentId);
    }

    getState(agentId: string): SshConnectionState | undefined {
        return this.connector.getState(agentId);
    }

    getLocalUrl(agentId: string): string | undefined {
        const state = this.connector.getState(agentId);
        return state?.effectiveUrl;
    }

    dispose(): void {
        this.connector.dispose();
    }

    private toSshRemoteServer(agentId: string, parsed: ParsedSshAddress): SshRemoteServer {
        return {
            id: agentId,
            label: parsed.host,
            kind: 'ssh',
            host: parsed.host,
            localPort: parsed.port,
            addedAt: 0,
            updatedAt: 0,
        };
    }
}
