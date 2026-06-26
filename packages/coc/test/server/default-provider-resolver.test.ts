/**
 * Tests for DefaultProviderResolver
 *
 * Verifies provider resolution logic:
 * - Concrete default provider selection
 * - Auto provider disabled scenarios
 * - Auto provider enabled with quota cache
 * - Forced Auto routing
 * - Unavailable quota cache fallback
 * - Effort-tier lookup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DefaultProviderResolver } from '../../src/server/providers/default-provider-resolver';
import type { DefaultProviderResolverOptions } from '../../src/server/providers/default-provider-resolver';
import type { ResolvedCLIConfig } from '../../src/config';
import type { RuntimeConfigService } from '../../src/config/runtime-config-service';
import type { AgentProvidersQuotaCache } from '../../src/server/agent-providers/quota-cache';

describe('DefaultProviderResolver', () => {
    describe('concrete default provider', () => {
        it('should return claude when explicitly configured', () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    defaultProvider: 'claude',
                } as ResolvedCLIConfig,
            });

            expect(resolver.getConcreteDefaultProvider()).toBe('claude');
        });

        it('should return codex when explicitly configured', () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    defaultProvider: 'codex',
                } as ResolvedCLIConfig,
            });

            expect(resolver.getConcreteDefaultProvider()).toBe('codex');
        });

        it('should return copilot as default when not configured', () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {} as ResolvedCLIConfig,
            });

            expect(resolver.getConcreteDefaultProvider()).toBe('copilot');
        });

        it('should prefer runtimeConfigService over resolvedConfig', () => {
            const resolver = new DefaultProviderResolver({
                runtimeConfigService: {
                    config: {
                        defaultProvider: 'claude',
                    },
                } as RuntimeConfigService,
                resolvedConfig: {
                    defaultProvider: 'codex',
                } as ResolvedCLIConfig,
            });

            expect(resolver.getConcreteDefaultProvider()).toBe('claude');
        });
    });

    describe('Auto provider routing enabled/disabled', () => {
        it('should report Auto routing as inactive when disabled in config', () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    features: { autoAgentProviderRouting: false },
                } as ResolvedCLIConfig,
            });

            expect(resolver.isAutoProviderRoutingActive()).toBe(false);
        });

        it('should report Auto routing as active when enabled in config', () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    features: { autoAgentProviderRouting: true },
                } as ResolvedCLIConfig,
            });

            expect(resolver.isAutoProviderRoutingActive()).toBe(true);
        });

        it('should prefer runtimeConfigService over resolvedConfig', () => {
            const resolver = new DefaultProviderResolver({
                runtimeConfigService: {
                    config: {
                        features: { autoAgentProviderRouting: true },
                    },
                } as RuntimeConfigService,
                resolvedConfig: {
                    features: { autoAgentProviderRouting: false },
                } as ResolvedCLIConfig,
            });

            expect(resolver.isAutoProviderRoutingActive()).toBe(true);
        });
    });

    describe('resolveDefaultProvider - no config', () => {
        it('should return concrete default when no config provided', async () => {
            const resolver = new DefaultProviderResolver({});
            const result = await resolver.resolveDefaultProvider();

            expect(result.provider).toBe('copilot');
            expect(result.selectedByAuto).toBe(false);
            expect(result.error).toBeUndefined();
        });
    });

    describe('resolveDefaultProvider - Auto disabled', () => {
        it('should return concrete default when Auto routing is disabled', async () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    defaultProvider: 'claude',
                    features: { autoAgentProviderRouting: false },
                } as ResolvedCLIConfig,
            });

            const result = await resolver.resolveDefaultProvider();

            expect(result.provider).toBe('claude');
            expect(result.selectedByAuto).toBe(false);
            expect(result.error).toBeUndefined();
        });

        it('should return concrete default even with forceAuto=false when Auto is disabled', async () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    defaultProvider: 'codex',
                    features: { autoAgentProviderRouting: false },
                } as ResolvedCLIConfig,
            });

            const result = await resolver.resolveDefaultProvider({ forceAuto: false });

            expect(result.provider).toBe('codex');
            expect(result.selectedByAuto).toBe(false);
        });
    });

    describe('resolveDefaultProvider - forced Auto routing', () => {
        it('should error when forceAuto=true but config disables Auto routing', async () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    features: { autoAgentProviderRouting: false },
                } as ResolvedCLIConfig,
            });

            const result = await resolver.resolveDefaultProvider({ forceAuto: true });

            expect(result.provider).toBeUndefined();
            expect(result.selectedByAuto).toBe(true);
            expect(result.error).toBe('Auto provider routing requires features.autoAgentProviderRouting: true');
        });
    });

    describe('resolveDefaultProvider - Auto enabled but no quota cache', () => {
        it('should error when Auto is enabled but quota cache is unavailable', async () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    features: { autoAgentProviderRouting: true },
                    agentProviderRouting: { auto: {} },
                } as unknown as ResolvedCLIConfig,
                quotaCache: undefined,
            });

            const result = await resolver.resolveDefaultProvider();

            expect(result.provider).toBeUndefined();
            expect(result.selectedByAuto).toBe(true);
            expect(result.error).toBe('Auto provider routing requires the provider quota cache.');
        });
    });

    describe('resolveDefaultProvider - Auto enabled with quota cache', () => {
        it('should delegate to Auto provider router when quota cache is available', async () => {
            const mockQuotaCache = {
                get: vi.fn().mockResolvedValue({
                    providers: [
                        {
                            id: 'copilot',
                            remaining: 100,
                            limit: 1000,
                        },
                    ],
                }),
                isStale: vi.fn().mockReturnValue(false),
            };

            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    features: { autoAgentProviderRouting: true },
                    agentProviderRouting: { auto: { rules: [] } },
                    defaultProvider: 'copilot',
                } as unknown as ResolvedCLIConfig,
                quotaCache: mockQuotaCache as unknown as AgentProvidersQuotaCache,
            });

            const result = await resolver.resolveDefaultProvider();

            // Should call quota cache to get data
            expect(mockQuotaCache.get).toHaveBeenCalledWith({ refreshIfStale: true });
            // Auto router will return some result (exact provider depends on quota data)
            expect(result.selectedByAuto).toBe(true);
        });
    });

    describe('resolveConcreteDefaultProvider', () => {
        it('should return provider when resolution succeeds', async () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    defaultProvider: 'claude',
                    features: { autoAgentProviderRouting: false },
                } as ResolvedCLIConfig,
            });

            const provider = await resolver.resolveConcreteDefaultProvider();

            expect(provider).toBe('claude');
        });

        it('should throw when resolution returns no provider', async () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    features: { autoAgentProviderRouting: true },
                } as unknown as ResolvedCLIConfig,
                quotaCache: undefined,
            });

            await expect(resolver.resolveConcreteDefaultProvider()).rejects.toThrow(
                'Auto provider routing requires the provider quota cache.'
            );
        });
    });

    describe('effort tier lookup', () => {
        it('should return undefined when no effort tiers configured', () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    models: {
                        providers: {
                            claude: {},
                        },
                    },
                } as unknown as ResolvedCLIConfig,
            });

            const tiers = resolver.getEffortTiersForProvider('claude');

            expect(tiers).toBeUndefined();
        });

        it('should return effort tiers from resolvedConfig', () => {
            const mockTiers = {
                low: { /* tier config */ },
                high: { /* tier config */ },
            };

            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    models: {
                        providers: {
                            claude: {
                                effortTiers: mockTiers as any,
                            },
                        },
                    },
                } as unknown as ResolvedCLIConfig,
            });

            const tiers = resolver.getEffortTiersForProvider('claude');

            expect(tiers).toEqual(mockTiers);
        });

        it('should prefer runtimeConfigService effort tiers over resolvedConfig', () => {
            const runtimeTiers = { runtime: true } as any;
            const resolvedTiers = { resolved: true } as any;

            const resolver = new DefaultProviderResolver({
                runtimeConfigService: {
                    config: {
                        models: {
                            providers: {
                                claude: {
                                    effortTiers: runtimeTiers,
                                },
                            },
                        },
                    },
                } as unknown as RuntimeConfigService,
                resolvedConfig: {
                    models: {
                        providers: {
                            claude: {
                                effortTiers: resolvedTiers,
                            },
                        },
                    },
                } as unknown as ResolvedCLIConfig,
            });

            const tiers = resolver.getEffortTiersForProvider('claude');

            expect(tiers).toEqual(runtimeTiers);
        });

        it('should return undefined for provider with no configured tiers', () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    models: {
                        providers: {
                            claude: {
                                effortTiers: { some: 'tiers' } as any,
                            },
                        },
                    },
                } as unknown as ResolvedCLIConfig,
            });

            const tiers = resolver.getEffortTiersForProvider('codex');

            expect(tiers).toBeUndefined();
        });
    });

    describe('getAutoProviderAvailability', () => {
        it('should report providers as disabled when config disables them', async () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {
                    codex: { enabled: false },
                    claude: { enabled: false },
                } as unknown as ResolvedCLIConfig,
            });

            const availability = await resolver.getAutoProviderAvailability();

            expect(availability.copilot.enabled).toBe(true);
            expect(availability.copilot.available).toBe(true);
            expect(availability.codex.enabled).toBe(false);
            expect(availability.codex.available).toBe(false);
            expect(availability.claude.enabled).toBe(false);
            expect(availability.claude.available).toBe(false);
        });

        it('should report copilot as always enabled and available', async () => {
            const resolver = new DefaultProviderResolver({
                resolvedConfig: {} as ResolvedCLIConfig,
            });

            const availability = await resolver.getAutoProviderAvailability();

            expect(availability.copilot.enabled).toBe(true);
            expect(availability.copilot.available).toBe(true);
        });
    });
});
