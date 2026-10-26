/**
 * Factory for `run_tool_script`: the model writes a short JavaScript script
 * that calls CoC tools as async functions, and only the script's return value
 * (plus console output and a per-call summary) comes back into context.
 *
 * The tool is built from the turn's FINAL tool list — after preference
 * filtering and the approval gate — so a script can only reach tools that are
 * enabled for this repo and mode, and gated tools still ask the user. The
 * engine (worker, budget, depth, abort) lives in coc-agent-sdk's
 * `runToolScript`; this file only adapts it to a CoC tool.
 *
 * Gated by the `features.toolScripting` admin flag at the addon level.
 */

import {
    CocToolRuntime,
    defineTool,
    MAX_CALLS_PER_SCRIPT,
    MAX_IN_FLIGHT_PER_SCRIPT,
    MAX_SCRIPT_DEPTH,
    RUN_TOOL_SCRIPT_TOOL_NAME,
    runToolScript,
    toModelPayload,
    type Tool,
    type ToolEvent,
    type ToolInvocation,
} from '@plusplusoneplusplus/coc-agent-sdk';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { createMcpScriptTools, MCP_CALL_TOOL_NAME, type McpScriptScope } from './mcp-script-tools';

export interface RunToolScriptToolDeps {
    /** The scriptable tools of this turn (already filtered and approval-gated). */
    tools: Tool<any>[];
    workspaceId?: string;
    processId?: string;
    /** Turn abort signal; combined with the invocation's own signal. */
    signal?: AbortSignal;
    /** Receives inner-call events so the timeline nests them under the script. */
    onNestedToolEvent?: (event: ToolEvent) => void;
    /** The turn's MCP clients; adds `mcp_list_tools` / `mcp_call` when it has servers. */
    mcp?: McpScriptScope;
    /** Applies the turn's approval gate to the MCP pair. */
    gateMcpTools?: (tools: Tool<any>[]) => Tool<any>[];
}

interface RunToolScriptArgs {
    code?: unknown;
}

export function buildRunToolScriptDescription(toolNames: readonly string[], mcpServerNames: readonly string[] = []): string {
    const callable = [...toolNames, RUN_TOOL_SCRIPT_TOOL_NAME].map(name => `tools.${name}`).join(', ');
    const mcpCall = toolNames.includes(MCP_CALL_TOOL_NAME)
        ? ' and tools.mcp_call({ server, tool, args }) to call one (resolves to its text, parsed as JSON when possible)'
        : '';
    const mcp = mcpServerNames.length > 0
        ? `MCP servers: ${mcpServerNames.join(', ')}; use tools.mcp_list_tools({ server }) to see their tools${mcpCall}. `
        : '';
    return 'Run a JavaScript script that calls CoC tools as async functions and returns only what you `return`. '
        + 'Use it for loops, filtering, or fan-out across many tool calls. '
        + 'Each call resolves to the tool\'s result, parsed as JSON when possible, otherwise a string. '
        + `Callable: ${callable}. `
        + mcp
        + `Limits: ${MAX_CALLS_PER_SCRIPT} tool calls per script, ${MAX_IN_FLIGHT_PER_SCRIPT} in flight, `
        + `nested run_tool_script up to depth ${MAX_SCRIPT_DEPTH}. `
        + 'A tool error throws ToolCallError (fields: toolName, message, code); catch it to continue. '
        + 'console.log output is returned in `logs`. No require, fetch, fs, process or timers.';
}

export function createRunToolScriptTool(deps: RunToolScriptToolDeps) {
    const mcpServerNames = deps.mcp?.serverNames() ?? [];
    const mcpTools = mcpServerNames.length > 0 ? createMcpScriptTools(deps.mcp!) : [];
    const gatedMcpTools = deps.gateMcpTools?.(mcpTools) ?? mcpTools;
    const scriptTools = [...deps.tools, ...gatedMcpTools];
    const tool = defineTool<RunToolScriptArgs>(RUN_TOOL_SCRIPT_TOOL_NAME, {
        description: buildRunToolScriptDescription(scriptTools.map(t => t.name), mcpServerNames),
        parameters: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'Body of an async JS function. Use `await tools.<name>(args)`. `return` the value you want back.',
                },
            },
            required: ['code'],
        },
        handler: async (args: RunToolScriptArgs, invocation?: ToolInvocation) => {
            if (typeof args?.code !== 'string' || !args.code.trim()) {
                return { textResultForLlm: 'run_tool_script needs a non-empty `code` string.', resultType: 'failure' };
            }
            const signals = [deps.signal, invocation?.signal].filter((s): s is AbortSignal => !!s);
            const runtime = new CocToolRuntime(scriptTools, {
                sessionId: invocation?.sessionId, workspaceId: deps.workspaceId, processId: deps.processId,
            });
            const started = Date.now();
            try {
                const run = await runToolScript({
                    code: args.code,
                    runtime,
                    scriptToolCallId: invocation?.toolCallId ?? '',
                    depth: 1,
                    signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
                    onToolEvent: deps.onNestedToolEvent,
                });
                getLogger().info(LogCategory.AI,
                    `[run_tool_script] workspace=${deps.workspaceId ?? '-'} process=${deps.processId ?? '-'} depth=1 `
                    + `calls=${run.callCount} outcome=${run.ok ? 'ok' : run.error?.code ?? run.error?.name ?? 'error'} `
                    + `durationMs=${Date.now() - started}`);
                const text = JSON.stringify(toModelPayload(run));
                return run.ok ? text : { textResultForLlm: text, resultType: 'failure' };
            } finally {
                runtime.dispose();
            }
        },
    });
    return { tool, mcpTools: gatedMcpTools };
}
