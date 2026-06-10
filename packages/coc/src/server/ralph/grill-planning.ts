import type { ISDKService } from '@plusplusoneplusplus/forge';
import type { SystemMessageConfig } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';

export const RALPH_GRILL_DEPTHS = ['light', 'standard', 'deep'] as const;
export type RalphGrillDepth = typeof RALPH_GRILL_DEPTHS[number];

export const RALPH_GRILL_AGENT_ROLES = [
    'product',
    'ux',
    'architecture-system',
    'interaction',
    'failure-edge-cases',
    'quality-test',
    'deduplication',
    'provenance',
] as const;
export type RalphGrillAgentRole = typeof RALPH_GRILL_AGENT_ROLES[number];

export type RalphGrillAgentProvider = 'copilot' | 'codex' | 'claude';

export interface RalphGrillAgentDefinition {
    role: RalphGrillAgentRole;
    label: string;
    focus: string;
}

export interface RalphGrillAgentModelSelection {
    role: RalphGrillAgentRole;
    provider?: RalphGrillAgentProvider;
    model?: string;
}

export interface RalphGrillSetup {
    enabled?: boolean;
    depth?: RalphGrillDepth;
    agents?: RalphGrillAgentModelSelection[];
}

export interface ResolvedRalphGrillAgent extends RalphGrillAgentDefinition {
    provider?: RalphGrillAgentProvider;
    model?: string;
    provenanceLabel: string;
}

export interface ResolvedRalphGrillSetup {
    enabled: boolean;
    depth: RalphGrillDepth;
    agents: ResolvedRalphGrillAgent[];
}

export type RalphGrillQuestionType = 'select' | 'multi-select' | 'yes-no' | 'confirm' | 'text';

export interface RalphGrillQuestionOption {
    value: string;
    label: string;
    description?: string;
}

export interface RalphGrillQuestionSource {
    role: RalphGrillAgentRole;
    roleLabel: string;
    provider?: RalphGrillAgentProvider;
    model?: string;
    provenanceLabel: string;
}

export interface RalphGrillCandidateQuestion {
    question: string;
    type: RalphGrillQuestionType;
    options?: RalphGrillQuestionOption[];
    defaultValue?: string | string[];
    rationale?: string;
    sources: RalphGrillQuestionSource[];
}

export interface RalphGrillAgentRunResult {
    agent: ResolvedRalphGrillAgent;
    status: 'completed' | 'empty' | 'failed';
    questions: RalphGrillCandidateQuestion[];
    warnings: string[];
    effectiveModel?: string;
}

export interface RalphGrillQuestionPlanningResult {
    enabled: boolean;
    depth: RalphGrillDepth;
    agentResults: RalphGrillAgentRunResult[];
    candidateQuestions: RalphGrillCandidateQuestion[];
    warnings: string[];
}

export interface RalphGrillQuestionPlanningContext {
    setup?: RalphGrillSetup | null;
    prompt: string;
    defaultProvider?: ChatProvider;
    defaultModel?: string;
    reasoningEffort?: ReasoningEffort;
    workingDirectory?: string;
    timeoutMs?: number;
    skillDirectories?: string[];
    disabledSkills?: string[];
}

export interface RalphGrillQuestionPlannerOptions {
    aiService: ISDKService;
    resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
    resolveModelForProvider?: (provider: ChatProvider, model: string | undefined) => {
        model?: string;
        coerced?: boolean;
        requestedModel?: string;
    };
}

const DEFAULT_DEPTH: RalphGrillDepth = 'standard';
const GRILL_AGENT_TIMEOUT_MS = 60_000;
const MAX_QUESTIONS_PER_AGENT = 6;
const QUESTION_TYPES = new Set<RalphGrillQuestionType>(['select', 'multi-select', 'yes-no', 'confirm', 'text']);

