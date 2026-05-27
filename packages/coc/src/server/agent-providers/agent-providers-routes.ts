/**
 * Agent Providers REST API Routes
 *
 * GET /api/agent-providers
 *   Returns enabled/available status for Copilot, Codex, and Claude so the
 *   New Chat UI and Admin page can show live provider state without a
 *   server restart.
 *
 * Copilot is always enabled, available, and locked.
 * Codex status is derived from:
 *   - `codex.enabled` in live runtime config (enabled flag)
 *   - `@openai/codex-sdk` SDK availability check (available flag)
 * Claude status is derived from:
 *   - `claude.enabled` in live runtime config (enabled flag)
 *   - `@anthropic-ai/claude-agent-sdk` SDK availability check (available flag)
 */

import type { Route } from '../types';
import { sendJson } from '../shared/router';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import type { AgentProviderStatus, AgentProvidersResponse, AgentProvidersQuotaResponse, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import type { CopilotSDKService, IAvailabilityResult, CodexSDKService, ClaudeSDKService, IAccountQuotaResult } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { getResolvedInstallState } from '../providers/provider-install-routes';

export interface AgentProvidersRouteContext {
    runtimeConfigService: RuntimeConfigService;
    /** Checks Codex SDK availability. Resolved per-request; the service caches the result. */
    getCodexAvailability: () => Promise<IAvailabilityResult>;
    /** Checks Claude SDK availability. Resolved per-request; the service caches the result. */
    getClaudeAvailability: () => Promise<IAvailabilityResult>;
    /** Optional: getter for Copilot account quota. Used by the quota endpoint. */
    getCopilotSdkService?: () => CopilotSDKService;
    /** Optional: getter for Codex account quota. Used by the quota endpoint. */
    getCodexSdkService?: () => CodexSDKService | undefined;
    /** Optional: getter for Claude account quota. Used by the quota endpoint. */
    getClaudeSdkService?: () => ClaudeSDKService | undefined;
}

function quotaResultToProviderQuotaTypes(result: IAccountQuotaResult): ProviderQuotaType[] {
    return Object.entries(result.quotaSnapshots).map(
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
}

/** Build the providers array from live config + SDK state. Exported for unit testing. */
export async function buildAgentProvidersResponse(ctx: AgentProvidersRouteContext): Promise<AgentProvidersResponse> {
    const config = ctx.runtimeConfigService.config;
    const codexEnabled = config.codex?.enabled ?? false;
    const claudeEnabled = config.claude?.enabled ?? false;

    const copilot: AgentProviderStatus = {
        id: 'copilot',
        label: 'Copilot',
        enabled: true,
        available: true,
        locked: true,
    };

    // Resolve SDK install status for optional providers.
    const codexInstallState = getResolvedInstallState('codex');
    const claudeInstallState = getResolvedInstallState('claude');

    let codexProvider: AgentProviderStatus;
    if (!codexEnabled) {
        codexProvider = {
            id: 'codex',
            label: 'Codex',
            enabled: false,
            available: false,
            installStatus: codexInstallState.status,
        };
    } else {
        const availability = await ctx.getCodexAvailability();
        if (availability.available) {
            codexProvider = {
                id: 'codex',
                label: 'Codex',
                enabled: true,
                available: true,
                installStatus: codexInstallState.status,
            };
        } else {
            codexProvider = {
                id: 'codex',
                label: 'Codex',
                enabled: true,
                available: false,
                reason: availability.error ?? 'Codex SDK is not available.',
                installStatus: codexInstallState.status,
            };
        }
    }

    let claudeProvider: AgentProviderStatus;
    if (!claudeEnabled) {
        claudeProvider = {
            id: 'claude',
            label: 'Claude',
            enabled: false,
            available: false,
            installStatus: claudeInstallState.status,
        };
    } else {
        const availability = await ctx.getClaudeAvailability();
        if (availability.available) {
            claudeProvider = {
                id: 'claude',
                label: 'Claude',
                enabled: true,
                available: true,
                installStatus: claudeInstallState.status,
            };
        } else {
            claudeProvider = {
                id: 'claude',
                label: 'Claude',
                enabled: true,
                available: false,
                reason: availability.error ?? 'Claude Code SDK is not available.',
                installStatus: claudeInstallState.status,
            };
        }
    }

    return { providers: [copilot, codexProvider, claudeProvider] };
}

export function registerAgentProvidersRoutes(routes: Route[], ctx: AgentProvidersRouteContext): void {
    routes.push({
        method: 'GET',
        pattern: '/api/agent-providers',
        handler: async (_req, res) => {
            const body = await buildAgentProvidersResponse(ctx);
            sendJson(res, body);
        },
    });

    routes.push({
        method: 'GET',
        pattern: '/api/agent-providers/quota',
        handler: async (_req, res) => {
            const config = ctx.runtimeConfigService.config;
            const codexEnabled = config.codex?.enabled ?? false;
            const claudeEnabled = config.claude?.enabled ?? false;

            const providers: AgentProvidersQuotaResponse['providers'] = [];

            // Copilot quota
            try {
                const sdkService = ctx.getCopilotSdkService?.();
                if (!sdkService) {
                    providers.push({ id: 'copilot', quotaTypes: [], error: 'Copilot SDK service not available' });
                } else {
                    const result = await sdkService.getAccountQuota();
                    const quotaTypes = quotaResultToProviderQuotaTypes(result);
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
                        const quotaTypes = quotaResultToProviderQuotaTypes(result);
                        providers.push({ id: 'codex', quotaTypes });
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    providers.push({ id: 'codex', quotaTypes: [], error: msg });
                }
            }

            // Claude quota uses cached `rate_limit_event` and `accountInfo()`
            // signals — see `ClaudeSDKService.getAccountQuota()` for the full
            // priority order. We always emit a `claude` entry when Claude is
            // enabled so the UI consistently shows the provider; only a real
            // SDK error pushes an entry with an `error` field.
            if (claudeEnabled) {
                try {
                    const claudeService = ctx.getClaudeSdkService?.();
                    if (claudeService) {
                        const result = await claudeService.getAccountQuota();
                        const quotaTypes = quotaResultToProviderQuotaTypes(result);
                        providers.push({ id: 'claude', quotaTypes });
                        if (quotaTypes.length === 0) {
                            getLogger().debug(LogCategory.AI, '[ClaudeQuota] No quota snapshots to report — emitting claude entry with empty quotaTypes');
                        }
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    getLogger().warn(LogCategory.AI, `[ClaudeQuota] quota lookup failed: ${msg}`);
                    providers.push({ id: 'claude', quotaTypes: [], error: msg });
                }
            }

            const body: AgentProvidersQuotaResponse = { providers };
            sendJson(res, body);
        },
    });
}
