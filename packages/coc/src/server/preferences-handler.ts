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

/** User UI preferences persisted on disk. */
export interface UserPreferences {
    /** Last-selected AI model in the SPA (empty string = default). */
    lastModel?: string;
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
