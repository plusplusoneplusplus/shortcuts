// MCP Server List: shows the session's MCP servers from session.rpc.mcp.list().
// Uses only the Copilot SDK extension API; the Copilot CLI answers the RPC.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { joinSession, createCanvas } from '@github/copilot-sdk/extension';

let session;

async function listServers() {
    const { servers = [], host } = await session.rpc.mcp.list();
    return {
        servers: servers.map(({ name, status, source, sourcePlugin, error }) => ({ name, status, source, sourcePlugin, error })),
        ...(host ? { host } : {}),
    };
}

const instances = new Map();

function sendJson(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
}

async function handle(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(PAGE);
        return;
    }
    if (request.method === 'GET' && url.pathname === '/servers') {
        sendJson(response, 200, await listServers());
        return;
    }
    sendJson(response, 404, { error: 'Not found' });
}

const canvas = createCanvas({
    id: 'mcp-server-list',
    displayName: 'MCP Server List',
    description: 'List the MCP servers configured for this session and their status.',
    async open(ctx) {
        let instance = instances.get(ctx.instanceId);
        if (!instance) {
            instance = { server: createServer((request, response) => {
                handle(request, response).catch(error => {
                    if (!response.headersSent) sendJson(response, 500, { error: error?.message ?? String(error) });
                    else response.end();
                });
            }) };
            instance.server.listen(0, '127.0.0.1');
            await once(instance.server, 'listening');
            instances.set(ctx.instanceId, instance);
        }
        return { title: 'MCP servers', url: `http://127.0.0.1:${instance.server.address().port}/` };
    },
    actions: [
        {
            name: 'list_servers',
            description: 'Return the session MCP servers with name, status, source and error.',
            inputSchema: { type: 'object', properties: {} },
            handler: () => listServers(),
        },
    ],
    async onClose(ctx) {
        const instance = instances.get(ctx.instanceId);
        if (!instance) return;
        instances.delete(ctx.instanceId);
        await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
    },
});

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>MCP servers</title>
<style>
:root { color-scheme: light dark; --line:#d0d7de; --muted:#656d76; --hl:#f6f8fa; --ok:#1a7f37; --bad:#cf222e; }
@media (prefers-color-scheme: dark) { :root { --line:#30363d; --muted:#8d96a0; --hl:#161b22; --ok:#3fb950; --bad:#f85149; } }
body { margin:0; font:13px system-ui, sans-serif; }
header { display:flex; gap:6px; align-items:center; padding:6px 8px; border-bottom:1px solid var(--line); }
button { font:inherit; color:inherit; background:var(--hl); border:1px solid var(--line); border-radius:4px; padding:2px 8px; }
#meta { color:var(--muted); }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; }
.connected { color:var(--ok); } .failed, .needs-auth { color:var(--bad); }
.err { color:var(--bad); white-space:pre-wrap; word-break:break-word; }
</style></head>
<body>
<header><button id="refresh">Refresh</button><span id="meta"></span></header>
<table><thead><tr><th>Name</th><th>Status</th><th>Source</th><th>Error</th></tr></thead><tbody id="rows"></tbody></table>
<script>
const $ = id => document.getElementById(id);
function cell(text, cls) { const td = document.createElement('td'); td.textContent = text ?? ''; if (cls) td.className = cls; return td; }
async function load() {
  $('meta').textContent = 'Loading…'; $('rows').replaceChildren();
  const res = await fetch('/servers');
  const body = await res.json().catch(() => ({ error: 'Bad response' }));
  if (!res.ok) { $('meta').textContent = body.error || 'Load failed'; return; }
  $('meta').textContent = body.servers.length + ' server(s)';
  for (const s of body.servers) {
    const tr = document.createElement('tr');
    tr.append(cell(s.name), cell(s.status, s.status), cell([s.source, s.sourcePlugin].filter(Boolean).join(' / ')), cell(s.error, 'err'));
    $('rows').append(tr);
  }
}
$('refresh').onclick = load;
load();
</script>
</body></html>`;

session = await joinSession({ canvases: [canvas] });
