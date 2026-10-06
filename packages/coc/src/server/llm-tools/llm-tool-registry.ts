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
}

/**
 * Canonical list of user-toggleable LLM tools.
 * Order determines display order in the settings UI.
 */
export const LLM_TOOL_REGISTRY: readonly LlmToolMeta[] = [
    {
        name: 'suggest_follow_ups',
        label: 'Follow-Up Suggestions',
        description: 'Suggests follow-up actions after the AI responds.',
        enabledByDefault: true,
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
        enabledByDefault: true,
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
        enabledByDefault: true,
    },
    {
        name: 'save_memory',
        label: 'Save Memory (V2)',
        description: 'Explicitly stores a new fact in the redesigned memory system.',
        enabledByDefault: true,
    },
    {
        name: 'recall_memory',
        label: 'Recall Memory (V2)',
        description: 'Searches the redesigned memory system for relevant facts.',
        enabledByDefault: true,
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
        enabledByDefault: true,
    },
    {
        name: 'tavily_web_search',
        label: 'Tavily Web Search',
        description: 'Searches the live web via Tavily API for current information.',
        enabledByDefault: false,
    },
] as const;

/** Tool names belonging to the canvas feature (gated by `canvas.enabled`). */
export const CANVAS_LLM_TOOL_NAMES = ['write_canvas', 'read_canvas', 'extension_canvas'] as const;

/** Tool names belonging to the Kusto feature (gated by `kusto.enabled`). */
export const KUSTO_LLM_TOOL_NAMES = ['kusto_query'] as const;

/** Tool names belonging to the System One feature (gated by `LLMToolSystemOne.enabled`). */
export const SYSTEM_ONE_LLM_TOOL_NAMES = ['system_one'] as const;

/**
 * Returns the effective LLM tool registry given runtime feature flags.
 *
 * When `cron.enabled` is false, the `scheduleWakeup` tool is filtered out so
 * the dashboard tool list and per-workspace settings do not advertise a tool
 * the executor will not register.
 */
export function getEffectiveLlmToolRegistry(opts: { cronEnabled?: boolean; canvasEnabled?: boolean; kustoEnabled?: boolean; llmToolSystemOneEnabled?: boolean } = {}): readonly LlmToolMeta[] {
    let registry = [...LLM_TOOL_REGISTRY];
    if (!opts.cronEnabled) {
        registry = registry.filter(t => t.name !== 'scheduleWakeup');
    }
    if (!opts.canvasEnabled) {
        registry = registry.filter(t => !(CANVAS_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
    }
    if (!opts.kustoEnabled) {
        registry = registry.filter(t => !(KUSTO_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
    }
    if (!opts.llmToolSystemOneEnabled) {
        registry = registry.filter(t => !(SYSTEM_ONE_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
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
