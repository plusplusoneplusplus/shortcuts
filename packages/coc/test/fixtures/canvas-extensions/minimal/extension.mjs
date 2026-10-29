import { createServer } from 'node:http';
import { once } from 'node:events';
import { joinSession, createCanvas, CanvasError } from '@github/copilot-sdk/extension';
import { createCanvas as rootCreateCanvas } from '@github/copilot-sdk';

let session;
const instances = new Map();
session = await joinSession({
    canvases: [createCanvas({
        id: 'counter', displayName: 'Counter', description: 'A minimal canvas fixture',
        async open(ctx) {
            if (!instances.has(ctx.instanceId)) {
                const state = { count: ctx.input?.count ?? 0 };
                const server = createServer((_req, response) => {
                    response.setHeader('Content-Type', 'application/json');
                    response.end(JSON.stringify(state));
                });
                server.listen(0, '127.0.0.1');
                await once(server, 'listening');
                instances.set(ctx.instanceId, { server, state });
            }
            return { title: 'Counter', url: `http://127.0.0.1:${instances.get(ctx.instanceId).server.address().port}/` };
        },
        actions: [
            { name: 'increment', handler: ctx => ++instances.get(ctx.instanceId).state.count },
            { name: 'error', handler() { throw new CanvasError('counter_error', 'Counter failed'); } },
            { name: 'callbacks', async handler() {
                const messageId = await session.send('hi');
                const answer = await session.rpc.ui.ephemeralQuery({ question: 'How many?' });
                const log = await session.rpc.log({ message: 'Fixture message' });
                console.error('fixture stderr');
                return { messageId, ...answer, ...log };
            } },
            { name: 'unknown', async handler() {
                const codes = [];
                for (let i = 0; i < 2; i++) {
                    try { await session.connection.sendRequest('fixture.unsupported', {}); }
                    catch (error) { codes.push(error.code); }
                }
                return codes;
            } },
            { name: 'wrong-session', async handler() {
                try { await session.connection.sendRequest('session.send', { sessionId: 'sibling', prompt: 'hi' }); }
                catch (error) { return error.code; }
            } },
            { name: 'ping', handler: () => session.connection.sendRequest('ping', {}) },
            { name: 'environment', handler: () => ({
                sessionId: process.env.SESSION_ID, home: process.env.COPILOT_HOME,
                electron: process.env.ELECTRON_RUN_AS_NODE, cwd: process.cwd(), pid: process.pid,
                rootImport: typeof rootCreateCanvas,
            }) },
            { name: 'hang', handler: () => new Promise(() => {}) },
            { name: 'crash', handler: () => process.exit(17) },
        ],
        async onClose(ctx) {
            const instance = instances.get(ctx.instanceId);
            if (instance) {
                await new Promise((resolve, reject) => instance.server.close(error => error ? reject(error) : resolve()));
                instances.delete(ctx.instanceId);
            }
        },
    })],
});
