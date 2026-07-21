/**
 * Agent proxy client.
 *
 * Encapsulates the single inbound-vs-HTTP transport policy shared by
 * workspace/process aggregation (buffered text) and the `/api/agent/:id/*`
 * route (streamed request/response). Inbound agents (connected via the
 * call-home WebSocket channel) are reached through the AgentManager; all
 * others go over HTTP, preferring a tunnel/SSH bridge local URL.
 */

import * as http from 'http';
import { URL } from 'url';
import type { Agent } from '../store';
import type { AgentManager } from '../inbound';
import type { TunnelBridge } from '../proxy/tunnel-bridge';
import type { SshBridge } from '../proxy/ssh-bridge';
import { pipeRequest } from '../proxy/http';

/** Buffered proxy result (status + text body + response headers). */
export interface ProxyResult {
    status: number;
    body: string;
    headers: Record<string, string>;
}

/** Headers that must not be forwarded verbatim across a proxy hop. */
const HOP_BY_HOP = new Set(['transfer-encoding', 'connection', 'keep-alive', 'upgrade']);

export class AgentProxyClient {
    constructor(
        private readonly agentManager: AgentManager,
        private readonly tunnelBridge: TunnelBridge,
        private readonly sshBridge: SshBridge,
    ) {}

    /**
     * Resolve the address to reach an agent over HTTP, preferring an SSH or
     * tunnel bridge local URL over the raw stored address.
     */
    resolveEffectiveAddress(agentId: string, address: string): string {
        return this.sshBridge.getLocalUrl(agentId) || this.tunnelBridge.getLocalUrl(agentId) || address;
    }

    /** Extract the inbound registration ID from an `inbound://<id>` address. */
    private inboundId(agent: Agent): string | undefined {
        return agent.address.startsWith('inbound://') ? agent.address.replace('inbound://', '') : undefined;
    }

    /**
     * Buffered proxy — used by aggregation. Uses the WebSocket channel for
     * inbound agents, falls back to a plain HTTP GET/fetch otherwise.
     */
    async proxy(agent: Agent, method: string, apiPath: string): Promise<ProxyResult> {
        const inboundId = this.inboundId(agent);
        if (inboundId && this.agentManager.hasAgent(inboundId)) {
            return this.agentManager.proxyRequest(inboundId, method, apiPath);
        }
        const effectiveAddr = this.resolveEffectiveAddress(agent.id, agent.address);
        const resp = await fetch(`${effectiveAddr}${apiPath}`);
        const body = await resp.text();
        const headers: Record<string, string> = {};
        resp.headers.forEach((v, k) => { headers[k] = v; });
        return { status: resp.status, body, headers };
    }

    /**
     * Streamed proxy for `/api/agent/:id/*`. Forwards the incoming request to
     * the agent and writes the response back onto `res`.
     */
    async forward(agent: Agent, req: http.IncomingMessage, res: http.ServerResponse, url: URL, rest: string): Promise<void> {
        const inboundId = this.inboundId(agent);
        process.stderr.write(`[agent-proxy] ${req.method} /api/${rest} → agent=${agent.name} inboundId=${inboundId ?? 'none'} hasAgent=${inboundId ? this.agentManager.hasAgent(inboundId) : false}\n`);
        if (inboundId && this.agentManager.hasAgent(inboundId)) {
            try {
                // Collect request body
                const bodyChunks: Buffer[] = [];
                for await (const chunk of req) {
                    bodyChunks.push(chunk as Buffer);
                }
                const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks).toString('utf8') : undefined;
                const headers: Record<string, string> = {};
                for (const [key, value] of Object.entries(req.headers)) {
                    // Strip accept-encoding — the agent proxy reads responses as
                    // UTF-8 text, so compressed (gzip/br) responses would be garbled.
                    if (typeof value === 'string' && key.toLowerCase() !== 'accept-encoding') headers[key] = value;
                }
                const response = await this.agentManager.proxyRequest(
                    inboundId,
                    req.method ?? 'GET',
                    `/api/${rest}${url.search}`,
                    headers,
                    body,
                );
                process.stderr.write(`[agent-proxy] Response: status=${response.status} bodyLen=${response.body?.length ?? 0}\n`);
                // Filter hop-by-hop headers that must not be forwarded
                const fwdHeaders: Record<string, string> = {};
                for (const [k, v] of Object.entries(response.headers)) {
                    if (!HOP_BY_HOP.has(k.toLowerCase())) fwdHeaders[k] = v;
                }
                // Ensure content-length matches actual body
                if (response.body) {
                    fwdHeaders['content-length'] = String(Buffer.byteLength(response.body, 'utf8'));
                }
                res.writeHead(response.status, fwdHeaders);
                res.end(response.body);
                return;
            } catch (err) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Proxy via channel failed', message: (err as Error).message }));
                return;
            }
        }
        // Fallback: use tunnel/SSH bridge local URL if available, otherwise direct address
        const effectiveAddr = this.resolveEffectiveAddress(agent.id, agent.address);
        if (effectiveAddr.startsWith('inbound://')) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Agent not connected via WebSocket channel' }));
            return;
        }
        pipeRequest(effectiveAddr, req, res, `/api/${rest}${url.search}`);
    }
}
