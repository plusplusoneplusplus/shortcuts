import type { ModelInfo } from './model-info';
import type { ReasoningEffort } from './types';

const KNOWN_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const satisfies readonly ReasoningEffort[];
const FALLBACK_REASONING_EFFORT_ORDER = ['high', 'medium'] as const satisfies readonly ReasoningEffort[];

export interface ResolveReasoningEffortOptions {
    modelId?: string;
    requestedEffort?: ReasoningEffort;
    model?: ModelInfo;
}

export interface ResolvedReasoningSelection {
    modelId?: string;
    reasoningEffort?: ReasoningEffort;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
    return typeof value === 'string' && (KNOWN_REASONING_EFFORTS as readonly string[]).includes(value);
}

function normalizeReasoningEffortList(values: readonly unknown[] | undefined): ReasoningEffort[] | undefined {
    if (!values) {
        return undefined;
    }

    const normalized: ReasoningEffort[] = [];
    for (const value of values) {
        if (isReasoningEffort(value) && !normalized.includes(value)) {
            normalized.push(value);
        }
    }
    return normalized;
}

function getSupportedReasoningEfforts(model: ModelInfo | undefined): ReasoningEffort[] | undefined {
    if (!model) {
        return undefined;
    }

    const rawCapabilityEfforts = normalizeReasoningEffortList(model.capabilities?.supports?.reasoning_effort);
    if (rawCapabilityEfforts) {
        return rawCapabilityEfforts;
    }

    const contractEfforts = normalizeReasoningEffortList(model.supportedReasoningEfforts);
    if (contractEfforts) {
        return contractEfforts;
    }

    if (model.capabilities?.supports?.reasoningEffort === false) {
        return [];
    }

    return undefined;
}

function formatSupportedEfforts(supportedEfforts: ReasoningEffort[] | undefined): string {
    if (supportedEfforts === undefined) {
        return 'unknown';
    }
    return supportedEfforts.length > 0 ? supportedEfforts.join(', ') : 'none';
}

/**
 * Resolves the reasoning effort to pass to the Copilot SDK for a model.
 *
 * Raw CAPI capability metadata wins over SDK contract fields when present,
 * because it is the most direct source for the values CAPI accepts.
 */
export function resolveReasoningEffort(options: ResolveReasoningEffortOptions): ReasoningEffort | undefined {
    const { modelId, requestedEffort, model } = options;
    const supportedEfforts = getSupportedReasoningEfforts(model);

    if (requestedEffort !== undefined) {
        if (!isReasoningEffort(requestedEffort)) {
            throw new Error(`Unsupported reasoning effort "${requestedEffort}" requested for model "${modelId ?? 'unknown'}". Known efforts: ${KNOWN_REASONING_EFFORTS.join(', ')}`);
        }

        if (supportedEfforts?.includes(requestedEffort)) {
            return requestedEffort;
        }

        throw new Error(`Unsupported reasoning effort "${requestedEffort}" requested for model "${modelId ?? model?.id ?? 'unknown'}". Supported efforts: ${formatSupportedEfforts(supportedEfforts)}`);
    }

    if (!supportedEfforts || supportedEfforts.length === 0) {
        return undefined;
    }

    const defaultEffort = model?.defaultReasoningEffort;
    if (isReasoningEffort(defaultEffort) && supportedEfforts.includes(defaultEffort)) {
        return defaultEffort;
    }

    if (supportedEfforts.length === 1) {
        return supportedEfforts[0];
    }

    for (const effort of FALLBACK_REASONING_EFFORT_ORDER) {
        if (supportedEfforts.includes(effort)) {
            return effort;
        }
    }

    return supportedEfforts[0];
}

export function resolveReasoningSelection(options: ResolveReasoningEffortOptions): ResolvedReasoningSelection {
    const reasoningEffort = resolveReasoningEffort(options);
    const rawCapabilityEfforts = normalizeReasoningEffortList(options.model?.capabilities?.supports?.reasoning_effort);
    const family = options.model?.capabilities?.family;
    const modelId = reasoningEffort
        && rawCapabilityEfforts?.includes(reasoningEffort)
        && typeof family === 'string'
        && family.length > 0
        && family !== options.modelId
        ? family
        : options.modelId;

    return {
        modelId,
        reasoningEffort,
    };
}
