/**
 * Shared request parsers for the Work Item execution surfaces.
 *
 * Execute, AI review and (indirectly) comment resolution all accept the same
 * AI setting fields on their request bodies. Parsing lives here so the accepted
 * values and the 400 messages cannot drift between surfaces, and so the queue
 * payload and the persisted execution history are always derived from one
 * parsed model.
 *
 * Parsers throw {@link APIError} (`badRequest`) on invalid values; REST routes
 * translate them via `handleAPIError`.
 */

import { badRequest } from '../errors';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import { parseChatProviderField, parseReasoningEffortField } from '../shared/ai-selection';
import type { WorkItemExecutionAiSettings } from './types';

export { parseChatProviderField, parseReasoningEffortField } from '../shared/ai-selection';

/** Effort tiers accepted on Work Item execution surfaces. */
export const VALID_EFFORT_TIERS: ReadonlySet<string> = new Set(['very-low', 'low', 'medium', 'high']);

/** Work Item execution strategies accepted on the execute route. */
export type WorkItemRequestedExecutionMode = 'one-shot' | 'ralph';

/**
 * AI settings shared by execute and AI review.
 *
 * `model` is an explicit passthrough: it is never validated here because the
 * accepted model set is provider-specific and resolved downstream.
 */
export interface WorkItemAiSettings {
    model?: string;
    provider?: ChatProvider;
    reasoningEffort?: ReasoningEffort;
    effortTier?: string;
    autoProviderRouting: boolean;
}

function bodyField(body: unknown, key: string): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    return (body as Record<string, unknown>)[key];
}

/** Parse `effortTier`; unknown tiers are rejected. */
export function parseEffortTierField(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string' && VALID_EFFORT_TIERS.has(value)) {
        return value;
    }
    throw badRequest(`Invalid effortTier: '${value}'`);
}

/** Explicit opt-in only: any value other than `true` means "not requested". */
export function parseAutoProviderRoutingField(value: unknown): boolean {
    return value === true;
}

/** Parse `executionMode`; anything other than the two known modes is rejected. */
export function parseExecutionModeField(value: unknown): WorkItemRequestedExecutionMode | undefined {
    if (value === undefined) return undefined;
    if (value === 'one-shot' || value === 'ralph') return value;
    throw badRequest(`Invalid executionMode: '${value}'`);
}

/** Parse `skillNames`, dropping non-string and blank entries. Never throws. */
export function parseSkillNamesField(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const names = value.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    return names.length ? names : undefined;
}

/** Parse the AI setting block shared by execute and AI review. */
export function parseWorkItemAiSettings(body: unknown): WorkItemAiSettings {
    const model = bodyField(body, 'model') as string | undefined;
    return {
        ...(model !== undefined ? { model } : {}),
        provider: parseChatProviderField(bodyField(body, 'provider')),
        reasoningEffort: parseReasoningEffortField(bodyField(body, 'reasoningEffort')),
        effortTier: parseEffortTierField(bodyField(body, 'effortTier')),
        autoProviderRouting: parseAutoProviderRoutingField(bodyField(body, 'autoProviderRouting')),
    };
}

/**
 * Queue `config` block derived from parsed AI settings. Falsy models are
 * dropped so an empty string never overrides the queue default.
 */
export function aiSettingsTaskConfig(settings: WorkItemAiSettings): Record<string, unknown> {
    return {
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
        ...(settings.effortTier ? { effortTier: settings.effortTier } : {}),
    };
}

/**
 * `aiSettings` metadata persisted on an execution history entry, or `undefined`
 * when nothing was selected. Derived from the same parsed model as
 * {@link aiSettingsTaskConfig} so history and queue payload cannot disagree.
 */
export function aiSettingsExecutionMetadata(settings: WorkItemAiSettings): WorkItemExecutionAiSettings | undefined {
    const metadata = {
        ...(settings.provider ? { provider: settings.provider } : {}),
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
        ...(settings.effortTier ? { effortTier: settings.effortTier } : {}),
        ...(settings.autoProviderRouting ? { autoProviderRouting: true } : {}),
    };
    return Object.keys(metadata).length > 0 ? metadata : undefined;
}
