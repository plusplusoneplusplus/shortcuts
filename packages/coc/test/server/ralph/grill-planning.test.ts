import { describe, expect, it, vi } from 'vitest';
import type {
    RalphGrillAgentRole,
    RalphGrillCandidateQuestion,
    RalphGrillQuestionOption,
} from '../../../src/server/ralph/grill-planning';
import {
    attachRalphGrillMetadataToAskUserPayloads,
    buildRalphMultiAgentGrillDirective,
    consolidateRalphGrillCandidateQuestions,
    formatRalphGrillQuestionPlanForPrompt,
    formatRalphGrillProvenance,
    getRalphGrillAgentDefinitions,
    normalizeRalphGrillSetupForContext,
    parseRalphGrillAgentResponse,
    planRalphGrillCandidateQuestions,
    resolveRalphGrillSetup,
} from '../../../src/server/ralph/grill-planning';

function candidateQuestion(
    question: string,
    role: RalphGrillAgentRole,
    overrides: Partial<Omit<RalphGrillCandidateQuestion, 'question' | 'sources'>> = {},
): RalphGrillCandidateQuestion {
    const definition = getRalphGrillAgentDefinitions('deep').find(agent => agent.role === role)!;
    return {
        question,
        type: overrides.type ?? 'text',
        ...(overrides.options ? { options: overrides.options } : {}),
        ...(overrides.defaultValue !== undefined ? { defaultValue: overrides.defaultValue } : {}),
        ...(overrides.rationale ? { rationale: overrides.rationale } : {}),
        sources: [{
            role,
            roleLabel: definition.label,
            provider: 'copilot',
            model: `${role}-model`,
            provenanceLabel: `${definition.label} · copilot/${role}-model`,
        }],
    };
}

