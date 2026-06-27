/**
 * Admin Setting Definitions — single source of truth for admin-editable config.
 *
 * ONE entry here drives everything derived elsewhere:
 *   - PUT /api/admin/config validation + merge      (server/admin/admin-config-fields.ts)
 *   - config-file schema validation                 (config/schema.ts)
 *   - resolved-config merge + source tracking       (config/namespace-registry.ts)
 *   - runtime dashboard feature flags + SPA embed   (server/config/runtime-config-handler.ts, server/index.ts)
 *   - the admin Features card UI                    (server/spa/client/react/admin/AdminPanel.tsx)
 *   - the generic contract test suite               (test/config/admin-setting-definitions.test.ts)
 *
 * To add a new admin-exposed setting:
 *   1. Add the field to CLIConfig / ResolvedCLIConfig and DEFAULT_CONFIG in config.ts
 *      (compile-time shape + default; a contract test enforces consistency).
 *   2. Add ONE definition entry below. Set `ui` to surface it on the admin
 *      Features card, and `runtimeFlag` to expose it to the dashboard SPA.
 *   3. Only if `runtimeFlag` is set: add the flag to RuntimeDashboardConfig.features
 *      in coc-client/src/contracts/admin.ts (cross-package type).
 *
 * This module must stay free of Node and zod imports — it is bundled into the
 * dashboard SPA client.
 */

import type { CLIConfig } from '../config';

/** Runtime behavior classification for admin-editable config fields. */
export type AdminConfigFieldRuntime = 'live' | 'reloadable' | 'restartRequired';

// ── value specs ───────────────────────────────────────────────────────────────

export type AdminSettingValueSpec =
    | { kind: 'boolean' }
    | {
        kind: 'string';
        nonEmpty?: boolean;
        maxLength?: number;
        /** Accept null/undefined; applying null clears the stored value. */
        nullable?: boolean;
        /** Applying '' also clears the stored value (requires nullable). */
        clearOnEmpty?: boolean;
        /** Validation error message override. */
        message?: string;
    }
    | {
        kind: 'number';
        integer?: boolean;
        /** Exclusive lower bound (value must be strictly greater). */
        gt?: number;
        min?: number;
        max?: number;
        /** Accept null; applying null clears the stored value. */
        nullable?: boolean;
        /** Validation error message override. */
        message?: string;
    }
    | {
        kind: 'enum';
        values: readonly string[];
        /** Accept null/undefined; applying null clears the stored value. */
        nullable?: boolean;
        /** Validation error message override. */
        message?: string;
    }
    | {
        kind: 'custom';
        validate: (value: unknown) => string | undefined;
    };

// ── UI specs (admin Features card) ────────────────────────────────────────────

export type FeatureGroupId = 'dashboard' | 'devTools' | 'workItems' | 'aiModes' | 'review' | 'infrastructure';

export interface FeatureGroupSpec {
    id: FeatureGroupId;
    heading: string;
    testId: string;
}

/** Ordered groups rendered in the admin Features card. */
export const FEATURE_CARD_GROUPS: readonly FeatureGroupSpec[] = [
    { id: 'dashboard', heading: 'Dashboard Modules', testId: 'feature-group-dashboard' },
    { id: 'devTools', heading: 'Development Tools', testId: 'feature-group-dev-tools' },
    { id: 'workItems', heading: 'Work Items', testId: 'feature-group-work-items' },
    { id: 'aiModes', heading: 'AI Execution Modes', testId: 'feature-group-ai-modes' },
    { id: 'review', heading: 'Code Review & Collaboration', testId: 'feature-group-review' },
    { id: 'infrastructure', heading: 'Infrastructure', testId: 'feature-group-infrastructure' },
];

export type AdminSettingBadge = 'restart' | 'experimental' | 'preview';

export interface AdminSettingUiSpec {
    group: FeatureGroupId;
    /** Render order within the group (ascending). */
    order: number;
    label: string;
    hint: string;
    badge?: AdminSettingBadge;
    /** Only render when this other (boolean) setting is currently on. */
    dependsOn?: string;
    /** Defaults to a toggle when omitted. */
    control?: { type: 'select'; options: readonly { value: string; label: string }[] };
    testId: string;
}

// ── definition ────────────────────────────────────────────────────────────────

