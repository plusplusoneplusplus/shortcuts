/**
 * Central registry of all toggleable LLM tools available in chat executor
 * sessions. Each entry describes a tool name, human-readable label,
 * description, and whether it is enabled by default.
 *
 * Context-specific tools (resolve_comment, add_diff_comment) that are only
 * injected for specialized executor flows are NOT listed here — they cannot
 * be toggled by the user.
 */

/**
 * Compact, display-only description of a single LLM tool input parameter.
 *
 * Derived from a tool's JSON-schema `parameters` purely for the settings UI;
 * it never affects tool execution, validation, or persisted preferences.
 */
export interface LlmToolParam {
    /** Parameter name as declared in the tool input schema. */
    name: string;
    /**
     * Compact type label: a JSON-schema primitive (`string`, `number`,
     * `boolean`, `integer`), `{...}` for nested objects, `[...]` for arrays,
     * `enum` for typeless enums, or `any` when the type cannot be determined.
     */
    type: string;
    /** Whether the parameter is required by the tool's input schema. */
    required: boolean;
}

export interface LlmToolMeta {
    /** Tool name as registered with `defineTool()` (matches the AI-facing name). */
    name: string;
    /** Human-readable label for the settings UI. */
    label: string;
    /** Short description shown in the settings UI. */
    description: string;
    /** Whether this tool is enabled by default when no explicit preference exists. */
    enabledByDefault: boolean;
    /**
     * Optional, additive compact parameter summary derived from the tool's
     * input schema for display in the settings UI. Absent when no JSON-schema
     * is available (render as "parameters unavailable"); an empty array means
     * the tool takes no parameters. Existing clients can ignore this field.
     */
    params?: LlmToolParam[];
    /**
     * Whether the user may mark this tool as "require approval" in repo
     * settings. Set by the settings route; absent on the static registry.
     */
    approvalGateable?: boolean;
    /**
     * Whether `run_tool_script` scripts may call this tool. Defaults to true;
     * tools outside the registry are never scriptable.
     */
    scriptable?: boolean;
    /** The tool only reads data. Canvas `host.runScript` may call read-only tools only. */
    readOnly?: boolean;
}

/**
 * Canonical list of user-toggleable LLM tools.
 * Order determines display order in the settings UI.
 */
