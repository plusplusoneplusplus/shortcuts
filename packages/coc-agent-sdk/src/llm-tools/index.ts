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
    CocToolCallOptions,
} from './coc-tool-runtime';

export {
    runToolScript,
    toModelPayload,
    RUN_TOOL_SCRIPT_TOOL_NAME,
    MAX_SCRIPT_DEPTH,
    MAX_CALLS_PER_SCRIPT,
    MAX_IN_FLIGHT_PER_SCRIPT,
} from './tool-script-runner';

export type {
    ToolScriptRunOptions,
    ToolScriptRunResult,
    ToolScriptCallRecord,
} from './tool-script-runner';

export {
    CocToolBridgeServer,
    cocToolBridgeServer,
} from './bridge-server';

export type { CocToolBridgeRegistration } from './bridge-server';

export {
    COC_LLM_TOOLS_MCP_SERVER_NAME,
    COC_LLM_TOOLS_ENDPOINT_ENV,
    COC_LLM_TOOLS_TOKEN_ENV,
    COC_LLM_TOOLS_BRIDGE_PATH_ENV,
    buildCocLlmToolsMcpConfig,
    resolveCocLlmToolsBridgePath,
    setCocLlmToolsBridgePath,
} from './mcp-config';

export type { CocLlmToolsMcpServerConfig } from './mcp-config';

export {
    createBridgeHandlers,
    createHttpTransport,
    runBridge,
} from './bridge';

export type { BridgeTransport, BridgeHandlerOptions } from './bridge';
