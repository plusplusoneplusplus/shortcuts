/**
 * Catalog matching for Claude provider models.
 *
 * The Claude CLI's initialize response advertises models under short alias
 * ids (`default`, `opus`, `haiku`) with per-model `supportedEffortLevels`,
 * while CoC configs, effort tiers, and stored process metadata may carry CLI
 * family aliases (`sonnet`), dotted marketing ids (`claude-sonnet-4.6`), or
 * dashed CLI ids (`claude-opus-4-7`). This module bridges those id shapes so
 * reasoning-effort validation can resolve a model's supported efforts instead
 * of failing with "Supported efforts: unknown".
 *
 * Matching is deliberately permissive: the Claude SDK silently downgrades a
 * reasoning effort the selected model does not support, so over-matching is
 * harmless while a failed lookup hard-fails the chat turn.
 */

/** Minimal structural shape of a Claude catalog entry used for matching. */
export interface ClaudeCatalogModelLike {
    id: string;
    name?: string;
    /** CLI model description (e.g. "Sonnet 4.6 · Best for everyday tasks"). */
    description?: string;
}

/** Model ids that mean "let the Claude CLI pick its default model". */
const CLAUDE_PROVIDER_DEFAULT_IDS = new Set(['default', 'provider-default', 'claude-provider-default']);

/** Claude model families recognized for fuzzy catalog matching. */
const CLAUDE_MODEL_FAMILIES = ['opus', 'sonnet', 'haiku'] as const;

function findById<T extends ClaudeCatalogModelLike>(models: readonly T[], id: string): T | undefined {
    return models.find(m => m.id.trim().toLowerCase() === id);
}

function findByFamily<T extends ClaudeCatalogModelLike>(models: readonly T[], family: string): T | undefined {
    return models.find(m => {
        const haystack = `${m.id} ${m.name ?? ''} ${m.description ?? ''}`.toLowerCase();
        return haystack.includes(family);
    });
}

/**
 * Resolve the Claude catalog entry for a requested model id.
 *
 * Resolution order:
 *   1. No id / provider-default sentinel → the catalog's `default` entry
 *      (the CLI's own default model).
 *   2. Exact id match (case-insensitive).
 *   3. Exact match after normalizing a dotted marketing id to the dashed CLI
 *      form (`claude-sonnet-4.6` → `claude-sonnet-4-6`).
 *   4. Family match — the first entry whose id, name, or description mentions
 *      the requested model's family (`opus` / `sonnet` / `haiku`).
 *   5. Family recognized but absent from the catalog → the `default` entry as
 *      a proxy (its advertised efforts approximate the CLI default model).
 *
 * Returns `undefined` when the id matches nothing — callers treat that as
 * "supported efforts unknown".
 */
export function findClaudeCatalogModel<T extends ClaudeCatalogModelLike>(
    models: readonly T[],
    modelId: string | undefined,
): T | undefined {
    const normalized = modelId?.trim().toLowerCase() ?? '';
    if (!normalized || CLAUDE_PROVIDER_DEFAULT_IDS.has(normalized)) {
        return findById(models, 'default');
    }

    const exact = findById(models, normalized);
    if (exact) {return exact;}

    const dashed = normalized.replace(/(\d)\.(\d)/g, '$1-$2');
    if (dashed !== normalized) {
        const dashedMatch = findById(models, dashed);
        if (dashedMatch) {return dashedMatch;}
    }

    const family = CLAUDE_MODEL_FAMILIES.find(f => normalized.includes(f));
    if (!family) {return undefined;}

    return findByFamily(models, family) ?? findById(models, 'default');
}
