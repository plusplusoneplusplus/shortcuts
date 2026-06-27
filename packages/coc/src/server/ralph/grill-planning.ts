import type { ISDKService } from '@plusplusoneplusplus/forge';
import type { SystemMessageConfig } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import type { AskUserRalphGrillPlanningSummary, AskUserSSEPayload } from '../llm-tools/ask-user-tool';

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

export type RalphGrillAgentProvider = 'copilot' | 'codex' | 'claude' | 'opencode';
export const RALPH_GRILL_EFFORT_TIERS = ['very-low', 'low', 'medium', 'high'] as const;
export type RalphGrillEffortTier = typeof RALPH_GRILL_EFFORT_TIERS[number];

export interface RalphGrillAgentDefinition {
    role: RalphGrillAgentRole;
    label: string;
    focus: string;
}

export interface RalphGrillAgentModelSelection {
    role: RalphGrillAgentRole;
    provider?: RalphGrillAgentProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    effortTier?: RalphGrillEffortTier;
}

export interface RalphGrillSetup {
    enabled?: boolean;
    depth?: RalphGrillDepth;
    agents?: RalphGrillAgentModelSelection[];
}

export interface ResolvedRalphGrillAgent extends RalphGrillAgentDefinition {
    provider?: RalphGrillAgentProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    effortTier?: RalphGrillEffortTier;
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
    effortTier?: RalphGrillEffortTier;
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

export type RalphGrillQuestionConsolidationKind = 'unique' | 'merged-duplicate' | 'converted-conflict';

export interface RalphGrillConsolidatedQuestion extends RalphGrillCandidateQuestion {
    consolidation: {
        kind: RalphGrillQuestionConsolidationKind;
        mergedCandidateCount: number;
        mergedQuestions: string[];
    };
}

export interface RalphGrillConsolidationSummary {
    rawCandidateCount: number;
    selectedQuestionCount: number;
    exactDuplicatesMerged: number;
    semanticDuplicatesMerged: number;
    conflictsConverted: number;
    duplicateOnlyAgents: string[];
}

export interface RalphGrillQuestionConsolidationResult {
    selectedQuestions: RalphGrillConsolidatedQuestion[];
    summary: RalphGrillConsolidationSummary;
    warnings: string[];
}

export const RALPH_GRILL_MAX_ROUNDS = 3;
export type RalphGrillTerminationReason = 'all-agents-empty' | 'user-ended' | 'round-cap';

export interface RalphGrillAgentRunResult {
    agent: ResolvedRalphGrillAgent;
    status: 'completed' | 'empty' | 'failed';
    questions: RalphGrillCandidateQuestion[];
    warnings: string[];
    effectiveModel?: string;
    sessionId?: string;
}

export interface RalphGrillQuestionPlanningResult {
    enabled: boolean;
    depth: RalphGrillDepth;
    round: number;
    roundsRun: number;
    maxRounds: number;
    terminal: boolean;
    terminationReason?: RalphGrillTerminationReason;
    promptHistory: string[];
    agentResults: RalphGrillAgentRunResult[];
    candidateQuestions: RalphGrillCandidateQuestion[];
    selectedQuestions: RalphGrillConsolidatedQuestion[];
    consolidation: RalphGrillConsolidationSummary;
    warnings: string[];
}

export interface RalphGrillRoleSessionState {
    role: RalphGrillAgentRole;
    roleLabel: string;
    provenanceLabel: string;
    status: RalphGrillAgentRunResult['status'];
    candidateCount: number;
    sessionId?: string;
}

export interface RalphGrillProcessState {
    roundsRun: number;
    maxRounds: number;
    terminal: boolean;
    terminationReason?: RalphGrillTerminationReason;
    agents: Partial<Record<RalphGrillAgentRole, RalphGrillRoleSessionState>>;
    askedQuestions: string[];
    /** Original request plus later user answer turns, used to seed fresh fallback agents. */
    promptHistory?: string[];
    warnings: string[];
}

export type RalphGrillPlanningProgressStatus = 'running' | 'completed';
export type RalphGrillPlanningProgressAgentStatus = 'running' | 'completed' | 'empty' | 'failed';

export interface RalphGrillPlanningProgressAgent {
    role: RalphGrillAgentRole;
    roleLabel: string;
    provenanceLabel: string;
    status: RalphGrillPlanningProgressAgentStatus;
    candidateCount: number;
}

export interface RalphGrillPlanningProgress {
    status: RalphGrillPlanningProgressStatus;
    depth: RalphGrillDepth;
    round: number;
    maxRounds: number;
    agentCount: number;
    agents: RalphGrillPlanningProgressAgent[];
    message: string;
    warnings: string[];
}

export interface RalphGrillQuestionPlanningContext {
    setup?: RalphGrillSetup | null;
    prompt: string;
    previousState?: RalphGrillProcessState;
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
const SEMANTIC_DUPLICATE_THRESHOLD = 0.67;
const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'be',
    'by',
    'can',
    'for',
    'from',
    'how',
    'is',
    'it',
    'of',
    'on',
    'or',
    'should',
    'the',
    'this',
    'to',
    'we',
    'what',
    'when',
    'where',
    'which',
    'who',
    'will',
    'with',
]);
const TOKEN_ALIASES = new Map<string, string>([
    ['audience', 'user'],
    ['audiences', 'user'],
    ['capabilities', 'feature'],
    ['capability', 'feature'],
    ['customer', 'user'],
    ['customers', 'user'],
    ['disable', 'disable'],
    ['disabled', 'disable'],
    ['disabling', 'disable'],
    ['enable', 'enable'],
    ['enabled', 'enable'],
    ['enabling', 'enable'],
    ['group', 'user'],
    ['groups', 'user'],
    ['people', 'user'],
    ['stakeholder', 'user'],
    ['stakeholders', 'user'],
    ['users', 'user'],
]);
const OPPOSING_TOKEN_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['enable', 'disable'],
    ['include', 'exclude'],
    ['required', 'optional'],
    ['automatic', 'manual'],
    ['allow', 'block'],
    ['persist', 'discard'],
];

