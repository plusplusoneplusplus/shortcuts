/**
 * DefaultProviderResolver - Encapsulates provider/default-model policy.
 *
 * Resolves the concrete default AI provider and handles Auto provider routing
 * (with quota cache integration, availability checking, effort tier lookup).
 *
 * This service extracts provider policy from the route composition root so it
 * can be tested independently and reused consistently across features.
 */

import { sdkServiceRegistry, SDK_PROVIDER_CLAUDE, SDK_PROVIDER_CODEX, type StoredEffortTiersMap, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import { resolveAutoAgentProvider, type AutoProviderAvailabilityMap, type AutoProviderResolutionResult } from '../agent-providers/auto-provider-router';
import { loadConfigFile } from '../../config';
import type { AgentProvidersQuotaCache } from '../agent-providers/quota-cache';
import type { ChatProvider } from '../tasks/task-types';
import type { ResolvedCLIConfig } from '../../config';
import type { RuntimeConfigService } from '../../config/runtime-config-service';

export interface DefaultProviderResolverOptions {
    runtimeConfigService?: RuntimeConfigService;
    resolvedConfig?: ResolvedCLIConfig;
    configPath?: string;
    quotaCache?: AgentProvidersQuotaCache;
}

export class DefaultProviderResolver {
    private readonly runtimeConfigService?: RuntimeConfigService;
    private readonly resolvedConfig?: ResolvedCLIConfig;
    private readonly configPath?: string;
    private readonly quotaCache?: AgentProvidersQuotaCache;

    constructor(options: DefaultProviderResolverOptions) {
        this.runtimeConfigService = options.runtimeConfigService;
        this.resolvedConfig = options.resolvedConfig;
        this.configPath = options.configPath;
        this.quotaCache = options.quotaCache;
    }

    /** Get the configured concrete default provider (concrete, no Auto routing). */
    getConcreteDefaultProvider(): ChatProvider {
        const defaultProvider = this.runtimeConfigService?.config.defaultProvider
            ?? this.resolvedConfig?.defaultProvider;
        if (defaultProvider === 'codex') return 'codex';
        if (defaultProvider === 'claude') return 'claude';
        return 'copilot';
    }

    /** Check if Auto provider routing is currently enabled. */
    isAutoProviderRoutingActive(): boolean {
        const config = this.runtimeConfigService?.config ?? this.resolvedConfig;
        return config?.features.autoAgentProviderRouting === true;
    }

    /**
     * Get the current availability status of all providers (SDK service and config state).
     * Used to determine which providers Auto routing can select.
     */
    async getAutoProviderAvailability(): Promise<AutoProviderAvailabilityMap> {
        const config = this.runtimeConfigService?.config ?? this.resolvedConfig;
        const codexEnabled = config?.codex?.enabled ?? false;
        const claudeEnabled = config?.claude?.enabled ?? false;
        const availability: AutoProviderAvailabilityMap = {
            copilot: { enabled: true, available: true },
        };

        if (!codexEnabled) {
            availability.codex = { enabled: false, available: false, reason: 'Codex provider is disabled.' };
        } else {
            const svc = sdkServiceRegistry.get(SDK_PROVIDER_CODEX);
            availability.codex = svc
                ? { enabled: true, ...(await svc.isAvailable()) }
                : { enabled: true, available: false, reason: 'Codex SDK service is not registered.' };
        }

        if (!claudeEnabled) {
            availability.claude = { enabled: false, available: false, reason: 'Claude provider is disabled.' };
        } else {
            const svc = sdkServiceRegistry.get(SDK_PROVIDER_CLAUDE);
            availability.claude = svc
                ? { enabled: true, ...(await svc.isAvailable()) }
                : { enabled: true, available: false, reason: 'Claude SDK service is not registered.' };
        }

        return availability;
    }

    /**
     * Resolve the default provider, respecting Auto provider routing if enabled.
     *
     * - If forceAuto=true, uses Auto routing even if disabled by config
     * - If Auto routing is disabled, returns the concrete default provider
     * - If Auto routing is enabled, queries the quota cache and resolves the best fit
     *
     * Returns a result object containing the selected provider (or undefined on error)
     * plus resolution metadata (decisions, warnings, and failure reason if any).
     */
    async resolveDefaultProvider(options?: { forceAuto?: boolean }): Promise<AutoProviderResolutionResult> {
        const config = this.runtimeConfigService?.config ?? this.resolvedConfig;
        const forceAuto = options?.forceAuto === true;

        if (!config) {
            return this.makeConcreteResult();
        }

        const autoRoutingEnabled = config.features.autoAgentProviderRouting === true;
        if (!forceAuto && !autoRoutingEnabled) {
            return this.makeConcreteResult(config.defaultProvider);
        }

        if (config.features.autoAgentProviderRouting !== true) {
            return {
                selectedByAuto: true,
                fallbackUsed: false,
                decisions: [],
                warnings: [],
                error: 'Auto provider routing requires features.autoAgentProviderRouting: true',
            };
        }

        if (!this.quotaCache) {
            return {
                selectedByAuto: true,
                fallbackUsed: false,
                decisions: [],
                warnings: [],
                error: 'Auto provider routing requires the provider quota cache.',
            };
        }

        const quotaData = await this.quotaCache.get({ refreshIfStale: true });
        return resolveAutoAgentProvider(config.agentProviderRouting.auto, {
            providerAvailability: await this.getAutoProviderAvailability(),
            quotaData,
            quotaStale: this.quotaCache.isStale(),
        });
    }

    /**
     * Resolve the default provider and throw if the result has no concrete provider.
     * Use this when you must have a provider or fail fast.
     */
    async resolveConcreteDefaultProvider(): Promise<ChatProvider> {
        const resolution = await this.resolveDefaultProvider();
        if (!resolution.provider) {
            throw new Error(resolution.error ?? 'Default provider resolution did not select a concrete provider.');
        }
        return resolution.provider;
    }

    /**
     * Get effort tiers configured for a specific provider.
     * Searches runtime config first, then static config file.
     */
    getEffortTiersForProvider(provider: ChatProvider): StoredEffortTiersMap | undefined {
        const configPath = this.runtimeConfigService?.configPath ?? this.configPath;
        const fileConfig = configPath ? loadConfigFile(configPath) : undefined;
        return (
            fileConfig?.models?.providers?.[provider]?.effortTiers
            ?? this.runtimeConfigService?.config.models?.providers?.[provider]?.effortTiers
            ?? this.resolvedConfig?.models?.providers?.[provider]?.effortTiers
        );
    }

    private makeConcreteResult(provider: ChatProvider = this.getConcreteDefaultProvider()): AutoProviderResolutionResult {
        return {
            provider,
            selectedByAuto: false,
            fallbackUsed: false,
            decisions: [],
            warnings: [],
        };
    }
}
