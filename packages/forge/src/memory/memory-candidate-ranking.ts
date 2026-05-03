/**
 * Deterministic memory candidate ranking.
 *
 * Scores pending memory candidates from stored metadata only, keeping promotion
 * decisions repeatable and inspectable without asking an AI model to rank them.
 */

import type { MemoryCandidate } from './memory-candidate-types';

export interface MemoryCandidateScoreComponents {
    frequency: number;
    relevance: number;
    diversity: number;
    recency: number;
    consolidation: number;
    conceptual: number;
}

export interface MemoryCandidateRankingWeights extends MemoryCandidateScoreComponents {}

export interface MemoryCandidateSelectionPolicy {
    minScore: number;
    minSignalCount: number;
    minDiversity: number;
    recencyHalfLifeDays: number;
    minExplicitRelevance: number;
}

export interface MemoryCandidateRankingOptions {
    weights?: Partial<MemoryCandidateRankingWeights>;
    policy?: Partial<MemoryCandidateSelectionPolicy>;
    now?: Date | string | number;
}

export interface RankedMemoryCandidate {
    id: string;
    content: string;
    score: number;
    components: MemoryCandidateScoreComponents;
    selected: boolean;
    explicitMemoryIntent: boolean;
    candidate: MemoryCandidate;
}

export const DEFAULT_MEMORY_CANDIDATE_RANKING_WEIGHTS: MemoryCandidateRankingWeights = Object.freeze({
    frequency: 0.24,
    relevance: 0.30,
    diversity: 0.15,
    recency: 0.15,
    consolidation: 0.10,
    conceptual: 0.06,
});

export const DEFAULT_MEMORY_CANDIDATE_SELECTION_POLICY: MemoryCandidateSelectionPolicy = Object.freeze({
    minScore: 0.75,
    minSignalCount: 2,
    minDiversity: 1,
    recencyHalfLifeDays: 14,
    minExplicitRelevance: 0.5,
});

const MAX_FREQUENCY_SIGNALS = 10;
const MAX_DIVERSITY_SIGNALS = 3;
const MAX_CONSOLIDATION_SIGNALS = 3;
const MAX_CONCEPT_TAGS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function rankMemoryCandidates(
    candidates: MemoryCandidate[],
    options: MemoryCandidateRankingOptions = {},
): RankedMemoryCandidate[] {
    const weights = normalizeWeights(options.weights);
    const policy = normalizePolicy(options.policy);
    const nowMs = resolveNowMs(candidates, options.now);

    return candidates
        .map(candidate => rankMemoryCandidate(candidate, weights, policy, nowMs))
        .sort(compareRankedCandidates);
}

function rankMemoryCandidate(
    candidate: MemoryCandidate,
    weights: MemoryCandidateRankingWeights,
    policy: MemoryCandidateSelectionPolicy,
    nowMs: number,
): RankedMemoryCandidate {
    const diversitySignalCount = getDiversitySignalCount(candidate);
    const relevance = clamp01(candidate.totalScore / Math.max(candidate.signalCount, 1));

    const components: MemoryCandidateScoreComponents = {
        frequency: roundScore(clamp01(Math.log1p(candidate.signalCount) / Math.log1p(MAX_FREQUENCY_SIGNALS))),
        relevance: roundScore(relevance),
        diversity: roundScore(clamp01(diversitySignalCount / MAX_DIVERSITY_SIGNALS)),
        recency: roundScore(getRecency(candidate, nowMs, policy.recencyHalfLifeDays)),
        consolidation: roundScore(clamp01(getConsolidationSignalCount(candidate) / MAX_CONSOLIDATION_SIGNALS)),
        conceptual: roundScore(clamp01(candidate.conceptTags.length / MAX_CONCEPT_TAGS)),
    };

    const score = roundScore(
        components.frequency * weights.frequency
        + components.relevance * weights.relevance
        + components.diversity * weights.diversity
        + components.recency * weights.recency
        + components.consolidation * weights.consolidation
        + components.conceptual * weights.conceptual,
    );

    const standardSelected = score >= policy.minScore
        && candidate.signalCount >= policy.minSignalCount
        && diversitySignalCount >= policy.minDiversity;
    const explicitSelected = candidate.explicitMemoryIntent
        && relevance >= policy.minExplicitRelevance
        && diversitySignalCount >= Math.min(policy.minDiversity, 1);

    return {
        id: candidate.id,
        content: candidate.content,
        score,
        components,
        selected: standardSelected || explicitSelected,
        explicitMemoryIntent: candidate.explicitMemoryIntent,
        candidate,
    };
}

