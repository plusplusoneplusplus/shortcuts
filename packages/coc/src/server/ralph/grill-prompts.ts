import type { SystemMessageConfig } from '@plusplusoneplusplus/coc-agent-sdk';
import type {
    RalphGrillQuestionPlanningContext,
    RalphGrillSetup,
    ResolvedRalphGrillAgent,
} from './grill-planning-types';
import { normalizeRalphGrillDepth } from './grill-agent-config';
import { resolveRalphGrillSetup } from './grill-setup';

export function buildRalphGrillPromptHistory(ctx: RalphGrillQuestionPlanningContext): string[] {
    const history = [...(ctx.previousState?.promptHistory ?? [])];
    const prompt = ctx.prompt.trim();
    if (prompt && history[history.length - 1] !== prompt) {
        history.push(prompt);
    }
    return history;
}

export const GRILL_AGENT_SYSTEM_PROMPT: SystemMessageConfig = {
    mode: 'replace',
    content: `\
You are one specialized Ralph grill agent.

Your job is to propose clarification questions only from your assigned role and focus area. Do not synthesize the final goal. Do not ask the user directly. Do not call tools.

STRICT OUTPUT CONTRACT
======================
Respond with ONLY a valid JSON object. No prose, no markdown, no code fences.

Schema:
{
  "questions": [
    {
      "question": "Concrete clarification question text.",
      "type": "text",
      "options": [
        { "value": "option-id", "label": "Option label", "description": "Optional description" }
      ],
      "defaultValue": "optional default value",
      "rationale": "Why this question matters for the final goal spec."
    }
  ]
}

Rules:
- Produce 2 to 4 high-value questions.
- Keep each question answerable in one consolidated user form later.
- Avoid generic questions and obvious overlap with other roles.
- Use select, multi-select, yes-no, or confirm only when the options are clear; otherwise use text.
- Do not include provenance fields; the host records provenance.`
};

export function buildRalphMultiAgentGrillDirective(input?: RalphGrillSetup | null): string {
    const setup = resolveRalphGrillSetup(input);
    if (!setup.enabled) return '';

    const agentLines = setup.agents
        .map(agent => `- ${agent.provenanceLabel}: ${agent.focus}.`)
        .join('\n');

    return `\
Multi-agent grilling is enabled for this Ralph grilling session.

Question planning:
- Selected depth: ${setup.depth}.
- Use actual separate grill agents for the roles below. Do not simulate all roles inside one persona response.
- Each grill agent must propose distinct, non-overlapping clarification questions from its own focus area.
- Show progress immediately with a compact "Question planning" card while agents run.
- Continue with remaining agents if one agent fails, times out, returns no questions, or contributes only duplicates; surface a compact warning rather than blocking goal creation.

Agent model setup:
${agentLines}

Consolidation:
- Semantically deduplicate candidate questions before showing them to the user.
- Merge exact and semantic duplicates, preserving combined provenance.
- Convert conflicting candidate questions into one decision question with clear options.
- Ask the user through one consolidated ask_user batch grouped by lightweight agent role chips or sections; never create one form or chat thread per agent.
- Do not embed the provenance label in the visible question text; CoC automatically renders a provenance chip ("Role Agent · provider/tier" when a tier applies, otherwise "Role Agent · provider/model" with fallback copy when the concrete model is unavailable) beneath each question from attached metadata.

Final goal synthesis:
- Include the selected depth, provider/tier or provider/model used per agent, coverage summary, dedupe/conflict outcomes, constraints, out-of-scope items, references to load, and Definition of Done details for every acceptance criterion.
- Do not carry duplicate user-facing questions forward as separate open issues.`;
}

export function buildRalphGrillAgentPrompt(ctx: RalphGrillQuestionPlanningContext, agent: ResolvedRalphGrillAgent): string {
    const providerModel = agent.provider || agent.model || agent.effortTier
        ? `\nProvider/tier or provider/model provenance for this run: ${agent.provenanceLabel}`
        : '';
    return `\
Selected Ralph grilling depth: ${normalizeRalphGrillDepth(ctx.setup?.depth)}
Agent role: ${agent.label}
Agent focus: ${agent.focus}.${providerModel}

Original user request or current Ralph grilling context:
${ctx.prompt}

Return role-specific candidate questions as strict JSON.`;
}

export function buildRalphGrillAgentFollowUpPrompt(ctx: RalphGrillQuestionPlanningContext, agent: ResolvedRalphGrillAgent): string {
    const providerModel = agent.provider || agent.model || agent.effortTier
        ? `\nProvider/tier or provider/model provenance for this run: ${agent.provenanceLabel}`
        : '';
    return `\
Ralph grilling follow-up round for your existing ${agent.label} session.
Agent focus: ${agent.focus}.${providerModel}

The user answered the previously consolidated Ralph grilling questions with:
${ctx.prompt}

Use your retained session context to decide whether your role needs answer-dependent follow-up clarification.
Return only new, non-repeated role-specific candidate follow-up questions as strict JSON.
If your role has enough information, return {"questions":[]}.`;
}

export function buildRalphGrillAgentResumeFallbackPrompt(ctx: RalphGrillQuestionPlanningContext, agent: ResolvedRalphGrillAgent): string {
    const providerModel = agent.provider || agent.model || agent.effortTier
        ? `\nProvider/tier or provider/model provenance for this run: ${agent.provenanceLabel}`
        : '';
    const promptHistory = buildRalphGrillPromptHistory(ctx);
    const askedQuestions = ctx.previousState?.askedQuestions ?? [];
    const askedQuestionLines = askedQuestions.length > 0
        ? askedQuestions.map((question, index) => `${index + 1}. ${question}`).join('\n')
        : '- none recorded';
    const promptHistoryLines = promptHistory.length > 0
        ? promptHistory
            .map((prompt, index) => {
                const label = index === 0 ? 'Original request' : `Round ${index} user answers`;
                return `${label}:\n${prompt}`;
            })
            .join('\n\n')
        : 'No prior prompt history was recorded.';

    return `\
Ralph grilling follow-up round for a fresh ${agent.label} fallback session.
Agent focus: ${agent.focus}.${providerModel}

The prior SDK session could not be resumed, so native conversation history may be unavailable. Reconstruct your role-specific state from the full accumulated Ralph grilling Q&A below.

Already asked user-facing questions:
${askedQuestionLines}

Original request and accumulated user answers:
${promptHistoryLines}

Ask only new, non-repeated role-specific follow-up questions that are still needed after this accumulated Q&A.
Return strict JSON. If your role has enough information, return {"questions":[]}.`;
}

export function formatRalphGrillResumeFallbackWarning(agent: ResolvedRalphGrillAgent): string {
    return `${agent.label} resume history was unavailable; re-seeded with accumulated Q&A at reduced fidelity.`;
}
