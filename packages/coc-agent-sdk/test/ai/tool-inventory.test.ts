import { describe, expect, it, vi } from 'vitest';
import type { CopilotSession } from '@github/copilot-sdk';
import { captureCopilotToolInventory } from '../../src/copilot-tool-inventory';
import { createRuntimeToolInventory, TOOL_INVENTORY_MAX_TOOLS, type ToolInventoryDescriptor } from '../../src/tool-inventory';

const categories = (['builtin', 'coc', 'mcp'] as const).map(source => ({ source, status: 'complete' as const }));
const capture = (tools: ToolInventoryDescriptor[]) => createRuntimeToolInventory('copilot', tools, categories);
const descriptor: ToolInventoryDescriptor = {
    name: 'never_called', source: 'coc', description: 'Available even without a call',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } } },
};

describe('runtime inventory safety', () => {
    it('copies only descriptor data and keeps absent schemas absent', () => {
        const raw = { ...descriptor, handler: vi.fn(), env: { TOKEN: 'secret' }, headers: { Authorization: 'secret' }, arguments: { secret: true } };
        const result = capture([raw, { name: 'schema_unknown', source: 'builtin' }]);
        expect(result.tools).toEqual([descriptor, { name: 'schema_unknown', source: 'builtin' }]);
        expect(JSON.stringify(result)).not.toContain('secret');
        expect(result.tools[0].inputSchema).not.toBe(raw.inputSchema);
        expect(raw.handler).not.toHaveBeenCalled();
        expect(result.truncated).toBe(false);
    });

    it.each([
        { callback: () => 'secret' },
        { secret: undefined },
        { number: Infinity },
        { date: new Date() },
        { items: new Array(10001) },
        JSON.parse('{"__proto__":{"polluted":true}}'),
    ])('rejects unsafe schema data and marks the affected category partial', inputSchema => {
        const result = capture([{ ...descriptor, inputSchema }]);
        expect(result.tools).toEqual([]);
        expect(result.truncated).toBe(true);
        expect(result.categories.find(c => c.source === 'coc')?.status).toBe('partial');
        expect(categories.every(c => c.status === 'complete')).toBe(true);
    });

    it('rejects cyclic schemas and accessors without invoking them', () => {
        const schema: Record<string, unknown> = {};
        schema.self = schema;
        const getter = vi.fn(() => 'secret');
        const accessor = Object.defineProperty({}, 'value', { get: getter, enumerable: true });
        expect(capture([{ ...descriptor, inputSchema: schema }, { ...descriptor, inputSchema: accessor }]).tools).toEqual([]);
        expect(getter).not.toHaveBeenCalled();
    });

    it('bounds tool count, descriptions and schema size, with visible truncation', () => {
        const result = capture(Array.from({ length: TOOL_INVENTORY_MAX_TOOLS + 1 }, (_, i) => ({ ...descriptor, name: `tool_${i}` })));
        expect(result.tools).toHaveLength(TOOL_INVENTORY_MAX_TOOLS);
        expect(result.truncated).toBe(true);
        const long = capture([{ ...descriptor, description: 'x'.repeat(20000) }, { ...descriptor, inputSchema: { description: 'x'.repeat(70000) } }]);
        expect(long.tools).toHaveLength(1);
        expect(long.tools[0].description).toHaveLength(16384);
        expect(long.categories.find(c => c.source === 'coc')?.status).toBe('partial');
    });

    it('keeps actual schema property names and boolean schemas', () => {
        expect(capture([{ ...descriptor, inputSchema: false }]).tools[0].inputSchema).toBe(false);
        const inputSchema = { type: 'object', properties: { env: { type: 'string' }, headers: { type: 'object' } } };
        expect(capture([{ ...descriptor, inputSchema }]).tools[0].inputSchema).toEqual(inputSchema);
    });

    it('bounds the whole serialized inventory and preserves partial state', () => {
        const result = capture(Array.from({ length: 512 }, (_, i) => ({ ...descriptor, name: `tool_${i}`, description: 'x'.repeat(16384) })));
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024 * 1024);
        expect(result.truncated).toBe(true);
        expect(result.categories.find(c => c.source === 'coc')?.status).toBe('partial');
    });
});

