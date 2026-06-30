/**
 * LLM Tool Registry
 *
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
        description: 'Posts a message into an existing conversation (by processId), or starts a brand-new one when no processId is given.',
        enabledByDefault: true,
    },
    {
        name: 'ask_user',
        label: 'Ask User',
        description: 'Poses interactive questions to the user during execution.',
        enabledByDefault: true,
    },
    {
        name: 'get_work_item',
        label: 'Get Work Item',
        description: 'Reads the current detail of an existing work item by UUID, WI-N, or work-item number (read-only).',
        enabledByDefault: true,
    },
    {
        name: 'create_update_work_item',
        label: 'Create/Update Work Item',
        description: 'Creates typed work items and bugs, patches common fields, saves revised plan versions, and links/moves/unlinks items in the hierarchy.',
        enabledByDefault: true,
    },
    {
        name: 'memory',
        label: 'Memory',
        description: 'Reads and writes persistent memory entries across sessions.',
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
        name: 'tavily_web_search',
        label: 'Tavily Web Search',
        description: 'Searches the live web via Tavily API for current information.',
        enabledByDefault: false,
    },
] as const;

/** Tool names belonging to the canvas feature (gated by `canvas.enabled`). */
export const CANVAS_LLM_TOOL_NAMES = ['write_canvas', 'read_canvas', 'extension_canvas'] as const;

/**
 * Returns the effective LLM tool registry given runtime feature flags.
 *
 * When `loops.enabled` is false, the `scheduleWakeup` tool is filtered out so
 * the dashboard tool list and per-workspace settings do not advertise a tool
 * the executor will not register.
 */
export function getEffectiveLlmToolRegistry(opts: { loopsEnabled?: boolean; canvasEnabled?: boolean } = {}): readonly LlmToolMeta[] {
    let registry = [...LLM_TOOL_REGISTRY];
    if (!opts.loopsEnabled) {
        registry = registry.filter(t => t.name !== 'scheduleWakeup');
    }
    if (!opts.canvasEnabled) {
        registry = registry.filter(t => !(CANVAS_LLM_TOOL_NAMES as readonly string[]).includes(t.name));
    }
    return registry;
}

/** Tool names disabled by the registry-level default, independent of UI layout mode. */
export const DEFAULT_DISABLED_LLM_TOOLS: string[] = LLM_TOOL_REGISTRY
    .filter(t => !t.enabledByDefault)
    .map(t => t.name);

/** Additional tool names disabled by default when the dashboard uses classic mode. */
export const CLASSIC_MODE_EXTRA_DISABLED_TOOLS: string[] = [
    'get_work_item',
    'create_update_work_item',
];

const REMOVED_LLM_TOOL_NAMES = new Set([
    'create_bug',
]);

export function isRemovedLlmToolName(toolName: string): boolean {
    return REMOVED_LLM_TOOL_NAMES.has(toolName);
}

export function filterRemovedLlmToolNames(toolNames: readonly string[]): string[] {
    return toolNames.filter(name => !isRemovedLlmToolName(name));
}

/**
 * Resolve the default disabled tools for the current UI layout mode.
 * Classic mode is the safe default when no layout preference has been saved.
 */
export function getEffectiveDefaultDisabledTools(
    uiLayoutMode?: 'classic' | 'dev-workflow',
): string[] {
    if (uiLayoutMode === 'dev-workflow') {
        return [...DEFAULT_DISABLED_LLM_TOOLS];
    }

    return Array.from(new Set([
        ...DEFAULT_DISABLED_LLM_TOOLS,
        ...CLASSIC_MODE_EXTRA_DISABLED_TOOLS,
    ]));
}

/**
 * Returns true if a tool should be included given the disabled tools list.
 * When `disabledLlmTools` is undefined, falls back to the default disabled list.
 */
export function isLlmToolEnabled(
    toolName: string,
    disabledLlmTools: string[] | undefined,
): boolean {
    if (isRemovedLlmToolName(toolName)) {
        return false;
    }
    const disabled = filterRemovedLlmToolNames(disabledLlmTools ?? DEFAULT_DISABLED_LLM_TOOLS);
    return !disabled.includes(toolName);
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
