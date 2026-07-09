import { z } from 'zod';
import { filterRemovedLlmToolNames } from '../llm-tools/llm-tool-registry';
import { MAX_ADDITIONAL_NOTES_ROOTS } from '../notes/notes-root-resolver';

// ============================================================================
// Types
// ============================================================================

/** Skill interaction mode — determines which last-used skill preference to read/write. */
export type SkillMode = 'task' | 'ask';

/** Per-mode last-used skill names (array supports multi-skill combinations). */
export interface LastSkillsByMode {
    task?: string[];
    ask?: string[];
}

/** Per-mode last-used AI model names. */
export interface LastModelsByMode {
    task?: string;
    ask?: string;
    /** Default model for note-chat sessions. Falls back to claude-sonnet-4.6 when absent. */
    note?: string;
}

/** Mode keys for the per-repo default model overrides. */
export type DefaultModelMode = 'task' | 'ask' | 'note' | 'schedule' | 'followUp' | 'memory';

/** Per-mode default model overrides. Take precedence over the repo-wide defaultModel. */
export interface DefaultModelsByMode {
    task?: string;
    ask?: string;
    note?: string;
    schedule?: string;
    followUp?: string;
    memory?: string;
}

export type AutoPromoteMode = 'off' | 'threshold' | 'cron' | 'cron+threshold';

export interface BoundedMemoryAutoPromoteConfig {
    mode: AutoPromoteMode;
    cron?: string;
    timezone?: string;
    thresholdCount?: number;
    minIntervalMs?: number;
    gates?: {
        minScore?: number;
        minRecallCount?: number;
        minUniqueQueries?: number;
    };
}

/** A single saved run-script template. */
export interface ScriptTemplateEntry {
    id: string;
    name: string;
    scriptPath: string;
    args?: string;
    workingDirectory?: string;
    model?: string;
    pauseOnFailure?: boolean;
}

/** A single saved skill/model template. */
export interface SkillTemplateEntry {
    id: string;
    name?: string;
    model: string;
    mode: 'ask' | 'task';
    skills: string[];
}

export interface SkillUsageEntry {
    skillName: string;
    timestamp: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Hardcoded fallback for Ralph max iterations when no preference is set. */
export const RALPH_DEFAULT_MAX_ITERATIONS = 20;
/** Inclusive upper bound for the per-repo `maxRalphIterations` setting. */
export const RALPH_MAX_ITERATIONS_LIMIT = 200;

// ============================================================================
// Shared Schema Helpers
// ============================================================================

/** Helper: drop the key when the validated sub-object is empty. */
function dropIfEmpty<T extends Record<string, unknown>>(obj: T): T | undefined {
    const cleaned = { ...obj };
    for (const key of Object.keys(cleaned)) {
        if (cleaned[key] === undefined) delete cleaned[key];
    }
    return Object.keys(cleaned).length > 0 ? cleaned as T : undefined;
}

// ============================================================================
// Per-Repo Preferences Zod Schema
// ============================================================================

/** Zod sub-schema for per-mode last-used skill names with backward-compat coercion. */
const lastSkillsMode = z.union([
    z.string().min(1).transform(s => [s]),
    z.array(z.unknown()).transform(arr => arr.filter((s): s is string => typeof s === 'string' && s.length > 0)),
]).catch(undefined as unknown as string[]);

const LastSkillsByModeSchema = z.object({
    task: lastSkillsMode.optional(),
    ask: lastSkillsMode.optional(),
}).strip().transform(dropIfEmpty);

const optionalModelString = z.string().optional().catch(undefined);

const LastModelsByModeSchema = z.object({
    task: optionalModelString,
    ask: optionalModelString,
    note: optionalModelString,
}).strip().transform(dropIfEmpty);

const optionalModelStringMax100 = z.string().max(100).optional().catch(undefined);

const DefaultModelsByModeSchema = z.object({
    task: optionalModelStringMax100,
    ask: optionalModelStringMax100,
    note: optionalModelStringMax100,
    schedule: optionalModelStringMax100,
    followUp: optionalModelStringMax100,
    memory: optionalModelStringMax100,
}).strip().transform(dropIfEmpty);

/** String-keyed record where only string values survive. */
const stringRecordSchema = z.record(z.string(), z.unknown()).transform(rec => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) {
        if (k.length > 0 && typeof v === 'string') out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
});

/**
 * Schema for the redesigned coc-memory v2 per-workspace preferences.
 *
 * - `enabled`  — master switch for the new memory feature (default: false).
 * - `isolated` — when true, this workspace uses its own isolated store and
 *                never reads/writes global memory. Defaults to false (global).
 * - `frozenSnapshotLimit` — how many top-importance facts to inject as the
 *                           frozen system-prompt snapshot (default: 10).
 * - `recallLimit` — how many per-turn recalled facts to inject (default: 5).
 */
