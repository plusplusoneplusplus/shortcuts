/**
 * Admin Config Field Registry
 *
 * Single source of truth for editable admin config fields.
 * Each entry defines the flat key, a validator, an apply function, and optional
 * admin UI metadata.
 *
 * To add a new editable admin config field:
 *   1. Add the field to CLIConfig / ResolvedCLIConfig in config.ts (if structural)
 *   2. Add a default in DEFAULT_CONFIG in config.ts
 *   3. Add schema validation in config/schema.ts
 *   4. Add namespace tracking in config/namespace-registry.ts (for nested fields)
 *   5. Add ONE entry here — the admin handler and registry-driven UI pick it up automatically
 *   6. Update AdminResolvedConfig / AdminConfigUpdate in coc-client/src/contracts/admin.ts
 */

import type { AutoProviderRoutingConfig, CLIConfig, ConcreteAgentProvider, DefaultAgentProvider } from '../../config';

/** Runtime behavior classification for admin-editable config fields. */
export type AdminConfigFieldRuntime = 'live' | 'reloadable' | 'restartRequired';

export type AdminConfigUiSurface = 'features';
export type AdminConfigFeatureGroupId =
    | 'dashboard'
    | 'dev-tools'
    | 'work-items'
    | 'ai-modes'
    | 'review'
    | 'infrastructure';

export interface AdminConfigFeatureGroupSpec {
    id: AdminConfigFeatureGroupId;
    label: string;
    testId: string;
}

export interface AdminConfigFieldUiBadge {
    label: string;
    tone: 'accent' | 'warning';
}

export interface AdminConfigFieldUiVisibleWhen {
    key: string;
    equals: boolean | string;
}

export type AdminConfigFieldUiControl =
    | { type: 'toggle'; defaultValue: boolean }
    | { type: 'select'; defaultValue: string; options: readonly { value: string; label: string }[] };

export interface AdminConfigFieldUiSpec {
    surface: AdminConfigUiSurface;
    group: AdminConfigFeatureGroupId;
    label: string;
    hint: string;
    testId: string;
    badge?: AdminConfigFieldUiBadge;
    visibleWhen?: AdminConfigFieldUiVisibleWhen;
    control: AdminConfigFieldUiControl;
}

export interface AdminConfigFieldSpec {
    /** Flat key used in the PUT /api/admin/config request body, e.g. 'loops.enabled' */
    key: string;
    /** Runtime behavior: 'live' (immediate), 'reloadable', or 'restartRequired' */
    runtime: AdminConfigFieldRuntime;
    /** Return an error message string if invalid, undefined if valid */
    validate: (value: unknown) => string | undefined;
    /** Write the (already-validated) value into the CLIConfig that will be persisted */
    apply: (config: CLIConfig, value: unknown) => void;
    /** Optional metadata for registry-driven admin UI exposure. */
    ui?: AdminConfigFieldUiSpec;
}

export type AdminConfigFeatureUiFieldSpec = AdminConfigFieldSpec & { ui: AdminConfigFieldUiSpec & { surface: 'features' } };

export interface AdminConfigFieldMetadata {
    runtime: AdminConfigFieldRuntime;
    ui?: AdminConfigFieldUiSpec;
}

// ── helpers ──────────────────────────────────────────────────────────────────

export const ADMIN_CONFIG_FEATURE_GROUPS: readonly AdminConfigFeatureGroupSpec[] = [
    { id: 'dashboard', label: 'Dashboard Modules', testId: 'feature-group-dashboard' },
    { id: 'dev-tools', label: 'Development Tools', testId: 'feature-group-dev-tools' },
    { id: 'work-items', label: 'Work Items', testId: 'feature-group-work-items' },
    { id: 'ai-modes', label: 'AI Execution Modes', testId: 'feature-group-ai-modes' },
    { id: 'review', label: 'Code Review & Collaboration', testId: 'feature-group-review' },
    { id: 'infrastructure', label: 'Infrastructure', testId: 'feature-group-infrastructure' },
];

const featureToggle = (
    group: AdminConfigFeatureGroupId,
    label: string,
    hint: string,
    testId: string,
    defaultValue: boolean,
    options?: {
        badge?: AdminConfigFieldUiBadge;
        visibleWhen?: AdminConfigFieldUiVisibleWhen;
    },
): AdminConfigFieldUiSpec => ({
    surface: 'features',
    group,
    label,
    hint,
    testId,
    badge: options?.badge,
    visibleWhen: options?.visibleWhen,
    control: { type: 'toggle', defaultValue },
});

