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
    const baseModelId = deriveBaseModelId({
        modelId: options.modelId,
        family,
        reasoningEffort,
        rawCapabilityEfforts,
    });

    if (baseModelId) {
        return { modelId: baseModelId, reasoningEffort };
    }

    // Fallback: when raw CAPI capability efforts are absent (stale or missing
    // metadata), the resolved effort may come from outdated contract fields and
    // be incompatible with the model. If the model ID itself encodes a known
    // effort suffix (e.g. "claude-opus-4.7-xhigh"), trust that suffix as the
    // authoritative signal and strip it to derive the base model ID.
    if (!rawCapabilityEfforts && options.modelId) {
        const suffixInferred = inferFromModelIdSuffix(options.modelId);
        if (suffixInferred) {
            // When the suffix-derived effort differs from the resolved one,
            // override — the model ID is the most direct signal from CAPI about
            // which effort this variant was provisioned for.
            return {
                modelId: suffixInferred.baseModelId,
                reasoningEffort: suffixInferred.effort,
            };
        }
    }

    return { modelId: options.modelId, reasoningEffort };
}

interface DeriveBaseModelOptions {
    modelId: string | undefined;
    family: string | undefined;
    reasoningEffort: ReasoningEffort | undefined;
    rawCapabilityEfforts: ReasoningEffort[] | undefined;
}

/**
 * Map a raw-effort variant model ID (e.g. "claude-opus-4.7-xhigh") to the
 * base family ID the SDK actually accepts for requests.
 *
 * Two signals, in priority order:
 *
 *   1. capabilities.family — when distinct from modelId, trust it.
 *   2. Suffix derivation — when family is missing or equals modelId,
 *      and the model advertises exactly one raw reasoning effort that
 *      matches the resolved effort, and modelId ends with "-<effort>",
 *      strip that suffix. Driven entirely by live metadata, not a
 *      hardcoded variant list.
 *
 * Returns undefined when no rewrite applies.
 */
/**
 * Infer reasoning effort and base model ID from a model ID suffix.
 *
 * For example, "claude-opus-4.7-xhigh" → { baseModelId: "claude-opus-4.7", effort: "xhigh" }.
 * Returns undefined when the model ID does not end with a known effort suffix.
 */
function inferFromModelIdSuffix(modelId: string): { baseModelId: string; effort: ReasoningEffort } | undefined {
    for (const effort of KNOWN_REASONING_EFFORTS) {
        const suffix = `-${effort}`;
        if (modelId.endsWith(suffix)) {
            const base = modelId.slice(0, -suffix.length);
            if (base.length > 0) {
                return { baseModelId: base, effort };
            }
        }
    }
    return undefined;
}

function deriveBaseModelId(options: DeriveBaseModelOptions): string | undefined {
    const { modelId, family, reasoningEffort, rawCapabilityEfforts } = options;

    if (!reasoningEffort || !modelId) {
        return undefined;
    }
    if (!rawCapabilityEfforts?.includes(reasoningEffort)) {
        return undefined;
    }

    if (typeof family === 'string' && family.length > 0 && family !== modelId) {
        return family;
    }

    if (rawCapabilityEfforts.length !== 1) {
        return undefined;
    }
    const suffix = `-${reasoningEffort}`;
    if (!modelId.endsWith(suffix)) {
        return undefined;
    }
    const base = modelId.slice(0, -suffix.length);
    return base.length > 0 ? base : undefined;
}
