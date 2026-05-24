import { describe, it, expect } from 'vitest';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';

describe('defineTool', () => {
    it('returns a tool with name merged from the first arg', () => {
        const tool = defineTool('my_tool', { handler: async () => 'ok' });
        expect(tool.name).toBe('my_tool');
        expect(typeof tool.handler).toBe('function');
    });

    it('preserves description and parameters', () => {
        const tool = defineTool('t', {
            description: 'desc',
            parameters: { type: 'object', properties: {} },
            handler: async () => 'ok',
        });
        expect(tool.description).toBe('desc');
        expect(tool.parameters).toEqual({ type: 'object', properties: {} });
    });

    it('passes through overridesBuiltInTool flag', () => {
        const tool = defineTool('ask_user', {
            handler: async () => 'ok',
            overridesBuiltInTool: true,
        });
        expect(tool.overridesBuiltInTool).toBe(true);
    });

    it('passes through skipPermission flag', () => {
        const tool = defineTool('my_tool', {
            handler: async () => 'ok',
            skipPermission: true,
        });
        expect(tool.skipPermission).toBe(true);
    });

    it('omits override flags when not specified', () => {
        const tool = defineTool('plain', { handler: async () => 'ok' });
        expect(tool.overridesBuiltInTool).toBeUndefined();
        expect(tool.skipPermission).toBeUndefined();
    });
});
