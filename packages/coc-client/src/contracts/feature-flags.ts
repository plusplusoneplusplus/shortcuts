/**
 * Feature Flag Registry — single source of truth for boolean admin config flags.
 *
 * Every boolean dashboard/feature flag that is either exposed at runtime
 * (`GET /api/config/runtime` → `RuntimeDashboardConfig.features`) and/or editable
 * from the Admin UI lives here as ONE entry. The server, the client contracts, the
 * SPA config readers, and the Admin Features card all derive from this list, so
 * adding a flag is (ideally) a single edit here.
 *
 * What is derived from this registry:
 *  - `RuntimeDashboardConfig.features` boolean members + `AdminConfigUpdate` boolean keys
 *    + the client `DashboardConfig` flags (mapped types, see contracts/admin.ts and
 *    server/spa/client/react/utils/config.ts)
 *  - `ADMIN_CONFIG_FIELDS` boolean entries (server/admin/admin-config-fields.ts)
 *  - `buildRuntimeDashboardConfig` boolean flags (server/config/runtime-config-handler.ts)
 *  - the Admin → Configure → Features toggle list (server/spa/client/react/admin/AdminPanel.tsx)
 *
 * What stays hand-written but is locked to this registry by an exhaustiveness test
 * (test/server/feature-flags-registry.test.ts) so it can never silently drift:
 *  - `CLIConfig` / `ResolvedCLIConfig` nested members + `DEFAULT_CONFIG` defaults (config.ts)
 *  - the Zod schema (config/schema.ts)
 *  - the namespace merge + source keys (config/namespace-registry.ts)
 *  - `AdminResolvedConfig` nested members (contracts/admin.ts)
 *
 * NON-boolean settings (model, parallel, scratchpad.layout, defaultProvider,
 * commitChatLensDormantMode, chat.followUpSuggestions.count, …) and plain display
 * booleans (showReportIntent, groupSingleLineMessages, chat.*) are intentionally NOT
 * here — they remain bespoke entries in their respective handlers/cards.
 */

/** Runtime behavior classification for an admin-editable config field. */
export type FeatureFlagRuntime = 'live' | 'reloadable' | 'restartRequired';

/** Badge rendered next to a toggle label in the Admin Features card. */
export type FeatureFlagBadgeKind = 'warning' | 'accent';

/** Identifier for a Features-card group (controls section + data-testid). */
export type FeatureFlagGroupId =
    | 'dashboard'
    | 'dev-tools'
    | 'work-items'
    | 'ai-modes'
    | 'review'
    | 'infrastructure';

/** Admin Features-card presentation metadata for a single toggle. */
export interface FeatureFlagUi {
    /** Group the toggle is rendered under. */
    group: FeatureFlagGroupId;
    /** Human-readable label. */
    label: string;
    /** Tooltip / helper text shown beneath the label. */
    hint: string;
    /** `data-testid` applied to the toggle control. */
    testid: string;
    /** Optional badge appended to the label (e.g. "Restart", "Experimental"). */
    badge?: { text: string; kind: FeatureFlagBadgeKind };
    /** When set, the row only renders while the named flag key is enabled. */
    showWhenKey?: string;
}

/** A single boolean feature flag. */
export interface FeatureFlagSpec {
    /** Flat dot-notation key used by PUT /api/admin/config, e.g. 'excalidraw.enabled'. */
    key: string;
    /** Nested object path into CLIConfig, e.g. ['excalidraw', 'enabled']. */
    path: readonly string[];
    /** Canonical default — MUST match DEFAULT_CONFIG (enforced by test). */
    default: boolean;
    /** Admin field runtime behavior. */
    runtime: FeatureFlagRuntime;
    /** Whether the flag is editable via PUT /api/admin/config. */
    editable: boolean;
    /**
     * camelCase flag name surfaced in RuntimeDashboardConfig.features / DashboardConfig.
     * Omit for flags that are admin-editable but not exposed to the SPA at runtime
     * (e.g. mcpOauth.autoRefresh.enabled).
     */
    runtimeFlag?: string;
    /** Admin Features-card metadata. Omit for flags surfaced in other cards. */
    ui?: FeatureFlagUi;
}

