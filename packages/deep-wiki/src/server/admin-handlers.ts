/**
 * Admin Handlers
 *
 * REST API handlers for the admin portal.
 * Provides read/write access to seeds (seeds.json) and
 * config (deep-wiki.config.yaml) files.
 *
 * Routes:
 *   GET  /api/admin/seeds  — Read seeds.json from wiki directory
 *   PUT  /api/admin/seeds  — Write seeds.json to wiki directory
 *   GET  /api/admin/config — Read deep-wiki.config.yaml from repo root
 *   PUT  /api/admin/config — Write deep-wiki.config.yaml to repo root
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { sendJson, send404, send400, send500, readBody } from './router';
import { getErrorMessage } from '../utils/error-utils';
import { validateConfig, discoverConfigFile } from '../config-loader';

// ============================================================================
// Types
// ============================================================================

export interface AdminHandlerContext {
    /** Wiki output directory (contains seeds.json) */
    wikiDir: string;
    /** Repository root path (contains deep-wiki.config.yaml) */
    repoPath?: string;
}

// ============================================================================
// Main Admin Router
// ============================================================================

/**
 * Route an admin API request to the appropriate handler.
 * Returns true if the request was handled, false otherwise.
 */
export function handleAdminRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    method: string,
    context: AdminHandlerContext
): boolean {
    // GET /api/admin/seeds
    if (method === 'GET' && pathname === '/api/admin/seeds') {
        handleGetSeeds(res, context);
        return true;
    }

    // PUT /api/admin/seeds
    if (method === 'PUT' && pathname === '/api/admin/seeds') {
        handlePutSeeds(req, res, context).catch(() => {
            if (!res.headersSent) {
                send500(res, 'Failed to save seeds');
            }
        });
        return true;
    }

    // GET /api/admin/config
    if (method === 'GET' && pathname === '/api/admin/config') {
        handleGetConfig(res, context);
        return true;
    }

    // PUT /api/admin/config
    if (method === 'PUT' && pathname === '/api/admin/config') {
        handlePutConfig(req, res, context).catch(() => {
            if (!res.headersSent) {
                send500(res, 'Failed to save config');
            }
        });
        return true;
    }

    return false;
}

// ============================================================================
// Seeds Handlers
// ============================================================================

/** Seeds file name */
const SEEDS_FILE = 'seeds.json';

/**
 * GET /api/admin/seeds — Read seeds.json from the wiki directory.
 */
function handleGetSeeds(res: http.ServerResponse, context: AdminHandlerContext): void {
    try {
        const seedsPath = path.join(context.wikiDir, SEEDS_FILE);

        if (!fs.existsSync(seedsPath)) {
            sendJson(res, { exists: false, content: null, path: seedsPath });
            return;
        }

        const content = fs.readFileSync(seedsPath, 'utf-8');
        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch {
            // Return raw content if not valid JSON
            sendJson(res, { exists: true, content: null, raw: content, path: seedsPath, error: 'Invalid JSON' });
            return;
        }

        sendJson(res, { exists: true, content: parsed, path: seedsPath });
    } catch (error) {
        send500(res, `Failed to read seeds: ${getErrorMessage(error)}`);
    }
}

/**
 * PUT /api/admin/seeds — Write seeds.json to the wiki directory.
 * Expects JSON body with { content: <seeds object or string> }.
 */
async function handlePutSeeds(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    context: AdminHandlerContext
): Promise<void> {
    try {
        const body = await readBody(req);
        let payload: { content: unknown };

        try {
            payload = JSON.parse(body);
        } catch {
            send400(res, 'Request body must be valid JSON');
            return;
        }

        if (payload.content === undefined || payload.content === null) {
            send400(res, 'Missing "content" field in request body');
            return;
        }

        // Validate basic seeds structure
        const seeds = payload.content;
        if (typeof seeds === 'object' && !Array.isArray(seeds)) {
            const obj = seeds as Record<string, unknown>;
            if (obj.topics !== undefined && !Array.isArray(obj.topics)) {
                send400(res, 'Seeds "topics" field must be an array');
                return;
            }
        }

        const seedsPath = path.join(context.wikiDir, SEEDS_FILE);
        const content = typeof seeds === 'string' ? seeds : JSON.stringify(seeds, null, 2);
        fs.writeFileSync(seedsPath, content, 'utf-8');

        sendJson(res, { success: true, path: seedsPath });
    } catch (error) {
        send500(res, `Failed to save seeds: ${getErrorMessage(error)}`);
    }
}

// ============================================================================
// Config Handlers
// ============================================================================

/** Config file candidates */
const CONFIG_CANDIDATES = ['deep-wiki.config.yaml', 'deep-wiki.config.yml'];

/**
 * GET /api/admin/config — Read deep-wiki.config.yaml from the repo root.
 */
function handleGetConfig(res: http.ServerResponse, context: AdminHandlerContext): void {
    try {
        if (!context.repoPath) {
            sendJson(res, { exists: false, content: null, path: null, error: 'No repository path configured' });
            return;
        }

        const configPath = discoverConfigFile(context.repoPath);

        if (!configPath) {
            sendJson(res, {
                exists: false,
                content: null,
                path: path.join(context.repoPath, CONFIG_CANDIDATES[0]),
                defaultName: CONFIG_CANDIDATES[0],
            });
            return;
        }

        const content = fs.readFileSync(configPath, 'utf-8');
        sendJson(res, { exists: true, content, path: configPath });
    } catch (error) {
        send500(res, `Failed to read config: ${getErrorMessage(error)}`);
    }
}

/**
 * PUT /api/admin/config — Write deep-wiki.config.yaml to the repo root.
 * Expects JSON body with { content: <yaml string> }.
 */
async function handlePutConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    context: AdminHandlerContext
): Promise<void> {
    try {
        if (!context.repoPath) {
            send400(res, 'No repository path configured. Cannot save config.');
            return;
        }

        const body = await readBody(req);
        let payload: { content: unknown };

        try {
            payload = JSON.parse(body);
        } catch {
            send400(res, 'Request body must be valid JSON');
            return;
        }

        if (payload.content === undefined || payload.content === null) {
            send400(res, 'Missing "content" field in request body');
            return;
        }

        if (typeof payload.content !== 'string') {
            send400(res, '"content" must be a YAML string');
            return;
        }

        const yamlContent = payload.content;

        // Validate the YAML by attempting to parse and validate it
        try {
            const yaml = await import('js-yaml');
            const parsed = yaml.load(yamlContent);
            if (parsed !== null && parsed !== undefined && typeof parsed === 'object') {
                validateConfig(parsed as Record<string, unknown>);
            }
        } catch (error) {
            send400(res, `Invalid config: ${getErrorMessage(error)}`);
            return;
        }

        // Write to existing config file or create new one
        const existingPath = discoverConfigFile(context.repoPath);
        const configPath = existingPath || path.join(context.repoPath, CONFIG_CANDIDATES[0]);
        fs.writeFileSync(configPath, yamlContent, 'utf-8');

        sendJson(res, { success: true, path: configPath });
    } catch (error) {
        send500(res, `Failed to save config: ${getErrorMessage(error)}`);
    }
}
