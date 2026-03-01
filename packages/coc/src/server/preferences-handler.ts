/**
 * Preferences REST API Handler
 *
 * HTTP API routes for persisting user UI preferences (e.g. last-selected model).
 * Stores preferences in a JSON file under the CoC data directory (~/.coc/preferences.json).
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

/** A recently-used prompt or skill in the Follow Prompt dialog. */
export interface RecentFollowPromptEntry {
    type: 'prompt' | 'skill';
    name: string;
    path?: string;
    description?: string;
    timestamp: number;
}

/** User UI preferences persisted on disk. */
export interface UserPreferences {
    /** Last-selected AI model in the SPA (empty string = default). */
    lastModel?: string;
    /** Last-selected generation depth in the SPA ('deep' | 'normal'). */
    lastDepth?: 'deep' | 'normal';
    /** Last-selected effort level in the Generate Task dialog. */
    lastEffort?: 'low' | 'medium' | 'high';
    /** Persisted dashboard theme ('light' | 'dark' | 'auto'). */
    theme?: 'light' | 'dark' | 'auto';
    /** Recently-used prompts/skills in Follow Prompt dialog (max 10, newest first). */
    recentFollowPrompts?: RecentFollowPromptEntry[];
    /** Pinned chat session IDs per workspace (ordered by pin time, newest first). */
    pinnedChats?: Record<string, string[]>;
}

// ============================================================================
// Constants
// ============================================================================

/** Name of the preferences file within the data directory. */
export const PREFERENCES_FILE_NAME = 'preferences.json';

// ============================================================================
// Persistence Helpers
// ============================================================================

/**
 * Read preferences from disk.
 * Returns an empty object when the file doesn't exist or is invalid.
 */
export function readPreferences(dataDir: string): UserPreferences {
    const filePath = path.join(dataDir, PREFERENCES_FILE_NAME);
    try {
        if (!fs.existsSync(filePath)) {
            return {};
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return validatePreferences(parsed);
    } catch {
        return {};
    }
}

/**
 * Write preferences to disk atomically (write-then-rename pattern).
 * Creates the data directory if it doesn't exist.
 */
export function writePreferences(dataDir: string, prefs: UserPreferences): void {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, PREFERENCES_FILE_NAME);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(prefs, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

/**
 * Validate and sanitize a preferences object.
 * Unknown keys are silently dropped.
 */
export function validatePreferences(raw: unknown): UserPreferences {
    if (typeof raw !== 'object' || raw === null) {
        return {};
    }
    const obj = raw as Record<string, unknown>;
    const result: UserPreferences = {};

    if (typeof obj.lastModel === 'string') {
        result.lastModel = obj.lastModel;
    }

    if (obj.lastDepth === 'deep' || obj.lastDepth === 'normal') {
        result.lastDepth = obj.lastDepth;
    }

    if (obj.lastEffort === 'low' || obj.lastEffort === 'medium' || obj.lastEffort === 'high') {
        result.lastEffort = obj.lastEffort;
    }

    if (obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'auto') {
        result.theme = obj.theme;
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

    return result;
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
    // GET /api/preferences — Read current preferences
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/preferences',
        handler: async (_req, res) => {
            const prefs = readPreferences(dataDir);
            sendJSON(res, 200, prefs);
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/preferences — Replace preferences
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

            const prefs = validatePreferences(body);
            writePreferences(dataDir, prefs);
            sendJSON(res, 200, prefs);
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/preferences — Merge partial updates into preferences
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
            const patch = validatePreferences(body);
            const merged: UserPreferences = { ...existing, ...patch };
            writePreferences(dataDir, merged);
            sendJSON(res, 200, merged);
        },
    });
}