export const LLM_TOOL_REGISTRY: readonly LlmToolMeta[] = [
    {
        name: 'browser', label: 'Browser', description: 'Control the CoC desktop browser.',
        // Stateful UI control with binary screenshots.
        enabledByDefault: true, scriptable: false,
    },
    {
        name: 'suggest_follow_ups',
        label: 'Follow-Up Suggestions',
        description: 'Suggests follow-up actions after the AI responds.',
        // UI side channel intercepted by the executor's tool-event handler.
        enabledByDefault: true, scriptable: false,
    },
    {
        name: 'search_conversations',
        label: 'Search Conversations',
        description: 'Full-text search over past conversation history.',
        enabledByDefault: true,
    },
    {
        name: 'get_conversation',
        label: 'Get Conversation',
        description: 'Fetches the full transcript of a past session.',
        enabledByDefault: true,
    },
    {
        name: 'send_to_conversation',
        label: 'Send to Conversation',
        description: 'Posts into an existing conversation, starts a new one, or explicitly cancels local work with action: cancel and processId.',
        // Starts jobs; fan-out from a loop is easy to misuse.
        enabledByDefault: true, scriptable: false,
    },
    {
        name: 'list_workspaces',
        label: 'List Workspaces',
        description: 'Lists local and remote repos (and repo groups) with their IDs, for targeting Send to Conversation.',
        enabledByDefault: true,
    },
    {
        name: 'ask_user',
        label: 'Ask User',
        description: 'Poses interactive questions to the user during execution.',
        // Questions are asked in the open, not from a loop.
        enabledByDefault: true, scriptable: false,
    },
    {
        name: 'save_memory',
        label: 'Save Memory (V2)',
        description: 'Explicitly stores a new fact in the redesigned memory system.',
        enabledByDefault: false,
    },
    {
        name: 'recall_memory',
        label: 'Recall Memory (V2)',
        description: 'Searches the redesigned memory system for relevant facts.',
        enabledByDefault: false,
    },
    {
        name: 'scheduleWakeup',
        label: 'Schedule Wakeup',
        description: 'Schedules a one-shot delayed follow-up message into the conversation.',
        enabledByDefault: true,
    },
    {
        name: 'write_canvas',
        label: 'Write Canvas',
        description: 'Creates or updates a markdown/code canvas in a side panel next to the chat.',
        enabledByDefault: true,
    },
    {
        name: 'read_canvas',
        label: 'Read Canvas',
        description: 'Reads a canvas\'s content and revision (and manifest for extension canvases).',
        enabledByDefault: true,
    },
    {
        name: 'extension_canvas',
        label: 'Extension Canvas',
        description: 'Builds or runs a custom interactive canvas (UI + capabilities over JSON shared state).',
        enabledByDefault: true,
    },
    {
        name: 'list_canvas_capabilities',
        label: 'List Canvas Capabilities',
        description: 'Lists installed canvas extensions and their declared canvases and actions.',
        enabledByDefault: true,
    },
    {
        name: 'open_canvas',
        label: 'Open Canvas',
        description: 'Opens an installed canvas or reopens a saved instance.',
        enabledByDefault: true,
    },
    {
        name: 'invoke_canvas_action',
        label: 'Invoke Canvas Action',
        description: 'Invokes a declared action on an open canvas instance.',
        enabledByDefault: true,
    },
    {
        name: 'close_canvas',
        label: 'Close Canvas',
        description: 'Closes a canvas instance while keeping its saved record.',
        enabledByDefault: true,
    },
    {
        name: 'kusto_query',
        label: 'Kusto Query',
        description: 'Runs a Kusto (KQL) query server-side and shows the result as an interactive Kusto query canvas.',
        enabledByDefault: true,
    },
    {
        name: 'system_one',
        label: 'System One (Quick Decisions)',
        description: 'Fast yes/no, choice, or score judgments over earlier tool output, files, or short text. Always runs on Copilot, even in Claude/Codex chats.',
        enabledByDefault: true,
    },
    {
        name: 'create_pull_request',
        label: 'Create Pull Request',
        description: 'Opens a GitHub or Azure DevOps pull request for this chat\'s repo and links it to the chat. Autopilot only; used only when you ask for a PR.',
        // Outward-facing side effect; keep it a visible single call.
        enabledByDefault: true, scriptable: false,
    },
    {
        name: 'query_pull_request',
        label: 'Query Pull Request',
        description: 'Reads GitHub or Azure DevOps pull requests for a repository the AI names: list with status/author/CI filters, or get full details by ID. Read-only.',
        enabledByDefault: true,
        readOnly: true,
    },
    {
        name: 'sentinel_jobs',
        label: 'Sentinel Jobs',
        description: 'Lets a Sentinel chat list, create, edit, schedule, pause/resume, run and cancel its own refrains and its built-in Coda review on your instructions. Never deletes refrains.',
        // Opt-in rollout; schedules and runs must stay visible single calls.
        enabledByDefault: false, scriptable: false,
    },
    {
        name: 'tavily_web_search',
        label: 'Tavily Web Search',
        description: 'Searches the live web via Tavily API for current information.',
        enabledByDefault: false,
    },
    {
        name: 'run_tool_script',
        label: 'Tool Scripting',
        description: 'Runs a short JavaScript script that calls other CoC tools in loops or in parallel and returns only the script result.',
        enabledByDefault: true,
    },
] as const;

/** Tool names belonging to the canvas feature (gated by `canvas.enabled`). */
export const CANVAS_LLM_TOOL_NAMES = ['write_canvas', 'read_canvas', 'extension_canvas'] as const;

/** Installed-extension tools, independently gated by `canvasExtensions.enabled`. */
export const CANVAS_EXTENSION_LLM_TOOL_NAMES = [
    'list_canvas_capabilities', 'open_canvas', 'invoke_canvas_action', 'close_canvas',
] as const;

/** Tool names belonging to the Kusto feature (gated by `kusto.enabled`). */
export const KUSTO_LLM_TOOL_NAMES = ['kusto_query'] as const;

/** Tool names belonging to the System One feature (gated by `LLMToolSystemOne.enabled`). */
export const SYSTEM_ONE_LLM_TOOL_NAMES = ['system_one'] as const;

/** Tool names belonging to the tool-scripting feature (gated by `features.toolScripting`). */
export const TOOL_SCRIPTING_LLM_TOOL_NAMES = ['run_tool_script'] as const;

/** Tool names belonging to the query-pull-request feature (gated by `features.queryPullRequestTool`). */
export const QUERY_PULL_REQUEST_LLM_TOOL_NAMES = ['query_pull_request'] as const;

const SCRIPTABLE_LLM_TOOL_NAMES = new Set(LLM_TOOL_REGISTRY.filter(t => t.scriptable !== false).map(t => t.name));