export interface AdminSettingDefinition {
    /** Flat dot-notation key used in PUT /api/admin/config, e.g. 'loops.enabled'. */
    key: string;
    value: AdminSettingValueSpec;
    /** Resolved default — must match DEFAULT_CONFIG (enforced by contract test). */
    default: unknown;
    /** Runtime behavior: 'live' (immediate), 'reloadable', or 'restartRequired'. */
    runtime: AdminConfigFieldRuntime;
    /**
     * Value assumed when the config object has no value at `key`.
     * Used by the runtime feature-flag builder and the admin UI loader.
     * Defaults to `default`; override only for bootstrap-conservative flags
     * that must read as off/legacy when absent from a partial config.
     */
    absentFallback?: unknown;
    /**
     * Property name in RuntimeDashboardConfig.features. When set, the value is
     * exposed to the dashboard SPA (embedded bootstrap + GET /api/config/runtime).
     */
    runtimeFlag?: string;
    /**
     * Skip the generic resolved-config merge for this key — a hand-written
     * namespace descriptor in namespace-registry.ts owns its resolution.
     */
    customMerge?: boolean;
    /** Admin Features card exposure. Omit for settings rendered bespoke elsewhere. */
    ui?: AdminSettingUiSpec;
}

// ── path helpers ──────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the value at a dot-notation path, or undefined when absent. */
export function getConfigValueAtPath(config: unknown, key: string): unknown {
    let current: unknown = config;
    for (const segment of key.split('.')) {
        if (!isPlainObject(current)) return undefined;
        current = current[segment];
    }
    return current;
}

/** Write a value at a dot-notation path, creating intermediate objects. */
export function setConfigValueAtPath(config: Record<string, unknown>, key: string, value: unknown): void {
    const segments = key.split('.');
    let current: Record<string, unknown> = config;
    for (const segment of segments.slice(0, -1)) {
        if (!isPlainObject(current[segment])) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
    }
    current[segments[segments.length - 1]] = value;
}

/** Delete the value at a dot-notation path. No-op when a container is absent. */
export function deleteConfigValueAtPath(config: Record<string, unknown>, key: string): void {
    const segments = key.split('.');
    let current: unknown = config;
    for (const segment of segments.slice(0, -1)) {
        if (!isPlainObject(current)) return;
        current = current[segment];
    }
    if (isPlainObject(current)) {
        delete current[segments[segments.length - 1]];
    }
}

// ── validation / apply derivation ─────────────────────────────────────────────

function numberMessage(key: string, spec: Extract<AdminSettingValueSpec, { kind: 'number' }>): string {
    if (spec.message) return spec.message;
    let base: string;
    if (spec.integer && spec.min !== undefined && spec.max !== undefined) {
        base = `${key} must be an integer between ${spec.min} and ${spec.max}`;
    } else if (spec.integer && spec.min !== undefined) {
        base = `${key} must be a positive integer (≥ ${spec.min})`;
    } else if (spec.gt !== undefined) {
        base = `${key} must be a number greater than ${spec.gt}`;
    } else {
        base = `${key} must be a number`;
    }
    return spec.nullable ? `${base}, or null to clear` : base;
}

function stringMessage(key: string, spec: Extract<AdminSettingValueSpec, { kind: 'string' }>): string {
    if (spec.message) return spec.message;
    let base: string;
    if (spec.nonEmpty) {
        base = `${key} must be a non-empty string`;
    } else if (spec.maxLength !== undefined) {
        base = `${key} must be a string of at most ${spec.maxLength} characters`;
    } else {
        base = `${key} must be a string`;
    }
    return spec.nullable ? `${base}, or null to clear` : base;
}

/** Validate a candidate value against a definition. Returns an error message or undefined. */
export function validateAdminSettingValue(def: AdminSettingDefinition, value: unknown): string | undefined {
    const spec = def.value;
    switch (spec.kind) {
        case 'boolean':
            return typeof value === 'boolean' ? undefined : `${def.key} must be a boolean`;
        case 'string': {
            if (spec.nullable && (value === null || value === undefined)) return undefined;
            const ok = typeof value === 'string'
                && (!spec.nonEmpty || value.length > 0)
                && (spec.maxLength === undefined || value.length <= spec.maxLength);
            return ok ? undefined : stringMessage(def.key, spec);
        }
        case 'number': {
            if (spec.nullable && (value === null || value === undefined)) return undefined;
            const ok = typeof value === 'number'
                && (!spec.integer || Number.isInteger(value))
                && (spec.gt === undefined || value > spec.gt)
                && (spec.min === undefined || value >= spec.min)
                && (spec.max === undefined || value <= spec.max);
            return ok ? undefined : numberMessage(def.key, spec);
        }
        case 'enum': {
            if (spec.nullable && (value === null || value === undefined)) return undefined;
            const ok = typeof value === 'string' && spec.values.includes(value);
            const base = spec.message ?? `${def.key} must be one of: ${spec.values.join(', ')}`;
            return ok ? undefined : (spec.nullable ? `${base}, or null to clear` : base);
        }
        case 'custom':
            return spec.validate(value);
    }
}

