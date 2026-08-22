import type {
    RalphGrillAgentRole,
    RalphGrillProcessState,
    RalphGrillQuestionPlanningResult,
    RalphGrillRoleSessionState,
} from './grill-planning-types';

export function buildRalphGrillProcessStateFromPlan(
    plan: RalphGrillQuestionPlanningResult,
    previous?: RalphGrillProcessState,
): RalphGrillProcessState {
    const agents: Partial<Record<RalphGrillAgentRole, RalphGrillRoleSessionState>> = {
        ...(previous?.agents ?? {}),
    };
    for (const result of plan.agentResults) {
        agents[result.agent.role] = {
            role: result.agent.role,
            roleLabel: result.agent.label,
            provenanceLabel: result.agent.provenanceLabel,
            status: result.status,
            candidateCount: result.questions.length,
            ...(result.status !== 'failed' && result.sessionId ? { sessionId: result.sessionId } : {}),
        };
    }

    const askedQuestions = [
        ...(previous?.askedQuestions ?? []),
        ...plan.selectedQuestions.map(question => question.question),
    ];
    const promptHistory = plan.promptHistory ?? previous?.promptHistory ?? [];

    return {
        roundsRun: plan.roundsRun,
        maxRounds: plan.maxRounds,
        terminal: plan.terminal,
        ...(plan.terminationReason ? { terminationReason: plan.terminationReason } : {}),
        agents,
        askedQuestions: [...new Set(askedQuestions)],
        promptHistory,
        warnings: [...new Set([
            ...(previous?.warnings ?? []),
            ...plan.warnings,
        ])],
    };
}