/** Whether `run_tool_script` scripts may call this tool. Unregistered tools are not scriptable. */
export function isScriptableLlmTool(toolName: string): boolean {
    return SCRIPTABLE_LLM_TOOL_NAMES.has(toolName);
}

/**
 * Returns the effective LLM tool registry given runtime feature flags.
 *
 * When `cron.enabled` is false, the `scheduleWakeup` tool is filtered out so
 * the dashboard tool list and per-workspace settings do not advertise a tool
 * the executor will not register.
 */
export function getEffectiveLlmToolRegistry(opts: { cronEnabled?: boolean; canvasEnabled?: boolean; canvasExtensionsEnabled?: boolean; kustoEnabled?: boolean; browserControlEnabled?: boolean; llmToolSystemOneEnabled?: boolean; toolScriptingEnabled?: boolean; queryPullRequestToolEnabled?: boolean } = {}): readonly LlmToolMeta[] {
    let registry = [...LLM_TOOL_REGISTRY];
    if (!opts.cronEnabled) {
        registry = registry.filter(t => t.name !== 'scheduleWakeup');
    }
    if (!opts.canvasEnabled) {
        registry = registry.filter(t => !(CANVAS_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
    }
    if (!opts.canvasExtensionsEnabled) {
        registry = registry.filter(t => !(CANVAS_EXTENSION_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
    }
    if (!opts.kustoEnabled) {
        registry = registry.filter(t => !(KUSTO_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
    }
    if (!opts.browserControlEnabled) {
        registry = registry.filter(t => t.name !== 'browser');
    }
    if (!opts.llmToolSystemOneEnabled) {
        registry = registry.filter(t => !(SYSTEM_ONE_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
    }
    if (!opts.toolScriptingEnabled) {
        registry = registry.filter(t => !(TOOL_SCRIPTING_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
    }
    if (!opts.queryPullRequestToolEnabled) {
        registry = registry.filter(t => !(QUERY_PULL_REQUEST_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
    }
    return registry;
}

/** Tool names disabled by the registry-level default, independent of UI layout mode. */
export const DEFAULT_DISABLED_LLM_TOOLS: string[] = LLM_TOOL_REGISTRY
    .filter(t => !t.enabledByDefault)
    .map(t => t.name);

const REMOVED_LLM_TOOL_NAMES = new Set([
    'create_bug',
    'get_work_item',
    'create_update_work_item',
]);

export function isRemovedLlmToolName(toolName: string): boolean {
    return REMOVED_LLM_TOOL_NAMES.has(toolName);
}

export function filterRemovedLlmToolNames(toolNames: readonly string[]): string[] {
    return toolNames.filter(name => !isRemovedLlmToolName(name));
}

/** Default disabled tool names, as a fresh copy callers may mutate. */
export function getEffectiveDefaultDisabledTools(): string[] {
    return [...DEFAULT_DISABLED_LLM_TOOLS];
}

/**
 * Tools that can never be gated behind user approval: `ask_user` is the
 * approval prompt itself, and `suggest_follow_ups` only renders chips.
 */
export const NON_GATEABLE_LLM_TOOLS: readonly string[] = ['ask_user', 'suggest_follow_ups'];

export function isLlmToolApprovalGateable(toolName: string): boolean {
    return !NON_GATEABLE_LLM_TOOLS.includes(toolName) && !isRemovedLlmToolName(toolName);
}

/**
 * Tools that ask before running unless the repo opts out
 * (`approvalOptOutLlmTools`). `mcp_call` reaches external MCP servers from a
 * script, so it starts gated.
 */
export const DEFAULT_APPROVAL_REQUIRED_LLM_TOOLS: readonly string[] = ['mcp_call'];

/** Drop non-gateable and removed names from an approval-required list. */
export function filterApprovalRequiredLlmToolNames(toolNames: readonly string[]): string[] {
    return Array.from(new Set(toolNames.filter(isLlmToolApprovalGateable)));
}

/**
 * Filters an array of tools, removing removed tool names and any names
 * present in the disabled tools list (or the default disabled list when undefined).
 */
export function filterDisabledLlmTools<T extends { name: string }>(
    tools: T[],
    disabledLlmTools: string[] | undefined,
): T[] {
    const disabled = filterRemovedLlmToolNames(disabledLlmTools ?? DEFAULT_DISABLED_LLM_TOOLS);
    if (disabled.length === 0) return tools.filter(t => !isRemovedLlmToolName(t.name));
    return tools.filter(t => !isRemovedLlmToolName(t.name) && !disabled.includes(t.name));
}