/** Whether applying this (already-validated) value clears the stored field. */
function clearsStoredValue(def: AdminSettingDefinition, value: unknown): boolean {
    const spec = def.value;
    if (spec.kind === 'number' && spec.nullable) return value === null;
    if (spec.kind === 'string' && spec.nullable) {
        return value === null || (spec.clearOnEmpty === true && value === '');
    }
    if (spec.kind === 'enum' && spec.nullable) return value === null;
    return false;
}

/** Write an (already-validated) value into the CLIConfig that will be persisted. */
export function applyAdminSettingValue(config: CLIConfig, def: AdminSettingDefinition, value: unknown): void {
    const target = config as unknown as Record<string, unknown>;
    if (clearsStoredValue(def, value)) {
        deleteConfigValueAtPath(target, def.key);
    } else {
        setConfigValueAtPath(target, def.key, value);
    }
}

// ── reading values back (runtime flags + admin UI) ────────────────────────────

/**
 * Read the current value for a setting from a (possibly partial) config object,
 * falling back to `absentFallback ?? default` when absent or invalid.
 */
export function readAdminSettingValue(def: AdminSettingDefinition, config: unknown): unknown {
    const raw = getConfigValueAtPath(config, def.key);
    if (raw !== undefined && validateAdminSettingValue(def, raw) === undefined) {
        return raw;
    }
    return def.absentFallback !== undefined ? def.absentFallback : def.default;
}

/**
 * Build the RuntimeDashboardConfig.features flags derived from the registry.
 * Flags not backed by an admin setting (e.g. gitCommitLookupEnabled) are added
 * by the caller.
 */
export function buildRuntimeFeatureFlags(config: unknown): Record<string, unknown> {
    const flags: Record<string, unknown> = {};
    for (const def of ADMIN_SETTING_DEFINITIONS) {
        if (def.runtimeFlag) {
            flags[def.runtimeFlag] = readAdminSettingValue(def, config);
        }
    }
    return flags;
}

// ── agentProviderRouting.auto custom validation ───────────────────────────────

