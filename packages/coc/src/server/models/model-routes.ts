import * as http from 'http';
import type { Route } from '../shared/router.js';
import { sendJson, send500 } from '../shared/router.js';
import type { ISDKService, ModelInfo } from '@plusplusoneplusplus/forge';
import { getAllModels } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../config.js';

/** Minimal interface required by this route; allows mock injection in tests. */
export interface ModelStore {
    getAll(): ModelInfo[];
}

/** Options for config persistence, allowing test injection. */
export interface ModelRouteOptions {
    configPath?: string;
    loadConfigFile: (p?: string) => CLIConfig | undefined;
    writeConfigFile: (p: string, c: CLIConfig) => void;
    getConfigFilePath: () => string;
    aiService?: ISDKService;
}

/** Dynamic fallback derived from the static model registry. */
function getStaticFallbackModels(): ModelInfo[] {
    return getAllModels().map(m => ({
        id: m.id,
        name: m.label,
        capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: m.contextWindow ?? 128_000 },
        },
    }));
}

function getModelQueryError(error: string | undefined): string {
    if (!error) return 'Model query failed';
    try {
        const parsed = JSON.parse(error) as unknown;
        if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>;
            const nested = record.error;
            if (nested && typeof nested === 'object') {
                const message = (nested as Record<string, unknown>).message;
                if (typeof message === 'string' && message.trim()) return message;
            }
            const message = record.message;
            if (typeof message === 'string' && message.trim()) return message;
        }
    } catch {
        // Non-JSON provider errors are already displayable.
    }
    return error;
}

/**
 * Register model-related API routes.
 *
 * @param routes  Mutable route array shared by the server.
 * @param store   Model store instance (may be uninitialized).
 * @param options Optional config functions for enabled-models persistence.
 */
export function registerModelRoutes(routes: Route[], store: ModelStore, options?: ModelRouteOptions): void {
    // -- GET /api/models -------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/models',
        handler: (_req: http.IncomingMessage, res: http.ServerResponse) => {
            try {
                const models = store.getAll();
                const list = models.length > 0 ? models : getStaticFallbackModels();
                if (options) {
                    const cfg = options.loadConfigFile(options.configPath);
                    const enabledSet = new Set(cfg?.models?.enabled ?? []);
                    const withEnabled = list.map(m => ({ ...m, enabled: enabledSet.has(m.id) }));
                    sendJson(res, withEnabled);
                } else {
                    sendJson(res, list);
                }
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Failed to retrieve models');
            }
        },
    });

    if (!options) {
        return;
    }

    // -- POST /api/models/query ----------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/models/query',
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    if (!options.aiService) {
                        res.writeHead(503, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'AI service is not available' }));
                        return;
                    }
                    const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
                    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
                    const model = typeof parsed.model === 'string' && parsed.model.trim()
                        ? parsed.model.trim()
                        : undefined;
                    const timeoutMs = typeof parsed.timeoutMs === 'number' && Number.isFinite(parsed.timeoutMs)
                        ? Math.max(1_000, Math.min(parsed.timeoutMs, 120_000))
                        : 60_000;

                    if (!prompt) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'prompt is required' }));
                        return;
                    }

                    const startedAt = Date.now();
                    const result = await options.aiService.sendMessage({
                        prompt,
                        ...(model ? { model } : {}),
                        timeoutMs,
                        mode: 'interactive',
                    });
                    const durationMs = Date.now() - startedAt;
                    if (!result.success) {
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: false,
                            error: getModelQueryError(result.error),
                            model,
                            sessionId: result.sessionId,
                            durationMs,
                        }));
                        return;
                    }
                    sendJson(res, {
                        success: true,
                        response: result.response ?? '',
                        model,
                        sessionId: result.sessionId,
                        durationMs,
                    });
                } catch (err) {
                    send500(res, err instanceof Error ? err.message : 'Failed to query model');
                }
            });
        },
    });

    // -- GET /api/models/enabled -----------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/models/enabled',
        handler: (_req: http.IncomingMessage, res: http.ServerResponse) => {
            try {
                const cfg = options.loadConfigFile(options.configPath);
                sendJson(res, { enabledModels: cfg?.models?.enabled ?? [] });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Failed to retrieve enabled models');
            }
        },
    });

    // -- PUT /api/models/enabled -----------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: '/api/models/enabled',
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    if (!Array.isArray(parsed.enabledModels) || !parsed.enabledModels.every((x: unknown) => typeof x === 'string')) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'enabledModels must be an array of strings' }));
                        return;
                    }
                    const enabledModels: string[] = parsed.enabledModels;
                    const filePath = options.getConfigFilePath();
                    const cfg = options.loadConfigFile(options.configPath) ?? {};
                    const updated: CLIConfig = { ...cfg, models: { ...cfg.models, enabled: enabledModels } };
                    options.writeConfigFile(filePath, updated);
                    sendJson(res, { enabledModels });
                } catch (err) {
                    send500(res, err instanceof Error ? err.message : 'Failed to update enabled models');
                }
            });
        },
    });

    // -- GET /api/models/reasoning-efforts ------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/models/reasoning-efforts',
        handler: (_req: http.IncomingMessage, res: http.ServerResponse) => {
            try {
                const cfg = options.loadConfigFile(options.configPath);
                sendJson(res, { reasoningEfforts: cfg?.models?.reasoningEfforts ?? {} });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Failed to retrieve reasoning efforts');
            }
        },
    });

    // -- PUT /api/models/reasoning-efforts ------------------------------------
    routes.push({
        method: 'PUT',
        pattern: '/api/models/reasoning-efforts',
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    if (typeof parsed.modelId !== 'string' || !parsed.modelId) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'modelId is required' }));
                        return;
                    }
                    if (typeof parsed.effort !== 'string') {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'effort must be a string (or empty string to clear)' }));
                        return;
                    }
                    const { modelId, effort } = parsed as { modelId: string; effort: string };
                    const filePath = options.getConfigFilePath();
                    const cfg = options.loadConfigFile(options.configPath) ?? {};
                    const existing = { ...(cfg.models?.reasoningEfforts ?? {}) };
                    if (effort === '') {
                        delete existing[modelId];
                    } else {
                        existing[modelId] = effort;
                    }
                    const updated: CLIConfig = { ...cfg, models: { ...cfg.models, reasoningEfforts: existing } };
                    options.writeConfigFile(filePath, updated);
                    sendJson(res, { reasoningEfforts: existing });
                } catch (err) {
                    send500(res, err instanceof Error ? err.message : 'Failed to update reasoning effort');
                }
            });
        },
    });
}