const GRILL_AGENT_SYSTEM_PROMPT: SystemMessageConfig = {
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

const AGENT_DEFINITIONS: Record<RalphGrillAgentRole, RalphGrillAgentDefinition> = {
    product: {
        role: 'product',
        label: 'Product Agent',
        focus: 'feature intent, outcome, user value, and acceptance criteria completeness',
    },
    ux: {
        role: 'ux',
        label: 'UX Agent',
        focus: 'visual design, grouped interaction, user effort, and answer ergonomics',
    },
    'architecture-system': {
        role: 'architecture-system',
        label: 'Architecture/System Agent',
        focus: 'system integration, data boundaries, feature flags, and multi-repo constraints',
    },
    interaction: {
        role: 'interaction',
        label: 'Interaction Agent',
        focus: 'single consolidated answer flow, follow-up behavior, and skip/defer handling',
    },
    'failure-edge-cases': {
        role: 'failure-edge-cases',
        label: 'Failure/Edge Cases Agent',
        focus: 'timeouts, failed agents, empty outputs, duplicate-only outputs, and reduced coverage warnings',
    },
    'quality-test': {
        role: 'quality-test',
        label: 'Quality/Test Agent',
        focus: 'Definition of Done fidelity, test coverage, validation commands, and regression risk',
    },
    deduplication: {
        role: 'deduplication',
        label: 'Deduplication Agent',
        focus: 'semantic duplicate merging and conflict-to-decision-question conversion',
    },
    provenance: {
        role: 'provenance',
        label: 'Provenance Agent',
        focus: 'role plus provider/model visibility on questions and coverage summaries',
    },
};

const DEPTH_AGENT_ROLES: Record<RalphGrillDepth, readonly RalphGrillAgentRole[]> = {
    light: ['product', 'ux', 'architecture-system'],
    standard: ['product', 'ux', 'architecture-system', 'interaction', 'failure-edge-cases', 'quality-test'],
    deep: [
        'product',
        'ux',
        'architecture-system',
        'interaction',
        'failure-edge-cases',
        'quality-test',
        'deduplication',
        'provenance',
    ],
};

const PROVIDERS = new Set<RalphGrillAgentProvider>(['copilot', 'codex', 'claude']);

export function normalizeRalphGrillDepth(depth: unknown): RalphGrillDepth {
    return typeof depth === 'string' && (RALPH_GRILL_DEPTHS as readonly string[]).includes(depth)
        ? depth as RalphGrillDepth
        : DEFAULT_DEPTH;
}

export function getRalphGrillAgentDefinitions(depth: unknown): RalphGrillAgentDefinition[] {
    const normalizedDepth = normalizeRalphGrillDepth(depth);
    return DEPTH_AGENT_ROLES[normalizedDepth].map(role => AGENT_DEFINITIONS[role]);
}

export function formatRalphGrillProvenance(input: {
    roleLabel: string;
    provider?: string;
    model?: string;
}): string {
    const provider = input.provider?.trim();
    const model = input.model?.trim();
    if (provider && model) return `${input.roleLabel} · ${provider}/${model}`;
    if (provider) return `${input.roleLabel} · ${provider}/model unavailable`;
    if (model) return `${input.roleLabel} · provider unavailable/${model}`;
    return `${input.roleLabel} · model unavailable`;
}

export function resolveRalphGrillSetup(input?: RalphGrillSetup | null): ResolvedRalphGrillSetup {
    const depth = normalizeRalphGrillDepth(input?.depth);
    const selectedByRole = new Map<RalphGrillAgentRole, RalphGrillAgentModelSelection>();
    for (const agent of input?.agents ?? []) {
        if (!RALPH_GRILL_AGENT_ROLES.includes(agent.role)) continue;
        selectedByRole.set(agent.role, agent);
    }

    const agents = getRalphGrillAgentDefinitions(depth).map((definition): ResolvedRalphGrillAgent => {
        const selected = selectedByRole.get(definition.role);
        const provider = selected?.provider && PROVIDERS.has(selected.provider)
            ? selected.provider
            : undefined;
        const model = selected?.model?.trim() || undefined;
        return {
            ...definition,
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            provenanceLabel: formatRalphGrillProvenance({
                roleLabel: definition.label,
                provider,
                model,
            }),
        };
    });

    return {
        enabled: input?.enabled === true,
        depth,
        agents,
    };
}

export function normalizeRalphGrillSetupForContext(input: unknown): RalphGrillSetup | undefined {
    if (!input || typeof input !== 'object') {
        return undefined;
    }

    const resolved = resolveRalphGrillSetup(input as RalphGrillSetup);
    if (!resolved.enabled) {
        return undefined;
    }

    return {
        enabled: true,
        depth: resolved.depth,
        agents: resolved.agents.map(agent => ({
            role: agent.role,
            ...(agent.provider ? { provider: agent.provider } : {}),
            ...(agent.model ? { model: agent.model } : {}),
        })),
    };
}

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
- Every visible question must show provenance using the format "Role Agent · provider/model" when available, with fallback copy when the concrete model is unavailable.

Final goal synthesis:
- Include the selected depth, models used per agent, coverage summary, dedupe/conflict outcomes, constraints, out-of-scope items, references to load, and Definition of Done details for every acceptance criterion.
- Do not carry duplicate user-facing questions forward as separate open issues.`;
}

function stripCodeFences(raw: string): string {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
    return fenced ? fenced[1].trim() : trimmed;
}

function sourceFor(agent: ResolvedRalphGrillAgent): RalphGrillQuestionSource {
    return {
        role: agent.role,
        roleLabel: agent.label,
        ...(agent.provider ? { provider: agent.provider } : {}),
        ...(agent.model ? { model: agent.model } : {}),
        provenanceLabel: agent.provenanceLabel,
    };
}

function sanitizeOptions(raw: unknown): RalphGrillQuestionOption[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }
    const options = raw
        .map((option): RalphGrillQuestionOption | undefined => {
            if (!option || typeof option !== 'object') {
                return undefined;
            }
            const record = option as Record<string, unknown>;
            const value = typeof record.value === 'string' ? record.value.trim() : '';
            const label = typeof record.label === 'string' ? record.label.trim() : '';
            const description = typeof record.description === 'string' ? record.description.trim() : '';
            if (!value || !label) {
                return undefined;
            }
            return {
                value,
                label,
                ...(description ? { description } : {}),
            };
        })
        .filter((option): option is RalphGrillQuestionOption => !!option)
        .slice(0, 8);
    return options.length > 0 ? options : undefined;
}

function sanitizeDefaultValue(raw: unknown): string | string[] | undefined {
    if (typeof raw === 'string') {
        const value = raw.trim();
        return value || undefined;
    }
    if (Array.isArray(raw)) {
        const values = raw
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim())
            .filter(Boolean);
        return values.length > 0 ? values : undefined;
    }
    return undefined;
}

export function parseRalphGrillAgentResponse(raw: string, agent: ResolvedRalphGrillAgent): RalphGrillCandidateQuestion[] {
    const jsonText = stripCodeFences(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error(`AI returned non-JSON Ralph grill questions: ${raw.slice(0, 200)}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('AI Ralph grill question response must be a JSON object');
    }

    const rawQuestions = (parsed as { questions?: unknown }).questions;
    if (!Array.isArray(rawQuestions)) {
        throw new Error('AI Ralph grill question response must include a questions array');
    }

    const source = sourceFor(agent);
    return rawQuestions
        .map((item): RalphGrillCandidateQuestion | undefined => {
            if (!item || typeof item !== 'object') {
                return undefined;
            }
            const record = item as Record<string, unknown>;
            const question = typeof record.question === 'string' ? record.question.trim() : '';
            if (!question) {
                return undefined;
            }
            const rawType = typeof record.type === 'string' && QUESTION_TYPES.has(record.type as RalphGrillQuestionType)
                ? record.type as RalphGrillQuestionType
                : 'text';
            const options = sanitizeOptions(record.options);
            const defaultValue = sanitizeDefaultValue(record.defaultValue);
            const rationale = typeof record.rationale === 'string' ? record.rationale.trim() : '';
            return {
                question,
                type: rawType,
                ...(options ? { options } : {}),
                ...(defaultValue !== undefined ? { defaultValue } : {}),
                ...(rationale ? { rationale } : {}),
                sources: [source],
            };
        })
        .filter((question): question is RalphGrillCandidateQuestion => !!question)
        .slice(0, MAX_QUESTIONS_PER_AGENT);
}

