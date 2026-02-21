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
import { sendJson, send400, send500 } from '@plusplusoneplusplus/coc-server';
import { readBody, sendSSE } from './ask-handler';
import type { WikiManager } from './wiki-manager';

// ============================================================================
// Seeds Handlers
// ============================================================================

const SEEDS_FILE = 'seeds.yaml';

/**
 * Resolve the path where seeds.yaml should be stored.
 * Prefers repoPath (alongside deep-wiki.config.yaml) when available,
 * otherwise falls back to wikiDir.
 */
function resolveSeedsPath(wikiDir: string, repoPath?: string): string {
    return repoPath ? path.join(repoPath, SEEDS_FILE) : path.join(wikiDir, SEEDS_FILE);
}

/**
 * GET /api/wikis/:wikiId/admin/seeds — Read seeds.yaml from the wiki directory.
 */
export async function handleGetSeeds(
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
        const seedsPath = resolveSeedsPath(wiki.registration.wikiDir, wiki.registration.repoPath);
        if (!fs.existsSync(seedsPath)) {
            sendJson(res, { exists: false, content: null, path: seedsPath });
            return;
        }

        const content = fs.readFileSync(seedsPath, 'utf-8');
        let parsed: unknown;
        try {
            const yaml = await import('js-yaml');
            parsed = yaml.load(content);
        } catch {
            sendJson(res, { exists: true, content: null, raw: content, path: seedsPath, error: 'Invalid YAML' });
            return;
        }

        sendJson(res, { exists: true, content: parsed, path: seedsPath });
    } catch (error) {
        send500(res, `Failed to read seeds: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * PUT /api/wikis/:wikiId/admin/seeds — Write seeds.yaml to the wiki directory.
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

        const seedsPath = resolveSeedsPath(wiki.registration.wikiDir, wiki.registration.repoPath);
        const yaml = await import('js-yaml');
        const content = typeof seeds === 'string' ? seeds : yaml.dump(seeds);
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

// ============================================================================
// Seeds Generate Handler
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importDeepWiki(subpath: string): Promise<any> {
    const modulePath = `@plusplusoneplusplus/deep-wiki/dist/${subpath}`;
    return import(modulePath);
}

/**
 * POST /api/wikis/:wikiId/admin/seeds/generate — Generate theme seeds via AI (SSE).
 */
export async function handleGenerateSeeds(
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

    const repoPath = wiki.registration.repoPath;
    if (!repoPath) {
        sendJson(res, { error: 'No repository path configured' }, 400);
        return;
    }

    // Parse optional JSON body
    let maxThemes: number | undefined;
    let model: string | undefined;
    let timeout: number | undefined;
    try {
        const body = await readBody(req);
        if (body.trim()) {
            const parsed = JSON.parse(body);
            maxThemes = parsed.maxThemes;
            model = parsed.model;
            timeout = parsed.timeout;
        }
    } catch {
        // Use defaults on parse error
    }

    // SSE setup
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    // Track client disconnect to avoid writing to a destroyed stream
    let clientDisconnected = false;
    req.on('close', () => { clientDisconnected = true; });

    const safeSend = (data: Record<string, unknown>): boolean => {
        if (clientDisconnected) return false;
        return sendSSE(res, data);
    };

    const safeEnd = () => {
        if (!res.destroyed && !res.writableEnded) {
            res.end();
        }
    };

    try {
        safeSend({ type: 'status', message: 'Checking AI availability...' });

        const { checkAIAvailability } = await importDeepWiki('ai-invoker');
        const availability = await checkAIAvailability();
        if (!availability.available) {
            const reason = availability.reason || 'Copilot SDK not available';
            safeSend({ type: 'error', message: reason });
            safeSend({ type: 'done', success: false, error: reason });
            safeEnd();
            return;
        }

        if (clientDisconnected) { safeEnd(); return; }

        safeSend({ type: 'status', message: 'Generating theme seeds...' });

        const { runSeedsSession } = await importDeepWiki('seeds/seeds-session');
        const seeds = await runSeedsSession(repoPath, {
            maxThemes: maxThemes ?? 50,
            model,
            timeout,
        });

        if (clientDisconnected) { safeEnd(); return; }

        // Auto-save seeds.yaml — prefer repoPath (alongside deep-wiki.config.yaml), fall back to wikiDir
        try {
            const seedsPath = resolveSeedsPath(wiki.registration.wikiDir, wiki.registration.repoPath);
            fs.mkdirSync(path.dirname(seedsPath), { recursive: true });
            const yaml = await import('js-yaml');
            fs.writeFileSync(seedsPath, yaml.dump({ themes: seeds }), 'utf-8');
            safeSend({ type: 'log', message: `Seeds saved to ${seedsPath}` });
        } catch (saveErr: unknown) {
            const saveMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
            safeSend({ type: 'log', message: `Warning: failed to auto-save seeds — ${saveMsg}` });
        }

        safeSend({ type: 'log', message: `Generated ${seeds.length} theme seeds` });
        safeSend({ type: 'done', success: true, seeds });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        safeSend({ type: 'error', message });
        safeSend({ type: 'done', success: false, error: message });
    }

    safeEnd();
}