const featureSelect = (
    group: AdminConfigFeatureGroupId,
    label: string,
    hint: string,
    testId: string,
    defaultValue: string,
    options: readonly { value: string; label: string }[],
    visibleWhen: AdminConfigFieldUiVisibleWhen,
): AdminConfigFieldUiSpec => ({
    surface: 'features',
    group,
    label,
    hint,
    testId,
    visibleWhen,
    control: { type: 'select', defaultValue, options },
});

const bool = (
    key: string,
    set: (cfg: CLIConfig, v: boolean) => void,
    runtime: AdminConfigFieldRuntime = 'live',
    ui?: AdminConfigFieldUiSpec,
): AdminConfigFieldSpec => ({
    key,
    runtime,
    validate: (v) => typeof v === 'boolean' ? undefined : `${key} must be a boolean`,
    apply: (cfg, v) => set(cfg, v as boolean),
    ui,
});

const VALID_OUTPUT_VALUES = ['table', 'json', 'csv', 'markdown'] as const;
const VALID_DEFAULT_PROVIDER_VALUES = ['copilot', 'codex', 'claude'] as const;
const VALID_CONCRETE_PROVIDER_VALUES = ['copilot', 'codex', 'claude'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConcreteProvider(value: unknown): value is ConcreteAgentProvider {
    return typeof value === 'string' && (VALID_CONCRETE_PROVIDER_VALUES as readonly string[]).includes(value);
}

function validatePercent(value: unknown, key: string): string | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
        ? undefined
        : `${key} must be an integer between 0 and 100`;
}

function validateAutoProviderRouting(value: unknown): string | undefined {
    if (!isObject(value)) {
        return 'agentProviderRouting.auto must be an object';
    }
    const rules = value.rules;
    if (rules !== undefined) {
        if (!Array.isArray(rules)) {
            return 'agentProviderRouting.auto.rules must be an array';
        }
        for (const [index, rule] of rules.entries()) {
            if (!isObject(rule)) {
                return `agentProviderRouting.auto.rules[${index}] must be an object`;
            }
            if (!isConcreteProvider(rule.provider)) {
                return `agentProviderRouting.auto.rules[${index}].provider must be one of: ${VALID_CONCRETE_PROVIDER_VALUES.join(', ')}`;
            }
            if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
                return `agentProviderRouting.auto.rules[${index}].enabled must be a boolean`;
            }
            if (rule.minimumRemainingPercent !== undefined) {
                const err = validatePercent(rule.minimumRemainingPercent, `agentProviderRouting.auto.rules[${index}].minimumRemainingPercent`);
                if (err) { return err; }
            }
            if (rule.weeklyGuard !== undefined) {
                if (!isObject(rule.weeklyGuard)) {
                    return `agentProviderRouting.auto.rules[${index}].weeklyGuard must be an object`;
                }
                if (rule.weeklyGuard.enabled !== undefined && typeof rule.weeklyGuard.enabled !== 'boolean') {
                    return `agentProviderRouting.auto.rules[${index}].weeklyGuard.enabled must be a boolean`;
                }
                if (rule.weeklyGuard.minimumRemainingPercent !== undefined) {
                    const err = validatePercent(rule.weeklyGuard.minimumRemainingPercent, `agentProviderRouting.auto.rules[${index}].weeklyGuard.minimumRemainingPercent`);
                    if (err) { return err; }
                }
            }
        }
    }
    if (value.fallbackProvider !== undefined && !isConcreteProvider(value.fallbackProvider)) {
        return `agentProviderRouting.auto.fallbackProvider must be one of: ${VALID_CONCRETE_PROVIDER_VALUES.join(', ')}`;
    }
    return undefined;
}

// ── registry ─────────────────────────────────────────────────────────────────

/**
 * All admin-editable config fields.
 * The admin handler derives editableKeys, validation, and merge entirely from this list.
 */
