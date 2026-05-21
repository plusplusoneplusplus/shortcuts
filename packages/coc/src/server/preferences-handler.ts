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
import { sendJSON, sendError } from './core/api-handler';
import { parseBodyOrReject } from './shared/handler-utils';
import { getRepoDataPath } from './paths';
import type { Route } from './types';
import type { NotesGitConfig } from './notes/git/notes-git-types';
import { getEffectiveDefaultDisabledTools } from './llm-tools/llm-tool-registry';
import { MAX_ADDITIONAL_NOTES_ROOTS } from './notes/notes-root-resolver';

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

/** Global (cross-repo) UI preferences. */
export interface GlobalPreferences {
    /** Persisted dashboard theme ('light' | 'dark' | 'auto'). */
    theme?: 'light' | 'dark' | 'auto';
    /** Whether the repos sidebar (left panel) is collapsed. */
    reposSidebarCollapsed?: boolean;
    /** User-defined display order of repository groups. Each entry is a normalizedUrl (for grouped repos) or 'workspace:{id}' (for ungrouped repos). */
    gitGroupOrder?: string[];
    /** User-defined display order of individual repository tabs by workspace ID. */
    repoTabOrder?: string[];
    /** Whether the user has dismissed the welcome modal. */
    hasSeenWelcome?: boolean;

    /** Tracks progress through the onboarding checklist steps. */
    onboardingProgress?: {
        hasUsedChat?: boolean;
        hasRunWorkflow?: boolean;
        hasOpenedWiki?: boolean;
        settingsVisited?: boolean;
        dismissed?: boolean;
        hasCompletedTour?: boolean;
    };

    /** IDs of contextual tips the user has permanently dismissed. */
    dismissedTips?: string[];

    /** Persisted activity page filter selections (workspace selection and My Work exclusions).
     * statusFilter and typeFilter have moved to PerRepoPreferences.activityFilters. */
    activityFilters?: {
        workspace?: string;
        /** Persisted My Work Activity exclusion set (e.g. ['run-workflow', 'ask']). */
        myWorkExcludedTypes?: string[];
    };

    /** Persisted UI layout mode ('classic' | 'dev-workflow'). */
    uiLayoutMode?: 'classic' | 'dev-workflow';

    /**
     * Per-handler enabled/disabled overrides for the link-handler feature.
     * Keys are handler names (e.g. 'teams', 'vscode', 'onenote').
     * `true` or absent = handler is enabled (default); `false` = disabled.
     */
    linkHandlers?: Record<string, boolean>;
    /** Sandboxed inline previews for local .html/.htm links whose title is "embed". */
    htmlEmbed?: {
        enabled: boolean;
    };

    /** VS Code-style inline ghost-text autocomplete for the Queue Task and follow-up inputs. */
    promptAutocomplete?: {
        /** Enabled by default. Set to false to disable client-side suggestions. */
        enabled: boolean;
        /** AI-generated ghost-text settings. Disabled by default when absent. */
        ai?: {
            enabled?: boolean;
            /**
             * AI model id used for ghost-text generation.
             * Defaults to a fast/cheap model — override here to use a different one.
             * Examples: 'gpt-5-mini', 'gpt-5.4-mini', 'claude-haiku-4.5', 'gpt-4.1'.
             */
            model?: string;
            debounceMs?: number;
            timeoutMs?: number;
            maxHistoryItems?: number;
            maxCompletionChars?: number;
            includeGlobalHistory?: boolean;
        };
    };
}

