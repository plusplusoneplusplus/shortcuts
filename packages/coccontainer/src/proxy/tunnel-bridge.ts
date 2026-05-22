/**
 * Tunnel Bridge
 *
 * Creates local HTTP proxy servers for devtunnel agents. Each tunnel agent
 * gets a local port (auto-assigned from a configurable base) that forwards
 * all requests to the remote devtunnel URL.
 *
 * Authenticates to the devtunnel using a connect-scoped tunnel token obtained
 * via `devtunnel token <tunnelId> --scopes connect`. Tokens are cached and
 * refreshed automatically before expiry.
 */

import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { URL } from 'url';
import { execFile } from 'child_process';

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
}

interface TokenCacheEntry {
    token: string;
    expiresAt: number; // unix ms
}

/**
 * Acquire a devtunnel connect token via the `devtunnel` CLI.
 * Returns the raw JWT token string.
 */
function acquireTunnelToken(tunnelId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile('devtunnel', ['token', tunnelId, '--scopes', 'connect'], { timeout: 15_000 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`Failed to acquire tunnel token for ${tunnelId}: ${stderr || err.message}`));
                return;
            }
            // Parse the token from output — last line starting with "Token: "
            const match = stdout.match(/^Token:\s+(.+)$/m);
            if (match) {
                resolve(match[1].trim());
            } else {
                reject(new Error(`Could not parse tunnel token from devtunnel output: ${stdout.substring(0, 200)}`));
            }
        });
    });
}

export class TunnelBridge {
    private bridges = new Map<string, BridgeEntry>();
    private tokenCache = new Map<string, TokenCacheEntry>();
    private nextPort: number;

    constructor(options: TunnelBridgeOptions = {}) {
        this.nextPort = options.basePort ?? 10400;
    }

    /**
     * Get a valid tunnel token for the given tunnelId.
     * Returns from cache if not expired (with 5-minute buffer), otherwise acquires a new one.
     */
    private async getToken(tunnelId: string): Promise<string | undefined> {
        const cached = this.tokenCache.get(tunnelId);
        const now = Date.now();
        // Refresh 5 minutes before expiry
        if (cached && cached.expiresAt - now > 5 * 60 * 1000) {
            return cached.token;
        }
        try {
            const token = await acquireTunnelToken(tunnelId);
            // Parse expiry from JWT payload
            const payloadB64 = token.split('.')[1];
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
            const expiresAt = (payload.exp ?? 0) * 1000;
            this.tokenCache.set(tunnelId, { token, expiresAt });
            return token;
        } catch (err) {
            console.error(`[tunnel-bridge] ${(err as Error).message}`);
            // Fall back to cached token even if close to expiry
            return cached?.token;
        }
    }

    /** Get the tunnel auth header value, or undefined if no token available. */
    private async getTunnelAuthHeader(tunnelId: string): Promise<string | undefined> {
        const token = await this.getToken(tunnelId);
        return token ? `tunnel ${token}` : undefined;
    }

    /** Start a local bridge for a tunnel agent. Returns the local URL. */
    async start(agentId: string, tunnelId: string, remoteUrl: string): Promise<string> {
        // If already bridged, return existing
        const existing = this.bridges.get(agentId);
        if (existing) {
            return existing.localUrl;
        }

        // Pre-acquire token (best-effort, bridge still starts without it)
        void this.getToken(tunnelId);

        const localPort = this.nextPort++;
        const server = http.createServer((req, res) => {
            this.proxyToRemote(tunnelId, remoteUrl, req, res);
        });

        // Forward WebSocket upgrades through the tunnel
        server.on('upgrade', (req, socket, head) => {
            this.proxyUpgrade(tunnelId, remoteUrl, req, socket as net.Socket, head);
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

        const tunnelAuth = await this.getTunnelAuthHeader(tunnelId);
        const headers: Record<string, string | string[] | undefined> = {
            ...incomingReq.headers,
            host: url.host,
            // Override User-Agent so devtunnel doesn't trigger browser auth flow
            'user-agent': 'CoCContainer/1.0',
        };
        if (tunnelAuth) {
            headers['x-tunnel-authorization'] = tunnelAuth;
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

    /**
     * Proxy a WebSocket upgrade request through the tunnel.
     * Opens a raw TCP connection to the remote, sends the HTTP upgrade, then
     * pipes the two sockets together for bidirectional data flow.
     */
    private async proxyUpgrade(
        tunnelId: string,
        remoteUrl: string,
        req: http.IncomingMessage,
        clientSocket: net.Socket,
        head: Buffer,
    ): Promise<void> {
        const targetPath = req.url || '/';
        const url = new URL(targetPath, remoteUrl);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;
        const port = url.port ? parseInt(url.port) : (isHttps ? 443 : 80);

        const tunnelAuth = await this.getTunnelAuthHeader(tunnelId);
        const headers: Record<string, string | string[] | undefined> = {
            ...req.headers,
            host: url.host,
            // Override User-Agent so devtunnel doesn't trigger browser auth flow
            'user-agent': 'CoCContainer/1.0',
        };
        if (tunnelAuth) {
            headers['x-tunnel-authorization'] = tunnelAuth;
        }

        const proxyReq = transport.request({
            hostname: url.hostname,
            port,
            path: url.pathname + url.search,
            method: 'GET',
            headers,
        });

        proxyReq.on('upgrade', (_proxyRes, proxySocket, proxyHead) => {
            // Send back the 101 to the local client
            clientSocket.write(
                'HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                (_proxyRes.headers['sec-websocket-accept']
                    ? `Sec-WebSocket-Accept: ${_proxyRes.headers['sec-websocket-accept']}\r\n`
                    : '') +
                '\r\n'
            );

            if (proxyHead && proxyHead.length > 0) {
                clientSocket.write(proxyHead);
            }
            if (head && head.length > 0) {
                proxySocket.write(head);
            }

            // Bidirectional pipe
            proxySocket.pipe(clientSocket);
            clientSocket.pipe(proxySocket);

            proxySocket.on('error', () => clientSocket.destroy());
            clientSocket.on('error', () => proxySocket.destroy());
        });

        proxyReq.on('response', (res) => {
            // Upgrade wasn't accepted — send back the HTTP response and close
            const statusLine = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
            const headerLines = Object.entries(res.headers)
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                .join('\r\n');
            clientSocket.write(statusLine + headerLines + '\r\n\r\n');
            res.pipe(clientSocket);
        });

        proxyReq.on('error', () => {
            clientSocket.destroy();
        });

        proxyReq.end();
    }
}
