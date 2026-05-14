/**
 * Tunnel Bridge
 *
 * Creates local HTTP proxy servers for devtunnel agents. Each tunnel agent
 * gets a local port (auto-assigned from a configurable base) that forwards
 * all requests to the remote devtunnel URL with the appropriate auth token.
 *
 * This eliminates browser auth popups entirely — all traffic goes through
 * localhost and the bridge handles devtunnel authentication via access tokens.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { DevTunnelTokenService } from './tunnel-token';

export interface BridgeEntry {
    agentId: string;
    tunnelId: string;
    remoteUrl: string;
    localPort: number;
    localUrl: string;
    server: http.Server;
}

export interface TunnelBridgeOptions {
    /** Base port for auto-assignment (default: 10400) */
    basePort?: number;
    /** Token service for acquiring tunnel auth tokens */
    tokenService: DevTunnelTokenService;
}

export class TunnelBridge {
    private bridges = new Map<string, BridgeEntry>();
    private nextPort: number;
    private tokenService: DevTunnelTokenService;

    constructor(options: TunnelBridgeOptions) {
        this.nextPort = options.basePort ?? 10400;
        this.tokenService = options.tokenService;
    }

    /** Start a local bridge for a tunnel agent. Returns the local URL. */
    async start(agentId: string, tunnelId: string, remoteUrl: string): Promise<string> {
        // If already bridged, return existing
        const existing = this.bridges.get(agentId);
        if (existing) {
            return existing.localUrl;
        }

        const localPort = this.nextPort++;
        const server = http.createServer(async (req, res) => {
            await this.proxyToRemote(tunnelId, remoteUrl, req, res);
        });

        await new Promise<void>((resolve, reject) => {
            server.on('error', reject);
            server.listen(localPort, '127.0.0.1', () => resolve());
        });

        const localUrl = `http://127.0.0.1:${localPort}`;
        const entry: BridgeEntry = { agentId, tunnelId, remoteUrl, localPort, localUrl, server };
        this.bridges.set(agentId, entry);
        return localUrl;
    }

    /** Stop a bridge for an agent. */
    stop(agentId: string): void {
        const entry = this.bridges.get(agentId);
        if (entry) {
            entry.server.close();
            this.bridges.delete(agentId);
        }
    }

    /** Stop all bridges. */
    stopAll(): void {
        for (const entry of this.bridges.values()) {
            entry.server.close();
        }
        this.bridges.clear();
    }

    /** Get the local URL for an agent (if bridged). */
    getLocalUrl(agentId: string): string | undefined {
        return this.bridges.get(agentId)?.localUrl;
    }

    /** Get all active bridges info. */
    list(): Array<{ agentId: string; tunnelId: string; localPort: number; localUrl: string; remoteUrl: string }> {
        return Array.from(this.bridges.values()).map(({ agentId, tunnelId, localPort, localUrl, remoteUrl }) => ({
            agentId, tunnelId, localPort, localUrl, remoteUrl,
        }));
    }

    private async proxyToRemote(
        tunnelId: string,
        remoteUrl: string,
        incomingReq: http.IncomingMessage,
        outgoingRes: http.ServerResponse,
    ): Promise<void> {
        const targetPath = incomingReq.url || '/';
        const url = new URL(targetPath, remoteUrl);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;

        // Get tunnel access token
        const token = await this.tokenService.getToken(tunnelId);
        const headers: Record<string, string | string[] | undefined> = {
            ...incomingReq.headers,
            host: url.host,
        };
        if (token) {
            headers['x-tunnel-authorization'] = `TunnelAccessToken ${token}`;
        }
        // Remove connection-specific headers that shouldn't be forwarded
        delete headers['connection'];
        delete headers['keep-alive'];

        const proxyReq = transport.request(
            {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: incomingReq.method,
                headers,
            },
            (proxyRes) => {
                const status = proxyRes.statusCode ?? 502;
                // Pass through all headers except hop-by-hop
                const responseHeaders = { ...proxyRes.headers };
                delete responseHeaders['connection'];
                delete responseHeaders['keep-alive'];
                delete responseHeaders['transfer-encoding'];

                outgoingRes.writeHead(status, responseHeaders);
                proxyRes.pipe(outgoingRes);
            }
        );

        proxyReq.on('error', () => {
            if (!outgoingRes.headersSent) {
                outgoingRes.writeHead(502, { 'Content-Type': 'application/json' });
                outgoingRes.end(JSON.stringify({ error: 'Tunnel bridge: remote agent unavailable' }));
            }
        });

        incomingReq.pipe(proxyReq);
    }
}
