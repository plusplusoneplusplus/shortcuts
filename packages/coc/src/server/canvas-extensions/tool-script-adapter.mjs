import { randomUUID } from 'node:crypto';

// CoC-owned adapter for the installed SDK's session.connection transport.
// Imported as @coc/canvas-extension-tools only inside a CoC-hosted extension.
// This is not part of @github/copilot-sdk and does not modify its API or pin.
export async function createToolScriptBridge(session, { tools }) {
    const sessionId = process.env.SESSION_ID;
    const rpc = (action, params) => session.connection.sendRequest(`coc.toolScripts.v1.${action}`, { sessionId, ...params });
    await rpc('register', { tools });
    return {
        async runScript(code, { state, signal } = {}) {
            signal?.throwIfAborted();
            const requestId = randomUUID();
            const pending = rpc('run', { requestId, code, ...(state === undefined ? {} : { state }) });
            const cancel = () => { void rpc('cancel', { requestId }).catch(() => {}); };
            signal?.addEventListener('abort', cancel, { once: true });
            try { return await pending; }
            finally { signal?.removeEventListener('abort', cancel); }
        },
    };
}
