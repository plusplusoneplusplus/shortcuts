/**
 * Preferences REST API Handler
 *
 * HTTP API routes for persisting user UI preferences.
 * Stores preferences in a JSON file under the CoC data directory (~/.coc/preferences.json).
 * File format: { global?: GlobalPreferences, repos?: Record<string, PerRepoPreferences> }
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { sendJSON, sendError } from './core/api-handler';
import { parseBodyOrReject } from './shared/handler-utils';
import { getRepoDataPath } from './paths';
import type { Route } from './types';
import { getEffectiveDefaultDisabledTools } from './llm-tools/llm-tool-registry';
import { MAX_ADDITIONAL_NOTES_ROOTS } from './notes/notes-root-resolver';
import type { SyncEngine } from './sync/sync-engine';

// ============================================================================
// Types
// ============================================================================

/** Skill interaction mode — determines which last-used skill preference to read/write. */
export type SkillMode = 'task' | 'ask' | 'plan';

/** Per-mode last-used skill names (array supports multi-skill combinations). */
export interface LastSkillsByMode {
    task?: string[];
    ask?: string[];
    plan?: string[];
}

/** Per-mode last-used AI model names. */
export interface LastModelsByMode {
    task?: string;
    ask?: string;
    plan?: string;
    /** Default model for note-chat sessions. Falls back to claude-sonnet-4.6 when absent. */
    note?: string;
}

/** Mode keys for the per-repo default model overrides. */
export type DefaultModelMode = 'task' | 'ask' | 'plan' | 'note' | 'schedule' | 'followUp' | 'memory';

