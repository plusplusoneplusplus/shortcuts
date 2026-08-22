import type { ISDKService } from '@plusplusoneplusplus/forge';
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
