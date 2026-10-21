/**
 * Owner-bound tool scripts: run a `run_tool_script`-style script with the tools
 * a chat would have on an unattended turn, without starting a provider turn.
 *
 * Shared by Sentinel job gates (`job-gate-owner-runner.ts`) and the canvas
 * `host.runScript` bridge (`canvas/canvas-script-bridge.ts`). The tool context is
 * built with `unattendedScript: true`: no `ask_user`, approval-gated tools are
 * denied, and only the CoC handlers in the context execute.
 */

import {
    CocToolRuntime,
    RUN_TOOL_SCRIPT_TOOL_NAME,
    runToolScript,
    type ToolScriptRunResult,
} from '@plusplusoneplusplus/coc-agent-sdk';
import { buildChatTurnContext, type ChatTurnContextInput } from './chat-turn-context-builder';
import { readApprovalRequiredLlmTools } from '../preferences-handler';

/** The owner chat's resolved capabilities. The runner adds the unattended settings. */
export interface OwnerScriptTools extends Omit<ChatTurnContextInput,
    'askUser' | 'unattendedScript' | 'query' | 'browserActivation' | 'browserSignal'> {
    dataDir: string;
    workspaceId: string;
    processId: string;
}

/** One owner-bound script run, as the server runtime receives it. */
export interface OwnerScriptRequest {
    workspaceId: string;
    processId: string;
    code: string;
    state?: unknown;
    /** Tool names the script may call. Every other tool, and nested scripts, are left out. */
    allowTools: readonly string[];
    signal?: AbortSignal;
}

/** Owner-scoped script execution supplied by the queue runtime. */
export type OwnerScriptRunner = (request: OwnerScriptRequest) => Promise<ToolScriptRunResult>;

/** The owner chat is missing, of the wrong kind, or not in the requested workspace. */
export class OwnerScriptUnavailableError extends Error {
    readonly code = 'no-owner';
    constructor(message = 'Script owner chat is unavailable') {
        super(message);
        this.name = 'OwnerScriptUnavailableError';
    }
}

/**
 * Build the owner's unattended tool runtime, run `body`, and dispose both.
 * `allowNestedScripts` is true only when the owner's `run_tool_script` tool is
 * in the runtime and not approval-gated.
 */
export async function withOwnerToolRuntime<T>(
    ownerTools: OwnerScriptTools,
    signal: AbortSignal | undefined,
    body: (runtime: CocToolRuntime, allowNestedScripts: boolean) => Promise<T>,
    allowTools?: readonly string[],
): Promise<T> {
    signal?.throwIfAborted();
    const context = await buildChatTurnContext({
        ...ownerTools,
        unattendedScript: true,
        askUser: undefined,
        query: undefined,
        browserActivation: false,
        browserSignal: signal,
    });
    let runtime: CocToolRuntime | undefined;
    try {
        signal?.throwIfAborted();
        const allowed = allowTools ? new Set(allowTools) : undefined;
        const tools = allowed
            ? context.tools.filter(tool => tool.name !== RUN_TOOL_SCRIPT_TOOL_NAME && allowed.has(tool.name))
            : context.tools;
        const allowNestedScripts = tools.some(tool => tool.name === RUN_TOOL_SCRIPT_TOOL_NAME)
            && !readApprovalRequiredLlmTools(ownerTools.dataDir, ownerTools.workspaceId)
                .includes(RUN_TOOL_SCRIPT_TOOL_NAME);
        runtime = new CocToolRuntime(tools, {
            workspaceId: ownerTools.workspaceId, processId: ownerTools.processId,
        });
        return await body(runtime, allowNestedScripts);
    } finally {
        runtime?.dispose();
        context.dispose();
    }
}

/**
 * Run one script with the owner's tools narrowed to `allowTools`. Nested
 * scripts are always off and the result must be JSON. Returns the engine's
 * full outcome (result, logs, call count); never starts a provider turn.
 */
export function runScriptWithOwnerTools(options: {
    ownerTools: OwnerScriptTools;
    code: string;
    state?: unknown;
    allowTools: readonly string[];
    signal?: AbortSignal;
}): Promise<ToolScriptRunResult> {
    return withOwnerToolRuntime(options.ownerTools, options.signal, runtime => runToolScript({
        code: options.code,
        ...(options.state === undefined ? {} : { state: options.state }),
        requireJsonResult: true,
        allowNestedScripts: false,
        runtime,
        scriptToolCallId: '',
        depth: 1,
        signal: options.signal,
    }), options.allowTools);
}
