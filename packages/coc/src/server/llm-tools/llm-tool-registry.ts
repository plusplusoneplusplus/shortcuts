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

export interface LlmToolMeta {
    /** Tool name as registered with `defineTool()` (matches the AI-facing name). */
    name: string;
    /** Human-readable label for the settings UI. */
    label: string;
    /** Short description shown in the settings UI. */
    description: string;
    /** Whether this tool is enabled by default when no explicit preference exists. */
    enabledByDefault: boolean;
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
        name: 'ask_user',
        label: 'Ask User',
        description: 'Poses interactive questions to the user during execution.',
        enabledByDefault: true,
    },
    {
        name: 'create_update_work_item',
        label: 'Create/Update Work Item',
        description: 'Creates work items and saves revised plan versions for existing items.',
        enabledByDefault: true,
    },
    {
        name: 'create_bug',
        label: 'Create Bug',
        description: 'Files bug reports from the conversation context.',
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
        name: 'create_or_update_excalidraw',
        label: 'Create/Update Excalidraw',
        description: 'Creates or updates an Excalidraw diagram file.',
        enabledByDefault: true,
    },
    {
        name: 'read_excalidraw',
        label: 'Read Excalidraw',
        description: 'Reads an existing Excalidraw diagram file.',
        enabledByDefault: true,
    },
    {
        name: 'tavily_web_search',
        label: 'Tavily Web Search',
        description: 'Searches the live web via Tavily API for current information.',
        enabledByDefault: false,
    },
] as const;

/**
 * Returns the effective LLM tool registry given runtime feature flags.
 *
 * When `loops.enabled` is false, the `scheduleWakeup` tool is filtered out so
 * the dashboard tool list and per-workspace settings do not advertise a tool
 * the executor will not register.
 */
export function getEffectiveLlmToolRegistry(opts: { loopsEnabled?: boolean; excalidrawEnabled?: boolean } = {}): readonly LlmToolMeta[] {
    let registry = [...LLM_TOOL_REGISTRY];
    if (!opts.loopsEnabled) {
        registry = registry.filter(t => t.name !== 'scheduleWakeup');
    }
    if (!opts.excalidrawEnabled) {
        registry = registry.filter(t => t.name !== 'create_or_update_excalidraw' && t.name !== 'read_excalidraw');
    }
    return registry;
}

/** Tool names disabled by the registry-level default, independent of UI layout mode. */
export const DEFAULT_DISABLED_LLM_TOOLS: string[] = LLM_TOOL_REGISTRY
    .filter(t => !t.enabledByDefault)
    .map(t => t.name);

/** Additional tool names disabled by default when the dashboard uses classic mode. */
export const CLASSIC_MODE_EXTRA_DISABLED_TOOLS: string[] = [
    'create_update_work_item',
    'create_bug',
];

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
    const disabled = disabledLlmTools ?? DEFAULT_DISABLED_LLM_TOOLS;
    return !disabled.includes(toolName);
}

/**
 * Filters an array of tools, removing any whose name appears in the
 * disabled tools list (or the default disabled list when undefined).
 */
export function filterDisabledLlmTools<T extends { name: string }>(
    tools: T[],
    disabledLlmTools: string[] | undefined,
): T[] {
    const disabled = disabledLlmTools ?? DEFAULT_DISABLED_LLM_TOOLS;
    if (disabled.length === 0) return tools;
    return tools.filter(t => !disabled.includes(t.name));
}
