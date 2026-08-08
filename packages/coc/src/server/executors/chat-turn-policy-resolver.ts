/**
 * Chat Turn Policy Resolver
 *
 * Single source of truth for the per-turn *model policy*: which model runs the
 * turn, which reasoning effort it runs at, and whether a Copilot long-context
 * tier is requested.
 *
 * Both the first-turn path (`ChatBaseExecutor.execute`) and the continuation
 * path (`FollowUpExecutor.executeFollowUp`) resolve this the same way:
 *
 *   model   = explicit task/turn model
 *           > per-repo default model for the turn's default-model mode
 *           > provider default (undefined)
 *
 *   effort  = explicit per-turn effort
 *           > provider-scoped persisted default (models.providers[p].reasoningEfforts)
 *           > global persisted default — Copilot legacy only (models.reasoningEfforts)
 *           > SDK default (model catalog default, then FALLBACK_REASONING_EFFORT_ORDER)
 *
 *   tier    = Copilot-only, and only when the resolved model's catalog metadata
 *             advertises a long-context tier.
 *
 * The two paths differ only in their warning text and in how they react to a
 * model that does not support the requested effort. Both are injected, so this
 * module changes no observable behavior on either path.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ModelInfo } from '@plusplusoneplusplus/forge';
import { resolveModelForProvider, resolveReasoningSelection } from '@plusplusoneplusplus/forge';
import { getCopilotContextTierForModel } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ChatProvider } from '../tasks/task-types';
import { loadConfigFile } from '../../config';
import { resolveDefaultModel } from '../preferences-handler';

// ============================================================================
// Types
// ============================================================================

/** Effort shape accepted by `resolveReasoningSelection`. */
export type RequestedReasoningEffort = Parameters<typeof resolveReasoningSelection>[0]['requestedEffort'];

/** Which per-repo default-model slot this turn reads. */
export type DefaultModelMode = Parameters<typeof resolveDefaultModel>[2];

/** Reported when `resolveModelForProvider` drops an unsupported model. */
export interface CoercedModelReport {
    /** The model the caller asked for, before coercion. */
    requestedModel: string | undefined;
    /** Whether the coerced model came from the per-repo default rather than the task. */
    source: 'requested' | 'default';
}

export interface ChatTurnModelInput {
    provider: ChatProvider;
    /** Explicit model for this turn (task config / follow-up override / process metadata). */
    requestedModel: string | undefined;
    dataDir?: string;
    workspaceId?: string;
    /** Per-repo default-model slot to fall back to when no explicit model is set. */
    defaultModelMode: DefaultModelMode;
    /** Invoked (once per coercion) so each path keeps its own warning wording. */
    onCoerced?: (report: CoercedModelReport) => void;
}

export interface ChatTurnPolicyInput extends ChatTurnModelInput {
    /** Explicit per-turn effort override; wins over any persisted preference. */
    requestedEffort: RequestedReasoningEffort;
    /** Resolves catalog metadata for the resolved model (provider-aware). */
    getModelMetadata: (modelId: string | undefined) => Promise<ModelInfo | undefined>;
    /**
     * Invoked when `resolveReasoningSelection` throws. Return a selection to
     * recover (the follow-up path drops an unsupported per-turn effort), or
     * re-throw to fail the turn (the first-turn path).
     */
    onReasoningSelectionError?: (
        err: unknown,
        ctx: { modelId: string | undefined; requestedEffort: RequestedReasoningEffort; modelMetadata: ModelInfo | undefined },
    ) => ReturnType<typeof resolveReasoningSelection>;
}

export interface ChatTurnPolicy {
    /**
     * Model chosen by {@link resolveChatTurnModel}, before reasoning selection
     * had a chance to rewrite it. This is the identity callers should hand to
     * sub-agents (e.g. Ralph grill planning) so they run the same model the
     * user picked.
     */
    resolvedModel: string | undefined;
    /** Model actually sent to the SDK. `undefined` means "provider default". */
    modelId: string | undefined;
    /** Reasoning effort sent to the SDK, when one applies. */
    reasoningEffort: ReturnType<typeof resolveReasoningSelection>['reasoningEffort'];
    /** Copilot long-context tier, when the model advertises one. */
    contextTier: ReturnType<typeof getCopilotContextTierForModel>;
    /** Catalog metadata for the resolved model — reused by callers for logging. */
    modelMetadata: ModelInfo | undefined;
}

