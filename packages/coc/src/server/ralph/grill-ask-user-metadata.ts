import type { AskUserRalphGrillPlanningSummary, AskUserSSEPayload } from '../llm-tools/ask-user-tool';
import type {
    RalphGrillConsolidatedQuestion,
    RalphGrillQuestionPlanningResult,
} from './grill-planning-types';
import {
    SEMANTIC_DUPLICATE_THRESHOLD,
    normalizeQuestionForExactMatch,
    questionTokenSet,
    tokenSimilarity,
} from './grill-question-consolidator';

function buildAskUserPlanningSummary(plan: RalphGrillQuestionPlanningResult): AskUserRalphGrillPlanningSummary {
    return {
        depth: plan.depth,
        round: plan.round,
        maxRounds: plan.maxRounds,
        agentOutcomes: plan.agentResults.map(result => ({
            role: result.agent.role,
            roleLabel: result.agent.label,
            provenanceLabel: result.agent.provenanceLabel,
            status: result.status,
            candidateCount: result.questions.length,
        })),
        consolidation: {
            rawCandidateCount: plan.consolidation.rawCandidateCount,
            selectedQuestionCount: plan.consolidation.selectedQuestionCount,
            exactDuplicatesMerged: plan.consolidation.exactDuplicatesMerged,
            semanticDuplicatesMerged: plan.consolidation.semanticDuplicatesMerged,
            conflictsConverted: plan.consolidation.conflictsConverted,
            duplicateOnlyAgents: [...plan.consolidation.duplicateOnlyAgents],
        },
        warnings: [...new Set(plan.warnings)],
    };
}

function findMatchingSelectedQuestionIndex(
    payload: AskUserSSEPayload,
    payloadIndex: number,
    selectedQuestions: RalphGrillConsolidatedQuestion[],
    usedIndexes: Set<number>,
): number | undefined {
    const exactKey = normalizeQuestionForExactMatch(payload.question);
    const exactIndex = selectedQuestions.findIndex((question, index) =>
        !usedIndexes.has(index) && normalizeQuestionForExactMatch(question.question) === exactKey);
    if (exactIndex >= 0) return exactIndex;

    const payloadTokens = questionTokenSet(payload.question);
    let bestIndex = -1;
    let bestScore = 0;
    selectedQuestions.forEach((question, index) => {
        if (usedIndexes.has(index)) return;
        const score = tokenSimilarity(payloadTokens, questionTokenSet(question.question));
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });
    if (bestIndex >= 0 && bestScore >= SEMANTIC_DUPLICATE_THRESHOLD) {
        return bestIndex;
    }

    if (payloadIndex < selectedQuestions.length && !usedIndexes.has(payloadIndex)) {
        return payloadIndex;
    }
    return undefined;
}

export function attachRalphGrillMetadataToAskUserPayloads(
    payloads: AskUserSSEPayload[],
    plan: RalphGrillQuestionPlanningResult | undefined,
): AskUserSSEPayload[] {
    if (!plan?.enabled || payloads.length === 0) {
        return payloads;
    }

    const planning = buildAskUserPlanningSummary(plan);
    const usedSelectedQuestionIndexes = new Set<number>();
    return payloads.map((payload, index) => {
        const selectedIndex = findMatchingSelectedQuestionIndex(
            payload,
            index,
            plan.selectedQuestions,
            usedSelectedQuestionIndexes,
        );
        const selectedQuestion = selectedIndex === undefined
            ? undefined
            : plan.selectedQuestions[selectedIndex];
        if (selectedIndex !== undefined) {
            usedSelectedQuestionIndexes.add(selectedIndex);
        }

        const sources = selectedQuestion?.sources.map(source => ({
            role: source.role,
            roleLabel: source.roleLabel,
            ...(source.provider ? { provider: source.provider } : {}),
            ...(source.model ? { model: source.model } : {}),
            provenanceLabel: source.provenanceLabel,
        }));
        const consolidation = selectedQuestion
            ? {
                kind: selectedQuestion.consolidation.kind,
                mergedCandidateCount: selectedQuestion.consolidation.mergedCandidateCount,
            }
            : undefined;
        return {
            ...payload,
            ralphGrill: {
                ...(sources && sources.length > 0 ? { sources } : {}),
                ...(consolidation ? { consolidation } : {}),
                ...(index === 0 ? { planning } : {}),
            },
        };
    });
}
