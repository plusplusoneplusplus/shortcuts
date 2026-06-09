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
            terminalEnabled: config.terminal?.enabled ?? true,
            notesEnabled: config.notes?.enabled ?? true,
            myWorkEnabled: config.myWork?.enabled ?? false,
            myLifeEnabled: config.myLife?.enabled ?? false,
            scratchpadEnabled: config.scratchpad?.enabled ?? false,
            scratchpadLayout: config.scratchpad?.layout ?? 'horizontal',
            workflowsEnabled: config.workflows?.enabled ?? false,
            pullRequestsEnabled: config.pullRequests?.enabled ?? false,
            pullRequestsSuggestionsEnabled: config.pullRequests?.suggestions ?? false,
            pullRequestsAutoClassifyTeamEnabled: config.pullRequests?.autoClassifyTeam ?? false,
            serversEnabled: config.servers?.enabled ?? false,
            ralphEnabled: config.ralph?.enabled ?? false,
            forEachEnabled: config.forEach?.enabled ?? false,
            mapReduceEnabled: config.mapReduce?.enabled ?? false,
            vimNavigationEnabled: config.vimNavigation?.enabled ?? false,
            loopsEnabled: config.loops?.enabled ?? false,
            excalidrawEnabled: config.excalidraw?.enabled ?? false,
            mcpOauthEnabled: config.mcpOauth?.enabled ?? false,
            focusedDiffEnabled: config.features?.focusedDiff ?? false,
            containerDefaultAgentEnabled: config.containerDefaultAgent?.enabled ?? false,
            codexEnabled: config.codex?.enabled ?? false,
            claudeEnabled: config.claude?.enabled ?? false,
            defaultProvider: config.defaultProvider ?? 'copilot',
            autoAgentProviderRoutingEnabled: config.features?.autoAgentProviderRouting ?? false,
            workItemsHierarchyEnabled: config.workItems?.hierarchy?.enabled ?? false,
            workItemsSyncEnabled: config.workItems?.sync?.enabled ?? false,
            workItemsAiAuthoringEnabled: config.workItems?.aiAuthoring?.enabled ?? false,
            gitCommitLookupEnabled: config.features?.gitCommitLookup ?? false,
            gitCrossCloneCherryPickEnabled: config.features?.gitCrossCloneCherryPick ?? false,
            sessionContextAttachmentsEnabled: config.features?.sessionContextAttachments ?? false,
            commitChatLensEnabled: config.features?.commitChatLens ?? false,
            commitChatLensDormantMode: config.features?.commitChatLensDormantMode ?? 'ghost',
            effortLevelsEnabled: config.effortLevels?.enabled ?? false,
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