/** Per-repository UI preferences. */
export interface PerRepoPreferences {
    /** @deprecated Use lastModels instead. Kept for backward compatibility on read. */
    lastModel?: string;
    /** Per-mode last-used AI model names (task / ask / plan). */
    lastModels?: LastModelsByMode;
    /** Last-selected generation depth in the SPA ('deep' | 'normal'). */
    lastDepth?: 'deep' | 'normal';
    /** Last-selected effort level in the Generate Task dialog. */
    lastEffort?: 'low' | 'medium' | 'high';
    /** Per-mode last-used skill names (task / ask / plan). */
    lastSkills?: LastSkillsByMode;
    /** Skill usage timestamps for ordering skill dropdowns (skillName → ISO timestamp). */
    skillUsageMap?: Record<string, string>;
    /** Skill usage timestamps for the Git tab commit/range "Use Skill"
     *  context menu (skillName → ISO timestamp). Scoped to the Git tab so
     *  ordering reflects only commit-based runs, not Enqueue / Work-Item /
     *  other surfaces. */
    commitSkillUsageMap?: Record<string, string>;
    /** IDs of workspaces whose skill folders are linked via "Extra Skill Folders". */
    linkedRepoIds?: string[];
    /** Saved run-script templates from the Run Script dialog. */
    scriptTemplates?: ScriptTemplateEntry[];
    /** Saved skill/model templates from the Run Skill dialog. */
    skillTemplates?: SkillTemplateEntry[];
    /** Preferred file-list display mode across all git views (commits, branch changes, working tree). */
    filesViewMode?: 'flat' | 'tree';
    /** Bounded memory settings. */
    boundedMemory?: {
        enabled: boolean;
        /** Max characters for MEMORY.md content. Default: 16384. */
        charLimit?: number;
        /** Controls how aggressively the AI writes memory entries. Default: 'medium'. */
        writeFrequency?: 'low' | 'medium' | 'high';
        /** Ranked recall settings for prompt injection. Enabled by default when memory is enabled. */
        recall?: {
            enabled?: boolean;
            /** Maximum ranked repo/system entries to inject, excluding protected entries. */
            maxEntries?: number;
            /** Maximum serialized characters for recalled entries. Protected entries are always included. */
            charBudget?: number;
            /** Optional FTS5 BM25 upper bound. Lower scores are better. */
            maxBm25Score?: number;
        };
        /** Opt-in repo memory read tools. Disabled by default. */
        readTools?: {
            enabled?: boolean;
            /** Maximum search results returned by memory_search. */
            maxResults?: number;
            /** Maximum characters returned per memory entry. */
            maxEntryChars?: number;
        };
        /** Opt-in automatic candidate promotion. Defaults to off. */
        autoPromote?: BoundedMemoryAutoPromoteConfig;
    };
    /** Notes directory git tracking settings. */
    notesGit?: NotesGitConfig;
    /** Per-repo activity filter selections (status and type filters). */
    activityFilters?: {
        statusFilter?: string;
        typeFilter?: string;
    };
    /**
     * Per-workspace LLM tool deny-list.
     * - `undefined` — use mode-aware defaults.
     * - `string[]` — tools whose name matches an entry are disabled.
     */
    disabledLlmTools?: string[];
    /** Repo-wide default model used when no explicit model is provided. */
    defaultModel?: string;
    /** Per-mode default model overrides. Take precedence over defaultModel. */
    defaultModels?: DefaultModelsByMode;
    /**
     * Maximum number of iterations a Ralph loop runs before stopping.
     * Range: 1..200. When unset, server falls back to {@link RALPH_DEFAULT_MAX_ITERATIONS} (20).
     */
    maxRalphIterations?: number;
    /** Additional notes root folders (relative paths from workspace git root). Max 10. */
    additionalNotesRoots?: string[];
    /** Git-based notes sync settings (only for my_work / my_life virtual workspaces). */
    sync?: {
        /** Git remote URL. Sync is disabled when empty/absent. */
        gitRemote?: string;
        /** Sync interval in minutes (default: 5). */
        intervalMinutes?: number;
    };
    /**
     * Per-server tool allow-list.
     * - `undefined` — all tools for every server are enabled (default).
     * - Keys are MCP server names; values are arrays of tool names that are
     *   allowed. Only effective when the server itself is also enabled.
     */
    enabledMcpTools?: Record<string, string[]>;
}

