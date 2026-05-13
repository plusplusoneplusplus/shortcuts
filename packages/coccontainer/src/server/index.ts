/**
 * CoCContainer Server
 *
 * HTTP server that serves the aggregation dashboard and proxies API calls
 * to registered CoC agents.
 */

import * as http from 'http';
import { URL } from 'url';
import type { ResolvedContainerConfig } from '../config';
import { createAgentStore, type AgentStore, type Agent } from '../store';
import { pipeRequest } from '../proxy/http';
import { fetchAgentWorkspaces, type RemoteWorkspace } from '../proxy/workspaces';
import { SSERelay } from '../proxy/sse-relay';
import { WebSocketRelay } from '../proxy/ws-relay';
import { AgentHealthMonitor } from './health-monitor';

export interface ContainerServer {
    close(): void;
}

export async function createContainerServer(config: ResolvedContainerConfig): Promise<ContainerServer> {
    const agentStore = createAgentStore(config.serve.dataDir);
    const sseRelay = new SSERelay();
    const wsRelay = new WebSocketRelay();
    const healthMonitor = new AgentHealthMonitor(agentStore, config.healthCheckIntervalMs);

    // Start health monitoring and SSE/WS connections for existing agents
    const agents = agentStore.list();
    healthMonitor.start();

    for (const agent of agents) {
        sseRelay.connect(agent.id, agent.name, agent.address);
        wsRelay.connect(agent.id, agent.name, agent.address);
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
            if (url.pathname === '/api/agents' && req.method === 'GET') {
                return sendJson(res, agentStore.list());
            }

            if (url.pathname === '/api/agents' && req.method === 'POST') {
                const body = await readBody(req);
                const { address, name } = body as { address: string; name?: string };
                const agent = agentStore.add(address, name);
                sseRelay.connect(agent.id, agent.name, agent.address);
                wsRelay.connect(agent.id, agent.name, agent.address);
                return sendJson(res, agent, 201);
            }

            if (url.pathname.startsWith('/api/agents/') && req.method === 'DELETE') {
                const agentId = url.pathname.split('/')[3];
                const agent = agentStore.get(agentId);
                if (agent) {
                    sseRelay.disconnect(agent.id);
                    wsRelay.disconnect(agent.id);
                }
                const removed = agentStore.remove(agentId);
                return sendJson(res, { removed });
            }

            // Aggregated workspaces from all agents
            if (url.pathname === '/api/workspaces' && req.method === 'GET') {
                const allAgents = agentStore.list();
                const workspaces = await aggregateWorkspaces(allAgents);
                return sendJson(res, workspaces);
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
                return pipeRequest(agent.address, req, res, `/api/${rest}${url.search}`);
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

            // ── Dashboard SPA ──────────────────────────────
            if (url.pathname === '/' || url.pathname === '/index.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end(getDashboardHtml());
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
                        ws.send(JSON.stringify(msg));
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

        socket.destroy();
    });

    server.listen(config.serve.port, config.serve.host);

    return {
        close() {
            healthMonitor.stop();
            sseRelay.disconnectAll();
            wsRelay.disconnectAll();
            agentStore.close();
            server.close();
        },
    };
}

// ── Helpers ──────────────────────────────────────────────

async function aggregateWorkspaces(agents: Agent[]): Promise<RemoteWorkspace[]> {
    const results = await Promise.all(
        agents
            .filter(a => a.status !== 'offline')
            .map(async (agent) => {
                const workspaces = await fetchAgentWorkspaces(agent.address);
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

function getDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CoCContainer Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; }
    .header { padding: 16px 24px; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 12px; }
    .header h1 { font-size: 20px; font-weight: 600; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .agent-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .agent-header { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .status-dot.online { background: #3fb950; }
    .status-dot.offline { background: #f85149; }
    .status-dot.unknown { background: #8b949e; }
    .agent-name { font-weight: 600; font-size: 16px; }
    .agent-address { color: #8b949e; font-size: 13px; margin-left: auto; }
    .repos-list { margin-top: 12px; padding-left: 16px; }
    .repo-item { padding: 8px 12px; border: 1px solid #21262d; border-radius: 6px; margin-bottom: 6px; background: #0d1117; }
    .add-agent { margin-bottom: 24px; }
    .add-agent input { background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 12px; border-radius: 6px; margin-right: 8px; }
    .add-agent button { background: #238636; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .add-agent button:hover { background: #2ea043; }
    .empty { text-align: center; color: #8b949e; padding: 48px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔗 CoCContainer</h1>
    <span style="color: #8b949e">Multi-Agent Dashboard</span>
  </div>
  <div class="container">
    <div class="add-agent">
      <input id="agent-addr" type="text" placeholder="http://localhost:4000" style="width:300px" />
      <input id="agent-name" type="text" placeholder="Name (optional)" style="width:180px" />
      <button onclick="addAgent()">Add Agent</button>
    </div>
    <div id="agents-container">
      <div class="empty">Loading agents...</div>
    </div>
  </div>
  <script>
    const API = '';
    async function loadAgents() {
      const res = await fetch(API + '/api/agents');
      const agents = await res.json();
      const container = document.getElementById('agents-container');
      if (agents.length === 0) {
        container.innerHTML = '<div class="empty">No agents registered. Add one above.</div>';
        return;
      }
      container.innerHTML = '';
      for (const agent of agents) {
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.innerHTML = \`
          <div class="agent-header" onclick="toggleRepos('\${agent.id}')">
            <span class="status-dot \${agent.status}"></span>
            <span class="agent-name">\${agent.name}</span>
            <span class="agent-address">\${agent.address}</span>
            <button onclick="event.stopPropagation(); removeAgent('\${agent.id}')" style="background:#da3633;color:white;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;margin-left:8px;">Remove</button>
          </div>
          <div class="repos-list" id="repos-\${agent.id}" style="display:none">Loading repos...</div>
        \`;
        container.appendChild(card);
      }
    }

    async function toggleRepos(agentId) {
      const el = document.getElementById('repos-' + agentId);
      if (el.style.display === 'none') {
        el.style.display = 'block';
        try {
          const res = await fetch(API + '/api/agent/' + agentId + '/workspaces');
          const data = await res.json();
          const workspaces = Array.isArray(data) ? data : (data.workspaces || []);
          if (workspaces.length === 0) {
            el.innerHTML = '<div style="color:#8b949e;padding:8px">No repos on this agent.</div>';
          } else {
            el.innerHTML = workspaces.map(ws =>
              '<div class="repo-item">' + (ws.name || ws.rootPath || ws.id) + '</div>'
            ).join('');
          }
        } catch {
          el.innerHTML = '<div style="color:#f85149;padding:8px">Failed to fetch repos.</div>';
        }
      } else {
        el.style.display = 'none';
      }
    }

    async function addAgent() {
      const addr = document.getElementById('agent-addr').value.trim();
      const name = document.getElementById('agent-name').value.trim();
      if (!addr) return alert('Enter an address');
      try {
        await fetch(API + '/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr, name: name || undefined })
        });
        document.getElementById('agent-addr').value = '';
        document.getElementById('agent-name').value = '';
        loadAgents();
      } catch (e) { alert('Failed: ' + e.message); }
    }

    async function removeAgent(id) {
      if (!confirm('Remove this agent?')) return;
      await fetch(API + '/api/agents/' + id, { method: 'DELETE' });
      loadAgents();
    }

    loadAgents();
    setInterval(loadAgents, 30000);
  </script>
</body>
</html>`;
}
