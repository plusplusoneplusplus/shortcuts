// MCP Server List: shows the session's MCP servers from session.rpc.mcp.list() and
// its tools from session.rpc.tools.getCurrentMetadata(), grouped into built-in and
// per-server MCP tools. Uses only the Copilot SDK extension API.
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

async function listTools() {
    let { tools } = await session.rpc.tools.getCurrentMetadata();
    if (!tools) {
        await session.rpc.tools.initializeAndValidate();
        ({ tools } = await session.rpc.tools.getCurrentMetadata());
    }
    if (!tools) return { initialized: false, builtin: [], mcp: {} };
    const builtin = [];
    const mcp = {};
    for (const { name, description, mcpServerName } of tools) {
        const tool = { name, description };
        if (mcpServerName) (mcp[mcpServerName] ??= []).push(tool);
        else builtin.push(tool);
    }
    return { initialized: true, builtin, mcp };
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
    if (request.method === 'GET' && url.pathname === '/tools') {
        sendJson(response, 200, await listTools());
        return;
    }
    sendJson(response, 404, { error: 'Not found' });
}

const canvas = createCanvas({
    id: 'mcp-server-list',
    displayName: 'MCP Server List',
    description: 'List the MCP servers configured for this session and its tools, grouped into built-in and MCP.',
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
        {
            name: 'list_tools',
            description: 'Return the session tools grouped as { builtin: [...], mcp: { <server>: [...] } }.',
            inputSchema: { type: 'object', properties: {} },
            handler: () => listTools(),
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
<html><head><meta charset="utf-8"><title>MCP servers and tools</title>
<style>
:root { color-scheme: light dark; --line:#d0d7de; --muted:#656d76; --hl:#f6f8fa; --ok:#1a7f37; --bad:#cf222e; }
@media (prefers-color-scheme: dark) { :root { --line:#30363d; --muted:#8d96a0; --hl:#161b22; --ok:#3fb950; --bad:#f85149; } }
body { margin:0; font:13px system-ui, sans-serif; }
header { display:flex; gap:6px; align-items:center; padding:6px 8px; border-bottom:1px solid var(--line); }
button, input { font:inherit; color:inherit; background:var(--hl); border:1px solid var(--line); border-radius:4px; padding:2px 8px; }
button.on { font-weight:600; border-color:var(--muted); }
#filter { flex:1; }
#meta { color:var(--muted); }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; }
.connected { color:var(--ok); } .failed, .needs-auth { color:var(--bad); }
.err { color:var(--bad); white-space:pre-wrap; word-break:break-word; }
details { border-bottom:1px solid var(--line); }
summary { padding:6px 8px; cursor:pointer; font-weight:600; }
summary span { color:var(--muted); font-weight:400; }
.tool { padding:3px 8px 3px 24px; }
.tool code { font:12px ui-monospace, Menlo, monospace; }
.tool div { color:var(--muted); white-space:pre-wrap; word-break:break-word; }
[hidden] { display:none !important; }
</style></head>
<body>
<header>
  <button id="tab-servers" class="on">Servers</button><button id="tab-tools">Tools</button>
  <input id="filter" placeholder="Filter tools" hidden>
  <button id="refresh">Refresh</button><span id="meta"></span>
</header>
<table id="servers"><thead><tr><th>Name</th><th>Status</th><th>Source</th><th>Error</th></tr></thead><tbody id="rows"></tbody></table>
<div id="tools" hidden></div>
<script>
const $ = id => document.getElementById(id);
let tab = 'servers';
let tools;
function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
async function getJson(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({ error: 'Bad response' }));
  if (!res.ok) throw new Error(body.error || 'Load failed');
  return body;
}
async function loadServers() {
  $('rows').replaceChildren();
  const body = await getJson('/servers');
  $('meta').textContent = body.servers.length + ' server(s)';
  for (const s of body.servers) {
    const tr = el('tr');
    tr.append(el('td', s.name), el('td', s.status, s.status), el('td', [s.source, s.sourcePlugin].filter(Boolean).join(' / ')), el('td', s.error, 'err'));
    $('rows').append(tr);
  }
}
function group(title, list, query) {
  const shown = list.filter(t => !query || (t.name + ' ' + t.description).toLowerCase().includes(query));
  if (!shown.length) return null;
  const d = el('details'); d.open = true;
  const s = el('summary', title + ' '); s.append(el('span', '(' + shown.length + ')')); d.append(s);
  for (const t of shown) { const row = el('div', null, 'tool'); row.append(el('code', t.name), el('div', t.description)); d.append(row); }
  return d;
}
function renderTools() {
  if (!tools) return;
  const query = $('filter').value.trim().toLowerCase();
  const servers = Object.keys(tools.mcp).sort();
  const total = tools.builtin.length + servers.reduce((n, s) => n + tools.mcp[s].length, 0);
  $('meta').textContent = tools.initialized
    ? total + ' tool(s): ' + tools.builtin.length + ' built-in, ' + (total - tools.builtin.length) + ' MCP'
    : 'Tools are not initialized yet';
  $('tools').replaceChildren(...[group('Built-in', tools.builtin, query), ...servers.map(s => group('MCP: ' + s, tools.mcp[s], query))].filter(Boolean));
}
async function load() {
  $('meta').textContent = 'Loading…';
  try {
    if (tab === 'servers') await loadServers();
    else { $('tools').replaceChildren(); tools = await getJson('/tools'); renderTools(); }
  } catch (error) { $('meta').textContent = error.message; }
}
function show(next) {
  tab = next;
  $('tab-servers').classList.toggle('on', tab === 'servers'); $('tab-tools').classList.toggle('on', tab === 'tools');
  $('servers').hidden = tab !== 'servers'; $('tools').hidden = tab !== 'tools'; $('filter').hidden = tab !== 'tools';
  load();
}
$('tab-servers').onclick = () => show('servers');
$('tab-tools').onclick = () => show('tools');
$('refresh').onclick = load;
$('filter').oninput = renderTools;
load();
</script>
</body></html>`;

session = await joinSession({ canvases: [canvas] });