function emptyRalphGrillConsolidationSummary(): RalphGrillConsolidationSummary {
    return {
        rawCandidateCount: 0,
        selectedQuestionCount: 0,
        exactDuplicatesMerged: 0,
        semanticDuplicatesMerged: 0,
        conflictsConverted: 0,
        duplicateOnlyAgents: [],
    };
}

function isRalphGrillUserStopSignal(prompt: string): boolean {
    const normalized = prompt
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/g, '')
        .replace(/\s+/g, ' ');
    if (!normalized || normalized.length > 120) return false;
    return [
        'enough',
        'that is enough',
        "that's enough",
        'no more',
        'no more questions',
        'stop grilling',
        'stop the grilling',
        'proceed',
        'proceed to synthesis',
        'synthesize',
        'synthesize the goal',
        'finish',
        'finish the spec',
        'done',
    ].includes(normalized);
}

function formatRalphGrillTerminationReason(reason: RalphGrillTerminationReason | undefined): string {
    switch (reason) {
        case 'all-agents-empty':
            return 'all resumed grill agents returned no follow-up questions';
        case 'user-ended':
            return 'the user signaled that grilling is complete';
        case 'round-cap':
            return `the ${RALPH_GRILL_MAX_ROUNDS}-round grill cap has been reached`;
        default:
            return 'grilling is complete';
    }
}

function buildRalphGrillPromptHistory(ctx: RalphGrillQuestionPlanningContext): string[] {
    const history = [...(ctx.previousState?.promptHistory ?? [])];
    const prompt = ctx.prompt.trim();
    if (prompt && history[history.length - 1] !== prompt) {
        history.push(prompt);
    }
    return history;
}

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

const PROVIDERS = new Set<RalphGrillAgentProvider>(['copilot', 'codex', 'claude', 'opencode']);
const EFFORT_TIERS = new Set<RalphGrillEffortTier>(RALPH_GRILL_EFFORT_TIERS);
const REASONING_EFFORTS = new Set<ReasoningEffort>(['low', 'medium', 'high', 'xhigh']);

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
    effortTier?: string;
}): string {
    const provider = input.provider?.trim();
    const effortTier = input.effortTier?.trim();
    const model = input.model?.trim();
    if (provider && effortTier) return `${input.roleLabel} · ${provider}/${effortTier}`;
    if (effortTier) return `${input.roleLabel} · provider unavailable/${effortTier}`;
    if (provider && model) return `${input.roleLabel} · ${provider}/${model}`;
    if (provider) return `${input.roleLabel} · ${provider}/model unavailable`;
    if (model) return `${input.roleLabel} · provider unavailable/${model}`;
    return `${input.roleLabel} · model unavailable`;
}