const MemoryV2Schema = z.object({
    enabled: z.boolean(),
    isolated: z.boolean().optional().catch(undefined),
    frozenSnapshotLimit: z.number().int().min(1).max(50).optional().catch(undefined),
    recallLimit: z.number().int().min(1).max(20).optional().catch(undefined),
}).strip();

const NotesGitAutoCommitSchema = z.object({
    enabled: z.boolean(),
    intervalMs: z.number().int().min(1).optional().catch(undefined),
}).strip();

const NotesGitSchema = z.object({
    enabled: z.boolean(),
    autoCommit: NotesGitAutoCommitSchema.optional().catch(undefined),
}).strip();

const ActivityFiltersSchema = z.object({
    statusFilter: z.string().optional().catch(undefined),
    typeFilter: z.string().optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const WorkItemsSyncGithubSchema = z.object({
    owner: z.string().trim().min(1).max(100).optional().catch(undefined),
    repo: z.string().trim().min(1).max(100).optional().catch(undefined),
    pollingEnabled: z.boolean().optional().catch(undefined),
    pollIntervalMinutes: z.number().int().min(1).max(1440).optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const WorkItemsSyncAzureBoardsSchema = z.object({
    project: z.string().trim().min(1).max(200).optional().catch(undefined),
    pollingEnabled: z.boolean().optional().catch(undefined),
    pollIntervalMinutes: z.number().int().min(1).max(1440).optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const WorkItemsSyncSchema = z.object({
    github: WorkItemsSyncGithubSchema.optional().catch(undefined),
    azureBoards: WorkItemsSyncAzureBoardsSchema.optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const WorkItemsPreferencesSchema = z.object({
    sync: WorkItemsSyncSchema.optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const DreamsPreferencesSchema = z.object({
    enabled: z.boolean().optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const SyncSchema = z.object({
    gitRemote: z.string().optional().catch(undefined),
    intervalMinutes: z.number().int().min(1).optional().catch(undefined),
}).strip();

const ScriptTemplateSchema = z.object({
    id: z.string().min(1),
    name: z.string(),
    scriptPath: z.string(),
    args: z.string().optional(),
    workingDirectory: z.string().optional(),
    model: z.string().optional(),
    pauseOnFailure: z.boolean().optional(),
}).strip();

const SkillTemplateSchema = z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    model: z.string(),
    mode: z.enum(['ask', 'task']),
    skills: z.array(z.unknown()).transform(arr => arr.filter((s): s is string => typeof s === 'string')),
}).strip();

const EnabledMcpToolsSchema = z.record(z.string(), z.unknown()).transform(rec => {
    const out: Record<string, string[]> = {};
    for (const [serverName, tools] of Object.entries(rec)) {
        if (serverName.length > 0 && Array.isArray(tools)) {
            out[serverName] = tools.filter((t): t is string => typeof t === 'string' && t.length > 0);
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
});

/**
 * Zod schema for per-repository UI preferences.
 * Source of truth — the PerRepoPreferences type is derived via z.infer<>.
 * Uses .strip() at parse time so unknown keys are silently dropped.
 */
export const PerRepoPreferencesSchema = z.object({
    /** @deprecated Use lastModels instead. Kept for backward compatibility on read. */
    lastModel: z.string().optional(),
    lastModels: LastModelsByModeSchema.optional(),
    lastDepth: z.enum(['deep', 'normal']).optional(),
    lastEffort: z.enum(['very-low', 'low', 'medium', 'high']).optional(),
    lastSkills: LastSkillsByModeSchema.optional(),
    skillUsageMap: stringRecordSchema.optional(),
    commitSkillUsageMap: stringRecordSchema.optional(),
    linkedRepoIds: z.array(z.unknown())
        .transform(arr => arr.filter((id): id is string => typeof id === 'string' && id.length > 0))
        .optional(),
    scriptTemplates: z.array(z.unknown())
        .transform(arr => arr
            .map(entry => ScriptTemplateSchema.safeParse(entry))
            .filter(r => r.success)
            .map(r => (r as z.ZodSafeParseSuccess<z.infer<typeof ScriptTemplateSchema>>).data)
        )
        .optional(),
    skillTemplates: z.array(z.unknown())
        .transform(arr => arr
            .map(entry => SkillTemplateSchema.safeParse(entry))
            .filter(r => r.success)
            .map(r => (r as z.ZodSafeParseSuccess<z.infer<typeof SkillTemplateSchema>>).data)
        )
        .optional(),
    filesViewMode: z.enum(['flat', 'tree']).optional(),
    memoryV2: MemoryV2Schema.optional(),
    notesGit: NotesGitSchema.optional(),
    activityFilters: ActivityFiltersSchema.optional(),
    disabledLlmTools: z.array(z.unknown())
        .transform(arr => filterRemovedLlmToolNames(
            arr.filter((t): t is string => typeof t === 'string' && t.length > 0),
        ))
        .optional(),
    defaultModel: z.string().max(100).optional(),
    defaultModels: DefaultModelsByModeSchema.optional(),
    lastChatProvider: z.enum(['copilot', 'codex', 'claude', 'opencode', 'auto']).optional(),
    maxRalphIterations: z.number().int().min(1).max(RALPH_MAX_ITERATIONS_LIMIT).optional(),
    additionalNotesRoots: z.array(z.unknown())
        .transform(arr => {
            const roots = (arr as unknown[])
                .filter((r): r is string => typeof r === 'string' && r.length > 0 && r.length <= 500)
                .map(r => r.replace(/\\/g, '/').replace(/\/+$/, ''))
                .filter(r => r.length > 0 && !r.startsWith('/') && !r.startsWith('..') && !r.includes('/../'));
            return [...new Set(roots)].slice(0, MAX_ADDITIONAL_NOTES_ROOTS);
        })
        .optional(),
    sync: SyncSchema.optional(),
    workItems: WorkItemsPreferencesSchema.optional(),
    dreams: DreamsPreferencesSchema.optional().catch(undefined),
    enabledMcpTools: EnabledMcpToolsSchema.optional(),
}).strip();

/** Per-repository UI preferences — derived from PerRepoPreferencesSchema. */
export type PerRepoPreferences = z.infer<typeof PerRepoPreferencesSchema>;

// ============================================================================
// Global Preferences Zod Schema
// ============================================================================

const OnboardingProgressSchema = z.object({
    hasUsedChat: z.boolean().optional().catch(undefined),
    hasRunWorkflow: z.boolean().optional().catch(undefined),
    hasOpenedWiki: z.boolean().optional().catch(undefined),
    settingsVisited: z.boolean().optional().catch(undefined),
    dismissed: z.boolean().optional().catch(undefined),
    hasCompletedTour: z.boolean().optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const GlobalActivityFiltersSchema = z.object({
    workspace: z.string().optional().catch(undefined),
    myWorkExcludedTypes: z.array(z.unknown())
        .transform(arr => arr.filter((v): v is string => typeof v === 'string' && v.length > 0))
        .optional()
        .catch(undefined),
}).strip().transform(dropIfEmpty);

/** Boolean-valued record; filters empty-string keys and non-boolean values. */
const LinkHandlersSchema = z.record(z.string(), z.unknown()).transform(rec => {
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(rec)) {
        if (k.length > 0 && typeof v === 'boolean') out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
});

const HtmlEmbedSchema = z.object({
    enabled: z.boolean(),
}).strip();

const GlobalMemoryV2Schema = z.object({
    enabled: z.boolean().optional().catch(undefined),
    frozenSnapshotLimit: z.number().int().min(1).max(50).optional().catch(undefined),
    recallLimit: z.number().int().min(1).max(20).optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const PromptAutocompleteAiSchema = z.object({
    enabled: z.boolean().optional().catch(undefined),
    model: z.string().min(1).max(100).optional().catch(undefined),
    debounceMs: z.number().int().min(100).max(5000).optional().catch(undefined),
    timeoutMs: z.number().int().min(100).max(10000).optional().catch(undefined),
    maxHistoryItems: z.number().int().min(1).max(50).optional().catch(undefined),
    maxCompletionChars: z.number().int().min(20).max(500).optional().catch(undefined),
    includeGlobalHistory: z.boolean().optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const PromptAutocompleteSchema = z.object({
    enabled: z.boolean(),
    ai: PromptAutocompleteAiSchema.optional().catch(undefined),
}).strip();

/**
 * Zod schema for global (cross-repo) UI preferences.
 * Source of truth — the GlobalPreferences type is derived via z.infer<>.
 * Uses .strip() at parse time so unknown keys are silently dropped.
 */
export const GlobalPreferencesSchema = z.object({
    /** Persisted dashboard theme ('light' | 'dark' | 'auto'). */
    theme: z.enum(['light', 'dark', 'auto']).optional().catch(undefined),
    /** Whether the repos sidebar (left panel) is collapsed. */
    reposSidebarCollapsed: z.boolean().optional().catch(undefined),
    /** User-defined display order of repository groups. Each entry is a normalizedUrl (for grouped repos) or 'workspace:{id}' (for ungrouped repos). */
    gitGroupOrder: z.array(z.unknown())
        .transform(arr => {
            const filtered = arr.filter((k): k is string => typeof k === 'string' && k.length > 0);
            return filtered.length > 0 ? filtered : undefined;
        })
        .optional()
        .catch(undefined),
    /** User-defined display order of individual repository tabs by workspace ID. */
    repoTabOrder: z.array(z.unknown())
        .transform(arr => {
            const filtered = arr.filter((k): k is string => typeof k === 'string' && k.length > 0);
            return filtered.length > 0 ? filtered : undefined;
        })
        .optional()
        .catch(undefined),
    /** Most recently used remote groups in the remote shell. */
    recentRemotes: z.array(z.unknown())
        .transform(arr => {
            const filtered = arr.filter((k): k is string => typeof k === 'string' && k.length > 0);
            return filtered.length > 0 ? [...new Set(filtered)].slice(0, 8) : undefined;
        })
        .optional()
        .catch(undefined),
    /** Whether the user has dismissed the welcome modal. */
    hasSeenWelcome: z.boolean().optional().catch(undefined),
    /** Tracks progress through the onboarding checklist steps. */
    onboardingProgress: OnboardingProgressSchema.optional().catch(undefined),
    /** IDs of contextual tips the user has permanently dismissed. */
    dismissedTips: z.array(z.unknown())
        .transform(arr => {
            const filtered = arr.filter((t): t is string => typeof t === 'string' && t.length > 0);
            return filtered.length > 0 ? filtered : undefined;
        })
        .optional()
        .catch(undefined),
    /**
     * Persisted activity page filter selections (workspace selection and My Work exclusions).
     * statusFilter and typeFilter have moved to PerRepoPreferences.activityFilters.
     */
    activityFilters: GlobalActivityFiltersSchema.optional().catch(undefined),
    /** Persisted UI layout mode ('classic' | 'dev-workflow'). */
    uiLayoutMode: z.enum(['classic', 'dev-workflow']).optional().catch(undefined),
    /**
     * Per-handler enabled/disabled overrides for the link-handler feature.
     * Keys are handler names (e.g. 'teams', 'vscode', 'onenote').
     * `true` or absent = handler is enabled (default); `false` = disabled.
     */
    linkHandlers: LinkHandlersSchema.optional().catch(undefined),
    /** Sandboxed inline previews for local .html/.htm links whose title is "embed". */
    htmlEmbed: HtmlEmbedSchema.optional().catch(undefined),
    /** Inline ghost-text autocomplete for the Queue Task and follow-up inputs. */
    promptAutocomplete: PromptAutocompleteSchema.optional().catch(undefined),
    /** Global Memory V2 settings — independent of any workspace scope. */
    memoryV2: GlobalMemoryV2Schema.optional().catch(undefined),
}).strip();

/** Global (cross-repo) UI preferences — derived from GlobalPreferencesSchema. */
export type GlobalPreferences = z.infer<typeof GlobalPreferencesSchema>;

/** backward-compat alias */
export type UserPreferences = PerRepoPreferences;

// ============================================================================
// Validation
// ============================================================================

/** Validate and sanitize global preferences. Unknown keys are silently dropped. */
export function validateGlobalPreferences(raw: unknown): GlobalPreferences {
    if (typeof raw !== 'object' || raw === null) {
        return {};
    }
    const result = GlobalPreferencesSchema.safeParse(raw);
    if (!result.success) {
        return {};
    }
    const data = result.data;
    for (const key of Object.keys(data) as (keyof GlobalPreferences)[]) {
        if (data[key] === undefined) {
            delete data[key];
        }
    }
    return data;
}

export function normalizeGlobalPreferencesForRead(global: GlobalPreferences): GlobalPreferences {
    if (
        global.hasSeenWelcome === true
        && global.onboardingProgress?.dismissed !== true
        && global.onboardingProgress?.hasCompletedTour !== true
    ) {
        return {
            ...global,
            onboardingProgress: {
                ...global.onboardingProgress,
                hasCompletedTour: true,
            },
        };
    }

    return global;
}

/** Validate and sanitize per-repo preferences. Unknown keys are silently dropped. */
export function validatePerRepoPreferences(raw: unknown): PerRepoPreferences {
    if (typeof raw !== 'object' || raw === null) {
        return {};
    }
    const result = PerRepoPreferencesSchema.safeParse(raw);
    if (!result.success) {
        return {};
    }
    // Strip keys whose value is undefined (Zod sets them for failed optional sub-schemas)
    const data = result.data;
    for (const key of Object.keys(data) as (keyof PerRepoPreferences)[]) {
        if (data[key] === undefined) {
            delete data[key];
        }
    }
    return data;
}

/** backward-compat alias for validatePerRepoPreferences */
export function validatePreferences(raw: unknown): PerRepoPreferences {
    return validatePerRepoPreferences(raw);
}