describe('Copilot runtime discovery', () => {
    function session(tools: unknown) {
        return { rpc: { tools: { initializeAndValidate: vi.fn().mockResolvedValue({}), getCurrentMetadata: vi.fn().mockResolvedValue({ tools }) } } };
    }
    it('initializes then reports effective built-in, CoC and MCP tools, including unused ones', async () => {
        const active = session([
            { name: 'read', description: 'Read', input_schema: { type: 'object' } },
            { name: 'never_called', description: 'Available' },
            { name: 'remote_search', mcpServerName: 'search', description: 'Search', input_schema: { type: 'object' } },
        ]);
        const inventory = await captureCopilotToolInventory(active as unknown as CopilotSession, [{ name: 'never_called' }, { name: 'filtered_out' }]);
        expect(active.rpc.tools.initializeAndValidate.mock.invocationCallOrder[0]).toBeLessThan(active.rpc.tools.getCurrentMetadata.mock.invocationCallOrder[0]);
        expect(inventory.tools.map(t => [t.name, t.source, t.serverName])).toEqual([
            ['read', 'builtin', undefined], ['never_called', 'coc', undefined], ['remote_search', 'mcp', 'search'],
        ]);
        expect(inventory.categories.find(c => c.source === 'mcp')?.status).toBe('partial');
        expect(inventory.capturedAt).toMatch(/^\d{4}-/);
    });

    it('does not substitute configured tools when discovery is missing or uninitialized', async () => {
        for (const active of [{}, session(null)]) {
            const inventory = await captureCopilotToolInventory(active as CopilotSession, [{ name: 'configured_only' }]);
            expect(inventory.tools).toEqual([]);
            expect(inventory.categories.every(c => c.status === 'unavailable')).toBe(true);
        }
    });

    it('does not leak provider errors', async () => {
        const active = session([]);
        active.rpc.tools.initializeAndValidate.mockRejectedValue(new Error('Bearer secret connection command'));
        const inventory = await captureCopilotToolInventory(active as unknown as CopilotSession, []);
        expect(JSON.stringify(inventory)).not.toContain('secret');
        expect(inventory.categories.every(c => c.status === 'unavailable')).toBe(true);
    });

    it('bounds discovery and ignores late metadata after timeout', async () => {
        vi.useFakeTimers();
        try {
            const active = session([]);
            active.rpc.tools.getCurrentMetadata.mockReturnValue(new Promise(() => {}));
            const pending = captureCopilotToolInventory(active as unknown as CopilotSession, [], undefined, 100);
            await vi.advanceTimersByTimeAsync(100);
            expect((await pending).tools).toEqual([]);
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });

    it('stops awaiting discovery on abort and removes listeners', async () => {
        const active = session([]);
        active.rpc.tools.initializeAndValidate.mockReturnValue(new Promise(() => {}));
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const pending = captureCopilotToolInventory(active as unknown as CopilotSession, [], controller.signal);
        controller.abort();
        expect((await pending).categories.every(c => c.status === 'unavailable')).toBe(true);
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('does not request metadata when initialization completes after its deadline', async () => {
        vi.useFakeTimers();
        try {
            const active = session([]);
            let finish!: (value: unknown) => void;
            active.rpc.tools.initializeAndValidate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
            const pending = captureCopilotToolInventory(active as unknown as CopilotSession, [], undefined, 100);
            await vi.advanceTimersByTimeAsync(100);
            expect((await pending).categories.every(c => c.status === 'unavailable')).toBe(true);
            finish({});
            await vi.advanceTimersByTimeAsync(0);
            expect(active.rpc.tools.getCurrentMetadata).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });
});
