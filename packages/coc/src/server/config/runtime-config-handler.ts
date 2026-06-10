/**
 * Runtime Config API Handler
 *
 * Exposes GET /api/config/runtime so the SPA can fetch current feature
 * flags from the RuntimeConfigService instead of relying on stale
 * HTML-embedded window.__DASHBOARD_CONFIG__.
 */

import type { Route } from '../types';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import { sendJson } from '../shared/router';
import type { RuntimeDashboardConfig } from '@plusplusoneplusplus/coc-client';
import { shortenHostname } from '../core/hostname-utils';
import { buildRuntimeFeatureFlags } from '../../config/admin-setting-definitions';
import type { ResolvedCLIConfig } from '../../config';

/**
 * Build the dashboard feature-flag map for a (possibly partial) config.
 * Registry-driven: every admin setting with a `runtimeFlag` is included
 * automatically. Flags not backed by an admin setting are added by hand here.
 */
export function buildRuntimeFeatures(config: Partial<ResolvedCLIConfig>): RuntimeDashboardConfig['features'] {
    return {
        ...buildRuntimeFeatureFlags(config),
        gitCommitLookupEnabled: config.features?.gitCommitLookup ?? false,
    } as RuntimeDashboardConfig['features'];
}

export interface RuntimeConfigRouteOptions {
    runtimeConfigService: RuntimeConfigService;
    hostname: string;
    bindAddress: string;
}

/**
 * Build the runtime dashboard config response from the current config snapshot.
 */
export function buildRuntimeDashboardConfig(
    runtimeConfigService: RuntimeConfigService,
    hostname: string,
    bindAddress: string,
): RuntimeDashboardConfig {
    const config = runtimeConfigService.config;
    return {
        revision: runtimeConfigService.revision,
        features: buildRuntimeFeatures(config),
        hostname: config.serve?.serverName || shortenHostname(hostname),
        bindAddress,
    };
}

export function registerRuntimeConfigRoutes(
    routes: Route[],
    options: RuntimeConfigRouteOptions,
): void {
    const { runtimeConfigService, hostname, bindAddress } = options;

    routes.push({
        method: 'GET',
        pattern: '/api/config/runtime',
        handler: (_req, res) => {
            const response = buildRuntimeDashboardConfig(
                runtimeConfigService,
                hostname,
                bindAddress,
            );
            sendJson(res, response);
        },
    });
}
