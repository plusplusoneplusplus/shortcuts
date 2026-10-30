import { createServer } from 'node:http';
import { once } from 'node:events';
import { joinSession, createCanvas } from '@github/copilot-sdk/extension';

const instances = new Map();
await joinSession({
    canvases: [createCanvas({
        id: 'counter', displayName: 'Interactive counter', description: 'SSE counter fixture',
        async open(ctx) {
            if (!instances.has(ctx.instanceId)) {
                const state = { count: ctx.input?.count ?? 0, streams: new Set() };
                const server = createServer((request, response) => {
                    if (request.url === '/events') {
                        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
                        response.write(`data: ${state.count}\n\n`);
                        state.streams.add(response);
                        response.on('close', () => state.streams.delete(response));
                        return;
                    }
                    response.setHeader('Content-Type', 'text/html');
                    response.end('<!doctype html><title>Interactive counter</title><p id="count">waiting</p>'
                        + '<a id="external" href="https://example.test/extension">External</a>'
                        + '<script>new EventSource("/events").onmessage = event => document.getElementById("count").textContent = event.data;</script>');
                });
                server.listen(0, '127.0.0.1');
                await once(server, 'listening');
                instances.set(ctx.instanceId, { server, state });
            }
            return { title: 'Interactive counter', url: `http://127.0.0.1:${instances.get(ctx.instanceId).server.address().port}/` };
        },
        actions: [{
            name: 'increment',
            handler(ctx) {
                const { state } = instances.get(ctx.instanceId);
                state.count++;
                for (const stream of state.streams) stream.write(`data: ${state.count}\n\n`);
                return state.count;
            },
        }],
        async onClose(ctx) {
            const instance = instances.get(ctx.instanceId);
            if (!instance) return;
            for (const stream of instance.state.streams) stream.end();
            await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
            instances.delete(ctx.instanceId);
        },
    })],
});
