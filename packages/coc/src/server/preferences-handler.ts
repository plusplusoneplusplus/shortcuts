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
import { sendJSON, sendError } from './api-handler';
import { parseBodyOrReject } from './shared/handler-utils';
import { getRepoDataPath } from './paths';
import type { Route } from './types';
import type { NotesGitConfig } from './notes-git-types';

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

    /** Persisted UI layout mode ('classic' | 'dev-workflow' | 'notes-centric'). */
    uiLayoutMode?: 'classic' | 'dev-workflow' | 'notes-centric';

    /**
     * Per-handler enabled/disabled overrides for the link-handler feature.
     * Keys are handler names (e.g. 'teams', 'vscode', 'onenote').
     * `true` = handler is enabled; `false` or absent = disabled (default).
     */
    linkHandlers?: Record<string, boolean>;
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
    };
    /** Sandboxed inline previews for local .html/.htm links whose title is "embed". */
    htmlEmbed?: {
        enabled: boolean;
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
     * - `undefined` — use defaults (all enabled except tavily_web_search).
     * - `string[]` — tools whose name matches an entry are disabled.
     */
    disabledLlmTools?: string[];
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

    if (obj.uiLayoutMode === 'classic' || obj.uiLayoutMode === 'dev-workflow' || obj.uiLayoutMode === 'notes-centric') {
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

    return result;
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
            result.boundedMemory = validated;
        }
    }

    if (typeof obj.htmlEmbed === 'object' && obj.htmlEmbed !== null) {
        const he = obj.htmlEmbed as Record<string, unknown>;
        if (typeof he.enabled === 'boolean') {
            result.htmlEmbed = { enabled: he.enabled };
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
            const file = readPreferences(dataDir);
            sendJSON(res, 200, file.global ?? {});
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

            // Deep-merge activityFilters so that patching { activityFilters: { statusFilter: 'x' } }
            // preserves existing typeFilter value.
            if (patch.activityFilters && existingRepo.activityFilters) {
                merged.activityFilters = { ...existingRepo.activityFilters, ...patch.activityFilters };
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
}
