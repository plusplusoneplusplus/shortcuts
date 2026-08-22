import type { RalphGrillQuestionPlanningResult } from './grill-planning-types';
import { formatRalphGrillTerminationReason } from './grill-termination';

export function formatRalphGrillQuestionPlanForPrompt(plan: RalphGrillQuestionPlanningResult): string {
    if (!plan.enabled) {
        return '';
    }
    const agentLines = plan.agentResults.length > 0
        ? plan.agentResults
            .map(result => `- ${result.agent.provenanceLabel}: ${result.status}, ${result.questions.length} candidate question${result.questions.length === 1 ? '' : 's'}.`)
            .join('\n')
        : '- none (terminal turn; no grill agents were run).';
    const uniqueWarnings = [...new Set(plan.warnings)];
    const warningLines = uniqueWarnings.length > 0
        ? uniqueWarnings.map(warning => `- ${warning}`).join('\n')
        : '- none';
    const duplicateOnlyAgents = plan.consolidation.duplicateOnlyAgents.length > 0
        ? plan.consolidation.duplicateOnlyAgents.join(', ')
        : 'none';
    const coverageAgentLines = plan.agentResults.length > 0
        ? plan.agentResults
            .map(result => `  - ${result.agent.provenanceLabel}: ${result.status}, ${result.questions.length} candidate question${result.questions.length === 1 ? '' : 's'}.`)
            .join('\n')
        : '  - none';
    const warningsSummary = uniqueWarnings.length > 0 ? uniqueWarnings.join(' | ') : 'none';
    const dedupeSummary = `raw ${plan.consolidation.rawCandidateCount} -> selected ${plan.consolidation.selectedQuestionCount}; exact duplicates ${plan.consolidation.exactDuplicatesMerged}; semantic duplicates ${plan.consolidation.semanticDuplicatesMerged}; conflicts converted ${plan.consolidation.conflictsConverted}; duplicate-only agents ${duplicateOnlyAgents}`;
    const questionLines = plan.selectedQuestions.length > 0
        ? plan.selectedQuestions.map((question, index) => {
            const provenance = question.sources.map(source => source.provenanceLabel).join('; ');
            const options = question.options?.length
                ? ` Options: ${question.options.map(option => `${option.value}=${option.label}`).join(', ')}.`
                : '';
            const mergeInfo = question.consolidation.mergedCandidateCount > 1
                ? ` Merged ${question.consolidation.mergedCandidateCount} candidates as ${question.consolidation.kind}.`
                : '';
            return `${index + 1}. [${provenance}] (${question.type}) ${question.question}${options}${mergeInfo}`;
        }).join('\n')
        : plan.terminal
            ? 'No further grill questions should be asked; proceed to final goal synthesis.'
            : 'No usable candidate questions were returned; continue with normal Ralph grilling and include a reduced-coverage warning.';
    const nextStepInstruction = plan.terminal
        ? `Do not call ask_user or ask any additional clarification questions. Ralph grill questioning is complete because ${formatRalphGrillTerminationReason(plan.terminationReason)}. Proceed directly to synthesize or save the final \`## Goal\` spec from the accumulated conversation and answers.`
        : 'Ask only the selected questions above in one consolidated ask_user batch, grouped by lightweight role chips or sections. Do not ask raw duplicate candidates separately. Do not embed the provenance label in the visible question text — CoC renders provenance chips automatically beneath each question from attached metadata. Preserve the listed combined provenance only in the final coverage summary.';

    return `\
Actual grill-agent planning result:
- Selected depth: ${plan.depth}.
- CoC already invoked the separate grill agents below before this turn; do not simulate or rerun these roles inside one persona response.
- Grill round: ${plan.round} of up to ${plan.maxRounds}.
${plan.terminal ? `- Grill termination: ${formatRalphGrillTerminationReason(plan.terminationReason)}.` : '- Grill termination: not reached.'}

Agent outcomes:
${agentLines}

Consolidation outcomes:
- Raw candidate questions: ${plan.consolidation.rawCandidateCount}.
- Selected user-facing questions: ${plan.consolidation.selectedQuestionCount}.
- Exact duplicates merged: ${plan.consolidation.exactDuplicatesMerged}.
- Semantic duplicates merged: ${plan.consolidation.semanticDuplicatesMerged}.
- Conflicts converted to decision questions: ${plan.consolidation.conflictsConverted}.
- Duplicate-only agents: ${duplicateOnlyAgents}.

Warnings:
${warningLines}

Selected questions after consolidation:
${questionLines}

${nextStepInstruction}

Final goal coverage summary requirement:
When the user's answers are complete and you emit or save the final \`## Goal\` spec, include a \`## Agent Coverage Summary\` section using this exact planning data. Do not invent additional agent runs.
- [decision] Depth: ${plan.depth}
- [decision] Rounds run: ${plan.roundsRun} of up to ${plan.maxRounds}
- [decision] Provider/tier or provider/model used per agent:
${coverageAgentLines}
- [decision] Dedupe/conflict outcomes: ${dedupeSummary}
- [decision] Warnings / reduced coverage: ${warningsSummary}

Also keep the final spec autonomy-ready: include functional acceptance criteria with Definition of Done details, constraints, out-of-scope items, references to load, and no duplicate user-facing questions as separate open issues.`;
}
