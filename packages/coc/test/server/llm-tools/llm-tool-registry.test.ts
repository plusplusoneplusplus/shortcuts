/**
 * LLM Tool Registry Tests
 *
 * Tests for the LLM tool registry, default disabled tools, and filtering utilities.
 */

import { describe, it, expect } from 'vitest';
import {
    LLM_TOOL_REGISTRY,
    DEFAULT_DISABLED_LLM_TOOLS,
    CLASSIC_MODE_EXTRA_DISABLED_TOOLS,
    getEffectiveDefaultDisabledTools,
    isLlmToolEnabled,
    filterDisabledLlmTools,
    filterRemovedLlmToolNames,
} from '../../../src/server/llm-tools/llm-tool-registry';

describe('LLM_TOOL_REGISTRY', () => {
    it('contains all expected tools', () => {
        const names = LLM_TOOL_REGISTRY.map(t => t.name);
        expect(names).toContain('suggest_follow_ups');
        expect(names).toContain('search_conversations');
        expect(names).toContain('get_conversation');
        expect(names).toContain('ask_user');
        expect(names).toContain('get_work_item');
        expect(names).toContain('create_update_work_item');
        expect(names).toContain('create_conversation');
        expect(names).not.toContain('create_work_item');
        expect(names).not.toContain('update_work_item');
        expect(names).not.toContain('create_bug');
        expect(names).toContain('memory');
        expect(names).toContain('tavily_web_search');
    });

    it('has unique tool names', () => {
        const names = LLM_TOOL_REGISTRY.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('each tool has required metadata fields', () => {
        for (const tool of LLM_TOOL_REGISTRY) {
            expect(tool.name).toBeTruthy();
            expect(tool.label).toBeTruthy();
            expect(tool.description).toBeTruthy();
            expect(typeof tool.enabledByDefault).toBe('boolean');
        }
    });

    it('tavily_web_search is disabled by default', () => {
        const tavily = LLM_TOOL_REGISTRY.find(t => t.name === 'tavily_web_search');
        expect(tavily).toBeDefined();
        expect(tavily!.enabledByDefault).toBe(false);
    });

    it('create_conversation is opt-in (disabled by default)', () => {
        const entry = LLM_TOOL_REGISTRY.find(t => t.name === 'create_conversation');
        expect(entry).toBeDefined();
        expect(entry!.enabledByDefault).toBe(false);
        // Exactly one registry entry named create_conversation.
        expect(LLM_TOOL_REGISTRY.filter(t => t.name === 'create_conversation')).toHaveLength(1);
    });

    it('all other tools are enabled by default', () => {
        const optIn = new Set(['tavily_web_search', 'create_conversation']);
        const enabledByDefaultTools = LLM_TOOL_REGISTRY.filter(t => !optIn.has(t.name));
        for (const tool of enabledByDefaultTools) {
            expect(tool.enabledByDefault).toBe(true);
        }
    });
});

describe('DEFAULT_DISABLED_LLM_TOOLS', () => {
    it('contains tavily_web_search', () => {
        expect(DEFAULT_DISABLED_LLM_TOOLS).toContain('tavily_web_search');
    });

    it('contains the opt-in create_conversation tool', () => {
        expect(DEFAULT_DISABLED_LLM_TOOLS).toContain('create_conversation');
    });

    it('does not contain enabled-by-default tools', () => {
        for (const tool of LLM_TOOL_REGISTRY.filter(t => t.enabledByDefault)) {
            expect(DEFAULT_DISABLED_LLM_TOOLS).not.toContain(tool.name);
        }
    });
});

describe('getEffectiveDefaultDisabledTools', () => {
    it('disables the work item tool family and web search tools in classic mode', () => {
        expect(getEffectiveDefaultDisabledTools('classic')).toEqual(
            expect.arrayContaining(['get_work_item', 'create_update_work_item', 'tavily_web_search']),
        );
        expect(getEffectiveDefaultDisabledTools('classic')).not.toContain('create_bug');
    });

    it('uses classic mode defaults when layout mode is undefined', () => {
        expect(getEffectiveDefaultDisabledTools(undefined)).toEqual(getEffectiveDefaultDisabledTools('classic'));
    });

    it('uses only registry-level defaults in dev-workflow mode', () => {
        expect(getEffectiveDefaultDisabledTools('dev-workflow')).toEqual(DEFAULT_DISABLED_LLM_TOOLS);
        expect(getEffectiveDefaultDisabledTools('dev-workflow')).not.toContain('get_work_item');
        expect(getEffectiveDefaultDisabledTools('dev-workflow')).not.toEqual(
            expect.arrayContaining(CLASSIC_MODE_EXTRA_DISABLED_TOOLS),
        );
    });
});

describe('filterRemovedLlmToolNames', () => {
    it('drops stale create_bug disabled-tool preferences', () => {
        expect(filterRemovedLlmToolNames(['suggest_follow_ups', 'create_bug', 'memory'])).toEqual([
            'suggest_follow_ups',
            'memory',
        ]);
    });
});

describe('isLlmToolEnabled', () => {
    it('returns true for enabled tools when disabledList is undefined (default)', () => {
        expect(isLlmToolEnabled('suggest_follow_ups', undefined)).toBe(true);
        expect(isLlmToolEnabled('search_conversations', undefined)).toBe(true);
    });

    it('returns false for tavily_web_search when disabledList is undefined (default)', () => {
        expect(isLlmToolEnabled('tavily_web_search', undefined)).toBe(false);
    });

    it('returns false for opt-in create_conversation when disabledList is undefined (default)', () => {
        expect(isLlmToolEnabled('create_conversation', undefined)).toBe(false);
    });

    it('returns true for create_conversation when explicitly enabled (empty disabled list)', () => {
        expect(isLlmToolEnabled('create_conversation', [])).toBe(true);
    });

    it('returns true for tavily_web_search when explicitly enabled (empty disabled list)', () => {
        expect(isLlmToolEnabled('tavily_web_search', [])).toBe(true);
    });

    it('returns false for tools in the disabled list', () => {
        expect(isLlmToolEnabled('suggest_follow_ups', ['suggest_follow_ups', 'memory'])).toBe(false);
        expect(isLlmToolEnabled('memory', ['suggest_follow_ups', 'memory'])).toBe(false);
    });

    it('returns true for tools not in the disabled list', () => {
        expect(isLlmToolEnabled('ask_user', ['suggest_follow_ups'])).toBe(true);
    });

    it('handles unknown tool names gracefully', () => {
        expect(isLlmToolEnabled('unknown_tool', undefined)).toBe(true);
        expect(isLlmToolEnabled('unknown_tool', ['unknown_tool'])).toBe(false);
    });

    it('treats removed create_bug as disabled', () => {
        expect(isLlmToolEnabled('create_bug', undefined)).toBe(false);
        expect(isLlmToolEnabled('create_bug', [])).toBe(false);
    });
});

describe('filterDisabledLlmTools', () => {
    const mockTools = [
        { name: 'suggest_follow_ups', handler: () => {} },
        { name: 'tavily_web_search', handler: () => {} },
        { name: 'memory', handler: () => {} },
    ];

    it('filters out disabled-by-default tools when disabledList is undefined', () => {
        const filtered = filterDisabledLlmTools(mockTools, undefined);
        const names = filtered.map(t => t.name);
        expect(names).toContain('suggest_follow_ups');
        expect(names).toContain('memory');
        expect(names).not.toContain('tavily_web_search');
    });

    it('keeps all tools when disabled list is empty', () => {
        const filtered = filterDisabledLlmTools(mockTools, []);
        expect(filtered).toHaveLength(3);
    });

    it('removes only explicitly disabled tools', () => {
        const filtered = filterDisabledLlmTools(mockTools, ['memory']);
        const names = filtered.map(t => t.name);
        expect(names).toContain('suggest_follow_ups');
        expect(names).toContain('tavily_web_search');
        expect(names).not.toContain('memory');
    });

    it('handles empty tools array', () => {
        const filtered = filterDisabledLlmTools([], ['memory']);
        expect(filtered).toHaveLength(0);
    });

    it('preserves tool objects by reference', () => {
        const filtered = filterDisabledLlmTools(mockTools, ['tavily_web_search']);
        expect(filtered[0]).toBe(mockTools[0]);
        expect(filtered[1]).toBe(mockTools[2]);
    });

    it('removes stale create_bug tools even when explicitly enabled', () => {
        const filtered = filterDisabledLlmTools([
            { name: 'create_update_work_item', handler: () => {} },
            { name: 'create_bug', handler: () => {} },
        ], []);

        expect(filtered.map(t => t.name)).toEqual(['create_update_work_item']);
    });
});

describe('getEffectiveLlmToolRegistry', () => {
    it('filters out scheduleWakeup when loopsEnabled is false', async () => {
        const { getEffectiveLlmToolRegistry } = await import('../../../src/server/llm-tools/llm-tool-registry');
        const names = getEffectiveLlmToolRegistry({ loopsEnabled: false }).map(t => t.name);
        expect(names).not.toContain('scheduleWakeup');
    });

    it('filters out scheduleWakeup when loopsEnabled is omitted (default off)', async () => {
        const { getEffectiveLlmToolRegistry } = await import('../../../src/server/llm-tools/llm-tool-registry');
        const names = getEffectiveLlmToolRegistry().map(t => t.name);
        expect(names).not.toContain('scheduleWakeup');
    });

    it('includes scheduleWakeup when loopsEnabled is true', async () => {
        const { getEffectiveLlmToolRegistry } = await import('../../../src/server/llm-tools/llm-tool-registry');
        const names = getEffectiveLlmToolRegistry({ loopsEnabled: true, excalidrawEnabled: true, canvasEnabled: true }).map(t => t.name);
        expect(names).toContain('scheduleWakeup');
        // Should equal the full registry length when all flags on
        expect(getEffectiveLlmToolRegistry({ loopsEnabled: true, excalidrawEnabled: true, canvasEnabled: true })).toHaveLength(LLM_TOOL_REGISTRY.length);
    });

    it('filters out excalidraw tools when excalidrawEnabled is false', async () => {
        const { getEffectiveLlmToolRegistry } = await import('../../../src/server/llm-tools/llm-tool-registry');
        const names = getEffectiveLlmToolRegistry({ excalidrawEnabled: false }).map(t => t.name);
        expect(names).not.toContain('create_or_update_excalidraw');
        expect(names).not.toContain('read_excalidraw');
    });

    it('includes excalidraw tools when excalidrawEnabled is true', async () => {
        const { getEffectiveLlmToolRegistry } = await import('../../../src/server/llm-tools/llm-tool-registry');
        const names = getEffectiveLlmToolRegistry({ excalidrawEnabled: true }).map(t => t.name);
        expect(names).toContain('create_or_update_excalidraw');
        expect(names).toContain('read_excalidraw');
    });

    it('returns registry minus feature-gated entries when all off', async () => {
        const { getEffectiveLlmToolRegistry } = await import('../../../src/server/llm-tools/llm-tool-registry');
        // scheduleWakeup + 2 excalidraw tools + 3 canvas tools = 6 filtered
        expect(getEffectiveLlmToolRegistry({ loopsEnabled: false, excalidrawEnabled: false, canvasEnabled: false })).toHaveLength(LLM_TOOL_REGISTRY.length - 6);
    });

    it('filters out canvas tools when canvasEnabled is false', async () => {
        const { getEffectiveLlmToolRegistry } = await import('../../../src/server/llm-tools/llm-tool-registry');
        const names = getEffectiveLlmToolRegistry({ canvasEnabled: false }).map(t => t.name);
        expect(names).not.toContain('write_canvas');
        expect(names).not.toContain('read_canvas');
        expect(names).not.toContain('extension_canvas');
    });

    it('includes canvas tools when canvasEnabled is true', async () => {
        const { getEffectiveLlmToolRegistry } = await import('../../../src/server/llm-tools/llm-tool-registry');
        const names = getEffectiveLlmToolRegistry({ canvasEnabled: true }).map(t => t.name);
        expect(names).toContain('write_canvas');
        expect(names).toContain('read_canvas');
        expect(names).toContain('extension_canvas');
    });
});
