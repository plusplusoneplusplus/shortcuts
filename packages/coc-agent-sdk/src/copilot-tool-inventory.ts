import type { CopilotSession } from '@github/copilot-sdk';
import type { Tool } from './types';
import { createRuntimeToolInventory, unavailableToolInventory, type RuntimeToolInventory } from './tool-inventory';

/** Read the active session catalog, never the client-wide built-in catalog or MCP configuration. */
export async function captureCopilotToolInventory(
    session: CopilotSession,
    tools: readonly Tool<any>[],
    signal?: AbortSignal,
    timeoutMs = 5000,
): Promise<RuntimeToolInventory> {
    const rpc = session.rpc?.tools;
    if (!rpc?.initializeAndValidate || !rpc?.getCurrentMetadata || signal?.aborted) return unavailableToolInventory('copilot');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let stopped = false;
    try {
        const cancelled = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { stopped = true; reject(new Error('Inventory discovery timeout')); }, timeoutMs);
            onAbort = () => { stopped = true; reject(new Error('Inventory discovery aborted')); };
            signal?.addEventListener('abort', onAbort, { once: true });
        });
        const metadata = await Promise.race([
            (async () => {
                await rpc.initializeAndValidate();
                if (stopped || signal?.aborted) throw new Error('Inventory discovery aborted');
                return rpc.getCurrentMetadata();
            })(),
            cancelled,
        ]);
        if (!Array.isArray(metadata?.tools) || signal?.aborted) return unavailableToolInventory('copilot');
        const cocNames = new Set(tools.map(tool => tool.name));
        return createRuntimeToolInventory('copilot', metadata.tools.map(tool => ({
            name: tool.name,
            source: tool.mcpServerName ? 'mcp' : cocNames.has(tool.name) ? 'coc' : 'builtin',
            ...(tool.mcpServerName ? { serverName: tool.mcpServerName } : {}),
            description: tool.description,
            ...(tool.input_schema !== undefined ? { inputSchema: tool.input_schema } : {}),
        })), [
            { source: 'builtin', status: 'complete' },
            { source: 'coc', status: 'complete' },
            // Metadata describes initialized callable tools, but does not prove
            // that every MCP server finished discovery or authentication.
            { source: 'mcp', status: 'partial', reason: 'Initialized MCP tools are shown; the runtime does not confirm discovery completeness.' },
        ]);
    } catch {
        // Provider errors may contain credentials or commands. Use fixed copy.
        return unavailableToolInventory('copilot');
    } finally {
        if (timer) clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
}
