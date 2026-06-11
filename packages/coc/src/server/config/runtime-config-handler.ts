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
import { buildFeatureFlagRuntimeMap } from '@plusplusoneplusplus/coc-client';
import { shortenHostname } from '../core/hostname-utils';

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
        features: {
            // Boolean flags are derived from the FEATURE_FLAGS registry.
            ...buildFeatureFlagRuntimeMap(config),
            // Non-boolean runtime settings remain explicit.
            scratchpadLayout: config.scratchpad?.layout ?? 'horizontal',
            defaultProvider: config.defaultProvider ?? 'copilot',
            commitChatLensDormantMode: config.features?.commitChatLensDormantMode ?? 'ghost',
        },
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
