/**
 * Wiki Admin Handlers
 *
 * REST API handlers for wiki admin endpoints (seeds, config).
 * Adapted from deep-wiki's admin-handlers for multi-wiki CoC server.
 * Each endpoint is a flat Route — no sub-router pattern.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { sendJson, send400, send500 } from '../router';
import { readBody } from './ask-handler';
import type { WikiManager } from './wiki-manager';

// ============================================================================
// Seeds Handlers
// ============================================================================

const SEEDS_FILE = 'seeds.json';

/**
 * GET /api/wikis/:wikiId/admin/seeds — Read seeds.json from the wiki directory.
 */
export function handleGetSeeds(
    res: http.ServerResponse,
    wikiId: string,
    wikiManager: WikiManager,
): void {
    const wiki = wikiManager.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

    try {
        const seedsPath = path.join(wiki.registration.wikiDir, SEEDS_FILE);
        if (!fs.existsSync(seedsPath)) {
            sendJson(res, { exists: false, content: null, path: seedsPath });
            return;
        }

        const content = fs.readFileSync(seedsPath, 'utf-8');
        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch {
            sendJson(res, { exists: true, content: null, raw: content, path: seedsPath, error: 'Invalid JSON' });
            return;
        }

        sendJson(res, { exists: true, content: parsed, path: seedsPath });
    } catch (error) {
        send500(res, `Failed to read seeds: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * PUT /api/wikis/:wikiId/admin/seeds — Write seeds.json to the wiki directory.
 */
export async function handlePutSeeds(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    wikiId: string,
    wikiManager: WikiManager,
): Promise<void> {
    const wiki = wikiManager.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

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

        const seeds = payload.content;
        if (typeof seeds === 'object' && !Array.isArray(seeds)) {
            const obj = seeds as Record<string, unknown>;
            if (obj.themes !== undefined && !Array.isArray(obj.themes)) {
                send400(res, 'Seeds "themes" field must be an array');
                return;
            }
        }

        const seedsPath = path.join(wiki.registration.wikiDir, SEEDS_FILE);
        const content = typeof seeds === 'string' ? seeds : JSON.stringify(seeds, null, 2);
        fs.writeFileSync(seedsPath, content, 'utf-8');

        sendJson(res, { success: true, path: seedsPath });
    } catch (error) {
        send500(res, `Failed to save seeds: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ============================================================================
// Config Handlers
// ============================================================================

const CONFIG_CANDIDATES = ['deep-wiki.config.yaml', 'deep-wiki.config.yml'];

/**
 * Discover config file in a directory (check for yaml/yml variants).
 */
function discoverConfigFile(dir: string): string | null {
    for (const candidate of CONFIG_CANDIDATES) {
        const configPath = path.join(dir, candidate);
        if (fs.existsSync(configPath)) {
            return configPath;
        }
    }
    return null;
}

/**
 * GET /api/wikis/:wikiId/admin/config — Read deep-wiki.config.yaml from the repo root.
 */
export function handleGetConfig(
    res: http.ServerResponse,
    wikiId: string,
    wikiManager: WikiManager,
): void {
    const wiki = wikiManager.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

    try {
        if (!wiki.registration.repoPath) {
            sendJson(res, { exists: false, content: null, path: null, error: 'No repository path configured' });
            return;
        }

        const configPath = discoverConfigFile(wiki.registration.repoPath);
        if (!configPath) {
            sendJson(res, {
                exists: false,
                content: null,
                path: path.join(wiki.registration.repoPath, CONFIG_CANDIDATES[0]),
                defaultName: CONFIG_CANDIDATES[0],
            });
            return;
        }

        const content = fs.readFileSync(configPath, 'utf-8');
        sendJson(res, { exists: true, content, path: configPath });
    } catch (error) {
        send500(res, `Failed to read config: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * PUT /api/wikis/:wikiId/admin/config — Write deep-wiki.config.yaml to the repo root.
 */
export async function handlePutConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    wikiId: string,
    wikiManager: WikiManager,
): Promise<void> {
    const wiki = wikiManager.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

    try {
        if (!wiki.registration.repoPath) {
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

        // Validate YAML (basic structure check)
        try {
            const yaml = await import('js-yaml');
            const parsed = yaml.load(yamlContent);
            if (parsed !== null && parsed !== undefined && typeof parsed !== 'object') {
                send400(res, 'Config must parse to an object');
                return;
            }
        } catch (error) {
            send400(res, `Invalid config YAML: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }

        const existingPath = discoverConfigFile(wiki.registration.repoPath);
        const configPath = existingPath || path.join(wiki.registration.repoPath, CONFIG_CANDIDATES[0]);
        fs.writeFileSync(configPath, yamlContent, 'utf-8');

        sendJson(res, { success: true, path: configPath });
    } catch (error) {
        send500(res, `Failed to save config: ${error instanceof Error ? error.message : String(error)}`);
    }
}
