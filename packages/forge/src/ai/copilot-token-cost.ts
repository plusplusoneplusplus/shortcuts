import { COPILOT_MODEL_PRICING, COPILOT_PRICING_SOURCE } from './copilot-pricing-data';
import type { CopilotModelPricing } from './copilot-pricing-data';

export interface CopilotTokenCostBreakdown {
    inputUsd: number;
    cachedInputUsd: number;
    cacheWriteUsd: number;
    outputUsd: number;
    totalUsd: number;
    pricingSource: string;
}

const PRICED_MODEL_IDS = new Set(COPILOT_MODEL_PRICING.map(pricing => pricing.modelId));
const PRICING_BY_MODEL_ID = new Map(COPILOT_MODEL_PRICING.map(pricing => [pricing.modelId, pricing]));

const NON_PRICING_SUFFIX_PATTERNS = [
    /-(?:low|medium|high|xhigh)$/,
    /-latest$/,
    /-20\d{2}-\d{2}-\d{2}$/,
    /-20\d{6}$/,
];

function normalizeModelIdSyntax(modelId: string): string {
    return modelId
        .trim()
        .toLowerCase()
        .replace(/\[[^\]]*\]/g, '')
        .replace(/[^a-z0-9.]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function addCandidate(candidates: string[], candidate: string): void {
    const trimmed = candidate.replace(/^-+|-+$/g, '');
    if (trimmed && !candidates.includes(trimmed)) {
        candidates.push(trimmed);
    }
}

function addDottedVersionCandidates(candidates: string[], candidate: string): void {
    const claudeCliVersion = candidate.match(/^claude-(sonnet|opus|haiku)-(\d+)-(\d+)(.*)$/);
    if (claudeCliVersion) {
        const [, family, major, minor, suffix] = claudeCliVersion;
        addCandidate(candidates, `claude-${family}-${major}.${minor}${suffix}`);
    }

    const gptHyphenVersion = candidate.match(/^gpt-(\d+)-(\d+)(.*)$/);
    if (gptHyphenVersion) {
        const [, major, minor, suffix] = gptHyphenVersion;
        addCandidate(candidates, `gpt-${major}.${minor}${suffix}`);
    }
}

function withoutOneNonPricingSuffix(modelId: string): string | undefined {
    for (const pattern of NON_PRICING_SUFFIX_PATTERNS) {
        if (pattern.test(modelId)) {
            return modelId.replace(pattern, '');
        }
    }
    return undefined;
}

function buildPricingLookupCandidates(modelId: string): string[] {
    const normalized = normalizeModelIdSyntax(modelId);
    const candidates: string[] = [];
    let current: string | undefined = normalized;

    while (current) {
        addCandidate(candidates, current);
        addDottedVersionCandidates(candidates, current);

        const stripped = withoutOneNonPricingSuffix(current);
        if (!stripped || stripped === current) {
            break;
        }
        current = stripped;
    }

    return candidates;
}

export function normalizeCopilotModelId(modelId: string): string {
    const candidates = buildPricingLookupCandidates(modelId);
    return candidates.find(candidate => PRICED_MODEL_IDS.has(candidate)) ?? candidates[0] ?? '';
}

export function getCopilotModelPricing(modelId: string): CopilotModelPricing | undefined {
    const normalizedModelId = normalizeCopilotModelId(modelId);
    return PRICING_BY_MODEL_ID.get(normalizedModelId);
}

export function estimateCopilotTokenCost(
    modelId: string,
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
    }
): CopilotTokenCostBreakdown | undefined {
    const pricing = getCopilotModelPricing(modelId);
    if (!pricing) {
        return undefined;
    }

    const nonCachedInputTokens = Math.max(
        0,
        usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens
    );
    const cacheWriteRate = pricing.usdPerMillionCacheWriteTokens ?? pricing.usdPerMillionInputTokens;
    const inputUsd = nonCachedInputTokens / 1_000_000 * pricing.usdPerMillionInputTokens;
    const cachedInputUsd = usage.cacheReadTokens / 1_000_000 * pricing.usdPerMillionCachedInputTokens;
    const cacheWriteUsd = usage.cacheWriteTokens / 1_000_000 * cacheWriteRate;
    const outputUsd = usage.outputTokens / 1_000_000 * pricing.usdPerMillionOutputTokens;

    return {
        inputUsd,
        cachedInputUsd,
        cacheWriteUsd,
        outputUsd,
        totalUsd: inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd,
        pricingSource: COPILOT_PRICING_SOURCE,
    };
}