/** Per-mode default model overrides. Take precedence over the repo-wide defaultModel. */
export interface DefaultModelsByMode {
    task?: string;
    ask?: string;
    plan?: string;
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

// GlobalPreferences type is derived from GlobalPreferencesSchema below (see "Global Preferences Zod Schema" section).

// ============================================================================
// Constants (must precede schema declarations that reference them)
// ============================================================================

/** Hardcoded fallback for Ralph max iterations when no preference is set. */
export const RALPH_DEFAULT_MAX_ITERATIONS = 20;
/** Inclusive upper bound for the per-repo `maxRalphIterations` setting. */
export const RALPH_MAX_ITERATIONS_LIMIT = 200;

// ============================================================================
// Per-Repo Preferences Zod Schema
// ============================================================================

/** Helper: drop the key when the validated sub-object is empty. */
function dropIfEmpty<T extends Record<string, unknown>>(obj: T): T | undefined {
    const cleaned = { ...obj };
    for (const key of Object.keys(cleaned)) {
        if (cleaned[key] === undefined) delete cleaned[key];
    }
    return Object.keys(cleaned).length > 0 ? cleaned as T : undefined;
}

/** Zod sub-schema for per-mode last-used skill names with backward-compat coercion. */
const lastSkillsMode = z.union([
    z.string().min(1).transform(s => [s]),
    z.array(z.unknown()).transform(arr => arr.filter((s): s is string => typeof s === 'string' && s.length > 0)),
]).catch(undefined as unknown as string[]);

const LastSkillsByModeSchema = z.object({
    task: lastSkillsMode.optional(),
    ask: lastSkillsMode.optional(),
    plan: lastSkillsMode.optional(),
}).strip().transform(dropIfEmpty);

const optionalModelString = z.string().optional().catch(undefined);

const LastModelsByModeSchema = z.object({
    task: optionalModelString,
    ask: optionalModelString,
    plan: optionalModelString,
    note: optionalModelString,
}).strip().transform(dropIfEmpty);

const optionalModelStringMax100 = z.string().max(100).optional().catch(undefined);

const DefaultModelsByModeSchema = z.object({
    task: optionalModelStringMax100,
    ask: optionalModelStringMax100,
    plan: optionalModelStringMax100,
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

const AutoPromoteGatesSchema = z.object({
    minScore: z.number().min(0).max(1).optional().catch(undefined),
    minRecallCount: z.number().int().min(1).optional().catch(undefined),
    minUniqueQueries: z.number().int().min(1).optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const AutoPromoteConfigSchema = z.object({
    mode: z.enum(['off', 'threshold', 'cron', 'cron+threshold']).catch('off' as const),
    cron: z.string().transform(s => s.trim() || undefined).optional().catch(undefined),
    timezone: z.string().transform(s => s.trim() || undefined).optional().catch(undefined),
    thresholdCount: z.number().int().min(1).optional().catch(undefined),
    minIntervalMs: z.number().int().min(0).optional().catch(undefined),
    gates: AutoPromoteGatesSchema.optional().catch(undefined),
}).strip();

const BoundedMemoryRecallSchema = z.object({
    enabled: z.boolean().optional().catch(undefined),
    maxEntries: z.number().int().min(1).optional().catch(undefined),
    charBudget: z.number().int().min(1).optional().catch(undefined),
    maxBm25Score: z.number().finite().optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const BoundedMemoryReadToolsSchema = z.object({
    enabled: z.boolean().optional().catch(undefined),
    maxResults: z.number().int().min(1).optional().catch(undefined),
    maxEntryChars: z.number().int().min(1).optional().catch(undefined),
}).strip().transform(dropIfEmpty);

const BoundedMemorySchema = z.object({
    enabled: z.boolean(),
    charLimit: z.number().int().min(1).optional().catch(undefined),
    writeFrequency: z.enum(['low', 'medium', 'high']).optional().catch(undefined),
    recall: BoundedMemoryRecallSchema.optional().catch(undefined),
    readTools: BoundedMemoryReadToolsSchema.optional().catch(undefined),
    autoPromote: AutoPromoteConfigSchema.optional().catch(undefined),
}).strip();

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
    lastEffort: z.enum(['low', 'medium', 'high']).optional(),
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
    boundedMemory: BoundedMemorySchema.optional(),
    memoryV2: MemoryV2Schema.optional(),
    notesGit: NotesGitSchema.optional(),
    activityFilters: ActivityFiltersSchema.optional(),
    disabledLlmTools: z.array(z.unknown())
        .transform(arr => arr.filter((t): t is string => typeof t === 'string' && t.length > 0))
        .optional(),
    defaultModel: z.string().max(100).optional(),
    defaultModels: DefaultModelsByModeSchema.optional(),
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
    /** VS Code-style inline ghost-text autocomplete for the Queue Task and follow-up inputs. */
    promptAutocomplete: PromptAutocompleteSchema.optional().catch(undefined),
}).strip();

/** Global (cross-repo) UI preferences — derived from GlobalPreferencesSchema. */
export type GlobalPreferences = z.infer<typeof GlobalPreferencesSchema>;

export interface SkillUsageEntry {
    skillName: string;
    timestamp: string;
}

/** backward-compat alias */
export type UserPreferences = PerRepoPreferences;

/** Top-level structure of the global preferences file on disk. */
export interface PreferencesFile {
    global?: GlobalPreferences;
}

// ============================================================================
// Constants
// ============================================================================

/** Name of the preferences file within the data directory. */
export const PREFERENCES_FILE_NAME = 'preferences.json';

export interface RepoPreferencesChangedEvent {
    workspaceId: string;
    preferences: PerRepoPreferences;
}

const repoPreferenceListeners = new Set<(event: RepoPreferencesChangedEvent) => void>();

export function onRepoPreferencesChanged(listener: (event: RepoPreferencesChangedEvent) => void): () => void {
    repoPreferenceListeners.add(listener);
    return () => {
        repoPreferenceListeners.delete(listener);
    };
}

function emitRepoPreferencesChanged(event: RepoPreferencesChangedEvent): void {
    for (const listener of repoPreferenceListeners) {
        try { listener(event); } catch { /* preference listeners are non-fatal */ }
    }
}

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

// ============================================================================
// Persistence Helpers
// ============================================================================

/**
 * Read the global preferences file from disk.
 * Returns an empty object when the file doesn't exist or is invalid.
 */
export function readPreferences(dataDir: string): PreferencesFile {
    const filePath = path.join(dataDir, PREFERENCES_FILE_NAME);
    try {
        if (!fs.existsSync(filePath)) {
            return {};
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
            return {};
        }
        const obj = parsed as Record<string, unknown>;
        const result: PreferencesFile = {};

        if (typeof obj.global === 'object' && obj.global !== null) {
            const g = validateGlobalPreferences(obj.global);
            if (Object.keys(g).length > 0) {
                result.global = g;
            }
        }

        return result;
    } catch {
        return {};
    }
}

/** Read only the global preferences block from disk. */
export function readGlobalPreferences(dataDir: string): GlobalPreferences {
    return normalizeGlobalPreferencesForRead(readPreferences(dataDir).global ?? {});
}

/**
 * Write the global preferences file to disk atomically (write-then-rename).
 * Creates the data directory if it doesn't exist.
 */
export function writePreferences(dataDir: string, data: PreferencesFile): void {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, PREFERENCES_FILE_NAME);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

/**
 * Read per-repo preferences from disk.
 * Returns an empty object when the file doesn't exist or is invalid.
 */
export function readRepoPreferences(dataDir: string, workspaceId: string): PerRepoPreferences {
    const filePath = getRepoDataPath(dataDir, workspaceId, PREFERENCES_FILE_NAME);
    try {
        if (!fs.existsSync(filePath)) {
            return {};
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return validatePerRepoPreferences(parsed);
    } catch {
        return {};
    }
}

/**
 * Resolve the per-repo default model for a given mode.
 *
 * Resolution order (highest → lowest):
 * 1. Per-mode default from `defaultModels[mode]`.
 * 2. Repo-wide default from `defaultModel`.
 * 3. `undefined` — caller falls through to its own default or CLI default.
 *
 * Callers should check `task.config.model` (explicit model) before calling this.
 */
export function resolveDefaultModel(
    dataDir: string,
    workspaceId: string,
    mode?: DefaultModelMode,
): string | undefined {
    const prefs = readRepoPreferences(dataDir, workspaceId);
    if (mode && prefs.defaultModels?.[mode]) return prefs.defaultModels[mode];
    return prefs.defaultModel || undefined;
}

/**
 * Resolve the effective disabled LLM tools for a workspace.
 * Explicit per-repo preferences win; otherwise defaults depend on the global UI layout mode.
 */
export function readEffectiveDisabledLlmTools(dataDir: string, workspaceId: string): string[] {
    const repoPrefs = readRepoPreferences(dataDir, workspaceId);
    if (repoPrefs.disabledLlmTools !== undefined) {
        return repoPrefs.disabledLlmTools;
    }

    const globalPrefs = readGlobalPreferences(dataDir);
    return getEffectiveDefaultDisabledTools(globalPrefs.uiLayoutMode);
}

/**
 * Write per-repo preferences to disk atomically (write-then-rename).
 * Creates the parent directory if it doesn't exist.
 */
export function writeRepoPreferences(dataDir: string, workspaceId: string, data: PerRepoPreferences): void {
    const filePath = getRepoDataPath(dataDir, workspaceId, PREFERENCES_FILE_NAME);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    emitRepoPreferencesChanged({ workspaceId, preferences: data });
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register preferences API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes - Shared route table
 * @param dataDir - Directory for preferences file (e.g. ~/.coc)
 * @param getSyncEngine - Optional getter for per-workspace sync engines; when
 *   provided, saving sync preferences immediately reconfigures the live engine
 *   without requiring a server restart.
 */
export function registerPreferencesRoutes(
    routes: Route[],
    dataDir: string,
    getSyncEngine?: (workspaceId: string) => SyncEngine | undefined,
): void {

    // ------------------------------------------------------------------
    // GET /api/preferences — Read global preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/preferences',
        handler: async (_req, res) => {
            sendJSON(res, 200, readGlobalPreferences(dataDir));
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/preferences — Replace global preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: '/api/preferences',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const global = validateGlobalPreferences(body);
            const existing = readPreferences(dataDir);
            writePreferences(dataDir, { ...existing, global });
            sendJSON(res, 200, global);
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/preferences — Merge partial updates into global preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: '/api/preferences',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const existing = readPreferences(dataDir);
            const patch = validateGlobalPreferences(body);
            const merged: GlobalPreferences = { ...(existing.global ?? {}), ...patch };

            // Deep-merge activityFilters so patching { activityFilters: { statusFilter: 'x' } }
            // preserves existing workspace/typeFilter values.
            if (patch.activityFilters && existing.global?.activityFilters) {
                merged.activityFilters = { ...existing.global.activityFilters, ...patch.activityFilters };
            }
            if (patch.promptAutocomplete && existing.global?.promptAutocomplete) {
                merged.promptAutocomplete = {
                    ...existing.global.promptAutocomplete,
                    ...patch.promptAutocomplete,
                    ai: patch.promptAutocomplete.ai || existing.global.promptAutocomplete.ai
                        ? { ...(existing.global.promptAutocomplete.ai ?? {}), ...(patch.promptAutocomplete.ai ?? {}) }
                        : undefined,
                };
            }

            writePreferences(dataDir, { ...existing, global: merged });
            sendJSON(res, 200, merged);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/preferences — Read per-repo preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences$/,
        handler: async (_req, res, match) => {
            const repoId = decodeURIComponent(match![1]);
            sendJSON(res, 200, readRepoPreferences(dataDir, repoId));
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/preferences — Replace per-repo preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const repoId = decodeURIComponent(match![1]);
            const repoPrefs = validatePerRepoPreferences(body);
            writeRepoPreferences(dataDir, repoId, repoPrefs);
            sendJSON(res, 200, repoPrefs);
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/preferences — Merge into per-repo preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const repoId = decodeURIComponent(match![1]);
            const existingRepo = readRepoPreferences(dataDir, repoId);
            const patch = validatePerRepoPreferences(body);
            const merged: PerRepoPreferences = { ...existingRepo, ...patch };

            // Deep-merge lastSkills so that patching { lastSkills: { ask: 'x' } }
            // preserves existing task/plan values.
            if (patch.lastSkills && existingRepo.lastSkills) {
                merged.lastSkills = { ...existingRepo.lastSkills, ...patch.lastSkills };
            }

            // Remove modes explicitly cleared by the client (empty array = "user cleared").
            // This works whether the deep-merge above ran or the shallow spread applied.
            if (merged.lastSkills) {
                for (const mode of ['task', 'ask', 'plan'] as const) {
                    if (Array.isArray(merged.lastSkills[mode]) && merged.lastSkills[mode]!.length === 0) {
                        delete merged.lastSkills[mode];
                    }
                }
                if (Object.keys(merged.lastSkills).length === 0) {
                    delete merged.lastSkills;
                }
            }

            // Deep-merge lastModels so that patching { lastModels: { ask: 'x' } }
            // preserves existing task/plan values.
            if (patch.lastModels && existingRepo.lastModels) {
                merged.lastModels = { ...existingRepo.lastModels, ...patch.lastModels };
            }

            // Deep-merge defaultModels so that patching { defaultModels: { task: 'x' } }
            // preserves existing per-mode overrides.
            if (patch.defaultModels && existingRepo.defaultModels) {
                merged.defaultModels = { ...existingRepo.defaultModels, ...patch.defaultModels };
            }
            // Remove per-mode entries explicitly cleared by the client (empty string = clear).
            if (merged.defaultModels) {
                for (const mode of ['task', 'ask', 'plan', 'note', 'schedule', 'followUp', 'memory'] as const) {
                    if (merged.defaultModels[mode] === '') {
                        delete merged.defaultModels[mode];
                    }
                }
                if (Object.keys(merged.defaultModels).length === 0) {
                    delete merged.defaultModels;
                }
            }
            // Clear defaultModel when explicitly set to empty string.
            if ((body as any).defaultModel === '') {
                delete merged.defaultModel;
            }

            // Deep-merge activityFilters so that patching { activityFilters: { statusFilter: 'x' } }
            // preserves existing typeFilter value.
            if (patch.activityFilters && existingRepo.activityFilters) {
                merged.activityFilters = { ...existingRepo.activityFilters, ...patch.activityFilters };
            }

            if (patch.boundedMemory && existingRepo.boundedMemory) {
                merged.boundedMemory = {
                    ...existingRepo.boundedMemory,
                    ...patch.boundedMemory,
                    ...(patch.boundedMemory.recall && existingRepo.boundedMemory.recall
                        ? { recall: { ...existingRepo.boundedMemory.recall, ...patch.boundedMemory.recall } }
                        : {}),
                    ...(patch.boundedMemory.readTools && existingRepo.boundedMemory.readTools
                        ? { readTools: { ...existingRepo.boundedMemory.readTools, ...patch.boundedMemory.readTools } }
                        : {}),
                    ...(patch.boundedMemory.autoPromote && existingRepo.boundedMemory.autoPromote
                        ? { autoPromote: { ...existingRepo.boundedMemory.autoPromote, ...patch.boundedMemory.autoPromote } }
                        : {}),
                };
            }

            // Explicitly set linkedRepoIds to empty array when client sends [] to clear
            if (Array.isArray((body as any).linkedRepoIds) && (body as any).linkedRepoIds.length === 0) {
                delete merged.linkedRepoIds;
            }

            writeRepoPreferences(dataDir, repoId, merged);

            // If sync settings changed, immediately reconfigure the live engine
            // so the status reflects the new configuration without a server restart.
            if (patch.sync !== undefined && getSyncEngine) {
                const engine = getSyncEngine(repoId);
                if (engine) {
                    const gitRemote = merged.sync?.gitRemote ?? '';
                    const intervalMinutes = merged.sync?.intervalMinutes ?? 5;
                    engine.start(gitRemote, intervalMinutes).catch(() => {});
                }
            }

            sendJSON(res, 200, merged);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/preferences/skill-usage — Read skill usage
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences\/skill-usage$/,
        handler: async (req, res, match) => {
            const parsed = new URL(req.url ?? '/', 'http://localhost');
            const skillName = parsed.searchParams.get('skillName') ?? undefined;
            const since = parsed.searchParams.get('since') ?? undefined;

            if (since && Number.isNaN(Date.parse(since))) {
                return sendError(res, 400, '`since` must be an ISO date-time string');
            }

            const repoId = decodeURIComponent(match![1]);
            const usageMap = readRepoPreferences(dataDir, repoId).skillUsageMap ?? {};
            const usage: SkillUsageEntry[] = Object.entries(usageMap)
                .filter(([name]) => !skillName || name === skillName)
                .filter(([, timestamp]) => !since || timestamp >= since)
                .sort((a, b) => b[1].localeCompare(a[1]))
                .map(([name, timestamp]) => ({ skillName: name, timestamp }));

            sendJSON(res, 200, { usage });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/preferences/skill-usage — Record a skill usage
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences\/skill-usage$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body || typeof body.skillName !== 'string' || body.skillName.length === 0) {
                return sendError(res, 400, '`skillName` is required');
            }

            const repoId = decodeURIComponent(match![1]);
            const skillName: string = body.skillName;
            const existingRepo = readRepoPreferences(dataDir, repoId);
            const timestamp = new Date().toISOString();
            const usageMap = { ...(existingRepo.skillUsageMap ?? {}), [skillName]: timestamp };
            const merged: PerRepoPreferences = { ...existingRepo, skillUsageMap: usageMap };
            writeRepoPreferences(dataDir, repoId, merged);
            sendJSON(res, 200, { skillName, timestamp });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/preferences/commit-skill-usage — Read commit-scoped skill usage
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences\/commit-skill-usage$/,
        handler: async (req, res, match) => {
            const parsed = new URL(req.url ?? '/', 'http://localhost');
            const skillName = parsed.searchParams.get('skillName') ?? undefined;
            const since = parsed.searchParams.get('since') ?? undefined;

            if (since && Number.isNaN(Date.parse(since))) {
                return sendError(res, 400, '`since` must be an ISO date-time string');
            }

            const repoId = decodeURIComponent(match![1]);
            const usageMap = readRepoPreferences(dataDir, repoId).commitSkillUsageMap ?? {};
            const usage: SkillUsageEntry[] = Object.entries(usageMap)
                .filter(([name]) => !skillName || name === skillName)
                .filter(([, timestamp]) => !since || timestamp >= since)
                .sort((a, b) => b[1].localeCompare(a[1]))
                .map(([name, timestamp]) => ({ skillName: name, timestamp }));

            sendJSON(res, 200, { usage });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/preferences/commit-skill-usage — Record a commit-scoped skill usage
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences\/commit-skill-usage$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body || typeof body.skillName !== 'string' || body.skillName.length === 0) {
                return sendError(res, 400, '`skillName` is required');
            }

            const repoId = decodeURIComponent(match![1]);
            const skillName: string = body.skillName;
            const existingRepo = readRepoPreferences(dataDir, repoId);
            const timestamp = new Date().toISOString();
            const usageMap = { ...(existingRepo.commitSkillUsageMap ?? {}), [skillName]: timestamp };
            const merged: PerRepoPreferences = { ...existingRepo, commitSkillUsageMap: usageMap };
            writeRepoPreferences(dataDir, repoId, merged);
            sendJSON(res, 200, { skillName, timestamp });
        },
    });
}