/** Ordered Features-card groups (heading + data-testid for the section wrapper). */
export const FEATURE_FLAG_GROUPS: ReadonlyArray<{ id: FeatureFlagGroupId; heading: string; testid: string }> = [
    { id: 'dashboard', heading: 'Dashboard Modules', testid: 'feature-group-dashboard' },
    { id: 'dev-tools', heading: 'Development Tools', testid: 'feature-group-dev-tools' },
    { id: 'work-items', heading: 'Work Items', testid: 'feature-group-work-items' },
    { id: 'ai-modes', heading: 'AI Execution Modes', testid: 'feature-group-ai-modes' },
    { id: 'review', heading: 'Code Review & Collaboration', testid: 'feature-group-review' },
    { id: 'infrastructure', heading: 'Infrastructure', testid: 'feature-group-infrastructure' },
];

/**
 * The registry. Order within a group controls Admin Features-card row order.
 *
 * `as const` preserves string-literal types so `runtimeFlag`/`key` unions can be
 * mapped into the contract interfaces below.
 */
export const FEATURE_FLAGS = [
    // ── Dashboard Modules ──────────────────────────────────────────────────────
    {
        key: 'notes.enabled', path: ['notes', 'enabled'], default: true, runtime: 'live',
        editable: true, runtimeFlag: 'notesEnabled',
        ui: { group: 'dashboard', label: 'Notes', hint: 'Markdown notebooks for creating and editing notes.', testid: 'toggle-notes-enabled' },
    },
    {
        key: 'myWork.enabled', path: ['myWork', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'myWorkEnabled',
        ui: { group: 'dashboard', label: 'My Work', hint: 'Personal landing page with action items and weekly summaries.', testid: 'toggle-mywork-enabled' },
    },
    {
        key: 'myLife.enabled', path: ['myLife', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'myLifeEnabled',
        ui: { group: 'dashboard', label: 'My Life', hint: 'Personal page with goals, journal, and life admin.', testid: 'toggle-mylife-enabled' },
    },
    {
        key: 'scratchpad.enabled', path: ['scratchpad', 'enabled'], default: true, runtime: 'live',
        editable: true, runtimeFlag: 'scratchpadEnabled',
        ui: { group: 'dashboard', label: 'Scratchpad panel', hint: 'Bottom-split note editor inside the chat detail view.', testid: 'toggle-scratchpad-enabled' },
    },

    // ── Development Tools ──────────────────────────────────────────────────────
    {
        key: 'terminal.enabled', path: ['terminal', 'enabled'], default: true, runtime: 'restartRequired',
        editable: true, runtimeFlag: 'terminalEnabled',
        ui: { group: 'dev-tools', label: 'Terminal', hint: 'Web terminal for shell access to the server machine. Toggling requires a server restart.', testid: 'toggle-terminal-enabled', badge: { text: 'Restart', kind: 'warning' } },
    },
    {
        key: 'workflows.enabled', path: ['workflows', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'workflowsEnabled',
        ui: { group: 'dev-tools', label: 'Workflows Tab', hint: 'YAML workflow runner tab in repo view.', testid: 'toggle-workflows-enabled' },
    },
    {
        key: 'pullRequests.enabled', path: ['pullRequests', 'enabled'], default: true, runtime: 'live',
        editable: true, runtimeFlag: 'pullRequestsEnabled',
        ui: { group: 'dev-tools', label: 'Pull Requests Tab', hint: 'Pull request list tab in repo view.', testid: 'toggle-pull-requests-enabled' },
    },
    {
        key: 'pullRequests.suggestions', path: ['pullRequests', 'suggestions'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'pullRequestsSuggestionsEnabled',
        ui: { group: 'dev-tools', label: 'PR Review Suggestions', hint: "AI-ranked suggestions for which open PRs to review, based on your review history. Adds a 'For You' filter pill to the PR queue.", testid: 'toggle-pull-requests-suggestions-enabled', showWhenKey: 'pullRequests.enabled' },
    },
    {
        key: 'pullRequests.autoClassifyTeam', path: ['pullRequests', 'autoClassifyTeam'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'pullRequestsAutoClassifyTeamEnabled',
        ui: { group: 'dev-tools', label: 'Auto-classify Team PRs', hint: 'Automatically queues lightweight diff classification for open Pull Requests tab Team roster PRs. Disabled by default.', testid: 'toggle-pull-requests-auto-classify-team-enabled', showWhenKey: 'pullRequests.enabled' },
    },
    {
        key: 'servers.enabled', path: ['servers', 'enabled'], default: true, runtime: 'live',
        editable: true, runtimeFlag: 'serversEnabled',
        ui: { group: 'dev-tools', label: 'Servers', hint: 'Multi-server connection manager (devtunnel).', testid: 'toggle-servers-enabled' },
    },

    // ── Work Items ─────────────────────────────────────────────────────────────
    {
        key: 'workItems.hierarchy.enabled', path: ['workItems', 'hierarchy', 'enabled'], default: true, runtime: 'live',
        editable: true, runtimeFlag: 'workItemsHierarchyEnabled',
        ui: { group: 'work-items', label: 'Work Items Hierarchy Board', hint: 'Extends the Work Items tab into an Epic → Feature → PBI → Work Item / Bug hierarchy board. Enabled by default.', testid: 'toggle-work-items-hierarchy-enabled' },
    },
    {
        key: 'workItems.sync.enabled', path: ['workItems', 'sync', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'workItemsSyncEnabled',
        ui: { group: 'work-items', label: 'Remote Work Items', hint: 'Enables remote provider integration for hierarchy mode: provider status, imports, save-to-provider updates, and background polling. Requires the hierarchy board and never stores provider tokens.', testid: 'toggle-work-items-sync-enabled', badge: { text: 'Preview', kind: 'accent' } },
    },
    {
        key: 'workItems.aiAuthoring.enabled', path: ['workItems', 'aiAuthoring', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'workItemsAiAuthoringEnabled',
        ui: { group: 'work-items', label: 'Work Items AI Authoring', hint: 'Adds AI-assisted work item creation and improvement to the Work Items tab. Disabled by default.', testid: 'toggle-work-items-ai-authoring-enabled', badge: { text: 'Experimental', kind: 'accent' } },
    },
    {
        key: 'workItems.workflow.enabled', path: ['workItems', 'workflow', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'workItemsWorkflowEnabled',
        ui: { group: 'work-items', label: 'Work Items Workflow', hint: 'Enables the durable Work Items/Goals command-center workflow. Disabled by default.', testid: 'toggle-work-items-workflow-enabled', badge: { text: 'Experimental', kind: 'accent' } },
    },

    // ── AI Execution Modes ─────────────────────────────────────────────────────
    {
        key: 'ralph.enabled', path: ['ralph', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'ralphEnabled',
        ui: { group: 'ai-modes', label: 'Ralph Mode', hint: 'Autonomous iterative coding loop — stateless agents with fresh context per iteration.', testid: 'toggle-ralph-enabled', badge: { text: 'Experimental', kind: 'accent' } },
    },
    {
        key: 'forEach.enabled', path: ['forEach', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'forEachEnabled',
        ui: { group: 'ai-modes', label: 'For Each Mode', hint: 'Generate a reviewed item plan from New Chat, then run each item as a separate child chat. Disabled by default.', testid: 'toggle-for-each-enabled', badge: { text: 'Experimental', kind: 'accent' } },
    },
    {
        key: 'mapReduce.enabled', path: ['mapReduce', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'mapReduceEnabled',
        ui: { group: 'ai-modes', label: 'Map Reduce Mode', hint: 'Generate a reviewed map plan from New Chat, run items in parallel, then reduce outputs into one result. Disabled by default.', testid: 'toggle-map-reduce-enabled', badge: { text: 'Experimental', kind: 'accent' } },
    },
    {
        key: 'effortLevels.enabled', path: ['effortLevels', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'effortLevelsEnabled',
        ui: { group: 'ai-modes', label: 'Effort Tiers', hint: 'Replace the model picker + reasoning-effort pill in the chat composer with a single Low / Medium / High effort selector. Configure tier mappings per provider on the AI Provider page. Disabled by default.', testid: 'toggle-effort-levels-enabled', badge: { text: 'Experimental', kind: 'accent' } },
    },

    // ── Code Review & Collaboration ────────────────────────────────────────────
    {
        key: 'features.focusedDiff', path: ['features', 'focusedDiff'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'focusedDiffEnabled',
        ui: { group: 'review', label: 'Focused Diff', hint: 'AI-powered hunk classification for PR diffs. Highlights logic changes and dims mechanical edits.', testid: 'toggle-focused-diff-enabled' },
    },
    {
        key: 'features.gitCrossCloneCherryPick', path: ['features', 'gitCrossCloneCherryPick'], default: true, runtime: 'live',
        editable: true, runtimeFlag: 'gitCrossCloneCherryPickEnabled',
        ui: { group: 'review', label: 'Cross-clone cherry-pick', hint: 'Adds a Git commit context-menu action that transfers one commit to another registered clone using patch export/apply. Enabled by default.', testid: 'toggle-git-cross-clone-cherry-pick-enabled', badge: { text: 'Experimental', kind: 'accent' } },
    },
    {
        key: 'features.sessionContextAttachments', path: ['features', 'sessionContextAttachments'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'sessionContextAttachmentsEnabled',
        ui: { group: 'review', label: 'Session context attachments', hint: 'Allow dragging existing same-workspace chat sessions into chat composers as pointer-only context. Disabled by default.', testid: 'toggle-session-context-attachments-enabled', badge: { text: 'Experimental', kind: 'accent' } },
    },
    {
        key: 'features.commitChatLens', path: ['features', 'commitChatLens'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'commitChatLensEnabled',
        ui: { group: 'review', label: 'Review chat lens', hint: 'Open unpinned commit and pull-request review chat as a desktop bottom-right lens instead of the side panel or drawer. Disabled by default.', testid: 'toggle-commit-chat-lens-enabled', badge: { text: 'Experimental', kind: 'accent' } },
    },
    {
        key: 'excalidraw.enabled', path: ['excalidraw', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'excalidrawEnabled',
        ui: { group: 'review', label: 'Excalidraw diagrams', hint: 'AI can generate and read Excalidraw diagrams during conversations. Disabled by default.', testid: 'toggle-excalidraw-enabled' },
    },

    // ── Infrastructure ─────────────────────────────────────────────────────────
    {
        key: 'loops.enabled', path: ['loops', 'enabled'], default: true, runtime: 'restartRequired',
        editable: true, runtimeFlag: 'loopsEnabled',
        ui: { group: 'infrastructure', label: 'Loops & Wakeups', hint: 'Recurring follow-up loops and one-shot scheduleWakeup tool. Disabled by default — toggling requires a server restart to (de)wire infrastructure.', testid: 'toggle-loops-enabled', badge: { text: 'Restart', kind: 'warning' } },
    },
    {
        key: 'mcpOauth.enabled', path: ['mcpOauth', 'enabled'], default: false, runtime: 'restartRequired',
        editable: true, runtimeFlag: 'mcpOauthEnabled',
        ui: { group: 'infrastructure', label: 'MCP OAuth', hint: 'Handle OAuth flows for MCP servers that require authentication. Disabled by default — toggling requires a server restart.', testid: 'toggle-mcp-oauth-enabled', badge: { text: 'Restart', kind: 'warning' } },
    },
    {
        key: 'mcpOauth.autoRefresh.enabled', path: ['mcpOauth', 'autoRefresh', 'enabled'], default: false, runtime: 'restartRequired',
        editable: true,
        ui: { group: 'infrastructure', label: 'MCP OAuth auto-refresh', hint: "Periodically dedup ~/.copilot/mcp-oauth-config/ and refresh AAD-backed tokens before they expire so HTTP MCP servers don't re-prompt for auth. Disabled by default — toggling requires a server restart.", testid: 'toggle-mcp-oauth-auto-refresh-enabled', badge: { text: 'Restart', kind: 'warning' }, showWhenKey: 'mcpOauth.enabled' },
    },
    {
        key: 'vimNavigation.enabled', path: ['vimNavigation', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'vimNavigationEnabled',
        ui: { group: 'infrastructure', label: 'Vim-style navigation', hint: 'Enable hjkl pane navigation, j/k to step through chats and messages, gg/G to jump, i to focus the input, Esc to blur. Disabled by default.', testid: 'toggle-vim-navigation-enabled' },
    },

    // ── Runtime-exposed / editable flags surfaced in OTHER cards (no Features-card UI) ──
    {
        key: 'containerDefaultAgent.enabled', path: ['containerDefaultAgent', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'containerDefaultAgentEnabled',
    },
    {
        key: 'codex.enabled', path: ['codex', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'codexEnabled',
    },
    {
        key: 'claude.enabled', path: ['claude', 'enabled'], default: false, runtime: 'live',
        editable: true, runtimeFlag: 'claudeEnabled',
    },
    {
        key: 'features.autoAgentProviderRouting', path: ['features', 'autoAgentProviderRouting'], default: false, runtime: 'restartRequired',
        editable: true, runtimeFlag: 'autoAgentProviderRoutingEnabled',
    },

    // ── Runtime-exposed but NOT admin-editable ─────────────────────────────────
    {
        key: 'features.gitCommitLookup', path: ['features', 'gitCommitLookup'], default: false, runtime: 'live',
        editable: false, runtimeFlag: 'gitCommitLookupEnabled',
    },
] as const satisfies readonly FeatureFlagSpec[];

// ── Derived unions ─────────────────────────────────────────────────────────────

/** Every flat key in the registry. */
export type FeatureFlagKey = typeof FEATURE_FLAGS[number]['key'];

/** Keys for flags editable via PUT /api/admin/config. */
export type EditableFeatureFlagKey = Extract<typeof FEATURE_FLAGS[number], { editable: true }>['key'];

/** Runtime flag names surfaced in RuntimeDashboardConfig.features / DashboardConfig. */
export type FeatureFlagRuntimeName = Extract<typeof FEATURE_FLAGS[number], { runtimeFlag: string }>['runtimeFlag'];

/** `{ [runtimeFlag]: boolean }` for every runtime-exposed flag. */
export type FeatureFlagRuntimeMap = { [K in FeatureFlagRuntimeName]: boolean };

/** `{ [key]?: boolean }` for every editable flag (used by AdminConfigUpdate). */
export type FeatureFlagUpdateMap = { [K in EditableFeatureFlagKey]?: boolean };

// ── Runtime helpers (shared by server + SPA) ────────────────────────────────────

/** Registry entries that are surfaced to the SPA at runtime. */
export const RUNTIME_FEATURE_FLAGS: ReadonlyArray<FeatureFlagSpec & { runtimeFlag: string }> =
    (FEATURE_FLAGS as readonly FeatureFlagSpec[]).filter(
        (f): f is FeatureFlagSpec & { runtimeFlag: string } => typeof f.runtimeFlag === 'string',
    );

/** Registry entries that render as a toggle in the Admin Features card. */
export const ADMIN_FEATURE_TOGGLES: ReadonlyArray<FeatureFlagSpec & { ui: FeatureFlagUi }> =
    (FEATURE_FLAGS as readonly FeatureFlagSpec[]).filter(
        (f): f is FeatureFlagSpec & { ui: FeatureFlagUi } => f.ui !== undefined,
    );

/** Read a nested boolean value out of a config-shaped object by path. */
export function readFlagValue(config: unknown, path: readonly string[]): boolean | undefined {
    let current: unknown = config;
    for (const segment of path) {
        if (typeof current !== 'object' || current === null) return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === 'boolean' ? current : undefined;
}

/** Build the runtime `{ [runtimeFlag]: boolean }` map from a resolved config object. */
export function buildFeatureFlagRuntimeMap(config: unknown): FeatureFlagRuntimeMap {
    const out: Record<string, boolean> = {};
    for (const flag of RUNTIME_FEATURE_FLAGS) {
        out[flag.runtimeFlag] = readFlagValue(config, flag.path) ?? flag.default;
    }
    return out as FeatureFlagRuntimeMap;
}

/**
 * Write a boolean value into a config-shaped object at the given path, creating
 * intermediate objects as needed. Used by the admin write path to apply a
 * validated flag value into the CLIConfig that will be persisted.
 */
export function setFlagValue(config: Record<string, unknown>, path: readonly string[], value: boolean): void {
    let current = config;
    for (let i = 0; i < path.length - 1; i++) {
        const segment = path[i];
        const next = current[segment];
        if (typeof next !== 'object' || next === null) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
    }
    current[path[path.length - 1]] = value;
}
