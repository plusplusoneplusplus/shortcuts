import type { RuntimeToolDescriptor } from './llm-tools/coc-tool-runtime';
import { COC_LLM_TOOLS_MCP_SERVER_NAME } from './llm-tools/mcp-config';
import { createRuntimeToolInventory, unavailableToolInventory, type ToolInventoryDescriptor } from './tool-inventory';

/** Only the running turn's system/init frame establishes tool availability. */
export function captureClaudeToolInventory(
    frame: Record<string, unknown>,
    cocTools: readonly RuntimeToolDescriptor[],
) {
    if (!Array.isArray(frame.tools)) return unavailableToolInventory('claude');

    const servers = Array.isArray(frame.mcp_servers) ? frame.mcp_servers : [];
    const serverNames = servers.flatMap(server =>
        server && typeof server.name === 'string' && server.name
            ? [server.name as string] : [],
    ).sort((a, b) => b.length - a.length);
    const cocByName = new Map(cocTools.map(tool => [tool.name, tool]));
    const confirmedCoc = new Set<string>();
    const seen = new Set<string>();
    const descriptors: ToolInventoryDescriptor[] = [];
    let malformed = false;
    for (const name of frame.tools) {
        if (typeof name !== 'string' || !name) { malformed = true; continue; }
        if (seen.has(name)) continue;
        seen.add(name);
        if (!name.startsWith('mcp__')) {
            descriptors.push({ name, source: 'builtin' });
            continue;
        }
        const serverName = serverNames.find(server => name.startsWith(`mcp__${server}__`));
        if (!serverName) { malformed = true; continue; }
        const bareName = name.slice(`mcp__${serverName}__`.length);
        const cocTool = serverName === COC_LLM_TOOLS_MCP_SERVER_NAME ? cocByName.get(bareName) : undefined;
        if (cocTool) {
            confirmedCoc.add(bareName);
            descriptors.push({ ...cocTool, source: 'coc' });
        } else {
            descriptors.push({ name, source: 'mcp', serverName });
        }
    }
    const cocComplete = !malformed && confirmedCoc.size === cocByName.size;
    return createRuntimeToolInventory('claude', descriptors, [
        { source: 'builtin', status: 'partial', reason: 'Claude reports startup tool names without descriptions or input schemas.' },
        { source: 'coc', status: cocComplete ? 'complete' : 'partial', ...(!cocComplete ? {
            reason: 'Some CoC bridge tools could not be confirmed in the startup catalog.',
        } : {}) },
        { source: 'mcp', status: 'partial', reason: 'Claude startup discovery may omit deferred or disconnected MCP tools and does not report their descriptions or input schemas.' },
    ]);
}
