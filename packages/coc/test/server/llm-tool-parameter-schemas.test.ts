/**
 * LLM tool parameter schema map tests
 *
 * Covers the display-only mirror of tool input schemas
 * (`LLM_TOOL_PARAMETER_SCHEMAS`) and the `withToolParameterMetadata` helper
 * that attaches the additive `params` summary to registry metadata.
 *
 * Includes a drift guard: for every tool that is cheap to construct, the
 * summary derived from the mirror must equal the summary derived from the
 * tool's live `parameters` schema, so the mirror cannot silently drift.
 */

import { describe, it, expect } from 'vitest';
import {
    LLM_TOOL_PARAMETER_SCHEMAS,
    withToolParameterMetadata,
} from '../../src/server/llm-tools/llm-tool-parameter-schemas';
import { summarizeToolParameters } from '../../src/server/llm-tools/llm-tool-parameters';
import { LLM_TOOL_REGISTRY, type LlmToolMeta } from '../../src/server/llm-tools/llm-tool-registry';
import { createSuggestFollowUpsTool } from '../../src/server/llm-tools/suggest-follow-ups-tool';
import { createSearchConversationsTool } from '../../src/server/llm-tools/search-conversations-tool';
import { createGetConversationTool } from '../../src/server/llm-tools/get-conversation-tool';
import { createCreateConversationTool } from '../../src/server/llm-tools/create-conversation-tool';
import { createScheduleWakeupTool } from '../../src/server/llm-tools/loop-tools';
import { createAskUserTool } from '../../src/server/llm-tools/ask-user-tool';
import { createMemoryStoreFactTool, createMemoryRecallTool } from '../../src/server/llm-tools/memory-v2-tools';

/**
 * Registry tools that intentionally have no locally-declared schema and so
 * should render "parameters unavailable" rather than appear in the mirror.
 */
const SCHEMA_EXCLUDED_TOOLS = new Set<string>(['memory']);

describe('LLM_TOOL_PARAMETER_SCHEMAS', () => {
    it('covers every registry tool except the documented exclusions', () => {
        for (const tool of LLM_TOOL_REGISTRY) {
            const inMap = Object.prototype.hasOwnProperty.call(LLM_TOOL_PARAMETER_SCHEMAS, tool.name);
            if (SCHEMA_EXCLUDED_TOOLS.has(tool.name)) {
                expect(inMap, `${tool.name} should be excluded from the schema mirror`).toBe(false);
            } else {
                expect(inMap, `${tool.name} is missing from the schema mirror`).toBe(true);
            }
        }
    });

    it('has no stale entries for tools that left the registry', () => {
        const registryNames = new Set(LLM_TOOL_REGISTRY.map(t => t.name));
        for (const name of Object.keys(LLM_TOOL_PARAMETER_SCHEMAS)) {
            expect(registryNames.has(name), `${name} in the mirror is not a registered tool`).toBe(true);
        }
    });

    it('every mirrored schema summarizes to a usable param list', () => {
        for (const [name, schema] of Object.entries(LLM_TOOL_PARAMETER_SCHEMAS)) {
            const params = summarizeToolParameters(schema);
            expect(params, `${name} should produce a param array`).toBeDefined();
            expect(Array.isArray(params)).toBe(true);
        }
    });
});

describe('withToolParameterMetadata', () => {
    it('attaches a params summary to tools that have a mirrored schema', () => {
        const meta: LlmToolMeta = {
            name: 'suggest_follow_ups',
            label: 'Follow-Up Suggestions',
            description: 'desc',
            enabledByDefault: true,
        };
        const [result] = withToolParameterMetadata([meta]);
        expect(result.params).toEqual([{ name: 'suggestions', type: '[...]', required: true }]);
    });

    it('omits params for tools without a mirrored schema', () => {
        const meta: LlmToolMeta = {
            name: 'memory',
            label: 'Memory',
            description: 'desc',
            enabledByDefault: true,
        };
        const [result] = withToolParameterMetadata([meta]);
        expect(result.params).toBeUndefined();
        expect('params' in result).toBe(false);
    });

    it('preserves all existing contract fields and does not mutate the input', () => {
        const input: LlmToolMeta[] = [
            { name: 'example_tool', label: 'Example Tool', description: 'd', enabledByDefault: false },
        ];
        const frozenSnapshot = JSON.stringify(input);
        const [result] = withToolParameterMetadata(input);
        expect(result.name).toBe('example_tool');
        expect(result.label).toBe('Example Tool');
        expect(result.description).toBe('d');
        expect(result.enabledByDefault).toBe(false);
        // Input is untouched (no params field added in place).
        expect(JSON.stringify(input)).toBe(frozenSnapshot);
        expect(result).not.toBe(input[0]);
    });

    it('preserves registry order', () => {
        const result = withToolParameterMetadata(LLM_TOOL_REGISTRY);
        expect(result.map(t => t.name)).toEqual(LLM_TOOL_REGISTRY.map(t => t.name));
    });
});

describe('schema mirror drift guard', () => {
    // Tools whose factories are side-effect-free to construct (no fs/store
    // instantiation) so we can read their live `parameters` and compare.
    const liveSchemas: Array<{ name: string; parameters: unknown }> = [
        { name: 'suggest_follow_ups', parameters: createSuggestFollowUpsTool().parameters },
        { name: 'search_conversations', parameters: createSearchConversationsTool({} as any).tool.parameters },
        { name: 'get_conversation', parameters: createGetConversationTool({} as any).tool.parameters },
        { name: 'create_conversation', parameters: createCreateConversationTool({} as any).tool.parameters },
        { name: 'scheduleWakeup', parameters: createScheduleWakeupTool({} as any).tool.parameters },
        { name: 'ask_user', parameters: createAskUserTool({} as any).tool.parameters },
        { name: 'save_memory', parameters: createMemoryStoreFactTool({} as any).tool.parameters },
        { name: 'recall_memory', parameters: createMemoryRecallTool({} as any).tool.parameters },
    ];

    it.each(liveSchemas)('mirror for $name matches the live tool schema summary', ({ name, parameters }) => {
        const mirrored = summarizeToolParameters(LLM_TOOL_PARAMETER_SCHEMAS[name]);
        const live = summarizeToolParameters(parameters);
        expect(live).toBeDefined();
        expect(mirrored).toEqual(live);
    });
});
