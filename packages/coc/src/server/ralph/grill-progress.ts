import type {
    RalphGrillPlanningProgress,
    RalphGrillProcessState,
    RalphGrillQuestionPlanningResult,
    RalphGrillSetup,
} from './grill-planning-types';
import { RALPH_GRILL_MAX_ROUNDS } from './grill-planning-types';
import { resolveRalphGrillSetup } from './grill-setup';

export function buildRalphGrillPlanningStartedProgress(
    input?: RalphGrillSetup | null,
    previousState?: RalphGrillProcessState,
): RalphGrillPlanningProgress {
    const setup = resolveRalphGrillSetup(input);
    const previousRoundsRun = Math.min(previousState?.roundsRun ?? 0, RALPH_GRILL_MAX_ROUNDS);
    const round = Math.min(previousRoundsRun + 1, RALPH_GRILL_MAX_ROUNDS);
    return {
        status: 'running',
        depth: setup.depth,
        round,
        maxRounds: RALPH_GRILL_MAX_ROUNDS,
        agentCount: setup.agents.length,
        agents: setup.agents.map(agent => ({
            role: agent.role,
            roleLabel: agent.label,
            provenanceLabel: agent.provenanceLabel,
            status: 'running',
            candidateCount: 0,
        })),
        message: `Round ${round} of up to ${RALPH_GRILL_MAX_ROUNDS}: running ${setup.agents.length} Ralph grill agent${setup.agents.length === 1 ? '' : 's'} to plan consolidated questions.`,
        warnings: [],
    };
}

export function buildRalphGrillPlanningCompletedProgress(plan: RalphGrillQuestionPlanningResult): RalphGrillPlanningProgress {
    const warnings = [...new Set(plan.warnings)];
    return {
        status: 'completed',
        depth: plan.depth,
        round: plan.round,
        maxRounds: plan.maxRounds,
        agentCount: plan.agentResults.length,
        agents: plan.agentResults.map(result => ({
            role: result.agent.role,
            roleLabel: result.agent.label,
            provenanceLabel: result.agent.provenanceLabel,
            status: result.status,
            candidateCount: result.questions.length,
        })),
        message: `Round ${plan.round} of up to ${plan.maxRounds}: prepared ${plan.consolidation.selectedQuestionCount} consolidated question${plan.consolidation.selectedQuestionCount === 1 ? '' : 's'} from ${plan.consolidation.rawCandidateCount} candidate${plan.consolidation.rawCandidateCount === 1 ? '' : 's'}.`,
        warnings,
    };
}