export function buildRalphGrillAgentPrompt(ctx: RalphGrillQuestionPlanningContext, agent: ResolvedRalphGrillAgent): string {
    const providerModel = agent.provider || agent.model
        ? `\nProvider/model provenance for this run: ${agent.provenanceLabel}`
        : '';
    return `\
Selected Ralph grilling depth: ${normalizeRalphGrillDepth(ctx.setup?.depth)}
Agent role: ${agent.label}
Agent focus: ${agent.focus}.${providerModel}

Original user request or current Ralph grilling context:
${ctx.prompt}

Return role-specific candidate questions as strict JSON.`;
}

function resolveAgentForExecution(
    agent: ResolvedRalphGrillAgent,
    ctx: RalphGrillQuestionPlanningContext,
    options: RalphGrillQuestionPlannerOptions,
): { agent: ResolvedRalphGrillAgent; provider?: ChatProvider; model?: string; warnings: string[] } {
    const provider = agent.provider ?? ctx.defaultProvider;
    const requestedModel = agent.model ?? ctx.defaultModel;
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
        provenanceLabel: formatRalphGrillProvenance({
            roleLabel: agent.label,
            provider,
            model,
        }),
    };
    return { agent: resolvedAgent, provider, model, warnings };
}

async function runSingleRalphGrillAgent(
    options: RalphGrillQuestionPlannerOptions,
    ctx: RalphGrillQuestionPlanningContext,
    baseAgent: ResolvedRalphGrillAgent,
): Promise<RalphGrillAgentRunResult> {
    const { agent, provider, model, warnings } = resolveAgentForExecution(baseAgent, ctx, options);
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

        const result = await aiService.sendMessage({
            prompt: buildRalphGrillAgentPrompt(ctx, agent),
            ...(model ? { model } : {}),
            ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {}),
            workingDirectory: ctx.workingDirectory,
            timeoutMs: Math.min(ctx.timeoutMs ?? GRILL_AGENT_TIMEOUT_MS, GRILL_AGENT_TIMEOUT_MS),
            loadDefaultMcpConfig: false,
            systemMessage: GRILL_AGENT_SYSTEM_PROMPT,
            skillDirectories: ctx.skillDirectories,
            disabledSkills: ctx.disabledSkills,
        });
        if (!result.success) {
            return {
                agent,
                status: 'failed',
                questions: [],
                warnings: [
                    ...warnings,
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
                }),
            }
            : agent;
        const questions = parseRalphGrillAgentResponse(result.response ?? '', effectiveAgent);
        return {
            agent: effectiveAgent,
            status: questions.length > 0 ? 'completed' : 'empty',
            questions,
            warnings: questions.length > 0
                ? warnings
                : [...warnings, `${agent.label} returned no usable candidate questions.`],
            ...(result.effectiveModel ? { effectiveModel: result.effectiveModel } : {}),
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

export async function planRalphGrillCandidateQuestions(
    options: RalphGrillQuestionPlannerOptions,
    ctx: RalphGrillQuestionPlanningContext,
): Promise<RalphGrillQuestionPlanningResult> {
    const setup = resolveRalphGrillSetup(ctx.setup);
    if (!setup.enabled) {
        return {
            enabled: false,
            depth: setup.depth,
            agentResults: [],
            candidateQuestions: [],
            warnings: [],
        };
    }

    const agentResults = await Promise.all(
        setup.agents.map(agent => runSingleRalphGrillAgent(options, ctx, agent)),
    );
    const candidateQuestions = agentResults.flatMap(result => result.questions);
    const warnings = agentResults.flatMap(result => result.warnings);
    return {
        enabled: true,
        depth: setup.depth,
        agentResults,
        candidateQuestions,
        warnings,
    };
}

export function formatRalphGrillQuestionPlanForPrompt(plan: RalphGrillQuestionPlanningResult): string {
    if (!plan.enabled) {
        return '';
    }
    const agentLines = plan.agentResults
        .map(result => `- ${result.agent.provenanceLabel}: ${result.status}, ${result.questions.length} candidate question${result.questions.length === 1 ? '' : 's'}.`)
        .join('\n');
    const warningLines = plan.warnings.length > 0
        ? plan.warnings.map(warning => `- ${warning}`).join('\n')
        : '- none';
    const questionLines = plan.candidateQuestions.length > 0
        ? plan.candidateQuestions.map((question, index) => {
            const provenance = question.sources.map(source => source.provenanceLabel).join('; ');
            const options = question.options?.length
                ? ` Options: ${question.options.map(option => `${option.value}=${option.label}`).join(', ')}.`
                : '';
            return `${index + 1}. [${provenance}] (${question.type}) ${question.question}${options}`;
        }).join('\n')
        : 'No usable candidate questions were returned; continue with normal Ralph grilling and include a reduced-coverage warning.';

    return `\
Actual grill-agent planning result:
- Selected depth: ${plan.depth}.
- CoC already invoked the separate grill agents below before this turn; do not simulate or rerun these roles inside one persona response.

Agent outcomes:
${agentLines}

Warnings:
${warningLines}

Candidate questions before consolidation:
${questionLines}

Use these candidate questions as the input for semantic deduplication, conflict conversion, provenance rendering, and the one consolidated ask_user batch. Preserve combined provenance when questions merge.`;
}