/** Hardcoded fallback for Ralph max iterations when no preference is set. */
export const RALPH_DEFAULT_MAX_ITERATIONS = 20;
/** Inclusive upper bound for the per-repo `maxRalphIterations` setting. */
export const RALPH_MAX_ITERATIONS_LIMIT = 200;

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
    const obj = raw as Record<string, unknown>;
    const result: GlobalPreferences = {};

    if (obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'auto') {
        result.theme = obj.theme;
    }

    if (typeof obj.reposSidebarCollapsed === 'boolean') {
        result.reposSidebarCollapsed = obj.reposSidebarCollapsed;
    }

    if (Array.isArray(obj.gitGroupOrder)) {
        const order = (obj.gitGroupOrder as unknown[]).filter(
            (k): k is string => typeof k === 'string' && k.length > 0
        );
        if (order.length > 0) {
            result.gitGroupOrder = order;
        }
    }

    if (Array.isArray(obj.repoTabOrder)) {
        const order = (obj.repoTabOrder as unknown[]).filter(
            (k): k is string => typeof k === 'string' && k.length > 0
        );
        if (order.length > 0) {
            result.repoTabOrder = order;
        }
    }

    if (typeof obj.hasSeenWelcome === 'boolean') {
        result.hasSeenWelcome = obj.hasSeenWelcome;
    }

    if (typeof obj.onboardingProgress === 'object' && obj.onboardingProgress !== null && !Array.isArray(obj.onboardingProgress)) {
        const raw = obj.onboardingProgress as Record<string, unknown>;
        const validated: NonNullable<GlobalPreferences['onboardingProgress']> = {};
        for (const key of ['hasUsedChat', 'hasRunWorkflow', 'hasOpenedWiki', 'settingsVisited', 'dismissed', 'hasCompletedTour'] as const) {
            if (typeof raw[key] === 'boolean') {
                validated[key] = raw[key] as boolean;
            }
        }
        if (Object.keys(validated).length > 0) {
            result.onboardingProgress = validated;
        }
    }

    if (Array.isArray(obj.dismissedTips)) {
        const tips = (obj.dismissedTips as unknown[]).filter(
            (t): t is string => typeof t === 'string' && t.length > 0
        );
        if (tips.length > 0) {
            result.dismissedTips = tips;
        }
    }

    if (typeof obj.activityFilters === 'object' && obj.activityFilters !== null && !Array.isArray(obj.activityFilters)) {
        const raw = obj.activityFilters as Record<string, unknown>;
        const validated: NonNullable<GlobalPreferences['activityFilters']> = {};
        if (typeof raw.workspace === 'string') validated.workspace = raw.workspace;
        if (Array.isArray(raw.myWorkExcludedTypes)) {
            const arr = (raw.myWorkExcludedTypes as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0);
            validated.myWorkExcludedTypes = arr;
        }
        if (Object.keys(validated).length > 0) {
            result.activityFilters = validated;
        }
    }

    if (obj.uiLayoutMode === 'classic' || obj.uiLayoutMode === 'dev-workflow') {
        result.uiLayoutMode = obj.uiLayoutMode;
    }

    if (typeof obj.linkHandlers === 'object' && obj.linkHandlers !== null && !Array.isArray(obj.linkHandlers)) {
        const validated: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(obj.linkHandlers as Record<string, unknown>)) {
            if (typeof key === 'string' && key.length > 0 && typeof value === 'boolean') {
                validated[key] = value;
            }
        }
        if (Object.keys(validated).length > 0) {
            result.linkHandlers = validated;
        }
    }

    if (typeof obj.htmlEmbed === 'object' && obj.htmlEmbed !== null) {
        const he = obj.htmlEmbed as Record<string, unknown>;
        if (typeof he.enabled === 'boolean') {
            result.htmlEmbed = { enabled: he.enabled };
        }
    }

    if (typeof obj.promptAutocomplete === 'object' && obj.promptAutocomplete !== null) {
        const pa = obj.promptAutocomplete as Record<string, unknown>;
        if (typeof pa.enabled === 'boolean') {
            result.promptAutocomplete = { enabled: pa.enabled };
            if (typeof pa.ai === 'object' && pa.ai !== null && !Array.isArray(pa.ai)) {
                const ai = pa.ai as Record<string, unknown>;
                const validatedAi: NonNullable<NonNullable<GlobalPreferences['promptAutocomplete']>['ai']> = {};
                if (typeof ai.enabled === 'boolean') validatedAi.enabled = ai.enabled;
                if (typeof ai.model === 'string' && ai.model.length > 0 && ai.model.length <= 100) {
                    validatedAi.model = ai.model;
                }
                if (typeof ai.debounceMs === 'number' && Number.isInteger(ai.debounceMs) && ai.debounceMs >= 100 && ai.debounceMs <= 5000) {
                    validatedAi.debounceMs = ai.debounceMs;
                }
                if (typeof ai.timeoutMs === 'number' && Number.isInteger(ai.timeoutMs) && ai.timeoutMs >= 100 && ai.timeoutMs <= 10000) {
                    validatedAi.timeoutMs = ai.timeoutMs;
                }
                if (typeof ai.maxHistoryItems === 'number' && Number.isInteger(ai.maxHistoryItems) && ai.maxHistoryItems >= 1 && ai.maxHistoryItems <= 50) {
                    validatedAi.maxHistoryItems = ai.maxHistoryItems;
                }
                if (typeof ai.maxCompletionChars === 'number' && Number.isInteger(ai.maxCompletionChars) && ai.maxCompletionChars >= 20 && ai.maxCompletionChars <= 500) {
                    validatedAi.maxCompletionChars = ai.maxCompletionChars;
                }
                if (typeof ai.includeGlobalHistory === 'boolean') validatedAi.includeGlobalHistory = ai.includeGlobalHistory;
                if (Object.keys(validatedAi).length > 0) {
                    result.promptAutocomplete.ai = validatedAi;
                }
            }
        }
    }

    return result;
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