function options(values: string[]): RalphGrillQuestionOption[] {
    return values.map(value => ({ value, label: value }));
}

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
        // Provenance must not be embedded in visible question copy (it is rendered as a chip from metadata).
        expect(directive).toContain('Do not embed the provenance label in the visible question text');
        expect(directive).toContain('renders a provenance chip');
        expect(directive).not.toContain('Every visible question must show provenance');
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

    it('merges exact duplicate candidate questions while preserving combined provenance', () => {
        const consolidation = consolidateRalphGrillCandidateQuestions([
            candidateQuestion('Which users should this optimize for?', 'product'),
            candidateQuestion('Which users should this optimize for?', 'ux'),
        ]);

        expect(consolidation.selectedQuestions).toHaveLength(1);
        expect(consolidation.selectedQuestions[0].question).toBe('Which users should this optimize for?');
        expect(consolidation.selectedQuestions[0].sources.map(source => source.role)).toEqual(['product', 'ux']);
        expect(consolidation.selectedQuestions[0].consolidation).toMatchObject({
            kind: 'merged-duplicate',
            mergedCandidateCount: 2,
        });
        expect(consolidation.summary).toMatchObject({
            rawCandidateCount: 2,
            selectedQuestionCount: 1,
            exactDuplicatesMerged: 1,
            semanticDuplicatesMerged: 0,
            conflictsConverted: 0,
        });
    });

    it('merges semantic duplicate candidate questions with different phrasing', () => {
        const consolidation = consolidateRalphGrillCandidateQuestions([
            candidateQuestion('Which users should this optimize for?', 'product'),
            candidateQuestion('What user group should this optimize for?', 'quality-test'),
        ]);

        expect(consolidation.selectedQuestions).toHaveLength(1);
        expect(consolidation.selectedQuestions[0].question).toBe('Which users should this optimize for?');
        expect(consolidation.selectedQuestions[0].sources.map(source => source.role)).toEqual(['product', 'quality-test']);
        expect(consolidation.summary).toMatchObject({
            exactDuplicatesMerged: 0,
            semanticDuplicatesMerged: 1,
            conflictsConverted: 0,
        });
    });

    it('converts conflicting questions into one decision question with clear options', () => {
        const consolidation = consolidateRalphGrillCandidateQuestions([
            candidateQuestion('Should this capability be enabled by default?', 'product', { type: 'confirm' }),
            candidateQuestion('Should this capability stay disabled by default?', 'failure-edge-cases', { type: 'confirm' }),
        ]);

        expect(consolidation.selectedQuestions).toHaveLength(1);
        expect(consolidation.selectedQuestions[0]).toMatchObject({
            question: 'Should this capability be enabled or disabled by default?',
            type: 'select',
            options: [
                { value: 'enabled-by-default', label: 'Enable by default' },
                { value: 'disabled-by-default', label: 'Disable by default' },
            ],
            consolidation: {
                kind: 'converted-conflict',
                mergedCandidateCount: 2,
            },
        });
        expect(consolidation.selectedQuestions[0].sources.map(source => source.role)).toEqual(['product', 'failure-edge-cases']);
        expect(consolidation.summary.conflictsConverted).toBe(1);
    });

    it('converts conflicting option sets into one consolidated decision question', () => {
        const consolidation = consolidateRalphGrillCandidateQuestions([
            candidateQuestion('Which launch scope should we use?', 'product', {
                type: 'select',
                options: options(['pilot', 'all-users']),
            }),
            candidateQuestion('What launch scope should we use?', 'ux', {
                type: 'select',
                options: options(['internal-only', 'beta']),
            }),
        ]);

        expect(consolidation.selectedQuestions).toHaveLength(1);
        expect(consolidation.selectedQuestions[0]).toMatchObject({
            question: 'Which launch scope should we use?',
            type: 'select',
            options: [
                { value: 'pilot', label: 'pilot' },
                { value: 'all-users', label: 'all-users' },
                { value: 'internal-only', label: 'internal-only' },
                { value: 'beta', label: 'beta' },
            ],
        });
        expect(consolidation.summary.conflictsConverted).toBe(1);
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
        expect(plan.selectedQuestions).toHaveLength(2);
        expect(plan.consolidation).toMatchObject({
            rawCandidateCount: 2,
            selectedQuestionCount: 2,
        });
        expect(plan.candidateQuestions[0].sources[0].provenanceLabel).toBe('Product Agent · copilot/gpt-5.5');
        expect(plan.warnings).toContain('UX Agent failed: rate limit');

        const promptBlock = formatRalphGrillQuestionPlanForPrompt(plan);
        expect(promptBlock).toContain('Actual grill-agent planning result');
        expect(promptBlock).toContain('Consolidation outcomes');
        expect(promptBlock).toContain('Selected questions after consolidation');
        expect(promptBlock).toContain('UX Agent · claude/claude-sonnet-4.6: failed');
        expect(promptBlock).toContain('UX Agent failed: rate limit');
        expect(promptBlock).toContain('[Product Agent · copilot/gpt-5.5]');
        expect(promptBlock).toContain('Final goal coverage summary requirement');
        expect(promptBlock).toContain('`## Agent Coverage Summary`');
        expect(promptBlock).toContain('[decision] Depth: light');
        expect(promptBlock).toContain('[decision] Models used per agent:');
        expect(promptBlock).toContain('  - Product Agent · copilot/gpt-5.5: completed, 1 candidate question.');
        expect(promptBlock).toContain('  - UX Agent · claude/claude-sonnet-4.6: failed, 0 candidate questions.');
        expect(promptBlock).toContain('[decision] Dedupe/conflict outcomes: raw 2 -> selected 2; exact duplicates 0; semantic duplicates 0; conflicts converted 0; duplicate-only agents none');
        expect(promptBlock).toContain('[decision] Warnings / reduced coverage: UX Agent failed: rate limit');
        expect(promptBlock).toContain('include functional acceptance criteria with Definition of Done details');
        expect(promptBlock).toContain('no duplicate user-facing questions as separate open issues');
        // Provenance is rendered as a chip from metadata, so it must not be duplicated in the visible question text.
        expect(promptBlock).toContain('Do not embed the provenance label in the visible question text');
        expect(promptBlock).toContain('Preserve the listed combined provenance only in the final coverage summary');
        expect(promptBlock).not.toContain('in visible question copy');
    });

    it('warns when an agent contributes only duplicate questions after consolidation', async () => {
        const service = {
            isAvailable: vi.fn().mockResolvedValue({ available: true }),
            sendMessage: vi.fn(async (options: any) => ({
                success: true,
                response: JSON.stringify({
                    questions: [{
                        question: options.prompt.includes('UX Agent')
                            ? 'What user group should this optimize for?'
                            : options.prompt.includes('Architecture/System Agent')
                                ? 'Which system boundary is most constrained?'
                            : 'Which users should this optimize for?',
                        type: 'text',
                    }],
                }),
            })),
        };

        const plan = await planRalphGrillCandidateQuestions(
            { aiService: service as any },
            {
                setup: {
                    enabled: true,
                    depth: 'light',
                    agents: [
                        { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                        { role: 'ux', provider: 'copilot', model: 'gpt-5.5' },
                    ],
                },
                prompt: 'Design the new Ralph grilling experience',
                defaultProvider: 'copilot',
            },
        );

        expect(plan.candidateQuestions).toHaveLength(3);
        expect(plan.selectedQuestions).toHaveLength(2);
        expect(plan.consolidation.semanticDuplicatesMerged).toBe(1);
        expect(plan.consolidation.duplicateOnlyAgents).toEqual(['UX Agent']);
        expect(plan.warnings).toContain('UX Agent contributed only duplicate candidate questions after consolidation.');
    });

    it('attaches planning and provenance metadata to ask_user payloads', () => {
        const productQuestion = candidateQuestion('Which users should this optimize for?', 'product');
        const uxQuestion = candidateQuestion('How should the grouped form look?', 'ux');
        const setup = resolveRalphGrillSetup({
            enabled: true,
            depth: 'light',
            agents: [
                { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                { role: 'ux', provider: 'claude' },
            ],
        });
        const plan = {
            enabled: true,
            depth: 'light' as const,
            agentResults: [
                {
                    agent: setup.agents[0],
                    status: 'completed' as const,
                    questions: [productQuestion],
                    warnings: [],
                },
                {
                    agent: setup.agents[1],
                    status: 'failed' as const,
                    questions: [],
                    warnings: ['UX Agent failed: unavailable'],
                },
            ],
            candidateQuestions: [productQuestion, uxQuestion],
            selectedQuestions: [productQuestion, uxQuestion].map(question => ({
                ...question,
                consolidation: {
                    kind: 'unique' as const,
                    mergedCandidateCount: 1,
                    mergedQuestions: [question.question],
                },
            })),
            consolidation: {
                rawCandidateCount: 2,
                selectedQuestionCount: 2,
                exactDuplicatesMerged: 0,
                semanticDuplicatesMerged: 0,
                conflictsConverted: 0,
                duplicateOnlyAgents: [],
            },
            warnings: ['UX Agent failed: unavailable'],
        };

        const enriched = attachRalphGrillMetadataToAskUserPayloads([
            {
                batchId: 'batch-1',
                questionId: 'q-1',
                question: 'Which users should this optimize for?',
                type: 'text',
                turnIndex: 1,
                index: 0,
                batchSize: 2,
            },
            {
                batchId: 'batch-1',
                questionId: 'q-2',
                question: 'Slightly rephrased second question',
                type: 'text',
                turnIndex: 1,
                index: 1,
                batchSize: 2,
            },
        ], plan);

        expect(enriched[0].ralphGrill?.planning).toMatchObject({
            depth: 'light',
            consolidation: {
                rawCandidateCount: 2,
                selectedQuestionCount: 2,
            },
            warnings: ['UX Agent failed: unavailable'],
        });
        expect(enriched[0].ralphGrill?.planning?.agentOutcomes).toEqual([
            expect.objectContaining({
                role: 'product',
                provenanceLabel: 'Product Agent · copilot/gpt-5.5',
                status: 'completed',
                candidateCount: 1,
            }),
            expect.objectContaining({
                role: 'ux',
                provenanceLabel: 'UX Agent · claude/model unavailable',
                status: 'failed',
                candidateCount: 0,
            }),
        ]);
        expect(enriched[0].ralphGrill?.sources?.[0].provenanceLabel).toBe('Product Agent · copilot/product-model');
        expect(enriched[1].ralphGrill?.sources?.[0].provenanceLabel).toBe('UX Agent · copilot/ux-model');
        expect(enriched[1].ralphGrill?.planning).toBeUndefined();
    });
});
