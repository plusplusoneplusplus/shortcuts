/**
 * CoCContainer Server
 *
 * Thin wrapper that serves CoC's SPA in containerMode and proxies
 * API calls to registered CoC agents. The container has NO SPA of
 * its own — it reuses CoC's dashboard bundle.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import type { ResolvedContainerConfig } from '../config';
import { createAgentStore, type Agent } from '../store';
import { pipeRequest } from '../proxy/http';
import { TunnelBridge } from '../proxy/tunnel-bridge';
import { fetchAgentWorkspaces, addCachedWorkspace, type RemoteWorkspace } from '../proxy/workspaces';
import { SSERelay } from '../proxy/sse-relay';
import { WebSocketRelay } from '../proxy/ws-relay';
import { AgentHealthMonitor } from './health-monitor';
import { InboundAgentManager } from '../inbound';

export interface ContainerServer {
    close(): void;
}

// ── CoC SPA HTML reuse ──────────────────────────────────

/**
 * Import CoC's generateDashboardHtml from its compiled dist so the
 * container always serves the exact same HTML/config as CoC itself,
 * just with `containerMode: true`.
 */
function getCocHtmlTemplate(): { generateDashboardHtml: (opts?: Record<string, unknown>) => string } {
    const cocPkg = require.resolve('@plusplusoneplusplus/coc/package.json');
    const templatePath = path.join(path.dirname(cocPkg), 'dist', 'server', 'spa', 'html-template.js');
    return require(templatePath);
}

let cachedHtml: string | null = null;

function generateContainerHtml(): string {
    if (cachedHtml) return cachedHtml;
    const { generateDashboardHtml } = getCocHtmlTemplate();
    cachedHtml = generateDashboardHtml({
        title: 'CoCContainer',
        containerMode: true,
        // Container doesn't run terminal/notes/wiki locally — agents provide those
        terminalEnabled: false,
        notesEnabled: false,
        workflowsEnabled: false,
        pullRequestsEnabled: true,
    });
    return cachedHtml;
}

// ── Server factory ──────────────────────────────────────

