import type {
    RalphGrillAgentDefinition,
    RalphGrillAgentRole,
    RalphGrillDepth,
} from './grill-planning-types';
import { RALPH_GRILL_DEPTHS } from './grill-planning-types';

const DEFAULT_DEPTH: RalphGrillDepth = 'standard';

export const AGENT_DEFINITIONS: Record<RalphGrillAgentRole, RalphGrillAgentDefinition> = {
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

export function normalizeRalphGrillDepth(depth: unknown): RalphGrillDepth {
    return typeof depth === 'string' && (RALPH_GRILL_DEPTHS as readonly string[]).includes(depth)
        ? depth as RalphGrillDepth
        : DEFAULT_DEPTH;
}

export function getRalphGrillAgentDefinitions(depth: unknown): RalphGrillAgentDefinition[] {
    const normalizedDepth = normalizeRalphGrillDepth(depth);
    return DEPTH_AGENT_ROLES[normalizedDepth].map(role => AGENT_DEFINITIONS[role]);
}

export function getRalphGrillAgentDefinition(role: RalphGrillAgentRole): RalphGrillAgentDefinition {
    return AGENT_DEFINITIONS[role];
}
