/**
 * Admin Config Field Registry
 *
 * Single source of truth for editable admin config fields.
 * Each entry defines the flat key, a validator, and an apply function.
 *
 * To add a new editable admin config field:
 *   1. Add the field to CLIConfig / ResolvedCLIConfig in config.ts (if structural)
 *   2. Add a default in DEFAULT_CONFIG in config.ts
 *   3. Add schema validation in config/schema.ts
 *   4. Add namespace tracking in config/namespace-registry.ts (for nested fields)
 *   5. Add ONE entry here — the admin handler picks it up automatically
 *   6. Update AdminResolvedConfig / AdminConfigUpdate in coc-client/src/contracts/admin.ts
 *   7. Add UI in AdminPanel.tsx
 */

import type { CLIConfig } from '../../config';

/** Runtime behavior classification for admin-editable config fields. */
export type AdminConfigFieldRuntime = 'live' | 'reloadable' | 'restartRequired';

export interface AdminConfigFieldSpec {
    /** Flat key used in the PUT /api/admin/config request body, e.g. 'loops.enabled' */
    key: string;
    /** Runtime behavior: 'live' (immediate), 'reloadable', or 'restartRequired' */
    runtime: AdminConfigFieldRuntime;
    /** Return an error message string if invalid, undefined if valid */
    validate: (value: unknown) => string | undefined;
    /** Write the (already-validated) value into the CLIConfig that will be persisted */
    apply: (config: CLIConfig, value: unknown) => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const bool = (key: string, set: (cfg: CLIConfig, v: boolean) => void, runtime: AdminConfigFieldRuntime = 'live'): AdminConfigFieldSpec => ({
    key,
    runtime,
    validate: (v) => typeof v === 'boolean' ? undefined : `${key} must be a boolean`,
    apply: (cfg, v) => set(cfg, v as boolean),
});

const VALID_OUTPUT_VALUES = ['table', 'json', 'csv', 'markdown'] as const;

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
    }, 'restartRequired'),
    bool('notes.enabled', (cfg, v) => {
        if (!cfg.notes) { cfg.notes = {}; }
        cfg.notes.enabled = v;
    }),
    bool('myWork.enabled', (cfg, v) => {
        if (!cfg.myWork) { cfg.myWork = {}; }
        cfg.myWork.enabled = v;
    }),
    bool('myLife.enabled', (cfg, v) => {
        if (!cfg.myLife) { cfg.myLife = {}; }
        cfg.myLife.enabled = v;
    }),
    bool('scratchpad.enabled', (cfg, v) => {
        if (!cfg.scratchpad) { cfg.scratchpad = {}; }
        cfg.scratchpad.enabled = v;
    }),
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
    },
    bool('workflows.enabled', (cfg, v) => {
        if (!cfg.workflows) { cfg.workflows = {}; }
        cfg.workflows.enabled = v;
    }),
    bool('pullRequests.enabled', (cfg, v) => {
        if (!cfg.pullRequests) { cfg.pullRequests = {}; }
        cfg.pullRequests.enabled = v;
    }),
    bool('pullRequests.suggestions', (cfg, v) => {
        if (!cfg.pullRequests) { cfg.pullRequests = {}; }
        cfg.pullRequests.suggestions = v;
    }),
    bool('servers.enabled', (cfg, v) => {
        if (!cfg.servers) { cfg.servers = {}; }
        cfg.servers.enabled = v;
    }),
    bool('ralph.enabled', (cfg, v) => {
        if (!cfg.ralph) { cfg.ralph = {}; }
        cfg.ralph.enabled = v;
    }),
    bool('vimNavigation.enabled', (cfg, v) => {
        if (!cfg.vimNavigation) { cfg.vimNavigation = {}; }
        cfg.vimNavigation.enabled = v;
    }),
    bool('loops.enabled', (cfg, v) => {
        if (!cfg.loops) { cfg.loops = {}; }
        cfg.loops.enabled = v;
    }, 'restartRequired'),
    bool('excalidraw.enabled', (cfg, v) => {
        if (!cfg.excalidraw) { cfg.excalidraw = {}; }
        cfg.excalidraw.enabled = v;
    }),
    bool('mcpOauth.enabled', (cfg, v) => {
        if (!cfg.mcpOauth) { cfg.mcpOauth = {}; }
        cfg.mcpOauth.enabled = v;
    }, 'restartRequired'),
    bool('codex.enabled', (cfg, v) => {
        if (!cfg.codex) { cfg.codex = {}; }
        cfg.codex.enabled = v;
    }, 'restartRequired'),

    bool('features.focusedDiff', (cfg, v) => {
        if (!cfg.features) { cfg.features = {}; }
        cfg.features.focusedDiff = v;
    }),
];

/** Flat keys accepted by PUT /api/admin/config — derived from the registry. */
export const ADMIN_EDITABLE_KEYS: readonly string[] = ADMIN_CONFIG_FIELDS.map(f => f.key);

/** Build a key→metadata map for API responses. */
export function getAdminFieldMetadata(): Record<string, { runtime: AdminConfigFieldRuntime }> {
    const meta: Record<string, { runtime: AdminConfigFieldRuntime }> = {};
    for (const field of ADMIN_CONFIG_FIELDS) {
        meta[field.key] = { runtime: field.runtime };
    }
    return meta;
}
