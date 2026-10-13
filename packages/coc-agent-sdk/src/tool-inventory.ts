/** Safe, bounded runtime descriptors. These contain no executable tool objects. */
export type ToolInventorySource = 'builtin' | 'coc' | 'mcp';
export interface ToolInventoryDescriptor {
    name: string;
    source: ToolInventorySource;
    serverName?: string;
    description?: string;
    inputSchema?: Record<string, unknown> | boolean;
}
export interface ToolInventoryCategory {
    source: ToolInventorySource;
    status: 'complete' | 'partial' | 'unavailable';
    reason?: string;
}
export interface RuntimeToolInventory {
    version: 1;
    provider: string;
    capturedAt: string;
    tools: ToolInventoryDescriptor[];
    categories: ToolInventoryCategory[];
    truncated: boolean;
}

export const TOOL_INVENTORY_MAX_TOOLS = 512;
export const TOOL_INVENTORY_MAX_BYTES = 1024 * 1024;
const MAX_SCHEMA_BYTES = 64 * 1024;

/** Reject non-JSON data without invoking getters, toJSON, or schema handlers. */
function cloneJson(value: unknown, budget: { nodes: number }, depth = 0): unknown {
    if (++budget.nodes > 10000 || depth > 32) throw new Error('Schema limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string' && value.length <= MAX_SCHEMA_BYTES) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object') throw new Error('Non-JSON schema');
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new Error('Non-JSON schema');
    if (Array.isArray(value) && value.length > 10000) throw new Error('Schema limit');
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!property.enumerable) continue;
        if (!('value' in property) || key.length > MAX_SCHEMA_BYTES || key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Unsafe schema');
        Object.defineProperty(result, key, { value: cloneJson(property.value, budget, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return result;
}

/** Project descriptor fields explicitly; unknown fields never reach storage or the UI. */
export function createRuntimeToolInventory(
    provider: string,
    descriptors: readonly ToolInventoryDescriptor[],
    categories: readonly ToolInventoryCategory[],
): RuntimeToolInventory {
    const inventory: RuntimeToolInventory = {
        version: 1, provider, capturedAt: new Date().toISOString(), tools: [],
        categories: categories.map(({ source, status, reason }) => ({ source, status, ...(reason ? { reason } : {}) })),
        truncated: false,
    };
    const markPartial = (source: ToolInventorySource) => {
        inventory.truncated = true;
        const category = inventory.categories.find(c => c.source === source);
        if (category && category.status !== 'unavailable') {
            category.status = 'partial';
            category.reason = 'Some descriptors were omitted or truncated by inventory safety limits.';
        }
    };
    // Include metadata and reserve the bounded array's commas in the byte budget.
    let bytes = Buffer.byteLength(JSON.stringify(inventory)) + TOOL_INVENTORY_MAX_TOOLS + 1024;
    for (const raw of descriptors) {
        try {
            if (!['builtin', 'coc', 'mcp'].includes(raw.source) || typeof raw.name !== 'string' || !raw.name || raw.name.length > 512) throw new Error('Invalid descriptor');
            if (inventory.tools.length >= TOOL_INVENTORY_MAX_TOOLS) { markPartial(raw.source); continue; }
            const tool: ToolInventoryDescriptor = { name: raw.name, source: raw.source };
            if (raw.source === 'mcp') {
                if (typeof raw.serverName !== 'string' || !raw.serverName || raw.serverName.length > 512) throw new Error('Invalid server');
                tool.serverName = raw.serverName;
            }
            if (raw.description !== undefined) {
                if (typeof raw.description !== 'string') throw new Error('Invalid description');
                tool.description = raw.description.slice(0, 16384);
                if (tool.description.length !== raw.description.length) markPartial(raw.source);
            }
            if (raw.inputSchema !== undefined) {
                if (typeof raw.inputSchema !== 'boolean' && (!raw.inputSchema || typeof raw.inputSchema !== 'object' || Array.isArray(raw.inputSchema))) throw new Error('Invalid schema');
                const schema = cloneJson(raw.inputSchema, { nodes: 0 }) as Record<string, unknown> | boolean;
                if (Buffer.byteLength(JSON.stringify(schema)) > MAX_SCHEMA_BYTES) throw new Error('Schema limit');
                tool.inputSchema = schema;
            }
            const size = Buffer.byteLength(JSON.stringify(tool));
            if (bytes + size > TOOL_INVENTORY_MAX_BYTES) { markPartial(raw.source); continue; }
            inventory.tools.push(tool);
            bytes += size;
        } catch {
            markPartial(raw.source);
        }
    }
    return inventory;
}

export function unavailableToolInventory(provider: string): RuntimeToolInventory {
    return createRuntimeToolInventory(provider, [], (['builtin', 'coc', 'mcp'] as const).map(source => ({
        source, status: 'unavailable', reason: 'The provider could not report its initialized runtime catalog.',
    })));
}
