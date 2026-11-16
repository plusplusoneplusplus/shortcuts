import { isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import type { ConversationToolInventoryStore } from '../storage/conversation-tool-inventory-store';

/** Wire shape of the Copilot SDK `CurrentToolMetadata`, which the SDK does not export. */
export interface CanvasToolMetadata {
    name: string;
    description: string;
    mcpServerName?: string;
}

/** Wire shape of `session.tools.getCurrentMetadata`; `null` until tools are known. */
export interface CanvasToolMetadataResult {
    tools: CanvasToolMetadata[] | null;
}

/**
 * Answer `session.tools.getCurrentMetadata` from the conversation's latest
 * captured tool inventory (the same snapshot the chat's tool panel shows).
 * MCP tools carry `mcpServerName`; built-in and CoC tools do not, as in the
 * Copilot runtime. No turn captured yet gives `null`. Schemas are not sent.
 */
export function getCanvasToolMetadata(
    store: Pick<ConversationToolInventoryStore, 'getForProcess'>,
    owner: { workspaceId: string; processId: string },
): CanvasToolMetadataResult {
    const inventory = store.getForProcess(owner.workspaceId, owner.processId)
        ?? (isQueueProcessId(owner.processId) ? store.getForProcess(owner.workspaceId, toTaskId(owner.processId)) : undefined);
    if (inventory?.state !== 'captured') return { tools: null };
    return {
        tools: inventory.snapshot.tools.map(tool => ({
            name: tool.name,
            description: tool.description ?? '',
            ...(tool.source === 'mcp' && tool.serverName ? { mcpServerName: tool.serverName } : {}),
        })),
    };
}
