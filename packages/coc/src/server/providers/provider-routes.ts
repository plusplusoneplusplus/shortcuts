/**
 * Provider Routes
 *
 * GET  /api/providers/config  — returns sanitized config (tokens redacted as "****")
 * PUT  /api/providers/config  — validates and persists provider credentials; returns 204
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { Route } from '../types';
import { sendJson, readJsonBody, send400, send500 } from '../router';
import { readProvidersConfig, writeProvidersConfig } from './providers-config';
import type { ProvidersFileConfig } from './providers-config';

// ============================================================================
// Sanitization helper
// ============================================================================

/** Sanitize config so credentials never leave the server.
 *  GitHub: returns `{ hasToken: boolean }` instead of the masked string.
 *  ADO:    returns only `orgUrl` (PAT is no longer stored).
 *  Tavily: returns `{ hasApiKey: boolean }` instead of the key.
 */
function sanitizeConfig(config: ProvidersFileConfig): unknown {
    const sanitized: {
        providers: {
            github?: { hasToken: boolean };
            ado?: { orgUrl: string };
            tavily?: { hasApiKey: boolean };
        };
    } = { providers: {} };

    if (config.providers.github) {
        sanitized.providers.github = { hasToken: !!config.providers.github.token };
    }
    if (config.providers.ado) {
        sanitized.providers.ado = { orgUrl: config.providers.ado.orgUrl };
    }
    if (config.providers.tavily) {
        sanitized.providers.tavily = { hasApiKey: !!config.providers.tavily.apiKey };
    }

    return sanitized;
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register provider config API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes  - Shared route table
 * @param dataDir - CoC data directory (e.g. ~/.coc)
 */
export function registerProviderRoutes(routes: Route[], dataDir: string): void {

    // -- GET /api/providers/config ------------------------------------------

    routes.push({
        method: 'GET',
        pattern: '/api/providers/config',
        handler: async (_req, res) => {
            try {
                const config = await readProvidersConfig(dataDir);
                sendJson(res, sanitizeConfig(config));
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Internal error');
            }
        },
    });

    // -- PUT /api/providers/config ------------------------------------------

    routes.push({
        method: 'PUT',
        pattern: '/api/providers/config',
        handler: async (req, res) => {
            try {
                const body = await readJsonBody<{
                    github?: { token?: unknown };
                    ado?: { orgUrl?: unknown };
                    tavily?: { apiKey?: unknown };
                }>(req);

                if (body.github !== undefined) {
                    if (typeof body.github.token !== 'string' || !body.github.token) {
                        send400(res, 'github.token must be a non-empty string');
                        return;
                    }
                }

                if (body.ado !== undefined) {
                    if (typeof body.ado.orgUrl !== 'string' || !body.ado.orgUrl) {
                        send400(res, 'ado.orgUrl must be a non-empty string');
                        return;
                    }
                }

                if (body.tavily !== undefined) {
                    if (typeof body.tavily.apiKey !== 'string' || !body.tavily.apiKey) {
                        send400(res, 'tavily.apiKey must be a non-empty string');
                        return;
                    }
                }

                // Merge into existing config so a partial save (e.g. just GitHub)
                // does not wipe other providers.
                const existing = await readProvidersConfig(dataDir);
                const merged: ProvidersFileConfig = {
                    providers: { ...existing.providers },
                };
                if (body.github) {
                    merged.providers.github = { token: body.github.token as string };
                }
                if (body.ado) {
                    merged.providers.ado = { orgUrl: body.ado.orgUrl as string };
                }
                if (body.tavily) {
                    merged.providers.tavily = { apiKey: body.tavily.apiKey as string };
                }

                await writeProvidersConfig(merged, dataDir);
                res.writeHead(204);
                res.end();
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Internal error');
            }
        },
    });
}
