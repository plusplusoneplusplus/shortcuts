import { describe, expect, it, vi } from 'vitest';
import {
    buildRalphMultiAgentGrillDirective,
    formatRalphGrillQuestionPlanForPrompt,
    formatRalphGrillProvenance,
    getRalphGrillAgentDefinitions,
    normalizeRalphGrillSetupForContext,
    parseRalphGrillAgentResponse,
    planRalphGrillCandidateQuestions,
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

    it('parses candidate questions with source provenance', () => {
        const [agent] = resolveRalphGrillSetup({
            enabled: true,
            depth: 'light',
            agents: [{ role: 'product', provider: 'copilot', model: 'gpt-5.5' }],
        }).agents;

        const questions = parseRalphGrillAgentResponse(JSON.stringify({
            questions: [
                {
                    question: 'Which users should this optimize for?',
                    type: 'select',
                    options: [{ value: 'admins', label: 'Admins' }],
                    defaultValue: 'admins',
                    rationale: 'User segment changes the acceptance criteria.',
                },
            ],
        }), agent);

        expect(questions).toEqual([
            {
                question: 'Which users should this optimize for?',
                type: 'select',
                options: [{ value: 'admins', label: 'Admins' }],
                defaultValue: 'admins',
                rationale: 'User segment changes the acceptance criteria.',
                sources: [{
                    role: 'product',
                    roleLabel: 'Product Agent',
                    provider: 'copilot',
                    model: 'gpt-5.5',
                    provenanceLabel: 'Product Agent · copilot/gpt-5.5',
                }],
            },
        ]);
    });

    it('runs actual separate grill agents and keeps planning when one agent fails', async () => {
        const copilotService = {
            isAvailable: vi.fn().mockResolvedValue({ available: true }),
            sendMessage: vi.fn(async (options: any) => ({
                success: true,
                response: JSON.stringify({
                    questions: [{
                        question: options.prompt.includes('Product Agent')
                            ? 'What product outcome should define success?'
                            : 'Which system boundary is most constrained?',
                        type: 'text',
                    }],
                }),
                sessionId: 'agent-session',
            })),
        };
        const claudeService = {
            isAvailable: vi.fn().mockResolvedValue({ available: true }),
            sendMessage: vi.fn().mockResolvedValue({ success: false, error: 'rate limit' }),
        };
        const resolveAiServiceForProvider = vi.fn((provider: string) =>
            provider === 'claude' ? claudeService : copilotService);

        const plan = await planRalphGrillCandidateQuestions(
            {
                aiService: copilotService as any,
                resolveAiServiceForProvider: resolveAiServiceForProvider as any,
            },
            {
                setup: {
                    enabled: true,
                    depth: 'light',
                    agents: [
                        { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                        { role: 'ux', provider: 'claude', model: 'claude-sonnet-4.6' },
                    ],
                },
                prompt: 'Design the new Ralph grilling experience',
                defaultProvider: 'copilot',
                workingDirectory: '/repo',
            },
        );

        expect(resolveAiServiceForProvider).toHaveBeenCalledWith('copilot');
        expect(resolveAiServiceForProvider).toHaveBeenCalledWith('claude');
        expect(copilotService.sendMessage).toHaveBeenCalledTimes(2);
        expect(claudeService.sendMessage).toHaveBeenCalledTimes(1);
        expect(copilotService.sendMessage.mock.calls[0][0]).toMatchObject({
            model: 'gpt-5.5',
            workingDirectory: '/repo',
            loadDefaultMcpConfig: false,
            systemMessage: expect.objectContaining({ mode: 'replace' }),
        });
        expect(plan.agentResults.map(result => [result.agent.role, result.status])).toEqual([
            ['product', 'completed'],
            ['ux', 'failed'],
            ['architecture-system', 'completed'],
        ]);
        expect(plan.candidateQuestions).toHaveLength(2);
        expect(plan.candidateQuestions[0].sources[0].provenanceLabel).toBe('Product Agent · copilot/gpt-5.5');
        expect(plan.warnings).toContain('UX Agent failed: rate limit');

        const promptBlock = formatRalphGrillQuestionPlanForPrompt(plan);
        expect(promptBlock).toContain('Actual grill-agent planning result');
        expect(promptBlock).toContain('UX Agent · claude/claude-sonnet-4.6: failed');
        expect(promptBlock).toContain('UX Agent failed: rate limit');
        expect(promptBlock).toContain('[Product Agent · copilot/gpt-5.5]');
    });
});
