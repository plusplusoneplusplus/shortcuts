/**
 * Provider-neutral CoC LLM-tool runtime + MCP bridge wiring.
 *
 * This module adapts the existing Copilot SDK-native `Tool<any>[]` bundle into a
 * provider-neutral shape so the same CoC tools can be exposed to Codex and
 * Claude through MCP, not just to Copilot through native tools.
 */

export {
    CocToolRuntime,
    resolveInputSchema,
    normalizeToolResult,
    errorResult,
} from './coc-tool-runtime';

export type {
    RuntimeToolDescriptor,
    RuntimeToolResult,
    RuntimeToolResultContent,
    CocToolRuntimeContext,
} from './coc-tool-runtime';