function validateAutoPromoteConfig(raw: unknown): BoundedMemoryAutoPromoteConfig {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { mode: 'off' };
    }
    const obj = raw as Record<string, unknown>;
    const mode = (
        obj.mode === 'threshold'
        || obj.mode === 'cron'
        || obj.mode === 'cron+threshold'
        || obj.mode === 'off'
    ) ? obj.mode : 'off';
    const validated: BoundedMemoryAutoPromoteConfig = { mode };
    if (typeof obj.cron === 'string' && obj.cron.trim()) {
        validated.cron = obj.cron.trim();
    }
    if (typeof obj.timezone === 'string' && obj.timezone.trim()) {
        validated.timezone = obj.timezone.trim();
    }
    if (typeof obj.thresholdCount === 'number' && Number.isInteger(obj.thresholdCount) && obj.thresholdCount > 0) {
        validated.thresholdCount = obj.thresholdCount;
    }
    if (typeof obj.minIntervalMs === 'number' && Number.isInteger(obj.minIntervalMs) && obj.minIntervalMs >= 0) {
        validated.minIntervalMs = obj.minIntervalMs;
    }
    if (typeof obj.gates === 'object' && obj.gates !== null && !Array.isArray(obj.gates)) {
        const rawGates = obj.gates as Record<string, unknown>;
        const gates: NonNullable<BoundedMemoryAutoPromoteConfig['gates']> = {};
        if (typeof rawGates.minScore === 'number' && Number.isFinite(rawGates.minScore) && rawGates.minScore >= 0 && rawGates.minScore <= 1) {
            gates.minScore = rawGates.minScore;
        }
        if (typeof rawGates.minRecallCount === 'number' && Number.isInteger(rawGates.minRecallCount) && rawGates.minRecallCount > 0) {
            gates.minRecallCount = rawGates.minRecallCount;
        }
        if (typeof rawGates.minUniqueQueries === 'number' && Number.isInteger(rawGates.minUniqueQueries) && rawGates.minUniqueQueries > 0) {
            gates.minUniqueQueries = rawGates.minUniqueQueries;
        }
        if (Object.keys(gates).length > 0) {
            validated.gates = gates;
        }
    }
    return validated;
}

