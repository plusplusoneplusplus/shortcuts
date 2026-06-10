import { describe, expect, it } from 'vitest';
import {
    buildRalphMultiAgentGrillDirective,
    formatRalphGrillProvenance,
    getRalphGrillAgentDefinitions,
    normalizeRalphGrillSetupForContext,
    resolveRalphGrillSetup,
} from '../../../src/server/ralph/grill-planning';

describe('Ralph grill planning', () => {
    it('defaults to standard depth while remaining disabled', () => {
        const setup = resolveRalphGrillSetup();

        expect(setup.enabled).toBe(false);
        expect(setup.depth).toBe('standard');
        expect(setup.agents.map(agent => agent.role)).toEqual([
            'product',
            'ux',
            'architecture-system',
            'interaction',
            'failure-edge-cases',
            'quality-test',
        ]);
    });

    it('maps light, standard, and deep depths to increasing agent coverage', () => {
        expect(getRalphGrillAgentDefinitions('light').map(agent => agent.role)).toEqual([
            'product',
            'ux',
            'architecture-system',
        ]);
        expect(getRalphGrillAgentDefinitions('standard')).toHaveLength(6);
        expect(getRalphGrillAgentDefinitions('deep').map(agent => agent.role)).toEqual([
            'product',
            'ux',
            'architecture-system',
            'interaction',
            'failure-edge-cases',
            'quality-test',
            'deduplication',
            'provenance',
        ]);
    });

    it('preserves per-agent model selection state for roles in the selected depth', () => {
        const setup = resolveRalphGrillSetup({
            enabled: true,
            depth: 'light',
            agents: [
                { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                { role: 'ux', provider: 'claude', model: 'claude-sonnet-4.6' },
                { role: 'quality-test', provider: 'codex', model: 'gpt-5.3-codex' },
            ],
        });

        expect(setup.enabled).toBe(true);
        expect(setup.depth).toBe('light');
        expect(setup.agents.map(agent => [agent.role, agent.provider, agent.model, agent.provenanceLabel])).toEqual([
            ['product', 'copilot', 'gpt-5.5', 'Product Agent · copilot/gpt-5.5'],
            ['ux', 'claude', 'claude-sonnet-4.6', 'UX Agent · claude/claude-sonnet-4.6'],
            ['architecture-system', undefined, undefined, 'Architecture/System Agent · model unavailable'],
        ]);
    });

    it('formats fallback provenance when concrete provider or model is unavailable', () => {
        expect(formatRalphGrillProvenance({ roleLabel: 'UX Agent', provider: 'copilot' }))
            .toBe('UX Agent · copilot/model unavailable');
        expect(formatRalphGrillProvenance({ roleLabel: 'UX Agent', model: 'gpt-5.5' }))
            .toBe('UX Agent · provider unavailable/gpt-5.5');
        expect(formatRalphGrillProvenance({ roleLabel: 'UX Agent' }))
            .toBe('UX Agent · model unavailable');
    });

    it('builds the gated prompt directive with depth, agent provenance, dedupe, and one-form requirements', () => {
        const directive = buildRalphMultiAgentGrillDirective({
            enabled: true,
            depth: 'deep',
            agents: [
                { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                { role: 'provenance', provider: 'claude' },
            ],
        });

        expect(directive).toContain('Multi-agent grilling is enabled');
        expect(directive).toContain('Selected depth: deep');
        expect(directive).toContain('Use actual separate grill agents');
        expect(directive).toContain('Product Agent · copilot/gpt-5.5');
        expect(directive).toContain('Provenance Agent · claude/model unavailable');
        expect(directive).toContain('Semantically deduplicate candidate questions');
        expect(directive).toContain('one consolidated ask_user batch');
        expect(directive).toContain('Do not carry duplicate user-facing questions forward');
    });

    it('omits the directive when the setup is not enabled', () => {
        expect(buildRalphMultiAgentGrillDirective({ enabled: false, depth: 'deep' })).toBe('');
    });

    it('normalizes client-provided setup before storing it in task context', () => {
        const setup = normalizeRalphGrillSetupForContext({
            enabled: true,
            depth: 'deep',
            agents: [
                { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                { role: 'ux', provider: 'bad-provider', model: '  claude-sonnet-4.6  ' },
                { role: 'not-a-role', provider: 'codex', model: 'ignored' },
            ],
        });

        expect(setup).toEqual({
            enabled: true,
            depth: 'deep',
            agents: expect.arrayContaining([
                { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                { role: 'ux', model: 'claude-sonnet-4.6' },
            ]),
        });
        expect(setup?.agents?.some(agent => agent.role === 'not-a-role')).toBe(false);
    });
});
