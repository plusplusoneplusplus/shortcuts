import { joinSession, createCanvas } from '@github/copilot-sdk/extension';
import { createToolScriptBridge } from '@coc/canvas-extension-tools';

let session;
let bridge;
session = await joinSession({ canvases: [createCanvas({
    id: 'scripts', displayName: 'Scripts', description: 'CoC script bridge test fixture',
    open: () => ({ title: 'Scripts', url: 'http://127.0.0.1:1234/' }),
    actions: [
        { name: 'run', async handler(ctx) {
            const api = await (bridge ??= createToolScriptBridge(session, { tools: ['execute_kusto_query'] }));
            const controller = new AbortController();
            const timer = ctx.input.cancelAfterMs === undefined ? undefined
                : setTimeout(() => controller.abort(), ctx.input.cancelAfterMs);
            try { return await api.runScript(ctx.input.code, { state: ctx.input.state, signal: controller.signal }); }
            finally { clearTimeout(timer); }
        } },
        { name: 'raw', async handler(ctx) {
            try { return await session.connection.sendRequest(ctx.input.method, ctx.input.params); }
            catch (error) { return { rpcError: error.code, message: error.message }; }
        } },
    ],
})] });