function normalizeWeights(overrides: Partial<MemoryCandidateRankingWeights> | undefined): MemoryCandidateRankingWeights {
    const merged = { ...DEFAULT_MEMORY_CANDIDATE_RANKING_WEIGHTS, ...overrides };
    let total = 0;

    for (const [name, value] of Object.entries(merged)) {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`Memory candidate ranking weight '${name}' must be a non-negative finite number.`);
        }
        total += value;
    }

    if (total <= 0) {
        throw new Error('At least one memory candidate ranking weight must be greater than zero.');
    }

    return {
        frequency: merged.frequency / total,
        relevance: merged.relevance / total,
        diversity: merged.diversity / total,
        recency: merged.recency / total,
        consolidation: merged.consolidation / total,
        conceptual: merged.conceptual / total,
    };
}

function normalizePolicy(overrides: Partial<MemoryCandidateSelectionPolicy> | undefined): MemoryCandidateSelectionPolicy {
    const policy = { ...DEFAULT_MEMORY_CANDIDATE_SELECTION_POLICY, ...overrides };
    if (!Number.isFinite(policy.minScore) || policy.minScore < 0 || policy.minScore > 1) {
        throw new Error('Memory candidate minScore must be a finite number between 0 and 1.');
    }
    if (!Number.isInteger(policy.minSignalCount) || policy.minSignalCount < 1) {
        throw new Error('Memory candidate minSignalCount must be a positive integer.');
    }
    if (!Number.isInteger(policy.minDiversity) || policy.minDiversity < 1) {
        throw new Error('Memory candidate minDiversity must be a positive integer.');
    }
    if (!Number.isFinite(policy.recencyHalfLifeDays) || policy.recencyHalfLifeDays <= 0) {
        throw new Error('Memory candidate recencyHalfLifeDays must be greater than zero.');
    }
    if (!Number.isFinite(policy.minExplicitRelevance) || policy.minExplicitRelevance < 0 || policy.minExplicitRelevance > 1) {
        throw new Error('Memory candidate minExplicitRelevance must be a finite number between 0 and 1.');
    }
    return policy;
}

function resolveNowMs(candidates: MemoryCandidate[], now: Date | string | number | undefined): number {
    if (now !== undefined) {
        const parsed = parseDateMs(now);
        if (parsed === null) {
            throw new Error('Memory candidate ranking option now must be a valid date.');
        }
        return parsed;
    }

    let latest = 0;
    for (const candidate of candidates) {
        const parsed = parseDateMs(candidate.lastSeenAt);
        if (parsed !== null && parsed > latest) {
            latest = parsed;
        }
    }
    return latest;
}

function getRecency(candidate: MemoryCandidate, nowMs: number, halfLifeDays: number): number {
    const lastSeenMs = parseDateMs(candidate.lastSeenAt);
    if (lastSeenMs === null) return 0;
    const ageDays = Math.max(0, (nowMs - lastSeenMs) / MS_PER_DAY);
    return clamp01(Math.pow(0.5, ageDays / halfLifeDays));
}

function getDiversitySignalCount(candidate: MemoryCandidate): number {
    return Math.max(
        candidate.uniqueProcessCount,
        candidate.recallDays.length,
        candidate.turnIndex === null ? 0 : 1,
        candidate.signalCount > 0 ? 1 : 0,
    );
}

function getConsolidationSignalCount(candidate: MemoryCandidate): number {
    return Math.max(candidate.signalCount - 1, candidate.recallDays.length - 1, 0);
}

function compareRankedCandidates(a: RankedMemoryCandidate, b: RankedMemoryCandidate): number {
    return b.score - a.score
        || Number(b.selected) - Number(a.selected)
        || Number(b.explicitMemoryIntent) - Number(a.explicitMemoryIntent)
        || b.candidate.signalCount - a.candidate.signalCount
        || b.candidate.lastSeenAt.localeCompare(a.candidate.lastSeenAt)
        || a.content.localeCompare(b.content)
        || a.id.localeCompare(b.id);
}

function parseDateMs(value: Date | string | number): number | null {
    const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}
