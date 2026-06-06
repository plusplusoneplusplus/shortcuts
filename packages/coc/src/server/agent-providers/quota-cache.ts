/**
 * Agent-provider quota cache.
 *
 * Keeps the expensive provider quota lookups behind GET /api/agent-providers/quota
 * single-flighted and periodically refreshed.
 */

import type { AgentProvidersQuotaResponse, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { IAccountQuotaResult } from '@plusplusoneplusplus/forge';
import type { RuntimeConfigService } from '../../config/runtime-config-service';

export const AGENT_PROVIDERS_QUOTA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface AccountQuotaService {
    getAccountQuota(): Promise<IAccountQuotaResult>;
}

export interface AgentProvidersQuotaContext {
    runtimeConfigService: RuntimeConfigService;
    /** Optional getter for Copilot account quota. Copilot is always queried. */
    getCopilotSdkService?: () => AccountQuotaService | undefined;
    /** Optional getter for Codex account quota. Queried only when Codex is enabled. */
    getCodexSdkService?: () => AccountQuotaService | undefined;
    /** Optional getter for Claude account quota. Queried only when Claude is enabled. */
    getClaudeSdkService?: () => AccountQuotaService | undefined;
}

export interface AgentProvidersQuotaCacheOptions {
    refreshIntervalMs?: number;
    now?: () => Date;
}

export interface AgentProvidersQuotaGetOptions {
    force?: boolean;
    refreshIfStale?: boolean;
}

export function quotaResultToProviderQuotaTypes(result: IAccountQuotaResult): ProviderQuotaType[] {
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

export async function fetchAgentProvidersQuota(ctx: AgentProvidersQuotaContext): Promise<AgentProvidersQuotaResponse> {
    const config = ctx.runtimeConfigService.config;
    const codexEnabled = config.codex?.enabled ?? false;
    const claudeEnabled = config.claude?.enabled ?? false;

    const providers: AgentProvidersQuotaResponse['providers'] = [];

    try {
        const sdkService = ctx.getCopilotSdkService?.();
        if (!sdkService) {
            providers.push({ id: 'copilot', quotaTypes: [], error: 'Copilot SDK service not available' });
        } else {
            const result = await sdkService.getAccountQuota();
            providers.push({ id: 'copilot', quotaTypes: quotaResultToProviderQuotaTypes(result) });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        providers.push({ id: 'copilot', quotaTypes: [], error: msg });
    }

    if (codexEnabled) {
        try {
            const codexService = ctx.getCodexSdkService?.();
            if (!codexService) {
                providers.push({ id: 'codex', quotaTypes: [] });
            } else {
                const result = await codexService.getAccountQuota();
                providers.push({ id: 'codex', quotaTypes: quotaResultToProviderQuotaTypes(result) });
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            providers.push({ id: 'codex', quotaTypes: [], error: msg });
        }
    }

    if (claudeEnabled) {
        try {
            const claudeService = ctx.getClaudeSdkService?.();
            if (!claudeService) {
                providers.push({ id: 'claude', quotaTypes: [] });
            } else {
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

    return { providers, lastUpdated: null };
}

export class AgentProvidersQuotaCache {
    private cachedResponse: AgentProvidersQuotaResponse | null = null;
    private refreshPromise: Promise<AgentProvidersQuotaResponse> | null = null;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private readonly refreshIntervalMs: number;
    private readonly now: () => Date;

    constructor(
        private readonly ctx: AgentProvidersQuotaContext,
        options: AgentProvidersQuotaCacheOptions = {},
    ) {
        this.refreshIntervalMs = options.refreshIntervalMs ?? AGENT_PROVIDERS_QUOTA_REFRESH_INTERVAL_MS;
        this.now = options.now ?? (() => new Date());
    }

    start(): void {
        if (this.refreshTimer) {
            return;
        }
        this.refreshTimer = setInterval(() => {
            void this.refresh().catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                getLogger().warn(LogCategory.AI, `[AgentProvidersQuotaCache] background refresh failed: ${message}`);
            });
        }, this.refreshIntervalMs);
        const timer = this.refreshTimer;
        if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
            timer.unref();
        }
    }

    dispose(): void {
        if (!this.refreshTimer) {
            return;
        }
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
    }

    async get(options: AgentProvidersQuotaGetOptions = {}): Promise<AgentProvidersQuotaResponse> {
        if (!options.force && this.cachedResponse && !(options.refreshIfStale && this.isStale())) {
            return this.cachedResponse;
        }
        return this.refresh();
    }

    getCached(): AgentProvidersQuotaResponse | null {
        return this.cachedResponse;
    }

    isStale(): boolean {
        if (!this.cachedResponse?.lastUpdated) {
            return true;
        }
        const lastUpdatedMs = Date.parse(this.cachedResponse.lastUpdated);
        if (!Number.isFinite(lastUpdatedMs)) {
            return true;
        }
        return this.now().getTime() - lastUpdatedMs >= this.refreshIntervalMs;
    }

    refresh(): Promise<AgentProvidersQuotaResponse> {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        const refreshPromise = (async () => {
            const live = await fetchAgentProvidersQuota(this.ctx);
            const response: AgentProvidersQuotaResponse = {
                ...live,
                lastUpdated: this.now().toISOString(),
            };
            this.cachedResponse = response;
            return response;
        })().finally(() => {
            if (this.refreshPromise === refreshPromise) {
                this.refreshPromise = null;
            }
        });
        this.refreshPromise = refreshPromise;
        return refreshPromise;
    }
}
