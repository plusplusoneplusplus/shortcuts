/**
 * Agent Providers REST API Routes
 *
 * GET /api/agent-providers
 *   Returns enabled/available status for Copilot and Codex so the
 *   New Chat UI and Admin page can show live provider state without a
 *   server restart.
 *
 * Copilot is always enabled, available, and locked.
 * Codex status is derived from:
 *   - `codex.enabled` in live runtime config (enabled flag)
 *   - Codex auth store (available flag; requires authenticated status)
 */

import type { Route } from '../types';
import { sendJson } from '../shared/router';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import type { CodexAuthInfo } from '../codex-auth/codex-auth-store';
import type { AgentProviderStatus, AgentProvidersResponse, AgentProvidersQuotaResponse, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import type { CopilotSDKService, CodexSDKService } from '@plusplusoneplusplus/forge';

export interface AgentProvidersRouteContext {
    runtimeConfigService: RuntimeConfigService;
    /** Reads current Codex auth info. Returns unauthenticated info if Codex infra is absent. */
    getCodexAuthInfo: () => CodexAuthInfo;
    /** The base URL prefix used to build authUrl (e.g. 'http://localhost:4000'). */
    serverBaseUrl: string;
    /** Optional: getter for Copilot account quota. Used by the quota endpoint. */
    getCopilotSdkService?: () => CopilotSDKService;
    /** Optional: getter for Codex account quota. Used by the quota endpoint. */
    getCodexSdkService?: () => CodexSDKService | undefined;
}

/** Build the providers array from live config + auth state. Exported for unit testing. */
export function buildAgentProvidersResponse(ctx: AgentProvidersRouteContext): AgentProvidersResponse {
    const config = ctx.runtimeConfigService.config;
    const codexEnabled = config.codex?.enabled ?? false;

    const copilot: AgentProviderStatus = {
        id: 'copilot',
        label: 'Copilot',
        enabled: true,
        available: true,
        locked: true,
    };

    let codexProvider: AgentProviderStatus;
    if (!codexEnabled) {
        codexProvider = {
            id: 'codex',
            label: 'Codex',
            enabled: false,
            available: false,
        };
    } else {
        const authInfo: CodexAuthInfo = ctx.getCodexAuthInfo();
        const authenticated = authInfo.status === 'authenticated';
        if (authenticated) {
            codexProvider = {
                id: 'codex',
                label: 'Codex',
                enabled: true,
                available: true,
            };
        } else {
            const reason = authInfo.status === 'expired'
                ? 'Codex authentication has expired.'
                : 'Codex authentication required.';
            codexProvider = {
                id: 'codex',
                label: 'Codex',
                enabled: true,
                available: false,
                reason,
                authUrl: `${ctx.serverBaseUrl}/api/codex-auth/start`,
            };
        }
    }

    return { providers: [copilot, codexProvider] };
}

export function registerAgentProvidersRoutes(routes: Route[], ctx: AgentProvidersRouteContext): void {
    routes.push({
        method: 'GET',
        pattern: '/api/agent-providers',
        handler: (_req, res) => {
            const body = buildAgentProvidersResponse(ctx);
            sendJson(res, body);
        },
    });

    routes.push({
        method: 'GET',
        pattern: '/api/agent-providers/quota',
        handler: async (_req, res) => {
            const config = ctx.runtimeConfigService.config;
            const codexEnabled = config.codex?.enabled ?? false;

            const providers: AgentProvidersQuotaResponse['providers'] = [];

            // Copilot quota
            try {
                const sdkService = ctx.getCopilotSdkService?.();
                if (!sdkService) {
                    providers.push({ id: 'copilot', quotaTypes: [], error: 'Copilot SDK service not available' });
                } else {
                    const result = await sdkService.getAccountQuota();
                    const quotaTypes: ProviderQuotaType[] = Object.entries(result.quotaSnapshots).map(
                        ([type, snap]) => ({
                            type,
                            isUnlimitedEntitlement: snap.isUnlimitedEntitlement,
                            usedRequests: snap.usedRequests,
                            entitlementRequests: snap.entitlementRequests,
                            remainingPercentage: snap.remainingPercentage,
                            usageAllowedWithExhaustedQuota: snap.usageAllowedWithExhaustedQuota,
                            overage: snap.overage,
                            resetDate: snap.resetDate,
                        }),
                    );
                    providers.push({ id: 'copilot', quotaTypes });
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                providers.push({ id: 'copilot', quotaTypes: [], error: msg });
            }

            // Codex quota via app-server RPC
            if (codexEnabled) {
                try {
                    const codexService = ctx.getCodexSdkService?.();
                    if (!codexService) {
                        providers.push({ id: 'codex', quotaTypes: [] });
                    } else {
                        const result = await codexService.getAccountQuota();
                        const quotaTypes: ProviderQuotaType[] = Object.entries(result.quotaSnapshots).map(
                            ([type, snap]) => ({
                                type,
                                isUnlimitedEntitlement: snap.isUnlimitedEntitlement,
                                usedRequests: snap.usedRequests,
                                entitlementRequests: snap.entitlementRequests,
                                remainingPercentage: snap.remainingPercentage,
                                usageAllowedWithExhaustedQuota: snap.usageAllowedWithExhaustedQuota,
                                overage: snap.overage,
                                resetDate: snap.resetDate,
                            }),
                        );
                        providers.push({ id: 'codex', quotaTypes });
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    providers.push({ id: 'codex', quotaTypes: [], error: msg });
                }
            }

            const body: AgentProvidersQuotaResponse = { providers };
            sendJson(res, body);
        },
    });
}
