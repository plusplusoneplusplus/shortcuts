import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';
import type { EffortLevel, EffortPillOption } from '../features/chat/EffortPillSelector';
import type { EffortTierKey, LocalEffortTiersMap } from '../hooks/useProviderEffortTiers';

export type ChatComposerCycleDirection = -1 | 1;

export interface ChatComposerCycleResult<T> {
    changed: boolean;
    value: T;
}

export interface ComposerShortcutEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
}

type ChatProvider = AgentProviderStatus['id'];

const EFFORT_TIER_ORDER: readonly EffortTierKey[] = ['very-low', 'low', 'medium', 'high'];
const REASONING_EFFORT_ORDER: readonly (EffortLevel | null)[] = [null, 'low', 'medium', 'high', 'xhigh'];

function cycleOrderedValue<T>(
    order: readonly T[],
    current: T,
    direction: ChatComposerCycleDirection,
    isSelectable: (value: T) => boolean,
): ChatComposerCycleResult<T> {
    const startIndex = order.findIndex(value => value === current);
    const normalizedStart = startIndex >= 0
        ? startIndex
        : direction === 1 ? -1 : order.length;

    for (let i = normalizedStart + direction; i >= 0 && i < order.length; i += direction) {
        const candidate = order[i];
        if (isSelectable(candidate)) {
            return { changed: true, value: candidate };
        }
    }

    return { changed: false, value: current };
}

export function getComposerArrowCycleDirection(key: string): ChatComposerCycleDirection | null {
    if (key === 'ArrowUp') {
        return -1;
    }
    if (key === 'ArrowDown') {
        return 1;
    }
    return null;
}

export function isEffortCycleShortcut(event: ComposerShortcutEvent): boolean {
    return getComposerArrowCycleDirection(event.key) !== null
        && event.shiftKey === true
        && event.ctrlKey !== true
        && event.metaKey !== true
        && event.altKey !== true;
}

export function isMacPlatform(platform: string | undefined = typeof navigator === 'undefined' ? undefined : navigator.platform): boolean {
    return /Mac|iPhone|iPad|iPod/i.test(platform ?? '');
}

export function isProviderCycleShortcut(event: ComposerShortcutEvent, platform?: string): boolean {
    if (getComposerArrowCycleDirection(event.key) === null) {
        return false;
    }
    if (event.shiftKey || event.altKey) {
        return false;
    }

    return isMacPlatform(platform)
        ? event.metaKey === true && event.ctrlKey !== true
        : event.ctrlKey === true && event.metaKey !== true;
}

export function cycleConfiguredEffortTier(
    current: EffortTierKey,
    tiers: LocalEffortTiersMap,
    direction: ChatComposerCycleDirection,
): ChatComposerCycleResult<EffortTierKey> {
    return cycleOrderedValue(
        EFFORT_TIER_ORDER,
        current,
        direction,
        tier => Boolean(tiers[tier]?.model),
    );
}

export function cycleReasoningEffort(
    current: EffortLevel | null,
    options: readonly Pick<EffortPillOption, 'value'>[] | undefined,
    direction: ChatComposerCycleDirection,
): ChatComposerCycleResult<EffortLevel | null> {
    const optionValues = new Set((options ?? []).map(option => option.value));
    const hasExplicitOptions = options !== undefined;

    return cycleOrderedValue(
        REASONING_EFFORT_ORDER,
        current,
        direction,
        value => value === null || (!hasExplicitOptions || optionValues.has(value)),
    );
}

export function cycleChatProvider(
    current: ChatProvider,
    providers: readonly AgentProviderStatus[],
    direction: ChatComposerCycleDirection,
): ChatComposerCycleResult<ChatProvider> {
    const order = providers.map(provider => provider.id);
    return cycleOrderedValue(
        order,
        current,
        direction,
        providerId => {
            const provider = providers.find(p => p.id === providerId);
            return provider?.enabled === true && provider.available === true;
        },
    );
}
