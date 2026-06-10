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

const DEFAULT_DEPTH: RalphGrillDepth = 'standard';

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
