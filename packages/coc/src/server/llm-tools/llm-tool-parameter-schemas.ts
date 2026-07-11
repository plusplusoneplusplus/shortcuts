/**
 * LLM tool parameter schemas (display-only mirror)
 *
 * A compact, structural mirror of each toggleable LLM tool's input-schema
 * `parameters`, used purely to derive the additive `params` display metadata
 * surfaced on the workspace LLM Tools settings page.
 *
 * Why a mirror instead of importing the live schemas?
 *  - The real schemas are declared inline inside each `defineTool()` call, and
 *    several factories build heavyweight dependencies at construction time
 *    (e.g. `create_update_work_item` instantiates a `FileWorkItemStore`). The
 *    settings route must NOT instantiate tools just to read a schema.
 *  - This module is display-only: it never affects tool execution, validation,
 *    provider routing, or persisted preferences (per the feature's scope).
 *
 * Only the structure the compact summary cares about is mirrored — property
 * names, JSON-schema `type`, and the `required` list. Descriptions, defaults,
 * enums, and bounds are intentionally omitted because `summarizeToolParameters`
 * ignores them.
 *
 * KEEP IN SYNC: when a tool's `parameters` gains/loses a property or changes a
 * property's type or required-ness, update the matching entry here. The
 * `llm-tool-parameter-schemas` drift-guard test compares the summaries derived
 * here against the live tool schemas for every tool that is cheap to construct.
 *
 * Tools with no entry here (e.g. the built-in `memory` tool, whose schema is
 * not declared locally) intentionally render as "parameters unavailable".
 */

import type { LlmToolMeta } from './llm-tool-registry';
import { summarizeToolParameters } from './llm-tool-parameters';

/**
 * Mirror of each tool's input-schema structure, keyed by the tool name as
 * registered in {@link LLM_TOOL_REGISTRY}.
 */
export const LLM_TOOL_PARAMETER_SCHEMAS: Record<string, Record<string, unknown>> = {
    suggest_follow_ups: {
        type: 'object',
        properties: {
            suggestions: { type: 'array', items: { type: 'string' } },
        },
        required: ['suggestions'],
    },
    search_conversations: {
        type: 'object',
        properties: {
            query: { type: 'string' },
            workspaceId: { type: 'string' },
            since: { type: 'string' },
            until: { type: 'string' },
            limit: { type: 'number' },
            offset: { type: 'number' },
            summarize: { type: 'boolean' },
        },
        required: [],
    },
    get_conversation: {
        type: 'object',
        properties: {
            processId: { type: 'string' },
            maxChars: { type: 'number' },
            includeToolCalls: { type: 'boolean' },
            fromTurn: { type: 'number' },
            toTurn: { type: 'number' },
        },
        required: ['processId'],
    },
    send_to_conversation: {
        type: 'object',
        properties: {
            content: { type: 'string' },
            processId: { type: 'string' },
            workspaceId: { type: 'string' },
            mode: { type: 'string' },
            deliveryMode: { type: 'string' },
            title: { type: 'string' },
            model: { type: 'string' },
            provider: { type: 'string' },
            effortTier: { type: 'string' },
            priority: { type: 'string' },
        },
        required: ['content'],
    },
    ask_user: {
        type: 'object',
        properties: {
            questions: { type: 'array', items: { type: 'object' } },
        },
        required: ['questions'],
    },
    get_work_item: {
        type: 'object',
        properties: {
            workItemId: { type: 'string' },
            target: { type: 'string' },
            workItemNumber: { oneOf: [{ type: 'number' }, { type: 'string' }] },
        },
        required: [],
    },
    create_update_work_item: {
        type: 'object',
        properties: {
            workItemId: { type: 'string' },
            target: { type: 'string' },
            workItemNumber: { oneOf: [{ type: 'number' }, { type: 'string' }] },
            type: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string' },
            status: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            plan: { type: 'string' },
            summary: { type: 'string' },
            parentId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            parentTarget: { type: 'string' },
            parentWorkItemNumber: { oneOf: [{ type: 'number' }, { type: 'string' }] },
        },
        required: [],
    },
    save_memory: {
        type: 'object',
        properties: {
            content: { type: 'string' },
            importance: { type: 'number' },
            tags: { type: 'array', items: { type: 'string' } },
            target: { type: 'string' },
        },
        required: ['content'],
    },
    recall_memory: {
        type: 'object',
        properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
        },
        required: ['query'],
    },
    scheduleWakeup: {
        type: 'object',
        properties: {
            prompt: { type: 'string' },
            delay: { type: ['string', 'number'] },
            model: { type: 'string' },
        },
        required: ['prompt', 'delay'],
    },
    write_canvas: {
        type: 'object',
        properties: {
            canvasId: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            edits: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        oldText: { type: 'string' },
                        newText: { type: 'string' },
                    },
                    required: ['oldText', 'newText'],
                },
            },
            type: { type: 'string' },
            language: { type: 'string' },
            expectedRevision: { type: 'number' },
        },
        required: [],
    },
    read_canvas: {
        type: 'object',
        properties: {
            canvasId: { type: 'string' },
        },
        required: ['canvasId'],
    },
    extension_canvas: {
        type: 'object',
        properties: {
            canvasId: { type: 'string' },
            capability: { type: 'string' },
            params: { type: 'object' },
            title: { type: 'string' },
            description: { type: 'string' },
            capabilities: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        description: { type: 'string' },
                        paramsDescription: { type: 'string' },
                    },
                    required: ['name', 'description'],
                },
            },
            capabilitiesJs: { type: 'string' },
            uiHtml: { type: 'string' },
            initialState: { type: 'object' },
        },
        required: [],
    },
    tavily_web_search: {
        type: 'object',
        properties: {
            query: { type: 'string' },
            searchDepth: { type: 'string' },
            topic: { type: 'string' },
            maxResults: { type: 'number' },
            includeAnswer: { type: 'boolean' },
            includeRawContent: { type: 'boolean' },
            includeDomains: { type: 'array', items: { type: 'string' } },
            excludeDomains: { type: 'array', items: { type: 'string' } },
            days: { type: 'number' },
        },
        required: ['query'],
    },
};

/**
 * Return a shallow copy of each tool meta augmented with the additive,
 * display-only `params` summary derived from {@link LLM_TOOL_PARAMETER_SCHEMAS}.
 *
 * - When a schema is available, `params` is attached (an empty array means the
 *   tool declares no parameters).
 * - When no schema is available (no map entry), `params` is left absent so
 *   clients render "parameters unavailable".
 *
 * The returned metas are fresh objects; the input registry is not mutated.
 */
export function withToolParameterMetadata(tools: readonly LlmToolMeta[]): LlmToolMeta[] {
    return tools.map((tool) => {
        const schema = LLM_TOOL_PARAMETER_SCHEMAS[tool.name];
        if (schema === undefined) {
            return { ...tool };
        }
        const params = summarizeToolParameters(schema);
        return params === undefined ? { ...tool } : { ...tool, params };
    });
}
