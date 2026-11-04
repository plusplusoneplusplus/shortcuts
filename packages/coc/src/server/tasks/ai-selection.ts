import {
    resolveChatProvider,
    VALID_CHAT_PROVIDERS,
    VALID_REASONING_EFFORTS,
    type ChatProvider,
    type ReasoningEffort,
} from './task-types';

export class AiSelectionParseError extends Error {
    constructor(message: string, readonly shortMessage = message) {
        super(message);
    }
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
    return typeof value === 'string' && VALID_REASONING_EFFORTS.has(value as ReasoningEffort);
}

export function parseChatProvider(value: unknown): ChatProvider | undefined {
    if (value === undefined) return undefined;
    const provider = resolveChatProvider(value);
    if (provider) return provider;
    const message = `Invalid provider: '${String(value)}'`;
    throw new AiSelectionParseError(
        `${message}. Valid providers: ${[...VALID_CHAT_PROVIDERS].join(', ')}`,
        message,
    );
}

export function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
    if (value === undefined) return undefined;
    if (isReasoningEffort(value)) return value;
    const message = `Invalid reasoningEffort: '${String(value)}'`;
    throw new AiSelectionParseError(
        `${message}. Valid reasoningEffort values: ${[...VALID_REASONING_EFFORTS].join(', ')}`,
        message,
    );
}

export interface AiSelection {
    provider: ChatProvider | undefined;
    model: string | undefined;
    reasoningEffort: ReasoningEffort | undefined;
}

/** Parse explicit selection only; provider defaults belong to the caller. */
export function parseAiSelection(body: { provider?: unknown; config?: unknown }): AiSelection {
    const provider = parseChatProvider(body.provider);
    if (body.config !== undefined
        && (typeof body.config !== 'object' || Array.isArray(body.config) || body.config === null)) {
        throw new AiSelectionParseError('config must be an object');
    }
    const config = (body.config ?? {}) as Record<string, unknown>;
    if (config.model !== undefined && config.model !== null && typeof config.model !== 'string') {
        throw new AiSelectionParseError('config.model must be a string');
    }
    const model = typeof config.model === 'string' ? config.model.trim() || undefined : undefined;
    const reasoningEffort = parseReasoningEffort(config.reasoningEffort);
    return { provider, model, reasoningEffort };
}