function normalizeRalphGrillEffortTier(value: unknown): RalphGrillEffortTier | undefined {
    return typeof value === 'string' && EFFORT_TIERS.has(value as RalphGrillEffortTier)
        ? value as RalphGrillEffortTier
        : undefined;
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
    return typeof value === 'string' && REASONING_EFFORTS.has(value as ReasoningEffort)
        ? value as ReasoningEffort
        : undefined;
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
        const reasoningEffort = normalizeReasoningEffort(selected?.reasoningEffort);
        const effortTier = normalizeRalphGrillEffortTier(selected?.effortTier);
        return {
            ...definition,
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(effortTier ? { effortTier } : {}),
            provenanceLabel: formatRalphGrillProvenance({
                roleLabel: definition.label,
                provider,
                model,
                effortTier,
            }),
        };
    });

    return {
        enabled: input?.enabled === true,
        depth,
        agents,
    };
}

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
            ...(agent.reasoningEffort ? { reasoningEffort: agent.reasoningEffort } : {}),
            ...(agent.effortTier ? { effortTier: agent.effortTier } : {}),
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
- Do not embed the provenance label in the visible question text; CoC automatically renders a provenance chip ("Role Agent · provider/tier" when a tier applies, otherwise "Role Agent · provider/model" with fallback copy when the concrete model is unavailable) beneath each question from attached metadata.

Final goal synthesis:
- Include the selected depth, provider/tier or provider/model used per agent, coverage summary, dedupe/conflict outcomes, constraints, out-of-scope items, references to load, and Definition of Done details for every acceptance criterion.
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
        ...(agent.effortTier ? { effortTier: agent.effortTier } : {}),
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

