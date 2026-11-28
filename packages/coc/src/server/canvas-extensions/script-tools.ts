import { RUN_TOOL_SCRIPT_TOOL_NAME } from '@plusplusoneplusplus/coc-agent-sdk';
import { LLM_TOOL_REGISTRY, isScriptableLlmTool } from '../llm-tools/llm-tool-registry';
export const MAX_HOST_SCRIPT_RESULT_BYTES = 16 * 1024 * 1024;
export const MAX_EXTENSION_SCRIPT_TOOLS = 16;
const READ_ONLY_TOOL_NAMES = new Set(LLM_TOOL_REGISTRY.filter(tool => tool.readOnly === true).map(tool => tool.name));
const REGISTERED_TOOL_NAMES = new Set(LLM_TOOL_REGISTRY.map(tool => tool.name));

/** Whether a canvas script may call this tool: registered, scriptable, read-only, not `run_tool_script`. */
export function isExtensionScriptTool(name: string): boolean {
    return name !== RUN_TOOL_SCRIPT_TOOL_NAME && isScriptableLlmTool(name) && READ_ONLY_TOOL_NAMES.has(name);
}

/** Validate an extension's declared script tools. Absent is valid and means no tool access. */
export function validateExtensionScriptTools(tools: unknown): { ok: true; tools: string[] } | { ok: false; error: string } {
    if (tools === undefined || tools === null) {return { ok: true, tools: [] }; }
    if (!Array.isArray(tools) || tools.some(name => typeof name !== 'string')) {
        return { ok: false, error: 'tools must be an array of tool names' };
    }
    if (tools.length > MAX_EXTENSION_SCRIPT_TOOLS) {
        return { ok: false, error: `tools may list at most ${MAX_EXTENSION_SCRIPT_TOOLS} names` };
    }
    const seen = new Set<string>();
    for (const name of tools as string[]) {
        if (seen.has(name)) {return { ok: false, error: `tools lists "${name}" more than once` }; }
        seen.add(name);
        if (name === RUN_TOOL_SCRIPT_TOOL_NAME) {
            return { ok: false, error: 'tools cannot include run_tool_script — canvas scripts do not nest' };
        }
        if (!REGISTERED_TOOL_NAMES.has(name)) {return { ok: false, error: `tools: unknown tool "${name}"` }; }
        if (!isScriptableLlmTool(name)) {return { ok: false, error: `tools: "${name}" cannot be called from a script` }; }
        if (!READ_ONLY_TOOL_NAMES.has(name)) {
            return { ok: false, error: `tools: "${name}" is not read-only — canvas scripts may only call read-only tools` };
        }
    }
    return { ok: true, tools: [...seen] };
}
