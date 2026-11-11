// CoC Chat Viewer: shows a conversation transcript by process ID. The transcript comes
// from the read-only get_conversation LLM tool, called through CoC's tool-script bridge.
//
// Single file on purpose: discovery hashes only extension.mjs and package.json.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { joinSession, createCanvas, CanvasError } from '@github/copilot-sdk/extension';
import { createToolScriptBridge } from '@coc/canvas-extension-tools';

const SCRIPT = 'return await tools.get_conversation({ processId: state.processId, includeToolCalls: state.includeToolCalls });';

let session;
let bridge;

async function getConversation(processId, includeToolCalls = false) {
    if (typeof processId !== 'string' || !processId.trim()) throw new CanvasError('bad_input', 'processId is required');
    bridge ??= createToolScriptBridge(session, { tools: ['get_conversation'] }).catch(error => { bridge = undefined; throw error; });
    const outcome = await (await bridge).runScript(SCRIPT, { state: { processId: processId.trim(), includeToolCalls } });
    if (!outcome?.ok) throw new CanvasError(outcome?.code ?? 'failed', outcome?.error ?? 'get_conversation failed');
    return outcome.result;
}

const instances = new Map();

function sendJson(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
}

async function handle(instance, request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(page(instance.processId));
        return;
    }
    if (request.method === 'GET' && url.pathname === '/conversation') {
        const id = url.searchParams.get('id');
        const result = await getConversation(id, url.searchParams.get('tools') === '1');
        instance.processId = id;
        sendJson(response, 200, result);
        return;
    }
    sendJson(response, 404, { error: 'Not found' });
}

const canvas = createCanvas({
    id: 'chat-viewer',
    displayName: 'CoC Chat Viewer',
    description: 'View a CoC conversation transcript by process ID.',
    inputSchema: { type: 'object', properties: { processId: { type: 'string', description: 'Conversation process ID to show' } } },
    async open(ctx) {
        let instance = instances.get(ctx.instanceId);
        if (!instance) {
            instance = { processId: ctx.input?.processId ?? '' };
            instance.server = createServer((request, response) => {
                handle(instance, request, response).catch(error => {
                    if (!response.headersSent) sendJson(response, error instanceof CanvasError ? 400 : 500, { error: error.message });
                    else response.end();
                });
            });
            instance.server.listen(0, '127.0.0.1');
            await once(instance.server, 'listening');
            instances.set(ctx.instanceId, instance);
        }
        return { title: 'Chat viewer', url: `http://127.0.0.1:${instance.server.address().port}/` };
    },
    actions: [
        {
            name: 'get_conversation',
            description: 'Return the compacted transcript of a conversation by process ID.',
            inputSchema: { type: 'object', required: ['processId'], properties: {
                processId: { type: 'string' }, includeToolCalls: { type: 'boolean', default: false },
            } },
            handler: ctx => getConversation(ctx.input?.processId, ctx.input?.includeToolCalls === true),
        },
    ],
    async onClose(ctx) {
        const instance = instances.get(ctx.instanceId);
        if (!instance) return;
        instances.delete(ctx.instanceId);
        await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
    },
});

function page(processId) {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Chat viewer</title>
<style>
:root { color-scheme: light dark; --line:#d0d7de; --muted:#656d76; --hl:#f6f8fa; }
@media (prefers-color-scheme: dark) { :root { --line:#30363d; --muted:#8d96a0; --hl:#161b22; } }
body { margin:0; font:13px system-ui, sans-serif; display:flex; flex-direction:column; height:100vh; }
header { display:flex; gap:6px; align-items:center; padding:6px 8px; border-bottom:1px solid var(--line); }
input, button { font:inherit; color:inherit; background:var(--hl); border:1px solid var(--line); border-radius:4px; padding:2px 6px; }
#id { flex:1; }
#meta { padding:6px 8px; color:var(--muted); }
pre { flex:1; margin:0; padding:8px; overflow:auto; white-space:pre-wrap; word-break:break-word; font:12px ui-monospace, Menlo, monospace; }
</style></head>
<body>
<header>
  <input id="id" placeholder="Process ID" value="${String(processId).replace(/[&"<>]/g, c => `&#${c.charCodeAt(0)};`)}">
  <label><input id="tools" type="checkbox"> tool calls</label>
  <button id="load">Load</button>
</header>
<div id="meta"></div>
<pre id="out"></pre>
<script>
const $ = id => document.getElementById(id);
async function load() {
  const id = $('id').value.trim();
  if (!id) return;
  $('meta').textContent = 'Loading…'; $('out').textContent = '';
  const res = await fetch('/conversation?id=' + encodeURIComponent(id) + '&tools=' + ($('tools').checked ? 1 : 0));
  const body = await res.json().catch(() => ({ error: 'Bad response' }));
  if (!res.ok) { $('meta').textContent = body.error || 'Load failed'; return; }
  $('meta').textContent = [body.title, body.status, body.returnedTurns + '/' + body.totalTurns + ' turns', body.truncated ? 'truncated' : '']
    .filter(Boolean).join(' · ');
  $('out').textContent = body.transcript || body.note || '';
}
$('load').onclick = load;
$('id').onkeydown = ev => { if (ev.key === 'Enter') load(); };
if ($('id').value) load();
</script>
</body></html>`;
}

session = await joinSession({ canvases: [canvas] });
