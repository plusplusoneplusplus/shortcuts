/**
 * GET/PUT for editable runtime settings. Prefers the central
 * `RuntimeConfigService` when provided; otherwise falls back to the injected
 * `configFunctions` file path.
 */

import { validateConfigWithSchema } from '../../config/schema';
import { parseBody, sendJSON } from '../core/api-handler';
import { badRequest, handleAPIError, invalidJSON } from '../errors';
import type { CLIConfig } from '../storage/export-import-types';
import type { Route } from '../types';
import { ADMIN_CONFIG_FIELDS, ADMIN_EDITABLE_KEYS, getAdminFieldMetadata } from './admin-config-fields';
import type { AdminRouteOptions } from './admin-route-types';
import { resolveConfigPath } from './admin-route-types';

export function registerConfigRoutes(routes: Route[], options: AdminRouteOptions): void {
    const { configPath, configFunctions, runtimeConfigService } = options;
    const resolvedConfigPath = resolveConfigPath(options);

    // ------------------------------------------------------------------
    // GET /api/admin/config — Return resolved config with sources
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/config',
        handler: async (_req, res) => {
            if (runtimeConfigService) {
                const snapshot = runtimeConfigService.getSnapshot();
                sendJSON(res, 200, {
                    resolved: snapshot.config,
                    sources: snapshot.sources,
                    defaults: runtimeConfigService.defaults,
                    configFilePath: runtimeConfigService.configPath,
                    revision: snapshot.revision,
                    fieldMetadata: getAdminFieldMetadata(),
                });
            } else {
                const result = configFunctions?.getResolvedConfigWithSource?.(configPath) ?? { config: {}, sources: {} };
                sendJSON(res, 200, result);
            }
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/admin/config — Update editable runtime settings
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: '/api/admin/config',
        handler: async (req, res) => {
            let body: Record<string, unknown>;
            try {
                const parsed = await parseBody(req);
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    return handleAPIError(res, badRequest('Request body must be a JSON object'));
                }
                body = parsed;
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            // Reject empty body (no editable keys)
            const hasEditableKey = ADMIN_EDITABLE_KEYS.some(k => k in body);
            if (!hasEditableKey) {
                return handleAPIError(res, badRequest('Request body must contain at least one editable field'));
            }

            if (runtimeConfigService) {
                // Delegate validation, disk write, refresh, and revision bump to the service
                try {
                    const updateResult = await runtimeConfigService.updateConfig(body);
                    sendJSON(res, 200, {
                        resolved: updateResult.config,
                        sources: updateResult.sources,
                        defaults: runtimeConfigService.defaults,
                        configFilePath: runtimeConfigService.configPath,
                        revision: updateResult.revision,
                        effects: updateResult.effects,
                        fieldMetadata: getAdminFieldMetadata(),
                    });
                } catch (err) {
                    return handleAPIError(res, badRequest((err as Error).message));
                }
            } else {
                // Legacy path: validate and write through configFunctions
                const errors: string[] = [];
                for (const field of ADMIN_CONFIG_FIELDS) {
                    if (field.key in body) {
                        const err = field.validate(body[field.key]);
                        if (err) { errors.push(err); }
                    }
                }
                if (errors.length > 0) {
                    return handleAPIError(res, badRequest(errors.join('; ')));
                }

                const existing: CLIConfig = configFunctions?.loadConfigFile?.(configPath) ?? {};
                for (const field of ADMIN_CONFIG_FIELDS) {
                    if (field.key in body) {
                        field.apply(existing, body[field.key]);
                    }
                }

                try {
                    validateConfigWithSchema(existing);
                } catch (err) {
                    return handleAPIError(res, badRequest((err as Error).message));
                }

                configFunctions?.writeConfigFile?.(resolvedConfigPath, existing);

                const result = configFunctions?.getResolvedConfigWithSource?.(configPath) ?? { config: {}, sources: {} };
                sendJSON(res, 200, result);
            }
        },
    });
}
