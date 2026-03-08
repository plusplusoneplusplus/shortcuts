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
import { sendJSON, sendError, parseBody } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Types
// ============================================================================

/** Skill interaction mode — determines which last-used skill preference to read/write. */
export type SkillMode = 'task' | 'ask' | 'plan';

/** Per-mode last-used skill names. */
export interface LastSkillsByMode {
    task?: string;
    ask?: string;
    plan?: string;
}

/** A recently-used prompt or skill in the Follow Prompt dialog. */
export interface RecentFollowPromptEntry {
    type: 'prompt' | 'skill';
    name: string;
    path?: string;
    description?: string;
    timestamp: number;
}

/** Global (cross-repo) UI preferences. */
export interface GlobalPreferences {
    /** Persisted dashboard theme ('light' | 'dark' | 'auto'). */
    theme?: 'light' | 'dark' | 'auto';
    /** Whether the repos sidebar (left panel) is collapsed. */
    reposSidebarCollapsed?: boolean;
    /** User-defined display order of repository groups. Each entry is a normalizedUrl (for grouped repos) or 'workspace:{id}' (for ungrouped repos). */
    gitGroupOrder?: string[];
}

/** Per-repository UI preferences. */
export interface PerRepoPreferences {
    /** Last-selected AI model in the SPA (empty string = default). */
    lastModel?: string;
    /** Last-selected generation depth in the SPA ('deep' | 'normal'). */
    lastDepth?: 'deep' | 'normal';
    /** Last-selected effort level in the Generate Task dialog. */
    lastEffort?: 'low' | 'medium' | 'high';
    /** Per-mode last-used skill names (task / ask / plan). */
    lastSkills?: LastSkillsByMode;
    /** Recently-used prompts/skills in Follow Prompt dialog (max 10, newest first). */
    recentFollowPrompts?: RecentFollowPromptEntry[];
    /** Pinned chat session IDs per workspace (ordered by pin time, newest first). */
    pinnedChats?: Record<string, string[]>;
    /** Archived chat session IDs per workspace. */
    archivedChats?: Record<string, string[]>;
    /** Skill usage timestamps for ordering skill dropdowns (skillName → ISO timestamp). */
    skillUsageMap?: Record<string, string>;
}

/** backward-compat alias */
export type UserPreferences = PerRepoPreferences;

/** Top-level structure of the preferences file on disk. */
export interface PreferencesFile {
    global?: GlobalPreferences;
    repos?: Record<string, PerRepoPreferences>;
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
            if (typeof raw[mode] === 'string') {
                validated[mode] = raw[mode] as string;
            }
        }
        if (Object.keys(validated).length > 0) {
            result.lastSkills = validated;
        }
    }

    if (Array.isArray(obj.recentFollowPrompts)) {
        const validated: RecentFollowPromptEntry[] = [];
        for (const entry of obj.recentFollowPrompts) {
            if (
                typeof entry === 'object' && entry !== null &&
                (entry.type === 'prompt' || entry.type === 'skill') &&
                typeof entry.name === 'string' && entry.name.length > 0 &&
                typeof entry.timestamp === 'number'
            ) {
                const clean: RecentFollowPromptEntry = {
                    type: entry.type,
                    name: entry.name,
                    timestamp: entry.timestamp,
                };
                if (typeof entry.path === 'string') clean.path = entry.path;
                if (typeof entry.description === 'string') clean.description = entry.description;
                validated.push(clean);
            }
            if (validated.length >= 10) break;
        }
        if (validated.length > 0) {
            result.recentFollowPrompts = validated;
        }
    }

    if (typeof obj.pinnedChats === 'object' && obj.pinnedChats !== null && !Array.isArray(obj.pinnedChats)) {
        const validatedPins: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(obj.pinnedChats as Record<string, unknown>)) {
            if (typeof key === 'string' && Array.isArray(value)) {
                const ids = value.filter((id: unknown) => typeof id === 'string' && id.length > 0);
                if (ids.length > 0) {
                    validatedPins[key] = ids;
                }
            }
        }
        if (Object.keys(validatedPins).length > 0) {
            result.pinnedChats = validatedPins;
        }
    }

    if (typeof obj.archivedChats === 'object' && obj.archivedChats !== null && !Array.isArray(obj.archivedChats)) {
        const validatedArchived: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(obj.archivedChats as Record<string, unknown>)) {
            if (typeof key === 'string' && Array.isArray(value)) {
                const ids = value.filter((id: unknown) => typeof id === 'string' && id.length > 0);
                if (ids.length > 0) {
                    validatedArchived[key] = ids;
                }
            }
        }
        if (Object.keys(validatedArchived).length > 0) {
            result.archivedChats = validatedArchived;
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
 * Read the full preferences file from disk.
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

        if (typeof obj.repos === 'object' && obj.repos !== null && !Array.isArray(obj.repos)) {
            const repos: Record<string, PerRepoPreferences> = {};
            for (const [key, value] of Object.entries(obj.repos as Record<string, unknown>)) {
                repos[key] = validatePerRepoPreferences(value);
            }
            if (Object.keys(repos).length > 0) {
                result.repos = repos;
            }
        }

        return result;
    } catch {
        return {};
    }
}