/** Validate and sanitize per-repo preferences. Unknown keys are silently dropped. */
export function validatePerRepoPreferences(raw: unknown): PerRepoPreferences {
    if (typeof raw !== 'object' || raw === null) {
        return {};
    }
    const obj = raw as Record<string, unknown>;
    const result: PerRepoPreferences = {};

    if (typeof obj.lastModel === 'string') {
        result.lastModel = obj.lastModel;
    }

    if (typeof obj.lastModels === 'object' && obj.lastModels !== null && !Array.isArray(obj.lastModels)) {
        const raw = obj.lastModels as Record<string, unknown>;
        const validated: LastModelsByMode = {};
        for (const mode of ['task', 'ask', 'plan', 'note'] as const) {
            if (typeof raw[mode] === 'string') {
                validated[mode] = raw[mode] as string;
            }
        }
        if (Object.keys(validated).length > 0) {
            result.lastModels = validated;
        }
    }

    if (obj.lastDepth === 'deep' || obj.lastDepth === 'normal') {
        result.lastDepth = obj.lastDepth;
    }

    if (obj.lastEffort === 'low' || obj.lastEffort === 'medium' || obj.lastEffort === 'high') {
        result.lastEffort = obj.lastEffort;
    }

    if (typeof obj.lastSkills === 'object' && obj.lastSkills !== null && !Array.isArray(obj.lastSkills)) {
        const raw = obj.lastSkills as Record<string, unknown>;
        const validated: LastSkillsByMode = {};
        for (const mode of ['task', 'ask', 'plan'] as const) {
            const val = raw[mode];
            if (typeof val === 'string' && val.length > 0) {
                // Backwards compat: coerce legacy single string to array
                validated[mode] = [val];
            } else if (Array.isArray(val)) {
                const arr = val.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0);
                validated[mode] = arr; // keep empty arrays as explicit "cleared" signal
            }
        }
        if (Object.keys(validated).length > 0) {
            result.lastSkills = validated;
        }
    }

    if (typeof obj.skillUsageMap === 'object' && obj.skillUsageMap !== null && !Array.isArray(obj.skillUsageMap)) {
        const validated: Record<string, string> = {};
        for (const [key, value] of Object.entries(obj.skillUsageMap as Record<string, unknown>)) {
            if (typeof key === 'string' && key.length > 0 && typeof value === 'string') {
                validated[key] = value;
            }
        }
        if (Object.keys(validated).length > 0) {
            result.skillUsageMap = validated;
        }
    }

    if (typeof obj.commitSkillUsageMap === 'object' && obj.commitSkillUsageMap !== null && !Array.isArray(obj.commitSkillUsageMap)) {
        const validated: Record<string, string> = {};
        for (const [key, value] of Object.entries(obj.commitSkillUsageMap as Record<string, unknown>)) {
            if (typeof key === 'string' && key.length > 0 && typeof value === 'string') {
                validated[key] = value;
            }
        }
        if (Object.keys(validated).length > 0) {
            result.commitSkillUsageMap = validated;
        }
    }

    if (Array.isArray(obj.linkedRepoIds)) {
        const ids = (obj.linkedRepoIds as unknown[]).filter(
            (id): id is string => typeof id === 'string' && id.length > 0
        );
        // Preserve array even when empty so callers can detect an explicit clear
        result.linkedRepoIds = ids;
    }

    if (Array.isArray(obj.scriptTemplates)) {
        const validated: ScriptTemplateEntry[] = [];
        for (const entry of obj.scriptTemplates as unknown[]) {
            if (
                typeof entry === 'object' && entry !== null &&
                typeof (entry as any).id === 'string' && (entry as any).id.length > 0 &&
                typeof (entry as any).name === 'string' &&
                typeof (entry as any).scriptPath === 'string'
            ) {
                const clean: ScriptTemplateEntry = {
                    id: (entry as any).id,
                    name: (entry as any).name,
                    scriptPath: (entry as any).scriptPath,
                };
                if (typeof (entry as any).args === 'string') clean.args = (entry as any).args;
                if (typeof (entry as any).workingDirectory === 'string') clean.workingDirectory = (entry as any).workingDirectory;
                if (typeof (entry as any).model === 'string') clean.model = (entry as any).model;
                if (typeof (entry as any).pauseOnFailure === 'boolean') clean.pauseOnFailure = (entry as any).pauseOnFailure;
                validated.push(clean);
            }
        }
        // Keep empty array as explicit "delete all"
        result.scriptTemplates = validated;
    }

    if (Array.isArray(obj.skillTemplates)) {
        const validated: SkillTemplateEntry[] = [];
        for (const entry of obj.skillTemplates as unknown[]) {
            if (
                typeof entry === 'object' && entry !== null &&
                typeof (entry as any).id === 'string' && (entry as any).id.length > 0 &&
                typeof (entry as any).model === 'string' &&
                ((entry as any).mode === 'ask' || (entry as any).mode === 'task') &&
                Array.isArray((entry as any).skills)
            ) {
                const skills = ((entry as any).skills as unknown[]).filter(
                    (s): s is string => typeof s === 'string'
                );
                const clean: SkillTemplateEntry = {
                    id: (entry as any).id,
                    model: (entry as any).model,
                    mode: (entry as any).mode,
                    skills,
                };
                if (typeof (entry as any).name === 'string') clean.name = (entry as any).name;
                validated.push(clean);
            }
        }
        // Keep empty array as explicit "delete all"
        result.skillTemplates = validated;
    }

    if (obj.filesViewMode === 'flat' || obj.filesViewMode === 'tree') {
        result.filesViewMode = obj.filesViewMode;
    }

    if (typeof obj.boundedMemory === 'object' && obj.boundedMemory !== null) {
        const bm = obj.boundedMemory as Record<string, unknown>;
        if (typeof bm.enabled === 'boolean') {
            const validated: NonNullable<PerRepoPreferences['boundedMemory']> = { enabled: bm.enabled };
            if (typeof bm.charLimit === 'number' && bm.charLimit > 0) {
                validated.charLimit = bm.charLimit;
            }
            if (bm.writeFrequency === 'low' || bm.writeFrequency === 'medium' || bm.writeFrequency === 'high') {
                validated.writeFrequency = bm.writeFrequency;
            }
            if (typeof bm.recall === 'object' && bm.recall !== null) {
                const recall = bm.recall as Record<string, unknown>;
                const validatedRecall: NonNullable<NonNullable<PerRepoPreferences['boundedMemory']>['recall']> = {};
                if (typeof recall.enabled === 'boolean') {
                    validatedRecall.enabled = recall.enabled;
                }
                if (typeof recall.maxEntries === 'number' && recall.maxEntries > 0) {
                    validatedRecall.maxEntries = recall.maxEntries;
                }
                if (typeof recall.charBudget === 'number' && recall.charBudget > 0) {
                    validatedRecall.charBudget = recall.charBudget;
                }
                if (typeof recall.maxBm25Score === 'number' && Number.isFinite(recall.maxBm25Score)) {
                    validatedRecall.maxBm25Score = recall.maxBm25Score;
                }
                if (Object.keys(validatedRecall).length > 0) {
                    validated.recall = validatedRecall;
                }
            }
            if (typeof bm.readTools === 'object' && bm.readTools !== null) {
                const readTools = bm.readTools as Record<string, unknown>;
                const validatedReadTools: NonNullable<NonNullable<PerRepoPreferences['boundedMemory']>['readTools']> = {};
                if (typeof readTools.enabled === 'boolean') {
                    validatedReadTools.enabled = readTools.enabled;
                }
                if (typeof readTools.maxResults === 'number' && readTools.maxResults > 0) {
                    validatedReadTools.maxResults = readTools.maxResults;
                }
                if (typeof readTools.maxEntryChars === 'number' && readTools.maxEntryChars > 0) {
                    validatedReadTools.maxEntryChars = readTools.maxEntryChars;
                }
                if (Object.keys(validatedReadTools).length > 0) {
                    validated.readTools = validatedReadTools;
                }
            }
            if (typeof bm.autoPromote === 'object' && bm.autoPromote !== null) {
                validated.autoPromote = validateAutoPromoteConfig(bm.autoPromote);
            }
            result.boundedMemory = validated;
        }
    }

    if (typeof obj.notesGit === 'object' && obj.notesGit !== null) {
        const ng = obj.notesGit as Record<string, unknown>;
        if (typeof ng.enabled === 'boolean') {
            const validated: NotesGitConfig = { enabled: ng.enabled };
            if (typeof ng.autoCommit === 'object' && ng.autoCommit !== null) {
                const ac = ng.autoCommit as Record<string, unknown>;
                if (typeof ac.enabled === 'boolean') {
                    validated.autoCommit = { enabled: ac.enabled };
                    if (typeof ac.intervalMs === 'number' && ac.intervalMs > 0) {
                        validated.autoCommit.intervalMs = ac.intervalMs;
                    }
                }
            }
            result.notesGit = validated;
        }
    }

    if (typeof obj.activityFilters === 'object' && obj.activityFilters !== null && !Array.isArray(obj.activityFilters)) {
        const raw = obj.activityFilters as Record<string, unknown>;
        const validated: NonNullable<PerRepoPreferences['activityFilters']> = {};
        if (typeof raw.statusFilter === 'string') validated.statusFilter = raw.statusFilter;
        if (typeof raw.typeFilter === 'string') validated.typeFilter = raw.typeFilter;
        if (Object.keys(validated).length > 0) {
            result.activityFilters = validated;
        }
    }

    if (Array.isArray(obj.disabledLlmTools)) {
        const tools = (obj.disabledLlmTools as unknown[]).filter(
            (t): t is string => typeof t === 'string' && t.length > 0
        );
        result.disabledLlmTools = tools;
    }

    if (typeof obj.defaultModel === 'string' && obj.defaultModel.length <= 100) {
        result.defaultModel = obj.defaultModel;
    }

    if (typeof obj.maxRalphIterations === 'number'
        && Number.isFinite(obj.maxRalphIterations)
        && Number.isInteger(obj.maxRalphIterations)
        && obj.maxRalphIterations >= 1
        && obj.maxRalphIterations <= RALPH_MAX_ITERATIONS_LIMIT) {
        result.maxRalphIterations = obj.maxRalphIterations;
    }

    if (typeof obj.defaultModels === 'object' && obj.defaultModels !== null && !Array.isArray(obj.defaultModels)) {
        const raw = obj.defaultModels as Record<string, unknown>;
        const validated: DefaultModelsByMode = {};
        for (const mode of ['task', 'ask', 'plan', 'note', 'schedule', 'followUp', 'memory'] as const) {
            if (typeof raw[mode] === 'string' && (raw[mode] as string).length <= 100) {
                validated[mode] = raw[mode] as string;
            }
        }
        if (Object.keys(validated).length > 0) {
            result.defaultModels = validated;
        }
    }

    if (Array.isArray(obj.additionalNotesRoots)) {
        const roots = (obj.additionalNotesRoots as unknown[])
            .filter((r): r is string => typeof r === 'string' && r.length > 0 && r.length <= 500)
            .map(r => r.replace(/\\/g, '/').replace(/\/+$/, ''))  // normalize
            .filter(r => r.length > 0 && !r.startsWith('/') && !r.startsWith('..') && !r.includes('/../'));
        // Deduplicate
        const unique = [...new Set(roots)];
        result.additionalNotesRoots = unique.slice(0, MAX_ADDITIONAL_NOTES_ROOTS);
    }

    if (typeof obj.enabledMcpTools === 'object' && obj.enabledMcpTools !== null && !Array.isArray(obj.enabledMcpTools)) {
        const validated: Record<string, string[]> = {};
        for (const [serverName, tools] of Object.entries(obj.enabledMcpTools as Record<string, unknown>)) {
            if (typeof serverName === 'string' && serverName.length > 0 && Array.isArray(tools)) {
                const toolNames = (tools as unknown[]).filter(
                    (t): t is string => typeof t === 'string' && t.length > 0
                );
                validated[serverName] = toolNames;
            }
        }
        if (Object.keys(validated).length > 0) {
            result.enabledMcpTools = validated;
        }
    }

    return result;
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
 */
export function registerPreferencesRoutes(routes: Route[], dataDir: string): void {

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
