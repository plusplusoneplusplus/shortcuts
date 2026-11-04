import { resolveChatProvider, type ChatContext } from './task-types';

export type AutoProviderRoutingContext = Record<string, unknown> & Pick<ChatContext, 'autoProviderRouting'>;

/** Read wire or persisted context at ingress; internal consumers use the typed marker. */
export function parseAutoProviderRoutingContext(value: unknown): AutoProviderRoutingContext | undefined {
    if (!isRecord(value)) return undefined;
    const { autoProviderRouting, ...context } = value;
    if (!isRecord(autoProviderRouting)) return context;
    const { requested, selectedByAuto, provider, fallbackUsed, warnings, decisions, ...extra } = autoProviderRouting;
    const concreteProvider = resolveChatProvider(provider);
    return {
        ...context,
        autoProviderRouting: {
            ...extra,
            ...(typeof requested === 'boolean' ? { requested } : {}),
            ...(typeof selectedByAuto === 'boolean' ? { selectedByAuto } : {}),
            ...(concreteProvider ? { provider: concreteProvider } : {}),
            ...(typeof fallbackUsed === 'boolean' ? { fallbackUsed } : {}),
            ...(Array.isArray(warnings) && warnings.every((warning): warning is string => typeof warning === 'string') ? { warnings } : {}),
            ...(Array.isArray(decisions) ? { decisions } : {}),
        },
    };
}

export function isAutoProviderRoutingRequested(context: Pick<ChatContext, 'autoProviderRouting'> | undefined): boolean {
    return context?.autoProviderRouting?.requested === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
