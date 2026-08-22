/**
 * Ralph grill planning facade.
 *
 * The engine is split into layered modules; this file owns the round
 * orchestration entry point and re-exports the public API so callers can keep a
 * single import site:
 * - `grill-planning-types` — contracts, constants, and public shapes
 * - `grill-agent-config` — role definitions and depth-to-role selection
 * - `grill-setup` — setup normalization and provenance labels
 * - `grill-progress` — planning progress payloads
 * - `grill-prompts` — system/first-turn/follow-up/resume-fallback prompts
 * - `grill-response-parser` — strict JSON parsing and schema sanitization
 * - `grill-question-consolidator` — pure duplicate/conflict consolidation
 * - `grill-agent-runner` — provider resolution and SDK invocation
 * - `grill-termination` — stop signals and termination copy
 * - `grill-process-state` — durable process-state projection
 * - `grill-plan-prompt` / `grill-ask-user-metadata` — presenters
 */
import type {
    RalphGrillQuestionPlannerOptions,
    RalphGrillQuestionPlanningContext,
    RalphGrillQuestionPlanningResult,
} from './grill-planning-types';
import { RALPH_GRILL_MAX_ROUNDS } from './grill-planning-types';
import { resolveRalphGrillSetup } from './grill-setup';
import { buildRalphGrillPromptHistory } from './grill-prompts';
import {
    consolidateRalphGrillCandidateQuestions,
    emptyRalphGrillConsolidationSummary,
} from './grill-question-consolidator';
import { runSingleRalphGrillAgent } from './grill-agent-runner';
import { isRalphGrillUserStopSignal } from './grill-termination';

export * from './grill-planning-types';
export { getRalphGrillAgentDefinitions, normalizeRalphGrillDepth } from './grill-agent-config';
export {
    formatRalphGrillProvenance,
    normalizeRalphGrillSetupForContext,
    resolveRalphGrillSetup,
} from './grill-setup';
export {
    buildRalphGrillPlanningCompletedProgress,
    buildRalphGrillPlanningStartedProgress,
} from './grill-progress';
export {
    buildRalphGrillAgentPrompt,
    buildRalphMultiAgentGrillDirective,
} from './grill-prompts';
export { parseRalphGrillAgentResponse } from './grill-response-parser';
export { consolidateRalphGrillCandidateQuestions } from './grill-question-consolidator';
export { buildRalphGrillProcessStateFromPlan } from './grill-process-state';
export { formatRalphGrillQuestionPlanForPrompt } from './grill-plan-prompt';
export { attachRalphGrillMetadataToAskUserPayloads } from './grill-ask-user-metadata';

export async function planRalphGrillCandidateQuestions(
    options: RalphGrillQuestionPlannerOptions,
    ctx: RalphGrillQuestionPlanningContext,
): Promise<RalphGrillQuestionPlanningResult> {
    const setup = resolveRalphGrillSetup(ctx.setup);
    const previousRoundsRun = Math.min(ctx.previousState?.roundsRun ?? 0, RALPH_GRILL_MAX_ROUNDS);
    const nextRound = Math.min(previousRoundsRun + 1, RALPH_GRILL_MAX_ROUNDS);
    const promptHistory = buildRalphGrillPromptHistory(ctx);
    if (!setup.enabled) {
        return {
            enabled: false,
            depth: setup.depth,
            round: previousRoundsRun,
            roundsRun: previousRoundsRun,
            maxRounds: RALPH_GRILL_MAX_ROUNDS,
            terminal: false,
            promptHistory,
            agentResults: [],
            candidateQuestions: [],
            selectedQuestions: [],
            consolidation: emptyRalphGrillConsolidationSummary(),
            warnings: [],
        };
    }

    const terminalBeforePlanning = previousRoundsRun >= RALPH_GRILL_MAX_ROUNDS
        ? 'round-cap' as const
        : previousRoundsRun > 0 && isRalphGrillUserStopSignal(ctx.prompt)
            ? 'user-ended' as const
            : undefined;
    if (terminalBeforePlanning) {
        return {
            enabled: true,
            depth: setup.depth,
            round: previousRoundsRun,
            roundsRun: previousRoundsRun,
            maxRounds: RALPH_GRILL_MAX_ROUNDS,
            terminal: true,
            terminationReason: terminalBeforePlanning,
            promptHistory,
            agentResults: [],
            candidateQuestions: [],
            selectedQuestions: [],
            consolidation: emptyRalphGrillConsolidationSummary(),
            warnings: [],
        };
    }

    const agentResults = await Promise.all(
        setup.agents.map(agent => runSingleRalphGrillAgent(options, ctx, agent)),
    );
    const candidateQuestions = agentResults.flatMap(result => result.questions);
    const consolidation = consolidateRalphGrillCandidateQuestions(
        candidateQuestions,
        agentResults,
        ctx.previousState?.askedQuestions,
    );
    const allResumedAgentsEmpty = previousRoundsRun > 0
        && agentResults.length > 0
        && agentResults.every(result => result.status === 'empty');
    const warnings = [
        ...agentResults.flatMap(result => result.warnings),
        ...consolidation.warnings,
    ];
    return {
        enabled: true,
        depth: setup.depth,
        round: nextRound,
        roundsRun: nextRound,
        maxRounds: RALPH_GRILL_MAX_ROUNDS,
        terminal: allResumedAgentsEmpty,
        ...(allResumedAgentsEmpty ? { terminationReason: 'all-agents-empty' as const } : {}),
        promptHistory,
        agentResults,
        candidateQuestions,
        selectedQuestions: consolidation.selectedQuestions,
        consolidation: consolidation.summary,
        warnings,
    };
}
