import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { joinSession, createCanvas } from '@github/copilot-sdk/extension';
import { createToolScriptBridge } from '@coc/canvas-extension-tools';

const instances = new Map();
let session, bridge;
const script = `
const list = await tools.query_pull_request({
  provider: state.provider, repository: state.repository, status: 'open', limit: 10
});
if (!list.success) throw new Error(list.error || 'PR query failed');
return { items: list.items };
`;
async function refresh(instance) {
    bridge ??= await createToolScriptBridge(session, { tools: ['query_pull_request'] });
    const result = await bridge.runScript(script, { state: instance.input });
    if (!result.ok) throw new Error(result.error);
    const temporary = `${instance.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(result.result));
    await rename(temporary, instance.file);
    instance.state = result.result;
    return instance.state;
}
session = await joinSession({ canvases: [createCanvas({
    id: 'pr-dashboard', displayName: 'Pull requests', description: 'Read-only PR dashboard',
    async open(ctx) {
        if (!instances.has(ctx.instanceId)) {
            const file = join(session.workspacePath, `${Buffer.from(ctx.instanceId).toString('hex')}.json`);
            let state = { items: [] };
            try { state = JSON.parse(await readFile(file, 'utf8')); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            const instance = { file, state, input: ctx.input ?? {} };
            const server = createServer(async (request, response) => {
                try {
                    if (request.url === '/refresh' && request.method === 'POST') await refresh(instance);
                    if (request.url === '/data' || request.url === '/refresh') {
                        response.setHeader('Content-Type', 'application/json');
                        response.end(JSON.stringify(instance.state));
                    } else {
                        response.setHeader('Content-Type', 'text/html');
                        response.end(`<!doctype html><title>Pull requests</title><h1>Pull requests</h1>
<button id="refresh">Refresh</button><pre id="data"></pre><script>
const show = async (path, method) => {
 const result = await fetch(path, {method});
 document.getElementById('data').textContent = JSON.stringify(await result.json(), null, 2);
};
document.getElementById('refresh').onclick = () => show('/refresh', 'POST');
show('/data', 'GET');
</script>`);
                    }
                } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })); }
            });
            server.listen(0, '127.0.0.1'); await once(server, 'listening');
            instances.set(ctx.instanceId, Object.assign(instance, { server }));
        }
        return { title: 'Pull requests', url: `http://127.0.0.1:${instances.get(ctx.instanceId).server.address().port}/` };
    },
    actions: [{ name: 'refresh', handler: ctx => refresh(instances.get(ctx.instanceId)) }],
    async onClose(ctx) {
        const instance = instances.get(ctx.instanceId);
        if (instance) { await new Promise(resolve => instance.server.close(resolve)); instances.delete(ctx.instanceId); }
    },
})] });