/**
 * Write the full preferences file to disk atomically (write-then-rename).
 * Creates the data directory if it doesn't exist.
 */
export function writePreferences(dataDir: string, data: PreferencesFile): void {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, PREFERENCES_FILE_NAME);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

// ============================================================================
// Internal helpers
// ============================================================================

function isEmptyObjectBody(body: unknown, key: string): boolean {
    if (typeof body !== 'object' || body === null || !(key in (body as object))) {
        return false;
    }
    const val = (body as Record<string, unknown>)[key];
    return typeof val === 'object' && val !== null && !Array.isArray(val) &&
        Object.keys(val as object).length === 0;
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
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

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
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const existing = readPreferences(dataDir);
            const patch = validateGlobalPreferences(body);
            const merged: GlobalPreferences = { ...(existing.global ?? {}), ...patch };
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
            const file = readPreferences(dataDir);
            sendJSON(res, 200, file.repos?.[repoId] ?? {});
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/preferences — Replace per-repo preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/preferences$/,
        handler: async (req, res, match) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const repoId = decodeURIComponent(match![1]);
            const repoPrefs = validatePerRepoPreferences(body);
            const existing = readPreferences(dataDir);
            const repos = { ...(existing.repos ?? {}), [repoId]: repoPrefs };
            writePreferences(dataDir, { ...existing, repos });
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
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const repoId = decodeURIComponent(match![1]);
            const existing = readPreferences(dataDir);
            const existingRepo = existing.repos?.[repoId] ?? {};
            const patch = validatePerRepoPreferences(body);
            const merged: PerRepoPreferences = { ...existingRepo, ...patch };

            // Deep-merge lastSkills so that patching { lastSkills: { ask: 'x' } }
            // preserves existing task/plan values.
            if (patch.lastSkills && existingRepo.lastSkills) {
                merged.lastSkills = { ...existingRepo.lastSkills, ...patch.lastSkills };
            }

            // Explicitly clear pinnedChats/archivedChats when the body sends {}
            // (validatePerRepoPreferences drops empty objects so the spread would
            // leave the old value intact).
            if (isEmptyObjectBody(body, 'pinnedChats')) {
                delete merged.pinnedChats;
            }
            if (isEmptyObjectBody(body, 'archivedChats')) {
                delete merged.archivedChats;
            }

            const repos = { ...(existing.repos ?? {}), [repoId]: merged };
            writePreferences(dataDir, { ...existing, repos });
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
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            if (!body || typeof body.skillName !== 'string' || body.skillName.length === 0) {
                return sendError(res, 400, '`skillName` is required');
            }

            const repoId = decodeURIComponent(match![1]);
            const skillName: string = body.skillName;
            const existing = readPreferences(dataDir);
            const existingRepo = existing.repos?.[repoId] ?? {};
            const timestamp = new Date().toISOString();
            const usageMap = { ...(existingRepo.skillUsageMap ?? {}), [skillName]: timestamp };
            const merged: PerRepoPreferences = { ...existingRepo, skillUsageMap: usageMap };
            const repos = { ...(existing.repos ?? {}), [repoId]: merged };
            writePreferences(dataDir, { ...existing, repos });
            sendJSON(res, 200, { skillName, timestamp });
        },
    });
}