const VALID_CONCRETE_PROVIDER_VALUES = ['copilot', 'codex', 'claude', 'opencode'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConcreteProvider(value: unknown): boolean {
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

const DEFAULT_AUTO_PROVIDER_ROUTING = {
    rules: [
        { provider: 'claude', enabled: true, minimumRemainingPercent: 33, weeklyGuard: { enabled: true, minimumRemainingPercent: 33 } },
        { provider: 'codex', enabled: true, minimumRemainingPercent: 33, weeklyGuard: { enabled: true, minimumRemainingPercent: 33 } },
        { provider: 'copilot', enabled: true, minimumRemainingPercent: 10, weeklyGuard: { enabled: true, minimumRemainingPercent: 10 } },
    ],
    fallbackProvider: 'copilot',
} as const;

// ── shared value helpers ──────────────────────────────────────────────────────

const bool = (def: Omit<AdminSettingDefinition, 'value'>): AdminSettingDefinition => ({
    ...def,
    value: { kind: 'boolean' },
});

// ── the registry ──────────────────────────────────────────────────────────────

/**
 * All admin-editable config settings.
 *
 * `absentFallback` overrides encode today's bootstrap-conservative reads: these
 * flags read as off/legacy when a partial config lacks them, even though the
 * resolved default is on. Resolved configs always carry every field, so the
 * fallbacks only matter for partial configs (tests, legacy snapshots).
 */
export const ADMIN_SETTING_DEFINITIONS: readonly AdminSettingDefinition[] = [
    // ── AI execution ──────────────────────────────────────────────────────────
    {
        key: 'model',
        value: { kind: 'string', nonEmpty: true },
        default: undefined,
        runtime: 'live',
    },
    {
        // integer matches the file schema; the admin API previously accepted
        // decimals it could not re-load from disk.
        key: 'parallel',
        value: { kind: 'number', integer: true, gt: 0 },
        default: 5,
        runtime: 'live',
    },
    {
        key: 'timeout',
        value: { kind: 'number', gt: 0, nullable: true },
        default: undefined,
        runtime: 'live',
    },
    {
        key: 'output',
        value: { kind: 'enum', values: ['table', 'json', 'csv', 'markdown'] },
        default: 'table',
        runtime: 'live',
    },

    // ── display / UI ──────────────────────────────────────────────────────────
    bool({ key: 'showReportIntent', default: false, runtime: 'live' }),
    {
        key: 'toolCompactness',
        value: { kind: 'number', integer: true, min: 0, max: 3, message: 'toolCompactness must be 0, 1, 2, or 3' },
        default: 3,
        runtime: 'live',
    },
    {
        key: 'taskCardDensity',
        value: { kind: 'enum', values: ['compact', 'dense'], message: 'taskCardDensity must be "compact" or "dense"' },
        default: 'dense',
        runtime: 'live',
    },
    bool({ key: 'groupSingleLineMessages', default: true, runtime: 'live' }),

    // ── serve ─────────────────────────────────────────────────────────────────
    {
        key: 'serve.serverName',
        value: { kind: 'string', maxLength: 64, nullable: true, clearOnEmpty: true },
        default: undefined,
        runtime: 'live',
    },

    // ── chat ──────────────────────────────────────────────────────────────────
    bool({ key: 'chat.followUpSuggestions.enabled', default: true, runtime: 'live' }),
    {
        key: 'chat.followUpSuggestions.count',
        value: { kind: 'number', integer: true, min: 1, max: 5 },
        default: 3,
        runtime: 'live',
    },
    bool({ key: 'chat.askUser.enabled', default: true, runtime: 'live' }),
    {
        // Global system prompt injected into user-facing agent sessions across
        // all providers. Rendered bespoke on Admin -> System Prompts (no `ui`).
        // Live so edits apply without a server restart; nullable + clearOnEmpty
        // so saving an empty prompt clears the stored value.
        key: 'chat.globalSystemPrompt',
        value: { kind: 'string', nullable: true, clearOnEmpty: true },
        default: undefined,
        runtime: 'live',
    },

    // ── feature flags ─────────────────────────────────────────────────────────
    bool({
        key: 'terminal.enabled', default: true, runtime: 'restartRequired', runtimeFlag: 'terminalEnabled',
        ui: {
            group: 'devTools', order: 10, label: 'Terminal', badge: 'restart',
            hint: 'Web terminal for shell access to the server machine. Toggling requires a server restart.',
            testId: 'toggle-terminal-enabled',
        },
    }),
    bool({
        key: 'notes.enabled', default: true, runtime: 'live', runtimeFlag: 'notesEnabled',
        ui: {
            group: 'dashboard', order: 10, label: 'Notes',
            hint: 'Markdown notebooks for creating and editing notes.',
            testId: 'toggle-notes-enabled',
        },
    }),
    bool({
        key: 'myWork.enabled', default: false, runtime: 'live', runtimeFlag: 'myWorkEnabled',
        ui: {
            group: 'dashboard', order: 20, label: 'My Work',
            hint: 'Personal landing page with action items and weekly summaries.',
            testId: 'toggle-mywork-enabled',
        },
    }),
    bool({
        key: 'myLife.enabled', default: false, runtime: 'live', runtimeFlag: 'myLifeEnabled',
        ui: {
            group: 'dashboard', order: 30, label: 'My Life',
            hint: 'Personal page with goals, journal, and life admin.',
            testId: 'toggle-mylife-enabled',
        },
    }),
    bool({
        key: 'scratchpad.enabled', default: true, absentFallback: false, runtime: 'live', runtimeFlag: 'scratchpadEnabled',
        ui: {
            group: 'dashboard', order: 40, label: 'Scratchpad panel',
            hint: 'Bottom-split note editor inside the chat detail view.',
            testId: 'toggle-scratchpad-enabled',
        },
    }),
    {
        key: 'scratchpad.layout',
        value: { kind: 'enum', values: ['horizontal', 'vertical'], message: 'scratchpad.layout must be "horizontal" or "vertical"' },
        default: 'vertical',
        absentFallback: 'horizontal',
        runtime: 'live',
        runtimeFlag: 'scratchpadLayout',
        ui: {
            group: 'dashboard', order: 50, label: 'Layout', dependsOn: 'scratchpad.enabled',
            hint: 'Split direction for conversation and scratchpad.',
            control: {
                type: 'select',
                options: [
                    { value: 'horizontal', label: 'Horizontal (top/bottom)' },
                    { value: 'vertical', label: 'Vertical (left/right)' },
                ],
            },
            testId: 'select-scratchpad-layout',
        },
    },
    bool({
        key: 'workflows.enabled', default: false, runtime: 'live', runtimeFlag: 'workflowsEnabled',
        ui: {
            group: 'devTools', order: 20, label: 'Workflows Tab',
            hint: 'YAML workflow runner tab in repo view.',
            testId: 'toggle-workflows-enabled',
        },
    }),
    bool({
        key: 'pullRequests.enabled', default: true, absentFallback: false, runtime: 'live', runtimeFlag: 'pullRequestsEnabled',
        ui: {
            group: 'devTools', order: 30, label: 'Pull Requests Tab',
            hint: 'Pull request list tab in repo view.',
            testId: 'toggle-pull-requests-enabled',
        },
    }),
    bool({
        key: 'pullRequests.suggestions', default: false, runtime: 'live', runtimeFlag: 'pullRequestsSuggestionsEnabled',
        ui: {
            group: 'devTools', order: 40, label: 'PR Review Suggestions', dependsOn: 'pullRequests.enabled',
            hint: "AI-ranked suggestions for which open PRs to review, based on your review history. Adds a 'For You' filter pill to the PR queue.",
            testId: 'toggle-pull-requests-suggestions-enabled',
        },
    }),
    bool({
        key: 'pullRequests.autoClassifyTeam', default: false, runtime: 'live', runtimeFlag: 'pullRequestsAutoClassifyTeamEnabled',
        ui: {
            group: 'devTools', order: 50, label: 'Auto-classify Team PRs', dependsOn: 'pullRequests.enabled',
            hint: 'Automatically queues lightweight diff classification for open Pull Requests tab Team roster PRs. Disabled by default.',
            testId: 'toggle-pull-requests-auto-classify-team-enabled',
        },
    }),
    bool({
        key: 'servers.enabled', default: true, absentFallback: false, runtime: 'live', runtimeFlag: 'serversEnabled',
        ui: {
            group: 'devTools', order: 60, label: 'Servers',
            hint: 'Multi-server connection manager (devtunnel).',
            testId: 'toggle-servers-enabled',
        },
    }),
    bool({
        key: 'ralph.enabled', default: false, runtime: 'live', runtimeFlag: 'ralphEnabled',
        ui: {
            group: 'aiModes', order: 10, label: 'Ralph Mode', badge: 'experimental',
            hint: 'Autonomous iterative coding loop — stateless agents with fresh context per iteration.',
            testId: 'toggle-ralph-enabled',
        },
    }),
    bool({
        key: 'forEach.enabled', default: false, runtime: 'live', runtimeFlag: 'forEachEnabled',
        ui: {
            group: 'aiModes', order: 20, label: 'For Each Mode', badge: 'experimental',
            hint: 'Generate a reviewed item plan from New Chat, then run each item as a separate child chat. Disabled by default.',
            testId: 'toggle-for-each-enabled',
        },
    }),
    bool({
        key: 'mapReduce.enabled', default: false, runtime: 'live', runtimeFlag: 'mapReduceEnabled',
        ui: {
            group: 'aiModes', order: 30, label: 'Map Reduce Mode', badge: 'experimental',
            hint: 'Generate a reviewed map plan from New Chat, run items in parallel, then reduce outputs into one result. Disabled by default.',
            testId: 'toggle-map-reduce-enabled',
        },
    }),
    {
        key: 'ralph.finalCheck.maxGapFixLoops',
        value: { kind: 'number', integer: true, min: 1 },
        default: 3,
        runtime: 'live',
    },
    bool({
        key: 'vimNavigation.enabled', default: false, runtime: 'live', runtimeFlag: 'vimNavigationEnabled',
        ui: {
            group: 'infrastructure', order: 40, label: 'Vim-style navigation',
            hint: 'Enable hjkl pane navigation, j/k to step through chats and messages, gg/G to jump, i to focus the input, Esc to blur. Disabled by default.',
            testId: 'toggle-vim-navigation-enabled',
        },
    }),
    bool({
        key: 'loops.enabled', default: true, absentFallback: false, runtime: 'restartRequired', runtimeFlag: 'loopsEnabled',
        ui: {
            group: 'infrastructure', order: 10, label: 'Loops & Wakeups', badge: 'restart',
            hint: 'Recurring follow-up loops and one-shot scheduleWakeup tool. Disabled by default — toggling requires a server restart to (de)wire infrastructure.',
            testId: 'toggle-loops-enabled',
        },
    }),
    bool({
        key: 'triggers.enabled', default: false, runtime: 'restartRequired', runtimeFlag: 'triggersEnabled',
        ui: {
            group: 'infrastructure', order: 11, label: 'Triggers (CI auto-fix)', badge: 'restart',
            hint: 'Event → action triggers, including the PR-banner CI auto-fix monitor. Disabled by default — toggling requires a server restart to (de)wire infrastructure.',
            testId: 'toggle-triggers-enabled',
        },
    }),
    // `dreams.enabled` is rendered bespoke in the admin Dreams tab
    // (Knowledge nav group), not on the general Settings → Features grid, so it
    // intentionally omits a `ui` block. Runtime flag + PUT validation are unchanged.
    bool({
        key: 'dreams.enabled', default: false, runtime: 'live', runtimeFlag: 'dreamsEnabled',
    }),
    {
        key: 'dreams.provider',
        value: { kind: 'enum', values: ['copilot', 'codex', 'claude', 'opencode'], nullable: true, message: 'dreams.provider must be "copilot", "codex", "claude", or "opencode"' },
        default: undefined,
        runtime: 'live',
    },
    {
        key: 'dreams.model',
        value: { kind: 'string', nullable: true, clearOnEmpty: true },
        default: undefined,
        runtime: 'live',
    },
    {
        key: 'dreams.idleCheckIntervalMs',
        value: { kind: 'number', integer: true, gt: 0, message: 'dreams.idleCheckIntervalMs must be a positive integer number of milliseconds' },
        default: 5 * 60 * 1000,
        runtime: 'restartRequired',
    },
    {
        key: 'dreams.timeoutMs',
        value: { kind: 'number', integer: true, gt: 0, message: 'dreams.timeoutMs must be a positive integer number of milliseconds' },
        default: 3_600_000,
        runtime: 'live',
    },
    bool({
        key: 'excalidraw.enabled', default: false, runtime: 'live', runtimeFlag: 'excalidrawEnabled',
        ui: {
            group: 'review', order: 60, label: 'Excalidraw diagrams',
            hint: 'AI can generate and read Excalidraw diagrams during conversations. Disabled by default.',
            testId: 'toggle-excalidraw-enabled',
        },
    }),
    bool({
        key: 'canvas.enabled', default: false, runtime: 'live', runtimeFlag: 'canvasEnabled',
        ui: {
            group: 'review', order: 61, label: 'Canvas panel', badge: 'experimental',
            hint: 'AI can maintain a markdown document in a side panel next to the chat, with live user co-editing. Disabled by default.',
            testId: 'toggle-canvas-enabled',
        },
    }),
    bool({
        key: 'mcpOauth.enabled', default: false, runtime: 'restartRequired', runtimeFlag: 'mcpOauthEnabled',
        ui: {
            group: 'infrastructure', order: 20, label: 'MCP OAuth', badge: 'restart',
            hint: 'Handle OAuth flows for MCP servers that require authentication. Disabled by default — toggling requires a server restart.',
            testId: 'toggle-mcp-oauth-enabled',
        },
    }),
    bool({
        key: 'mcpOauth.autoRefresh.enabled', default: false, runtime: 'restartRequired',
        ui: {
            group: 'infrastructure', order: 30, label: 'MCP OAuth auto-refresh', badge: 'restart', dependsOn: 'mcpOauth.enabled',
            hint: "Periodically dedup ~/.copilot/mcp-oauth-config/ and refresh AAD-backed tokens before they expire so HTTP MCP servers don't re-prompt for auth. Disabled by default — toggling requires a server restart.",
            testId: 'toggle-mcp-oauth-auto-refresh-enabled',
        },
    }),
    bool({ key: 'containerDefaultAgent.enabled', default: false, runtime: 'live', runtimeFlag: 'containerDefaultAgentEnabled' }),
    bool({ key: 'codex.enabled', default: false, runtime: 'live', runtimeFlag: 'codexEnabled' }),
    bool({ key: 'claude.enabled', default: false, runtime: 'live', runtimeFlag: 'claudeEnabled' }),
    bool({ key: 'opencode.enabled', default: false, runtime: 'live', runtimeFlag: 'opencodeEnabled' }),
    {
        key: 'defaultProvider',
        value: { kind: 'enum', values: ['copilot', 'codex', 'claude', 'opencode'], message: 'defaultProvider must be "copilot", "codex", "claude", or "opencode"' },
        default: 'copilot',
        runtime: 'restartRequired',
        runtimeFlag: 'defaultProvider',
    },
    {
        key: 'agentProviderRouting.auto',
        value: { kind: 'custom', validate: validateAutoProviderRouting },
        default: DEFAULT_AUTO_PROVIDER_ROUTING,
        runtime: 'restartRequired',
        customMerge: true,
    },

    bool({
        key: 'features.focusedDiff', default: false, runtime: 'live', runtimeFlag: 'focusedDiffEnabled',
        ui: {
            group: 'review', order: 10, label: 'Focused Diff',
            hint: 'AI-powered hunk classification for PR diffs. Highlights logic changes and dims mechanical edits.',
            testId: 'toggle-focused-diff-enabled',
        },
    }),
    bool({
        key: 'features.gitCrossCloneCherryPick', default: true, absentFallback: false, runtime: 'live', runtimeFlag: 'gitCrossCloneCherryPickEnabled',
        ui: {
            group: 'review', order: 20, label: 'Cross-clone cherry-pick', badge: 'experimental',
            hint: 'Adds a Git commit context-menu action that transfers one commit to another registered clone using patch export/apply. Enabled by default.',
            testId: 'toggle-git-cross-clone-cherry-pick-enabled',
        },
    }),
    bool({
        key: 'features.sessionContextAttachments', default: false, runtime: 'live', runtimeFlag: 'sessionContextAttachmentsEnabled',
        ui: {
            group: 'review', order: 30, label: 'Session context attachments', badge: 'experimental',
            hint: 'Allow dragging existing same-workspace chat sessions into chat composers as pointer-only context. Disabled by default.',
            testId: 'toggle-session-context-attachments-enabled',
        },
    }),
    bool({
        key: 'features.commitChatLens', default: false, runtime: 'live', runtimeFlag: 'commitChatLensEnabled',
        ui: {
            group: 'review', order: 40, label: 'Review chat lens', badge: 'experimental',
            hint: 'Open unpinned commit and pull-request review chat as a desktop bottom-right lens instead of the side panel or drawer. Disabled by default.',
            testId: 'toggle-commit-chat-lens-enabled',
        },
    }),
    {
        key: 'features.commitChatLensDormantMode',
        value: { kind: 'enum', values: ['ghost', 'pill'], message: "features.commitChatLensDormantMode must be 'ghost' or 'pill'" },
        default: 'ghost',
        runtime: 'live',
        runtimeFlag: 'commitChatLensDormantMode',
        ui: {
            group: 'review', order: 50, label: 'Lens dormant mode', dependsOn: 'features.commitChatLens',
            hint: 'How the lens recedes when your cursor leaves it. Ghost fades to near-transparent; Pill collapses to a compact status pill.',
            control: {
                type: 'select',
                options: [
                    { value: 'ghost', label: 'Ghost fade' },
                    { value: 'pill', label: 'Collapse to pill' },
                ],
            },
            testId: 'select-commit-chat-lens-dormant-mode',
        },
    },
    bool({ key: 'features.autoAgentProviderRouting', default: false, runtime: 'restartRequired', runtimeFlag: 'autoAgentProviderRoutingEnabled' }),
    bool({
        key: 'features.nativeCliSessions', default: false, runtime: 'live', runtimeFlag: 'nativeCliSessionsEnabled',
        ui: {
            group: 'dashboard', order: 60, label: 'Native CLI sessions', badge: 'experimental',
            hint: 'Read-only CLI Sessions tab that lists native Copilot, Codex, and Claude Code sessions for the active workspace. Disabled by default.',
            testId: 'toggle-native-cli-sessions-enabled',
        },
    }),
    bool({
        key: 'features.remoteShell', default: false, runtime: 'live', runtimeFlag: 'remoteShellEnabled',
        ui: {
            group: 'dashboard', order: 65, label: 'Remote-first shell', badge: 'experimental',
            hint: 'Replace per-clone repo tabs with a remote-first two-row top bar: one tab per git remote, a clone switcher, and remote/clone-scoped sub-tabs. Desktop only. Disabled by default.',
            testId: 'toggle-remote-shell-enabled',
        },
    }),
    bool({
        key: 'features.ralphMultiAgentGrill', default: false, runtime: 'live', runtimeFlag: 'ralphMultiAgentGrillEnabled',
        ui: {
            group: 'aiModes', order: 15, label: 'Ralph Multi-Agent Grilling', badge: 'experimental',
            hint: 'Adds the question planning setup card, separate grill-agent calls, dedupe, provenance, and grouped consolidated questions to Ralph grilling. Disabled by default.',
            testId: 'toggle-ralph-multi-agent-grill-enabled',
        },
    }),

    bool({
        key: 'workItems.hierarchy.enabled', default: true, absentFallback: false, runtime: 'live', runtimeFlag: 'workItemsHierarchyEnabled',
        ui: {
            group: 'workItems', order: 10, label: 'Work Items Hierarchy Board',
            hint: 'Extends the Work Items tab into an Epic → Feature → PBI → Work Item / Bug hierarchy board. Enabled by default.',
            testId: 'toggle-work-items-hierarchy-enabled',
        },
    }),
    bool({
        key: 'workItems.sync.enabled', default: false, runtime: 'live', runtimeFlag: 'workItemsSyncEnabled',
        ui: {
            group: 'workItems', order: 20, label: 'Remote Work Items', badge: 'preview',
            hint: 'Enables remote provider integration for hierarchy mode: provider status, imports, save-to-provider updates, and background polling. Requires the hierarchy board and never stores provider tokens.',
            testId: 'toggle-work-items-sync-enabled',
        },
    }),
    bool({
        key: 'workItems.aiAuthoring.enabled', default: false, runtime: 'live', runtimeFlag: 'workItemsAiAuthoringEnabled',
        ui: {
            group: 'workItems', order: 30, label: 'Work Items AI Authoring', badge: 'experimental',
            hint: 'Adds AI-assisted work item creation and improvement to the Work Items tab. Disabled by default.',
            testId: 'toggle-work-items-ai-authoring-enabled',
        },
    }),
    bool({
        key: 'workItems.workflow.enabled', default: false, runtime: 'live', runtimeFlag: 'workItemsWorkflowEnabled',
        ui: {
            group: 'workItems', order: 40, label: 'Work Items Workflow', badge: 'experimental',
            hint: 'Enables the durable Work Items/Goals command-center workflow. Disabled by default.',
            testId: 'toggle-work-items-workflow-enabled',
        },
    }),

    bool({
        key: 'effortLevels.enabled', default: false, runtime: 'live', runtimeFlag: 'effortLevelsEnabled',
        ui: {
            group: 'aiModes', order: 40, label: 'Effort Tiers', badge: 'experimental',
            hint: 'Replace the model picker + reasoning-effort pill in the chat composer with a single Low / Medium / High effort selector. Configure tier mappings per provider on the AI Provider page. Disabled by default.',
            testId: 'toggle-effort-levels-enabled',
        },
    }),
];

// ── derived views ─────────────────────────────────────────────────────────────

/** All flat keys, in registry order. */
export const ADMIN_SETTING_KEYS: readonly string[] = ADMIN_SETTING_DEFINITIONS.map(d => d.key);

/** Dot-notation (namespaced) keys — tracked by the namespace registry. */
export const NAMESPACED_ADMIN_SETTING_KEYS: readonly string[] =
    ADMIN_SETTING_KEYS.filter(key => key.includes('.'));

/** Look up a definition by flat key. */
export function getAdminSettingDefinition(key: string): AdminSettingDefinition | undefined {
    return ADMIN_SETTING_DEFINITIONS.find(d => d.key === key);
}

/** Settings surfaced on the admin Features card, sorted by group order. */
export function getFeatureCardSettings(group: FeatureGroupId): readonly AdminSettingDefinition[] {
    return ADMIN_SETTING_DEFINITIONS
        .filter(d => d.ui?.group === group)
        .sort((a, b) => (a.ui!.order - b.ui!.order));
}
