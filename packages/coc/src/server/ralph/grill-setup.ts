import type { ReasoningEffort } from '../tasks/task-types';
import type {
    RalphGrillAgentModelSelection,
    RalphGrillAgentProvider,
    RalphGrillAgentRole,
    RalphGrillEffortTier,
    RalphGrillSetup,
    ResolvedRalphGrillAgent,
    ResolvedRalphGrillSetup,
} from './grill-planning-types';
import { RALPH_GRILL_AGENT_ROLES, RALPH_GRILL_EFFORT_TIERS } from './grill-planning-types';
import { getRalphGrillAgentDefinitions, normalizeRalphGrillDepth } from './grill-agent-config';

const PROVIDERS = new Set<RalphGrillAgentProvider>(['copilot', 'codex', 'claude', 'opencode']);
const EFFORT_TIERS = new Set<RalphGrillEffortTier>(RALPH_GRILL_EFFORT_TIERS);
const REASONING_EFFORTS = new Set<ReasoningEffort>(['low', 'medium', 'high', 'xhigh']);

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
