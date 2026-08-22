import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import type {
    RalphGrillAgentRunResult,
    RalphGrillQuestionPlannerOptions,
    RalphGrillQuestionPlanningContext,
    ResolvedRalphGrillAgent,
} from './grill-planning-types';
import { formatRalphGrillProvenance } from './grill-setup';
import {
    GRILL_AGENT_SYSTEM_PROMPT,
    buildRalphGrillAgentFollowUpPrompt,
    buildRalphGrillAgentPrompt,
    buildRalphGrillAgentResumeFallbackPrompt,
    formatRalphGrillResumeFallbackWarning,
} from './grill-prompts';
import { parseRalphGrillAgentResponse } from './grill-response-parser';

export const GRILL_AGENT_TIMEOUT_MS = 60_000;

export function resolveAgentForExecution(
    agent: ResolvedRalphGrillAgent,
    ctx: RalphGrillQuestionPlanningContext,
    options: RalphGrillQuestionPlannerOptions,
): { agent: ResolvedRalphGrillAgent; provider?: ChatProvider; model?: string; reasoningEffort?: ReasoningEffort; warnings: string[] } {
    const provider = agent.provider ?? ctx.defaultProvider;
    const requestedModel = agent.model ?? ctx.defaultModel;
    const reasoningEffort = agent.reasoningEffort ?? ctx.reasoningEffort;
    const warnings: string[] = [];
    let model = requestedModel;

    if (provider && requestedModel && options.resolveModelForProvider) {
        const resolved = options.resolveModelForProvider(provider, requestedModel);
        if (resolved.coerced) {
            warnings.push(`${agent.label} requested model '${resolved.requestedModel}' is unavailable for provider '${provider}'; provider default will be used.`);
        }
        model = resolved.model;
    }

    const resolvedAgent: ResolvedRalphGrillAgent = {
        ...agent,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        provenanceLabel: formatRalphGrillProvenance({
            roleLabel: agent.label,
            provider,
            model,
            effortTier: agent.effortTier,
        }),
    };
    return { agent: resolvedAgent, provider, model, reasoningEffort, warnings };
}

export async function runSingleRalphGrillAgent(
    options: RalphGrillQuestionPlannerOptions,
    ctx: RalphGrillQuestionPlanningContext,
    baseAgent: ResolvedRalphGrillAgent,
): Promise<RalphGrillAgentRunResult> {
    const { agent, provider, model, reasoningEffort, warnings } = resolveAgentForExecution(baseAgent, ctx, options);
    const resumeSessionId = ctx.previousState?.agents[baseAgent.role]?.sessionId;
    try {
        const aiService = provider && options.resolveAiServiceForProvider
            ? options.resolveAiServiceForProvider(provider)
            : options.aiService;
        const availability = await aiService.isAvailable();
        if (!availability.available) {
            return {
                agent,
                status: 'failed',
                questions: [],
                warnings: [
                    ...warnings,
                    `${agent.label} unavailable: ${availability.error || 'unknown reason'}`,
                ],
            };
        }

        const sendBase = {
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            workingDirectory: ctx.workingDirectory,
            timeoutMs: Math.min(ctx.timeoutMs ?? GRILL_AGENT_TIMEOUT_MS, GRILL_AGENT_TIMEOUT_MS),
            loadDefaultMcpConfig: false,
            systemMessage: GRILL_AGENT_SYSTEM_PROMPT,
            skillDirectories: ctx.skillDirectories,
            disabledSkills: ctx.disabledSkills,
        };
        let result = await aiService.sendMessage({
            prompt: resumeSessionId
                ? buildRalphGrillAgentFollowUpPrompt(ctx, agent)
                : buildRalphGrillAgentPrompt(ctx, agent),
            ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
            ...sendBase,
        });
        const invocationWarnings = [...warnings];
        if (resumeSessionId && result.success && result.sessionId && result.sessionId !== resumeSessionId) {
            invocationWarnings.push(formatRalphGrillResumeFallbackWarning(agent));
            result = await aiService.sendMessage({
                prompt: buildRalphGrillAgentResumeFallbackPrompt(ctx, agent),
                ...sendBase,
            });
        }
        if (!result.success) {
            return {
                agent,
                status: 'failed',
                questions: [],
                warnings: [
                    ...invocationWarnings,
                    `${agent.label} failed: ${result.error || 'AI execution failed'}`,
                ],
            };
        }

        const effectiveAgent = result.effectiveModel && result.effectiveModel !== agent.model
            ? {
                ...agent,
                model: result.effectiveModel,
                provenanceLabel: formatRalphGrillProvenance({
                    roleLabel: agent.label,
                    provider: agent.provider,
                    model: result.effectiveModel,
                    effortTier: agent.effortTier,
                }),
            }
            : agent;
        const questions = parseRalphGrillAgentResponse(result.response ?? '', effectiveAgent);
        const status = questions.length > 0 ? 'completed' : 'empty';
        return {
            agent: effectiveAgent,
            status,
            questions,
            warnings: questions.length > 0 || resumeSessionId
                ? invocationWarnings
                : [...invocationWarnings, `${agent.label} returned no usable candidate questions.`],
            ...(result.effectiveModel ? { effectiveModel: result.effectiveModel } : {}),
            ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        };
    } catch (err) {
        return {
            agent,
            status: 'failed',
            questions: [],
            warnings: [
                ...warnings,
                `${agent.label} failed: ${err instanceof Error ? err.message : String(err)}`,
            ],
        };
    }
}