export async function createContainerServer(config: ResolvedContainerConfig): Promise<ContainerServer> {
    const agentStore = createAgentStore(config.serve.dataDir);
    const tunnelBridge = new TunnelBridge({ basePort: config.tunnelBridgeBasePort });
    const sseRelay = new SSERelay();
    const wsRelay = new WebSocketRelay();
    const inboundManager = new InboundAgentManager();
    const healthMonitor = new AgentHealthMonitor(agentStore, config.healthCheckIntervalMs, tunnelBridge, inboundManager);

    // Start health monitoring and SSE/WS connections for existing agents
    const agents = agentStore.list();
    healthMonitor.start();

    for (const agent of agents) {
        // Start tunnel bridges for agents with tunnelId
        if (agent.tunnelId) {
            await tunnelBridge.start(agent.id, agent.tunnelId, agent.address).catch(() => {});
        }
        const effectiveAddr = tunnelBridge.getLocalUrl(agent.id) || agent.address;
        sseRelay.connect(agent.id, agent.name, effectiveAddr);
        wsRelay.connect(agent.id, agent.name, effectiveAddr);
    }

    // Inbound agent lifecycle — auto-register/deregister agents that call home
    inboundManager.on('agent-connected', (agent: { id: string; name: string }) => {
        // Add or update in agent store with a placeholder address (inbound agents don't expose a port)
        const existing = agentStore.get(agent.id);
        if (!existing) {
            agentStore.add(`inbound://${agent.id}`, agent.name);
            // Re-fetch to get the auto-generated ID and update with correct id
            const added = agentStore.list().find(a => a.address === `inbound://${agent.id}`);
            if (added && added.id !== agent.id) {
                agentStore.remove(added.id);
                // Manually insert with the correct agent ID
                agentStore.add(`inbound://${agent.id}`, agent.name);
            }
        }
        agentStore.updateStatus(existing?.id ?? agent.id, 'online');
        console.log(`[inbound] Agent "${agent.name}" (${agent.id}) connected via call-home`);
    });

    inboundManager.on('agent-disconnected', (agentId: string, agentName: string) => {
        const existing = agentStore.get(agentId);
        if (existing) {
            agentStore.updateStatus(existing.id, 'offline');
        }
        console.log(`[inbound] Agent "${agentName}" (${agentId}) disconnected`);
    });

    // Forward inbound agent WS events to browser clients (same path as wsRelay)
    inboundManager.on('agent-event', (agentId: string, agentName: string, data: string) => {
        wsRelay.emit('message', { agentId, agentName, data });
    });


    // ── WhatsApp bridge (only when enabled) ─────────────
    let whatsappBridge: { stop(): Promise<void>; getWhatsAppStatus(): { enabled: boolean; status: string; qr: string | null; error: string | null; groupJid?: string; userName: string }; updateConfig(patch: { userName?: string; groupJid?: string }): Promise<void>; reconnect(): Promise<void>; listGroups(): Promise<Array<{ jid: string; name: string }>> } | undefined;
    const waConfig = config.messaging?.whatsapp;
    if (waConfig?.enabled) {
        const { WhatsAppBridge } = await import('../messaging/whatsapp-bridge');
        const bridge = new WhatsAppBridge({
            config: waConfig,
            dataDir: config.serve.dataDir,
            wsRelay,
            agentStore,
            tunnelBridge,
        });
        await bridge.start();
        whatsappBridge = bridge;
    }

    // ── Teams bridge (only when enabled) ─────────────
    let teamsBridge: { stop(): Promise<void>; getTeamsStatus(): { enabled: boolean; status: string; mode: string; error: string | null; teamName?: string; channelName?: string; teamId?: string; channelId?: string; botName: string }; updateConfig(patch: { botName?: string; channelId?: string; enabled?: boolean; teamName?: string; channelName?: string; mode?: 'graph' | 'mcp' }): Promise<void>; reconnect(): Promise<void>; listChannels(): Promise<Array<{ id: string; displayName: string }>> } | undefined;
    const teamsConfig = config.messaging?.teams;
    if (teamsConfig?.enabled) {
        const { TeamsBridge } = await import('../messaging/teams-bridge');
        const bridge = new TeamsBridge({
            config: teamsConfig,
            dataDir: config.serve.dataDir,
            wsRelay,
            sseRelay,
            agentStore,
            tunnelBridge,
        });
        await bridge.start();
        teamsBridge = bridge;
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        try {
            // ── Container-level APIs ──────────────────────────────
            if (url.pathname === '/api/container/agents' && req.method === 'GET') {
                // Augment agent list with bridge info
                const list = agentStore.list().map(agent => ({
                    ...agent,
                    bridgeUrl: tunnelBridge.getLocalUrl(agent.id) || undefined,
                }));
                return sendJson(res, list);
            }

            if (url.pathname === '/api/container/agents' && req.method === 'POST') {
                const body = await readBody(req);
                const { address, name, tunnelId } = body as { address: string; name?: string; tunnelId?: string };
                const agent = agentStore.add(address, name, tunnelId);
                // Start tunnel bridge for devtunnel agents
                if (agent.tunnelId) {
                    await tunnelBridge.start(agent.id, agent.tunnelId, agent.address).catch(() => {});
                }
                const effectiveAddr = tunnelBridge.getLocalUrl(agent.id) || agent.address;
                sseRelay.connect(agent.id, agent.name, effectiveAddr);
                wsRelay.connect(agent.id, agent.name, effectiveAddr);
                const bridgeUrl = tunnelBridge.getLocalUrl(agent.id);
                return sendJson(res, { ...agent, bridgeUrl: bridgeUrl || undefined }, 201);
            }

            if (url.pathname.startsWith('/api/container/agents/') && req.method === 'DELETE') {
                const agentId = url.pathname.split('/')[4];
                const agent = agentStore.get(agentId);
                if (agent) {
                    tunnelBridge.stop(agent.id);
                    sseRelay.disconnect(agent.id);
                    wsRelay.disconnect(agent.id);
                }
                const removed = agentStore.remove(agentId);
                return sendJson(res, { removed });
            }

            if (url.pathname.startsWith('/api/container/agents/') && req.method === 'PUT') {
                const agentId = url.pathname.split('/')[4];
                const body = await readBody(req);
                const { name, address, tunnelId } = body as { name?: string; address?: string; tunnelId?: string | null };
                // Use full update if address or tunnelId provided, otherwise simple rename
                const agent = (address !== undefined || tunnelId !== undefined)
                    ? agentStore.update(agentId, { name, address, tunnelId })
                    : agentStore.rename(agentId, name ?? '');
                if (!agent) return sendJson(res, { error: 'Agent not found' }, 404);
                // Restart bridge if tunnelId changed
                tunnelBridge.stop(agentId);
                if (agent.tunnelId) {
                    await tunnelBridge.start(agentId, agent.tunnelId, agent.address).catch(() => {});
                }
                const bridgeUrl = tunnelBridge.getLocalUrl(agentId);
                return sendJson(res, { ...agent, bridgeUrl: bridgeUrl || undefined });
            }

            // Aggregated workspaces from all agents
            if (url.pathname === '/api/workspaces' && req.method === 'GET') {
                const allAgents = agentStore.list();
                const workspaces = await aggregateWorkspaces(allAgents, tunnelBridge);
                return sendJson(res, { workspaces });
            }

            // Aggregated process summaries from all agents
            if (url.pathname === '/api/processes/summaries' && req.method === 'GET') {
                const allAgents = agentStore.list().filter(a => a.status !== 'offline');
                const results = await Promise.all(
                    allAgents.map(async (agent) => {
                        try {
                            const effectiveAddr = tunnelBridge.getLocalUrl(agent.id) || agent.address;
                            const resp = await fetch(`${effectiveAddr}/api/processes/summaries${url.search}`);
                            if (!resp.ok) return [];
                            const data = await resp.json() as any;
                            const summaries = data?.summaries || data?.processes || (Array.isArray(data) ? data : []);
                            return summaries.map((p: any) => ({ ...p, agentId: agent.id, agentName: agent.name }));
                        } catch { return []; }
                    })
                );
                return sendJson(res, { summaries: results.flat() });
            }

            // Queue stub (container has no local queue — per-agent queues via proxy)
            if (url.pathname === '/api/queue' && req.method === 'GET') {
                return sendJson(res, { tasks: [], stats: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 } });
            }

            // Notify container that a workspace was registered on a remote agent
            // (bypassing the proxy, e.g. via browse-helper). Updates the workspace cache
            // so the aggregated list includes the new workspace immediately.
            if (url.pathname === '/api/container/workspace-registered' && req.method === 'POST') {
                const body = await readBody(req) as { agentId?: string; workspace?: RemoteWorkspace };
                if (body?.agentId && body?.workspace) {
                    const agent = agentStore.get(body.agentId);
                    if (agent) {
                        addCachedWorkspace(agent.address, {
                            ...body.workspace,
                            agentId: agent.id,
                            agentName: agent.name,
                            agentAddress: agent.address,
                        });
                    }
                }
                return sendJson(res, { ok: true });
            }

            // Queue repos stub
            if (url.pathname === '/api/queue/repos' && req.method === 'GET') {
                return sendJson(res, { repos: [] });
            }

            // Preferences — persisted as JSON in container data dir
            if (url.pathname === '/api/preferences') {
                const prefsPath = path.join(config.serve.dataDir, 'preferences.json');
                if (req.method === 'GET') {
                    try {
                        const data = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                        return sendJson(res, data);
                    } catch {
                        return sendJson(res, {});
                    }
                }
                if (req.method === 'PATCH' || req.method === 'PUT') {
                    const body = await readBody(req) as Record<string, unknown>;
                    let existing: Record<string, unknown> = {};
                    try { existing = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch { /* first write */ }
                    const merged = { ...existing, ...body };
                    fs.writeFileSync(prefsPath, JSON.stringify(merged, null, 2));
                    return sendJson(res, merged);
                }
            }

            // Notifications stub
            if (url.pathname === '/api/notifications' && req.method === 'GET') {
                return sendJson(res, { notifications: [] });
            }

            // ── Messaging API (WhatsApp status/QR) ────────────────
            if (url.pathname === '/api/container/messaging/status' && req.method === 'GET') {
                if (whatsappBridge) {
                    return sendJson(res, whatsappBridge.getWhatsAppStatus());
                }
                return sendJson(res, {
                    enabled: false,
                    status: 'disconnected',
                    qr: null,
                    error: null,
                    userName: config.messaging?.whatsapp?.userName ?? 'CoC',
                });
            }

            if (url.pathname === '/api/container/messaging/config' && req.method === 'POST') {
                const body = await readBody(req);
                const { userName, groupJid } = body as { userName?: string; groupJid?: string };
                if (whatsappBridge) {
                    await whatsappBridge.updateConfig({ userName, groupJid });
                    return sendJson(res, { ok: true, message: 'Config updated' });
                }
                return sendJson(res, { ok: false, error: 'WhatsApp not enabled' });
            }

            if (url.pathname === '/api/container/messaging/reconnect' && req.method === 'POST') {
                if (whatsappBridge) {
                    // Run reconnect in background, respond immediately
                    whatsappBridge.reconnect().catch(err => console.error('[container] WhatsApp reconnect error:', err));
                    return sendJson(res, { ok: true, message: 'Reconnecting — scan QR when prompted' });
                }
                return sendJson(res, { ok: false, error: 'WhatsApp not enabled' });
            }

            if (url.pathname === '/api/container/messaging/groups' && req.method === 'GET') {
                if (whatsappBridge) {
                    try {
                        const groups = await whatsappBridge.listGroups();
                        return sendJson(res, { groups });
                    } catch (err: any) {
                        return sendJson(res, { groups: [], error: err.message });
                    }
                }
                return sendJson(res, { groups: [], error: 'WhatsApp not enabled' });
            }

            // ── Teams Messaging API ────────────────────────────────
            if (url.pathname === '/api/container/messaging/teams/status' && req.method === 'GET') {
                if (teamsBridge) {
                    return sendJson(res, teamsBridge.getTeamsStatus());
                }
                return sendJson(res, {
                    enabled: false,
                    status: 'disconnected',
                    mode: config.messaging?.teams?.mode ?? 'graph',
                    error: null,
                    botName: config.messaging?.teams?.botName ?? 'CoC',
                });
            }

            if (url.pathname === '/api/container/messaging/teams/config' && req.method === 'POST') {
                const body = await readBody(req);
                const { botName, channelId, enabled, teamName, channelName, mode } = body as { botName?: string; channelId?: string; enabled?: boolean; teamName?: string; channelName?: string; mode?: 'graph' | 'mcp' };
                if (teamsBridge) {
                    await teamsBridge.updateConfig({ botName, channelId, enabled, teamName, channelName, mode });
                    return sendJson(res, { ok: true, message: 'Teams config updated' });
                }
                // Even without active bridge, persist the config
                try {
                    const fs = await import('fs');
                    const path = await import('path');
                    const jsYaml = await import('js-yaml');
                    const configPath = path.join(config.serve.dataDir, 'config.yaml');
                    let doc: Record<string, any> = {};
                    try { const raw = fs.readFileSync(configPath, 'utf8'); doc = (jsYaml.load(raw) as Record<string, any>) ?? {}; } catch {}
                    if (!doc.messaging) doc.messaging = {};
                    if (!doc.messaging.teams) doc.messaging.teams = {};
                    if (enabled !== undefined) doc.messaging.teams.enabled = enabled;
                    if (botName !== undefined) doc.messaging.teams.botName = botName;
                    if (channelId !== undefined) doc.messaging.teams.channelId = channelId;
                    if (teamName !== undefined) doc.messaging.teams.teamName = teamName;
                    if (channelName !== undefined) doc.messaging.teams.channelName = channelName;
                    if (mode !== undefined) doc.messaging.teams.mode = mode;
                    fs.writeFileSync(configPath, jsYaml.dump(doc), 'utf8');
                    return sendJson(res, { ok: true, message: 'Teams config saved (restart required)' });
                } catch (err: any) {
                    return sendJson(res, { ok: false, error: err.message });
                }
            }

            if (url.pathname === '/api/container/messaging/teams/reconnect' && req.method === 'POST') {
                if (teamsBridge) {
                    teamsBridge.reconnect().catch(err => console.error('[container] Teams reconnect error:', err));
                    return sendJson(res, { ok: true, message: 'Reconnecting to Teams' });
                }
                return sendJson(res, { ok: false, error: 'Teams not enabled' });
            }

            if (url.pathname === '/api/container/messaging/teams/channels' && req.method === 'GET') {
                if (teamsBridge) {
                    try {
                        const channels = await teamsBridge.listChannels();
                        return sendJson(res, { channels });
                    } catch (err: any) {
                        return sendJson(res, { channels: [], error: err.message });
                    }
                }
                return sendJson(res, { channels: [], error: 'Teams not enabled' });
            }

            // ── Teams OAuth Auth Endpoints (client-side PKCE) ─────────────────────────
            // POST /auth/start — starts a temporary callback server on a random port and returns OAuth params
            // The redirect_uri is http://localhost:<random-port>/ (root path, Azure AD localhost exception)
            if (url.pathname === '/api/container/messaging/teams/auth/start' && req.method === 'POST') {
                const mcpServerUrl = config.messaging?.teams?.mcpServerUrl;
                if (!mcpServerUrl) {
                    return sendJson(res, { ok: false, error: 'No mcpServerUrl configured' });
                }
                const { getOAuthConfig } = await import('@plusplusoneplusplus/teams-bot');
                const oauthConfig = getOAuthConfig(mcpServerUrl, {
                    clientId: config.messaging?.teams?.clientId,
                    scope: config.messaging?.teams?.scope,
                    mode: config.messaging?.teams?.mode ?? 'graph',
                });

                // Start temporary HTTP server on random port to receive the OAuth callback
                const callbackHtml = `<!DOCTYPE html><html><head><title>Teams Auth</title></head><body>
<h2>Processing login...</h2>
<script>
(function() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('code');
    var error = params.get('error');
    var errorDesc = params.get('error_description');
    if (window.opener) {
        window.opener.postMessage({ type: 'teams-auth-callback', code: code, error: error, errorDescription: errorDesc }, '*');
        document.querySelector('h2').textContent = code ? '\\u2713 Login successful' : '\\u2717 Login failed';
        document.body.innerHTML += '<p>You can close this window.</p>';
        setTimeout(function() { window.close(); }, 2000);
    } else {
        document.querySelector('h2').textContent = 'Error: no opener window';
    }
})();
</script></body></html>`;

                const tempServer = http.createServer((cbReq, cbRes) => {
                    cbRes.writeHead(200, { 'Content-Type': 'text/html' });
                    cbRes.end(callbackHtml);
                    // Auto-close temp server after serving the callback
                    setTimeout(() => tempServer.close(), 2000);
                });

                await new Promise<void>((resolve) => {
                    tempServer.listen(0, '127.0.0.1', () => resolve());
                });
                const callbackPort = (tempServer.address() as { port: number }).port;
                const redirectUri = `http://localhost:${callbackPort}/`;

                // Auto-close after 2 minutes if no callback received
                setTimeout(() => { try { tempServer.close(); } catch {} }, 120000);

                return sendJson(res, { ok: true, ...oauthConfig, redirectUri });
            }

            // POST /auth/exchange — client sends { code, codeVerifier, redirectUri } and server exchanges for tokens
            if (url.pathname === '/api/container/messaging/teams/auth/exchange' && req.method === 'POST') {
                const body = await readBody(req);
                const { code, codeVerifier, redirectUri } = body as { code?: string; codeVerifier?: string; redirectUri?: string };
                if (!code || !codeVerifier || !redirectUri) {
                    return sendJson(res, { ok: false, error: 'Missing required fields: code, codeVerifier, redirectUri' });
                }
                const mcpServerUrl = config.messaging?.teams?.mcpServerUrl;
                if (!mcpServerUrl) {
                    return sendJson(res, { ok: false, error: 'No mcpServerUrl configured' });
                }
                try {
                    const { exchangeCodeForToken } = await import('@plusplusoneplusplus/teams-bot');
                    await exchangeCodeForToken(mcpServerUrl, {
                        code,
                        codeVerifier,
                        redirectUri,
                        clientId: config.messaging?.teams?.clientId,
                        scope: config.messaging?.teams?.scope,
                        mode: config.messaging?.teams?.mode ?? 'graph',
                    });
                    console.log('[container] Teams OAuth code exchange succeeded');
                    // Auto-start or reconnect the bridge
                    if (teamsBridge) {
                        await teamsBridge.reconnect();
                    } else {
                        try {
                            const jsYaml = await import('js-yaml');
                            const configPath = path.join(config.serve.dataDir, 'config.yaml');
                            let doc: Record<string, any> = {};
                            try { const raw = fs.readFileSync(configPath, 'utf8'); doc = (jsYaml.load(raw) as Record<string, any>) ?? {}; } catch {}
                            if (!doc.messaging) doc.messaging = {};
                            if (!doc.messaging.teams) doc.messaging.teams = {};
                            doc.messaging.teams.enabled = true;
                            doc.messaging.teams.mcpServerUrl = mcpServerUrl;
                            fs.writeFileSync(configPath, jsYaml.dump(doc), 'utf8');
                        } catch { /* best effort */ }
                        try {
                            const { TeamsBridge } = await import('../messaging/teams-bridge');
                            const resolvedTeamsConfig = {
                                ...(config.messaging?.teams ?? {}),
                                enabled: true,
                                mode: (config.messaging?.teams?.mode ?? 'graph') as 'graph' | 'mcp',
                                mcpServerUrl,
                                botName: config.messaging?.teams?.botName ?? 'CoC',
                                pollIntervalMs: config.messaging?.teams?.pollIntervalMs ?? 3000,
                            };
                            const bridge = new TeamsBridge({
                                config: resolvedTeamsConfig,
                                dataDir: config.serve.dataDir,
                                wsRelay,
                                sseRelay,
                                agentStore,
                                tunnelBridge,
                            });
                            await bridge.start();
                            teamsBridge = bridge;
                        } catch (err: any) {
                            console.error('[container] Failed to start Teams bridge after login:', err.message);
                        }
                    }
                    return sendJson(res, { ok: true, message: 'Token exchange successful, bridge started' });
                } catch (err: any) {
                    console.error('[container] Teams OAuth exchange failed:', err.message);
                    return sendJson(res, { ok: false, error: err.message });
                }
            }

            if (url.pathname === '/api/container/messaging/teams/auth/status' && req.method === 'GET') {
                // Check if valid tokens exist
                try {
                    const mcpServerUrl = config.messaging?.teams?.mcpServerUrl;
                    if (!mcpServerUrl) {
                        return sendJson(res, { authenticated: false, error: 'No mcpServerUrl configured' });
                    }
                    const { acquireMcpOAuthToken } = await import('@plusplusoneplusplus/teams-bot');
                    await acquireMcpOAuthToken(mcpServerUrl);
                    return sendJson(res, { authenticated: true });
                } catch {
                    return sendJson(res, { authenticated: false });
                }
            }

            if (url.pathname === '/api/container/messaging/teams/auth/logout' && req.method === 'POST') {
                // Clear cached OAuth tokens for the configured MCP server
                try {
                    const mcpServerUrl = config.messaging?.teams?.mcpServerUrl;
                    if (mcpServerUrl) {
                        const crypto = await import('crypto');
                        const os = await import('os');
                        const configDir = path.join(os.homedir(), '.copilot', 'mcp-oauth-config');
                        if (fs.existsSync(configDir)) {
                            const files = fs.readdirSync(configDir).filter(f => f.endsWith('.json') && !f.includes('.tokens.'));
                            for (const file of files) {
                                try {
                                    const meta = JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf-8'));
                                    if (meta.serverUrl === mcpServerUrl) {
                                        const hash = file.replace('.json', '');
                                        fs.unlinkSync(path.join(configDir, file));
                                        const tokensFile = path.join(configDir, `${hash}.tokens.json`);
                                        if (fs.existsSync(tokensFile)) fs.unlinkSync(tokensFile);
                                        break;
                                    }
                                } catch { /* skip */ }
                            }
                        }
                    }
                    // Stop bridge
                    if (teamsBridge) {
                        await teamsBridge.stop();
                        teamsBridge = undefined;
                    }
                    return sendJson(res, { ok: true, message: 'Logged out and tokens cleared' });
                } catch (err: any) {
                    return sendJson(res, { ok: false, error: err.message });
                }
            }

            // ── Agent-scoped proxy ──────────────────────────────
            // Routes: /api/agent/:agentId/... → proxy to agent
            const agentProxyMatch = url.pathname.match(/^\/api\/agent\/([^/]+)\/(.*)/);
            if (agentProxyMatch) {
                const [, agentId, rest] = agentProxyMatch;
                const agent = agentStore.get(agentId);
                if (!agent) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Agent not found' }));
                }
                // Prefer inbound channel if agent is connected via call-home
                if (inboundManager.hasAgent(agentId)) {
                    try {
                        // Collect request body
                        const bodyChunks: Buffer[] = [];
                        for await (const chunk of req) {
                            bodyChunks.push(chunk as Buffer);
                        }
                        const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks).toString('utf8') : undefined;
                        const headers: Record<string, string> = {};
                        for (const [key, value] of Object.entries(req.headers)) {
                            if (typeof value === 'string') headers[key] = value;
                        }
                        const response = await inboundManager.proxyRequest(
                            agentId,
                            req.method ?? 'GET',
                            `/api/${rest}${url.search}`,
                            headers,
                            body,
                        );
                        res.writeHead(response.status, response.headers);
                        return res.end(response.body);
                    } catch (err) {
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'Proxy via channel failed', message: (err as Error).message }));
                    }
                }
                // Fallback: Use tunnel bridge local URL if available, otherwise direct address
                const effectiveAddr = tunnelBridge.getLocalUrl(agentId) || agent.address;
                return pipeRequest(effectiveAddr, req, res, `/api/${rest}${url.search}`);
            }

            // ── SSE events stream ──────────────────────────────
            if (url.pathname === '/api/events') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                });
                res.write(':ok\n\n');

                const onEvent = (event: { agentId: string; agentName: string; event?: string; data: string }) => {
                    const envelope = JSON.stringify({
                        agentId: event.agentId,
                        agentName: event.agentName,
                        payload: event.data,
                    });
                    if (event.event) {
                        res.write(`event: ${event.event}\n`);
                    }
                    res.write(`data: ${envelope}\n\n`);
                };

                sseRelay.on('event', onEvent);
                req.on('close', () => sseRelay.off('event', onEvent));
                return;
            }

            // ── Dashboard SPA (CoC bundle with containerMode) ───
            if (url.pathname === '/' || url.pathname === '/index.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end(generateContainerHtml());
            }

            // 404
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        } catch (err) {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }));
            }
        }
    });

    // WebSocket upgrade handling
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

        // Client WS at /ws — relay all agent messages
        if (url.pathname === '/ws') {
            const wss = new (require('ws').WebSocketServer)({ noServer: true });
            wss.handleUpgrade(req, socket, head, (ws: import('ws').WebSocket) => {
                const onMessage = (msg: { agentId: string; agentName: string; data: string }) => {
                    if (ws.readyState === 1) {
                        // Parse the agent's JSON payload and inject agentId/agentName so the
                        // browser's ProcessWebSocketConnection can pass isProcessEvent (which
                        // requires a top-level `type` field). Sending the raw envelope
                        // { agentId, agentName, data: "<json string>" } would fail that check
                        // and silently drop every event in container mode.
                        try {
                            const parsed = JSON.parse(msg.data);
                            ws.send(JSON.stringify({ ...parsed, agentId: msg.agentId, agentName: msg.agentName }));
                        } catch {
                            ws.send(JSON.stringify(msg));
                        }
                    }
                };
                wsRelay.on('message', onMessage);
                ws.on('message', (data: Buffer) => {
                    // Forward client messages to target agent
                    try {
                        const parsed = JSON.parse(data.toString());
                        if (parsed.agentId && parsed.data) {
                            wsRelay.send(parsed.agentId, typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data));
                        }
                    } catch {
                        // ignore malformed
                    }
                });
                ws.on('close', () => wsRelay.off('message', onMessage));
            });
            return;
        }

        // Agent inbound WS at /ws/agent-link — call-home connection
        if (url.pathname === '/ws/agent-link') {
            const wss = new (require('ws').WebSocketServer)({ noServer: true });
            wss.handleUpgrade(req, socket, head, (ws: import('ws').WebSocket) => {
                inboundManager.handleConnection(ws);
            });
            return;
        }

        socket.destroy();
    });

    server.listen(config.serve.port, config.serve.host);

    return {
        close() {
            whatsappBridge?.stop();
            healthMonitor.stop();
            tunnelBridge.stopAll();
            sseRelay.disconnectAll();
            wsRelay.disconnectAll();
            inboundManager.close();
            agentStore.close();
            server.close();
        },
    };
}

// ── Helpers ──────────────────────────────────────────────

async function aggregateWorkspaces(agents: Agent[], bridge: TunnelBridge): Promise<RemoteWorkspace[]> {
    const results = await Promise.all(
        agents
            .filter(a => a.status !== 'offline')
            .map(async (agent) => {
                const effectiveAddr = bridge.getLocalUrl(agent.id) || agent.address;
                const workspaces = await fetchAgentWorkspaces(effectiveAddr);
                return workspaces.map(ws => ({
                    ...ws,
                    agentId: agent.id,
                    agentName: agent.name,
                    agentAddress: agent.address,
                }));
            })
    );
    return results.flat();
}

function sendJson(res: http.ServerResponse, data: unknown, status: number = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}