// ============================================================================
// Model resolution
// ============================================================================

/**
 * Resolve the effective model for a turn: the explicit model when the provider
 * supports it, otherwise the per-repo default for `defaultModelMode`, otherwise
 * the provider default (`undefined`).
 *
 * Each dropped model is reported through `onCoerced` so callers keep their
 * existing log wording.
 */
export function resolveChatTurnModel(input: ChatTurnModelInput): string | undefined {
    const providerModel = resolveModelForProvider(input.provider, input.requestedModel);
    if (providerModel.coerced) {
        input.onCoerced?.({ requestedModel: providerModel.requestedModel, source: 'requested' });
    }
    if (providerModel.model) {
        return providerModel.model;
    }
    if (!input.dataDir || !input.workspaceId) {
        return providerModel.model;
    }

    const defaultModel = resolveDefaultModel(input.dataDir, input.workspaceId, input.defaultModelMode);
    const resolvedDefault = resolveModelForProvider(input.provider, defaultModel);
    if (resolvedDefault.coerced) {
        input.onCoerced?.({ requestedModel: resolvedDefault.requestedModel, source: 'default' });
    }
    return resolvedDefault.model;
}

// ============================================================================
// Reasoning effort resolution
// ============================================================================

/**
 * Look up the persisted reasoning-effort preference for a model.
 *
 * Provider-scoped settings (`models.providers[provider].reasoningEfforts`) win.
 * The legacy top-level `models.reasoningEfforts` map is Copilot-only and is
 * consulted only when the provider has no settings block at all.
 */
export function resolvePersistedReasoningEffort(
    provider: ChatProvider,
    modelId: string | undefined,
): string | undefined {
    if (!modelId) return undefined;
    const cfg = loadConfigFile();
    const providerSettings = cfg?.models?.providers?.[provider];
    const effortMap: Record<string, string> = providerSettings
        ? (providerSettings.reasoningEfforts ?? {})
        : (provider === 'copilot' ? (cfg?.models?.reasoningEfforts ?? {}) : {});
    return effortMap[modelId];
}

// ============================================================================
// Combined policy
// ============================================================================

/**
 * Resolve the full per-turn model policy (model + reasoning effort + Copilot
 * context tier) shared by first turns and follow-ups.
 */
export async function resolveChatTurnPolicy(input: ChatTurnPolicyInput): Promise<ChatTurnPolicy> {
    const modelId = resolveChatTurnModel(input);

    let requestedEffort: RequestedReasoningEffort = input.requestedEffort;
    if (!requestedEffort) {
        const persisted = resolvePersistedReasoningEffort(input.provider, modelId);
        if (persisted) requestedEffort = persisted as NonNullable<RequestedReasoningEffort>;
    }

    const modelMetadata = await input.getModelMetadata(modelId);

    let selection: ReturnType<typeof resolveReasoningSelection>;
    try {
        selection = resolveReasoningSelection({ modelId, requestedEffort, model: modelMetadata });
    } catch (err) {
        if (!input.onReasoningSelectionError) throw err;
        selection = input.onReasoningSelectionError(err, { modelId, requestedEffort, modelMetadata });
    }

    // Copilot long-context tier: requested only when the selected Copilot
    // model's catalog metadata advertises one. Never sent for other providers.
    const contextTier = input.provider === 'copilot'
        ? getCopilotContextTierForModel(modelMetadata)
        : undefined;

    return {
        resolvedModel: modelId,
        modelId: selection.modelId,
        reasoningEffort: selection.reasoningEffort,
        contextTier,
        modelMetadata,
    };
}
