/**
 * Tunnel Bridge
 *
 * Creates local HTTP proxy servers for devtunnel agents. Each tunnel agent
 * gets a local port (auto-assigned from a configurable base) that forwards
 * all requests to the remote devtunnel URL.
 *
 * Since we configure anonymous access on the tunnel (via ensureAnonymousAccess),
 * no auth header is needed — the devtunnel infrastructure handles it.
 * This eliminates browser auth popups entirely — all traffic goes through localhost.
 */

import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { URL } from 'url';

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

export class TunnelBridge {
    private bridges = new Map<string, BridgeEntry>();
    private nextPort: number;

    constructor(options: TunnelBridgeOptions = {}) {
        this.nextPort = options.basePort ?? 10400;
    }

    /** Start a local bridge for a tunnel agent. Returns the local URL. */
    async start(agentId: string, tunnelId: string, remoteUrl: string): Promise<string> {
        // If already bridged, return existing
        const existing = this.bridges.get(agentId);
        if (existing) {
            return existing.localUrl;
        }

        const localPort = this.nextPort++;
        const server = http.createServer((req, res) => {
            this.proxyToRemote(remoteUrl, req, res);
        });

        // Forward WebSocket upgrades through the tunnel
        server.on('upgrade', (req, socket, head) => {
            this.proxyUpgrade(remoteUrl, req, socket as net.Socket, head);
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

    private proxyToRemote(
        remoteUrl: string,
        incomingReq: http.IncomingMessage,
        outgoingRes: http.ServerResponse,
    ): void {
        const targetPath = incomingReq.url || '/';
        const url = new URL(targetPath, remoteUrl);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;

        const headers: Record<string, string | string[] | undefined> = {
            ...incomingReq.headers,
            host: url.host,
            // Override User-Agent so devtunnel doesn't trigger browser auth flow
            'user-agent': 'CoCContainer/1.0',
        };
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
    private proxyUpgrade(
        remoteUrl: string,
        req: http.IncomingMessage,
        clientSocket: net.Socket,
        head: Buffer,
    ): void {
        const targetPath = req.url || '/';
        const url = new URL(targetPath, remoteUrl);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;
        const port = url.port ? parseInt(url.port) : (isHttps ? 443 : 80);

        const headers: Record<string, string | string[] | undefined> = {
            ...req.headers,
            host: url.host,
        };

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