export const ADMIN_CONFIG_FIELDS: readonly AdminConfigFieldSpec[] = [
    // ── AI execution ──────────────────────────────────────────────────────────
    {
        key: 'model',
        runtime: 'live',
        validate: (v) => typeof v === 'string' && v.length > 0 ? undefined : 'model must be a non-empty string',
        apply: (cfg, v) => { cfg.model = v as string; },
    },
    {
        key: 'parallel',
        runtime: 'live',
        validate: (v) => typeof v === 'number' && v > 0 ? undefined : 'parallel must be a number greater than 0',
        apply: (cfg, v) => { cfg.parallel = v as number; },
    },
    {
        key: 'timeout',
        runtime: 'live',
        validate: (v) => v === null || (typeof v === 'number' && v > 0)
            ? undefined
            : 'timeout must be a number greater than 0, or null to clear',
        apply: (cfg, v) => {
            if (v === null) { delete cfg.timeout; } else { cfg.timeout = v as number; }
        },
    },
    {
        key: 'output',
        runtime: 'live',
        validate: (v) => typeof v === 'string' && (VALID_OUTPUT_VALUES as readonly string[]).includes(v)
            ? undefined
            : `output must be one of: ${VALID_OUTPUT_VALUES.join(', ')}`,
        apply: (cfg, v) => { cfg.output = v as CLIConfig['output']; },
    },

    // ── display / UI ──────────────────────────────────────────────────────────
    bool('showReportIntent', (cfg, v) => { cfg.showReportIntent = v; }),
    {
        key: 'toolCompactness',
        runtime: 'live',
        validate: (v) =>
            typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3
                ? undefined
                : 'toolCompactness must be 0, 1, 2, or 3',
        apply: (cfg, v) => { cfg.toolCompactness = v as CLIConfig['toolCompactness']; },
    },
    {
        key: 'taskCardDensity',
        runtime: 'live',
        validate: (v) => v === 'compact' || v === 'dense'
            ? undefined
            : 'taskCardDensity must be "compact" or "dense"',
        apply: (cfg, v) => { cfg.taskCardDensity = v as CLIConfig['taskCardDensity']; },
    },
    bool('groupSingleLineMessages', (cfg, v) => { cfg.groupSingleLineMessages = v; }),

    // ── serve ─────────────────────────────────────────────────────────────────
    {
        key: 'serve.serverName',
        runtime: 'live',
        validate: (v) => v === null || v === undefined || (typeof v === 'string' && v.length <= 64)
            ? undefined
            : 'serve.serverName must be a string of at most 64 characters, or null to clear',
        apply: (cfg, v) => {
            if (v === null || v === '') {
                if (cfg.serve) { delete cfg.serve.serverName; }
            } else {
                if (!cfg.serve) { cfg.serve = {}; }
                cfg.serve.serverName = v as string;
            }
        },
    },

    // ── chat ─────────────────────────────────────────────────────────────────
    bool('chat.followUpSuggestions.enabled', (cfg, v) => {
        if (!cfg.chat) { cfg.chat = {}; }
        if (!cfg.chat.followUpSuggestions) { cfg.chat.followUpSuggestions = {}; }
        cfg.chat.followUpSuggestions.enabled = v;
    }),
    {
        key: 'chat.followUpSuggestions.count',
        runtime: 'live',
        validate: (v) =>
            typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5
                ? undefined
                : 'chat.followUpSuggestions.count must be an integer between 1 and 5',
        apply: (cfg, v) => {
            if (!cfg.chat) { cfg.chat = {}; }
            if (!cfg.chat.followUpSuggestions) { cfg.chat.followUpSuggestions = {}; }
            cfg.chat.followUpSuggestions.count = v as number;
        },
    },
    bool('chat.askUser.enabled', (cfg, v) => {
        if (!cfg.chat) { cfg.chat = {}; }
        if (!cfg.chat.askUser) { cfg.chat.askUser = {}; }
        cfg.chat.askUser.enabled = v;
    }),

    // ── feature flags ─────────────────────────────────────────────────────────
    bool('terminal.enabled', (cfg, v) => {
        if (!cfg.terminal) { cfg.terminal = {}; }
        cfg.terminal.enabled = v;
    }, 'restartRequired', featureToggle(
        'dev-tools',
        'Terminal',
        'Web terminal for shell access to the server machine. Toggling requires a server restart.',
        'toggle-terminal-enabled',
        true,
        { badge: { label: 'Restart', tone: 'warning' } },
    )),
    bool('notes.enabled', (cfg, v) => {
        if (!cfg.notes) { cfg.notes = {}; }
        cfg.notes.enabled = v;
    }, 'live', featureToggle(
        'dashboard',
        'Notes',
        'Markdown notebooks for creating and editing notes.',
        'toggle-notes-enabled',
        true,
    )),
    bool('myWork.enabled', (cfg, v) => {
        if (!cfg.myWork) { cfg.myWork = {}; }
        cfg.myWork.enabled = v;
    }, 'live', featureToggle(
        'dashboard',
        'My Work',
        'Personal landing page with action items and weekly summaries.',
        'toggle-mywork-enabled',
        false,
    )),
    bool('myLife.enabled', (cfg, v) => {
        if (!cfg.myLife) { cfg.myLife = {}; }
        cfg.myLife.enabled = v;
    }, 'live', featureToggle(
        'dashboard',
        'My Life',
        'Personal page with goals, journal, and life admin.',
        'toggle-mylife-enabled',
        false,
    )),
    bool('scratchpad.enabled', (cfg, v) => {
        if (!cfg.scratchpad) { cfg.scratchpad = {}; }
        cfg.scratchpad.enabled = v;
    }, 'live', featureToggle(
        'dashboard',
        'Scratchpad panel',
        'Bottom-split note editor inside the chat detail view.',
        'toggle-scratchpad-enabled',
        true,
    )),
    {
        key: 'scratchpad.layout',
        runtime: 'live',
        validate: (v) => v === 'horizontal' || v === 'vertical'
            ? undefined
            : 'scratchpad.layout must be "horizontal" or "vertical"',
        apply: (cfg, v) => {
            if (!cfg.scratchpad) { cfg.scratchpad = {}; }
            cfg.scratchpad.layout = v as 'horizontal' | 'vertical';
        },
        ui: featureSelect(
            'dashboard',
            'Layout',
            'Split direction for conversation and scratchpad.',
            'select-scratchpad-layout',
            'vertical',
            [
                { value: 'horizontal', label: 'Horizontal (top/bottom)' },
                { value: 'vertical', label: 'Vertical (left/right)' },
            ],
            { key: 'scratchpad.enabled', equals: true },
        ),
    },
    bool('workflows.enabled', (cfg, v) => {
        if (!cfg.workflows) { cfg.workflows = {}; }
        cfg.workflows.enabled = v;
    }, 'live', featureToggle(
        'dev-tools',
        'Workflows Tab',
        'YAML workflow runner tab in repo view.',
        'toggle-workflows-enabled',
        false,
    )),
    bool('pullRequests.enabled', (cfg, v) => {
        if (!cfg.pullRequests) { cfg.pullRequests = {}; }
        cfg.pullRequests.enabled = v;
    }, 'live', featureToggle(
        'dev-tools',
        'Pull Requests Tab',
        'Pull request list tab in repo view.',
        'toggle-pull-requests-enabled',
        true,
    )),
    bool('pullRequests.suggestions', (cfg, v) => {
        if (!cfg.pullRequests) { cfg.pullRequests = {}; }
        cfg.pullRequests.suggestions = v;
    }, 'live', featureToggle(
        'dev-tools',
        'PR Review Suggestions',
        "AI-ranked suggestions for which open PRs to review, based on your review history. Adds a 'For You' filter pill to the PR queue.",
        'toggle-pull-requests-suggestions-enabled',
        false,
        { visibleWhen: { key: 'pullRequests.enabled', equals: true } },
    )),
    bool('pullRequests.autoClassifyTeam', (cfg, v) => {
        if (!cfg.pullRequests) { cfg.pullRequests = {}; }
        cfg.pullRequests.autoClassifyTeam = v;
    }, 'live', featureToggle(
        'dev-tools',
        'Auto-classify Team PRs',
        'Automatically queues lightweight diff classification for open Pull Requests tab Team roster PRs. Disabled by default.',
        'toggle-pull-requests-auto-classify-team-enabled',
        false,
        { visibleWhen: { key: 'pullRequests.enabled', equals: true } },
    )),
    bool('servers.enabled', (cfg, v) => {
        if (!cfg.servers) { cfg.servers = {}; }
        cfg.servers.enabled = v;
    }, 'live', featureToggle(
        'dev-tools',
        'Servers',
        'Multi-server connection manager (devtunnel).',
        'toggle-servers-enabled',
        true,
    )),
    bool('ralph.enabled', (cfg, v) => {
        if (!cfg.ralph) { cfg.ralph = {}; }
        cfg.ralph.enabled = v;
    }, 'live', featureToggle(
        'ai-modes',
        'Ralph Mode',
        'Autonomous iterative coding loop — stateless agents with fresh context per iteration.',
        'toggle-ralph-enabled',
        false,
        { badge: { label: 'Experimental', tone: 'accent' } },
    )),
    bool('forEach.enabled', (cfg, v) => {
        if (!cfg.forEach) { cfg.forEach = {}; }
        cfg.forEach.enabled = v;
    }, 'live', featureToggle(
        'ai-modes',
        'For Each Mode',
        'Generate a reviewed item plan from New Chat, then run each item as a separate child chat. Disabled by default.',
        'toggle-for-each-enabled',
        false,
        { badge: { label: 'Experimental', tone: 'accent' } },
    )),
    bool('mapReduce.enabled', (cfg, v) => {
        if (!cfg.mapReduce) { cfg.mapReduce = {}; }
        cfg.mapReduce.enabled = v;
    }, 'live', featureToggle(
        'ai-modes',
        'Map Reduce Mode',
        'Generate a reviewed map plan from New Chat, run items in parallel, then reduce outputs into one result. Disabled by default.',
        'toggle-map-reduce-enabled',
        false,
        { badge: { label: 'Experimental', tone: 'accent' } },
    )),
    {
        key: 'ralph.finalCheck.maxGapFixLoops',
        runtime: 'live' as AdminConfigFieldRuntime,
        validate: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1
            ? undefined
            : 'ralph.finalCheck.maxGapFixLoops must be a positive integer (≥ 1)',
        apply: (cfg, v) => {
            if (!cfg.ralph) { cfg.ralph = {}; }
            if (!cfg.ralph.finalCheck) { cfg.ralph.finalCheck = {}; }
            cfg.ralph.finalCheck.maxGapFixLoops = v as number;
        },
    },
    bool('vimNavigation.enabled', (cfg, v) => {
        if (!cfg.vimNavigation) { cfg.vimNavigation = {}; }
        cfg.vimNavigation.enabled = v;
    }, 'live', featureToggle(
        'infrastructure',
        'Vim-style navigation',
        'Enable hjkl pane navigation, j/k to step through chats and messages, gg/G to jump, i to focus the input, Esc to blur. Disabled by default.',
        'toggle-vim-navigation-enabled',
        false,
    )),
    bool('loops.enabled', (cfg, v) => {
        if (!cfg.loops) { cfg.loops = {}; }
        cfg.loops.enabled = v;
    }, 'restartRequired', featureToggle(
        'infrastructure',
        'Loops & Wakeups',
        'Recurring follow-up loops and one-shot scheduleWakeup tool. Disabled by default — toggling requires a server restart to (de)wire infrastructure.',
        'toggle-loops-enabled',
        true,
        { badge: { label: 'Restart', tone: 'warning' } },
    )),
    bool('excalidraw.enabled', (cfg, v) => {
        if (!cfg.excalidraw) { cfg.excalidraw = {}; }
        cfg.excalidraw.enabled = v;
    }, 'live', featureToggle(
        'review',
        'Excalidraw diagrams',
        'AI can generate and read Excalidraw diagrams during conversations. Disabled by default.',
        'toggle-excalidraw-enabled',
        false,
    )),
    bool('mcpOauth.enabled', (cfg, v) => {
        if (!cfg.mcpOauth) { cfg.mcpOauth = {}; }
        cfg.mcpOauth.enabled = v;
    }, 'restartRequired', featureToggle(
        'infrastructure',
        'MCP OAuth',
        'Handle OAuth flows for MCP servers that require authentication. Disabled by default — toggling requires a server restart.',
        'toggle-mcp-oauth-enabled',
        false,
        { badge: { label: 'Restart', tone: 'warning' } },
    )),
    bool('mcpOauth.autoRefresh.enabled', (cfg, v) => {
        if (!cfg.mcpOauth) { cfg.mcpOauth = {}; }
        if (!cfg.mcpOauth.autoRefresh) { cfg.mcpOauth.autoRefresh = {}; }
        cfg.mcpOauth.autoRefresh.enabled = v;
    }, 'restartRequired', featureToggle(
        'infrastructure',
        'MCP OAuth auto-refresh',
        "Periodically dedup ~/.copilot/mcp-oauth-config/ and refresh AAD-backed tokens before they expire so HTTP MCP servers don't re-prompt for auth. Disabled by default — toggling requires a server restart.",
        'toggle-mcp-oauth-auto-refresh-enabled',
        false,
        {
            badge: { label: 'Restart', tone: 'warning' },
            visibleWhen: { key: 'mcpOauth.enabled', equals: true },
        },
    )),
    bool('containerDefaultAgent.enabled', (cfg, v) => {
        if (!cfg.containerDefaultAgent) { cfg.containerDefaultAgent = {}; }
        cfg.containerDefaultAgent.enabled = v;
    }),
    bool('codex.enabled', (cfg, v) => {
        if (!cfg.codex) { cfg.codex = {}; }
        cfg.codex.enabled = v;
    }),
    bool('claude.enabled', (cfg, v) => {
        if (!cfg.claude) { cfg.claude = {}; }
        cfg.claude.enabled = v;
    }),
    {
        key: 'defaultProvider',
        runtime: 'restartRequired',
        validate: (v) => typeof v === 'string' && (VALID_DEFAULT_PROVIDER_VALUES as readonly string[]).includes(v)
            ? undefined
            : 'defaultProvider must be "copilot", "codex", or "claude"',
        apply: (cfg, v) => { cfg.defaultProvider = v as DefaultAgentProvider; },
    },
    {
        key: 'agentProviderRouting.auto',
        runtime: 'restartRequired',
        validate: validateAutoProviderRouting,
        apply: (cfg, v) => {
            if (!cfg.agentProviderRouting) { cfg.agentProviderRouting = {}; }
            cfg.agentProviderRouting.auto = v as AutoProviderRoutingConfig;
        },
    },

    bool('features.focusedDiff', (cfg, v) => {
        if (!cfg.features) { cfg.features = {}; }
        cfg.features.focusedDiff = v;
    }, 'live', featureToggle(
        'review',
        'Focused Diff',
        'AI-powered hunk classification for PR diffs. Highlights logic changes and dims mechanical edits.',
        'toggle-focused-diff-enabled',
        false,
    )),
    bool('features.gitCrossCloneCherryPick', (cfg, v) => {
        if (!cfg.features) { cfg.features = {}; }
        cfg.features.gitCrossCloneCherryPick = v;
    }, 'live', featureToggle(
        'review',
        'Cross-clone cherry-pick',
        'Adds a Git commit context-menu action that transfers one commit to another registered clone using patch export/apply. Enabled by default.',
        'toggle-git-cross-clone-cherry-pick-enabled',
        true,
        { badge: { label: 'Experimental', tone: 'accent' } },
    )),
    bool('features.sessionContextAttachments', (cfg, v) => {
        if (!cfg.features) { cfg.features = {}; }
        cfg.features.sessionContextAttachments = v;
    }, 'live', featureToggle(
        'review',
        'Session context attachments',
        'Allow dragging existing same-workspace chat sessions into chat composers as pointer-only context. Disabled by default.',
        'toggle-session-context-attachments-enabled',
        false,
        { badge: { label: 'Experimental', tone: 'accent' } },
    )),
    bool('features.commitChatLens', (cfg, v) => {
        if (!cfg.features) { cfg.features = {}; }
        cfg.features.commitChatLens = v;
    }, 'live', featureToggle(
        'review',
        'Review chat lens',
        'Open unpinned commit and pull-request review chat as a desktop bottom-right lens instead of the side panel or drawer. Disabled by default.',
        'toggle-commit-chat-lens-enabled',
        false,
        { badge: { label: 'Experimental', tone: 'accent' } },
    )),
    {
        key: 'features.commitChatLensDormantMode',
        runtime: 'live' as AdminConfigFieldRuntime,
        validate: (v) => (v === 'ghost' || v === 'pill') ? undefined : `features.commitChatLensDormantMode must be 'ghost' or 'pill'`,
        apply: (cfg, v) => {
            if (!cfg.features) { cfg.features = {}; }
            cfg.features.commitChatLensDormantMode = v as 'ghost' | 'pill';
        },
        ui: featureSelect(
            'review',
            'Lens dormant mode',
            'How the lens recedes when your cursor leaves it. Ghost fades to near-transparent; Pill collapses to a compact status pill.',
            'select-commit-chat-lens-dormant-mode',
            'ghost',
            [
                { value: 'ghost', label: 'Ghost fade' },
                { value: 'pill', label: 'Collapse to pill' },
            ],
            { key: 'features.commitChatLens', equals: true },
        ),
    },
    bool('features.autoAgentProviderRouting', (cfg, v) => {
        if (!cfg.features) { cfg.features = {}; }
        cfg.features.autoAgentProviderRouting = v;
    }, 'restartRequired'),

    bool('workItems.hierarchy.enabled', (cfg, v) => {
        if (!cfg.workItems) { cfg.workItems = {}; }
        if (!cfg.workItems.hierarchy) { cfg.workItems.hierarchy = {}; }
        cfg.workItems.hierarchy.enabled = v;
    }, 'live', featureToggle(
        'work-items',
        'Work Items Hierarchy Board',
        'Extends the Work Items tab into an Epic → Feature → PBI → Work Item / Bug hierarchy board. Enabled by default.',
        'toggle-work-items-hierarchy-enabled',
        true,
    )),

    bool('workItems.sync.enabled', (cfg, v) => {
        if (!cfg.workItems) { cfg.workItems = {}; }
        if (!cfg.workItems.sync) { cfg.workItems.sync = {}; }
        cfg.workItems.sync.enabled = v;
    }, 'live', featureToggle(
        'work-items',
        'Remote Work Items',
        'Enables remote provider integration for hierarchy mode: provider status, imports, save-to-provider updates, and background polling. Requires the hierarchy board and never stores provider tokens.',
        'toggle-work-items-sync-enabled',
        false,
        { badge: { label: 'Preview', tone: 'accent' } },
    )),

    bool('workItems.aiAuthoring.enabled', (cfg, v) => {
        if (!cfg.workItems) { cfg.workItems = {}; }
        if (!cfg.workItems.aiAuthoring) { cfg.workItems.aiAuthoring = {}; }
        cfg.workItems.aiAuthoring.enabled = v;
    }, 'live', featureToggle(
        'work-items',
        'Work Items AI Authoring',
        'Adds AI-assisted work item creation and improvement to the Work Items tab. Disabled by default.',
        'toggle-work-items-ai-authoring-enabled',
        false,
        { badge: { label: 'Experimental', tone: 'accent' } },
    )),

    bool('workItems.workflow.enabled', (cfg, v) => {
        if (!cfg.workItems) { cfg.workItems = {}; }
        if (!cfg.workItems.workflow) { cfg.workItems.workflow = {}; }
        cfg.workItems.workflow.enabled = v;
    }, 'live', featureToggle(
        'work-items',
        'Work Items Workflow',
        'Enables the durable Work Items/Goals command-center workflow. Disabled by default.',
        'toggle-work-items-workflow-enabled',
        false,
        { badge: { label: 'Experimental', tone: 'accent' } },
    )),

    bool('effortLevels.enabled', (cfg, v) => {
        if (!cfg.effortLevels) { cfg.effortLevels = {}; }
        cfg.effortLevels.enabled = v;
    }, 'live', featureToggle(
        'ai-modes',
        'Effort Tiers',
        'Replace the model picker + reasoning-effort pill in the chat composer with a single Low / Medium / High effort selector. Configure tier mappings per provider on the AI Provider page. Disabled by default.',
        'toggle-effort-levels-enabled',
        false,
        { badge: { label: 'Experimental', tone: 'accent' } },
    )),
];

/** Flat keys accepted by PUT /api/admin/config — derived from the registry. */
export const ADMIN_EDITABLE_KEYS: readonly string[] = ADMIN_CONFIG_FIELDS.map(f => f.key);

/** Admin feature settings surfaced by the registry-driven Features card. */
export const ADMIN_CONFIG_FEATURE_UI_FIELDS: readonly AdminConfigFeatureUiFieldSpec[] =
    ADMIN_CONFIG_FIELDS.filter((field): field is AdminConfigFeatureUiFieldSpec => field.ui?.surface === 'features');

/** Build a key→metadata map for API responses. */
export function getAdminFieldMetadata(): Record<string, AdminConfigFieldMetadata> {
    const meta: Record<string, AdminConfigFieldMetadata> = {};
    for (const field of ADMIN_CONFIG_FIELDS) {
        meta[field.key] = field.ui
            ? { runtime: field.runtime, ui: field.ui }
            : { runtime: field.runtime };
    }
    return meta;
}