function normalizeQuestionForExactMatch(question: string): string {
    return question
        .toLowerCase()
        .replace(/['"`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeQuestionToken(raw: string): string | undefined {
    let token = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!token || STOP_WORDS.has(token)) return undefined;
    token = TOKEN_ALIASES.get(token) ?? token;
    if (token.endsWith('ies') && token.length > 4) {
        token = `${token.slice(0, -3)}y`;
    } else if (token.endsWith('s') && token.length > 3) {
        token = token.slice(0, -1);
    }
    token = TOKEN_ALIASES.get(token) ?? token;
    return token && !STOP_WORDS.has(token) ? token : undefined;
}

function questionTokenSet(question: string): Set<string> {
    const tokens = new Set<string>();
    for (const part of question.split(/[^a-zA-Z0-9]+/)) {
        const token = normalizeQuestionToken(part);
        if (token) tokens.add(token);
    }
    return tokens;
}

function sourceKey(source: RalphGrillQuestionSource): string {
    return [
        source.role,
        source.provider ?? '',
        source.model ?? '',
        source.effortTier ?? '',
        source.provenanceLabel,
    ].join('\u0000');
}

function mergeQuestionSources(
    left: RalphGrillQuestionSource[],
    right: RalphGrillQuestionSource[],
): RalphGrillQuestionSource[] {
    const merged = new Map<string, RalphGrillQuestionSource>();
    for (const source of [...left, ...right]) {
        merged.set(sourceKey(source), source);
    }
    return [...merged.values()];
}

function mergeRationales(left: string | undefined, right: string | undefined): string | undefined {
    const values = [left?.trim(), right?.trim()].filter((value): value is string => !!value);
    if (values.length === 0) return undefined;
    return [...new Set(values)].join(' ');
}

function optionSignature(question: RalphGrillCandidateQuestion): string | undefined {
    if (!question.options?.length) return undefined;
    return question.options
        .map(option => `${option.value.trim().toLowerCase()}:${option.label.trim().toLowerCase()}`)
        .sort()
        .join('|');
}

function defaultValueSignature(question: RalphGrillCandidateQuestion): string | undefined {
    const value = question.defaultValue;
    if (value === undefined) return undefined;
    return Array.isArray(value)
        ? value.map(item => item.trim().toLowerCase()).sort().join('|')
        : value.trim().toLowerCase();
}

function tokenOverlapSize(left: Set<string>, right: Set<string>, ignored = new Set<string>()): number {
    let count = 0;
    for (const token of left) {
        if (!ignored.has(token) && right.has(token)) count++;
    }
    return count;
}

function tokenSimilarity(left: Set<string>, right: Set<string>): number {
    if (left.size === 0 || right.size === 0) return 0;
    const intersection = tokenOverlapSize(left, right);
    const union = new Set([...left, ...right]).size;
    return union === 0 ? 0 : intersection / union;
}

function findOpposingTokenPair(left: Set<string>, right: Set<string>): readonly [string, string] | undefined {
    return OPPOSING_TOKEN_PAIRS.find(([positive, negative]) =>
        (left.has(positive) && right.has(negative)) || (left.has(negative) && right.has(positive)));
}

function hasConflictingChoices(
    left: RalphGrillCandidateQuestion,
    right: RalphGrillCandidateQuestion,
    comparable: boolean,
): boolean {
    if (!comparable) return false;
    const leftOptions = optionSignature(left);
    const rightOptions = optionSignature(right);
    if (leftOptions && rightOptions && leftOptions !== rightOptions) {
        return true;
    }
    const leftDefault = defaultValueSignature(left);
    const rightDefault = defaultValueSignature(right);
    return !!leftDefault && !!rightDefault && leftDefault !== rightDefault;
}

function isConflictingQuestion(
    left: RalphGrillCandidateQuestion,
    right: RalphGrillCandidateQuestion,
    leftTokens: Set<string>,
    rightTokens: Set<string>,
    comparable: boolean,
): boolean {
    if (hasConflictingChoices(left, right, comparable)) {
        return true;
    }
    const opposingPair = findOpposingTokenPair(leftTokens, rightTokens);
    if (!opposingPair) return false;
    const ignored = new Set(opposingPair);
    return comparable || tokenOverlapSize(leftTokens, rightTokens, ignored) >= 1;
}

function slugifyOptionValue(label: string, index: number): string {
    const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return slug || `option-${index + 1}`;
}

function stripQuestionSuffix(question: string): string {
    return question.trim().replace(/[?.!]+$/g, '');
}

function uniqueOptions(options: RalphGrillQuestionOption[]): RalphGrillQuestionOption[] {
    const seen = new Set<string>();
    const unique: RalphGrillQuestionOption[] = [];
    for (const option of options) {
        const key = `${option.value.trim().toLowerCase()}:${option.label.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(option);
    }
    return unique;
}

function inferConflictOptions(
    left: RalphGrillCandidateQuestion,
    right: RalphGrillCandidateQuestion,
    leftTokens: Set<string>,
    rightTokens: Set<string>,
): RalphGrillQuestionOption[] {
    const opposingPair = findOpposingTokenPair(leftTokens, rightTokens);
    if (opposingPair?.[0] === 'enable' && opposingPair[1] === 'disable') {
        return [
            { value: 'enabled-by-default', label: 'Enable by default' },
            { value: 'disabled-by-default', label: 'Disable by default' },
        ];
    }

    const mergedOptions = uniqueOptions([...(left.options ?? []), ...(right.options ?? [])]);
    if (mergedOptions.length >= 2) {
        return mergedOptions.slice(0, 8);
    }

    return [left.question, right.question].map((question, index) => {
        const label = stripQuestionSuffix(question);
        return {
            value: slugifyOptionValue(label, index),
            label,
        };
    });
}

function inferConflictQuestion(
    left: RalphGrillCandidateQuestion,
    right: RalphGrillCandidateQuestion,
    leftTokens: Set<string>,
    rightTokens: Set<string>,
): string {
    const opposingPair = findOpposingTokenPair(leftTokens, rightTokens);
    if (opposingPair?.[0] === 'enable' && opposingPair[1] === 'disable' && (leftTokens.has('default') || rightTokens.has('default'))) {
        return 'Should this capability be enabled or disabled by default?';
    }
    if ((left.options?.length ?? 0) > 0 || (right.options?.length ?? 0) > 0) {
        return left.question;
    }
    return `Resolve this conflicting clarification decision: ${stripQuestionSuffix(left.question)}.`;
}

type ConsolidationRelation = 'exact-duplicate' | 'semantic-duplicate' | 'conflict';
type DuplicateConsolidationRelation = Exclude<ConsolidationRelation, 'conflict'>;

interface RalphGrillConsolidationGroup {
    question: RalphGrillConsolidatedQuestion;
    exactKeys: Set<string>;
    tokens: Set<string>;
}

interface RalphGrillAskedQuestionIndex {
    exactKey: string;
    tokens: Set<string>;
}

function toConsolidatedQuestion(question: RalphGrillCandidateQuestion): RalphGrillConsolidatedQuestion {
    return {
        ...question,
        sources: mergeQuestionSources(question.sources, []),
        consolidation: {
            kind: 'unique',
            mergedCandidateCount: 1,
            mergedQuestions: [question.question],
        },
    };
}

function classifyQuestionRelation(
    group: RalphGrillConsolidationGroup,
    question: RalphGrillCandidateQuestion,
    questionExactKey: string,
    questionTokens: Set<string>,
): ConsolidationRelation | undefined {
    const duplicateRelation = classifyDuplicateQuestionRelation(group.exactKeys, group.tokens, questionExactKey, questionTokens);
    const comparable = !!duplicateRelation;
    if (isConflictingQuestion(group.question, question, group.tokens, questionTokens, comparable)) {
        return 'conflict';
    }
    if (duplicateRelation) return duplicateRelation;
    return undefined;
}

function classifyDuplicateQuestionRelation(
    exactKeys: Set<string>,
    tokens: Set<string>,
    questionExactKey: string,
    questionTokens: Set<string>,
): DuplicateConsolidationRelation | undefined {
    if (exactKeys.has(questionExactKey)) return 'exact-duplicate';
    if (tokenSimilarity(tokens, questionTokens) >= SEMANTIC_DUPLICATE_THRESHOLD) {
        return 'semantic-duplicate';
    }
    return undefined;
}

function buildAlreadyAskedQuestionIndex(questions: string[]): RalphGrillAskedQuestionIndex[] {
    return questions
        .map(question => ({
            exactKey: normalizeQuestionForExactMatch(question),
            tokens: questionTokenSet(question),
        }))
        .filter(index => index.exactKey.length > 0 || index.tokens.size > 0);
}

function findAlreadyAskedDuplicateRelation(
    alreadyAsked: RalphGrillAskedQuestionIndex[],
    questionExactKey: string,
    questionTokens: Set<string>,
): DuplicateConsolidationRelation | undefined {
    for (const asked of alreadyAsked) {
        const relation = classifyDuplicateQuestionRelation(new Set([asked.exactKey]), asked.tokens, questionExactKey, questionTokens);
        if (relation) return relation;
    }
    return undefined;
}

function mergeQuestionIntoGroup(
    group: RalphGrillConsolidationGroup,
    question: RalphGrillCandidateQuestion,
    relation: ConsolidationRelation,
    questionExactKey: string,
    questionTokens: Set<string>,
): void {
    const mergedSources = mergeQuestionSources(group.question.sources, question.sources);
    const mergedQuestions = [...new Set([...group.question.consolidation.mergedQuestions, question.question])];
    const mergedCandidateCount = group.question.consolidation.mergedCandidateCount + 1;
    if (relation === 'conflict') {
        const options = inferConflictOptions(group.question, question, group.tokens, questionTokens);
        group.question = {
            question: inferConflictQuestion(group.question, question, group.tokens, questionTokens),
            type: 'select',
            options,
            rationale: mergeRationales(
                group.question.rationale,
                question.rationale ?? 'Conflicting candidate questions were converted into one user-facing decision.',
            ),
            sources: mergedSources,
            consolidation: {
                kind: 'converted-conflict',
                mergedCandidateCount,
                mergedQuestions,
            },
        };
    } else {
        group.question = {
            ...group.question,
            rationale: mergeRationales(group.question.rationale, question.rationale),
            sources: mergedSources,
            consolidation: {
                kind: 'merged-duplicate',
                mergedCandidateCount,
                mergedQuestions,
            },
        };
    }

    group.exactKeys.add(questionExactKey);
    for (const token of questionTokens) {
        group.tokens.add(token);
    }
}

function recordRoleContribution(
    contributions: Map<RalphGrillAgentRole, { total: number; productive: number }>,
    question: RalphGrillCandidateQuestion,
    productive: boolean,
): void {
    for (const source of question.sources) {
        const current = contributions.get(source.role) ?? { total: 0, productive: 0 };
        current.total += 1;
        if (productive) current.productive += 1;
        contributions.set(source.role, current);
    }
}

export function consolidateRalphGrillCandidateQuestions(
    candidateQuestions: RalphGrillCandidateQuestion[],
    agentResults: RalphGrillAgentRunResult[] = [],
    alreadyAskedQuestions: string[] = [],
): RalphGrillQuestionConsolidationResult {
    const groups: RalphGrillConsolidationGroup[] = [];
    const alreadyAsked = buildAlreadyAskedQuestionIndex(alreadyAskedQuestions);
    const contributions = new Map<RalphGrillAgentRole, { total: number; productive: number }>();
    let exactDuplicatesMerged = 0;
    let semanticDuplicatesMerged = 0;
    let conflictsConverted = 0;

    for (const question of candidateQuestions) {
        const questionExactKey = normalizeQuestionForExactMatch(question.question);
        const questionTokens = questionTokenSet(question.question);
        const alreadyAskedRelation = findAlreadyAskedDuplicateRelation(alreadyAsked, questionExactKey, questionTokens);
        if (alreadyAskedRelation) {
            if (alreadyAskedRelation === 'exact-duplicate') exactDuplicatesMerged += 1;
            if (alreadyAskedRelation === 'semantic-duplicate') semanticDuplicatesMerged += 1;
            recordRoleContribution(contributions, question, false);
            continue;
        }

        let matched = false;
        for (const group of groups) {
            const relation = classifyQuestionRelation(group, question, questionExactKey, questionTokens);
            if (!relation) continue;
            mergeQuestionIntoGroup(group, question, relation, questionExactKey, questionTokens);
            if (relation === 'exact-duplicate') exactDuplicatesMerged += 1;
            if (relation === 'semantic-duplicate') semanticDuplicatesMerged += 1;
            if (relation === 'conflict') conflictsConverted += 1;
            recordRoleContribution(contributions, question, relation === 'conflict');
            matched = true;
            break;
        }
        if (matched) continue;

        groups.push({
            question: toConsolidatedQuestion(question),
            exactKeys: new Set([questionExactKey]),
            tokens: new Set(questionTokens),
        });
        recordRoleContribution(contributions, question, true);
    }

    const duplicateOnlyAgents = agentResults.length > 0
        ? agentResults
            .filter(result => result.questions.length > 0)
            .filter(result => {
                const contribution = contributions.get(result.agent.role);
                return contribution && contribution.total > 0 && contribution.productive === 0;
            })
            .map(result => result.agent.label)
        : [...contributions.entries()]
            .filter(([, contribution]) => contribution.total > 0 && contribution.productive === 0)
            .map(([role]) => AGENT_DEFINITIONS[role].label);

    const warnings = duplicateOnlyAgents.map(agentLabel =>
        `${agentLabel} contributed only duplicate candidate questions after consolidation.`);

    const selectedQuestions = groups.map(group => group.question);
    return {
        selectedQuestions,
        summary: {
            rawCandidateCount: candidateQuestions.length,
            selectedQuestionCount: selectedQuestions.length,
            exactDuplicatesMerged,
            semanticDuplicatesMerged,
            conflictsConverted,
            duplicateOnlyAgents,
        },
        warnings,
    };
}

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

function buildRalphGrillAgentFollowUpPrompt(ctx: RalphGrillQuestionPlanningContext, agent: ResolvedRalphGrillAgent): string {
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

function buildRalphGrillAgentResumeFallbackPrompt(ctx: RalphGrillQuestionPlanningContext, agent: ResolvedRalphGrillAgent): string {
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

function formatRalphGrillResumeFallbackWarning(agent: ResolvedRalphGrillAgent): string {
    return `${agent.label} resume history was unavailable; re-seeded with accumulated Q&A at reduced fidelity.`;
}

function resolveAgentForExecution(
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

async function runSingleRalphGrillAgent(
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
