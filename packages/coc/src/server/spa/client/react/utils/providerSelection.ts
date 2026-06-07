import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';
import type { EffortTierKey, LocalEffortTiersMap } from '../hooks/useProviderEffortTiers';
import { getConfiguredDefaultProvider, getDefaultProvider, isAutoAgentProviderRoutingEnabled } from './config';

export type ConcreteChatProvider = 'copilot' | 'codex' | 'claude';
export type ChatProvider = ConcreteChatProvider | 'auto';

export interface AgentSelectorProvider {
    id: ChatProvider;
    label: string;
    enabled: boolean;
    available: boolean;
    locked?: boolean;
    reason?: string;
}

export interface ResolvedComposerAiSelection {
    provider?: ConcreteChatProvider;
    model?: string;
    reasoningEffort?: string;
    effortTier?: EffortTierKey;
    autoProviderRouting?: true;
}

export const AUTO_PROVIDER_OPTION: AgentSelectorProvider = {
    id: 'auto',
    label: 'Auto',
    enabled: true,
    available: true,
};

export const AUTO_EFFORT_TIER_MAP: LocalEffortTiersMap = {
    'very-low': { model: 'Auto', reasoningEffort: '', source: 'default' },
    low: { model: 'Auto', reasoningEffort: '', source: 'default' },
    medium: { model: 'Auto', reasoningEffort: '', source: 'default' },
    high: { model: 'Auto', reasoningEffort: '', source: 'default' },
};

export function isConcreteChatProvider(value: unknown): value is ConcreteChatProvider {
    return value === 'copilot' || value === 'codex' || value === 'claude';
}

export function isChatProvider(value: unknown): value is ChatProvider {
    return isConcreteChatProvider(value) || value === 'auto';
}

export function getAgentSelectorProviders(providers: readonly AgentProviderStatus[]): AgentSelectorProvider[] {
    const concreteProviders = providers.map(provider => ({ ...provider }));
    return isAutoAgentProviderRoutingEnabled()
        ? [AUTO_PROVIDER_OPTION, ...concreteProviders]
        : concreteProviders;
}

export function isSelectableProvider(
    provider: ChatProvider,
    providers: readonly Pick<AgentSelectorProvider, 'id' | 'enabled' | 'available'>[],
): boolean {
    if (provider === 'auto') {
        return isAutoAgentProviderRoutingEnabled();
    }
    if (provider === 'copilot') {
        return true;
    }
    const status = providers.find(p => p.id === provider);
    return status?.enabled === true && status?.available === true;
}

export function getConcreteProviderForClientHooks(provider: ChatProvider): ConcreteChatProvider {
    return provider === 'auto' ? getDefaultProvider() : provider;
}

export function getConfiguredComposerDefaultProvider(): ChatProvider {
    return isAutoAgentProviderRoutingEnabled() ? 'auto' : getConfiguredDefaultProvider();
}

export function getSelectableComposerDefaultProvider(
    providers: readonly Pick<AgentSelectorProvider, 'id' | 'enabled' | 'available'>[],
): ChatProvider {
    const configuredDefault = getConfiguredComposerDefaultProvider();
    return isSelectableProvider(configuredDefault, providers) ? configuredDefault : 'copilot';
}

export function shouldSendProviderOverride(provider: ChatProvider): provider is ConcreteChatProvider {
    return provider !== 'auto';
}

export function mergeAutoProviderRoutingContext(
    selection: Pick<ResolvedComposerAiSelection, 'autoProviderRouting'>,
    context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
    if (!selection.autoProviderRouting) {
        return context;
    }
    return {
        ...(context ?? {}),
        autoProviderRouting: { requested: true },
    };
}
