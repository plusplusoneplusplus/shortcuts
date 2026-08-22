import { describe, expect, it } from 'vitest';

import type {
    RalphGrillCandidateQuestion,
    RalphGrillQuestionPlanningContext,
    ResolvedRalphGrillAgent,
} from '../../../src/server/ralph/grill-planning-types';
import { RALPH_GRILL_MAX_ROUNDS } from '../../../src/server/ralph/grill-planning-types';
import {
    AGENT_DEFINITIONS,
    getRalphGrillAgentDefinition,
    getRalphGrillAgentDefinitions,
    normalizeRalphGrillDepth,
} from '../../../src/server/ralph/grill-agent-config';
import { formatRalphGrillProvenance, resolveRalphGrillSetup } from '../../../src/server/ralph/grill-setup';
import {
    GRILL_AGENT_SYSTEM_PROMPT,
    buildRalphGrillAgentFollowUpPrompt,
    buildRalphGrillAgentPrompt,
    buildRalphGrillAgentResumeFallbackPrompt,
    buildRalphGrillPromptHistory,
    formatRalphGrillResumeFallbackWarning,
} from '../../../src/server/ralph/grill-prompts';
import {
    MAX_QUESTIONS_PER_AGENT,
    parseRalphGrillAgentResponse,
} from '../../../src/server/ralph/grill-response-parser';
import {
    SEMANTIC_DUPLICATE_THRESHOLD,
    consolidateRalphGrillCandidateQuestions,
    emptyRalphGrillConsolidationSummary,
    normalizeQuestionForExactMatch,
    normalizeQuestionToken,
    questionTokenSet,
    tokenSimilarity,
} from '../../../src/server/ralph/grill-question-consolidator';
import {
    formatRalphGrillTerminationReason,
    isRalphGrillUserStopSignal,
} from '../../../src/server/ralph/grill-termination';

const productAgent: ResolvedRalphGrillAgent = {
    ...AGENT_DEFINITIONS.product,
    provider: 'copilot',
    model: 'gpt-5',
    provenanceLabel: 'Product Agent · copilot/gpt-5',
};

function context(overrides: Partial<RalphGrillQuestionPlanningContext> = {}): RalphGrillQuestionPlanningContext {
    return {
        setup: { enabled: true, depth: 'standard' },
        prompt: 'Add a repo-group workspace view.',
        ...overrides,
    };
}

function candidate(
    question: string,
    overrides: Partial<Omit<RalphGrillCandidateQuestion, 'question'>> = {},
): RalphGrillCandidateQuestion {
    return {
        question,
        type: overrides.type ?? 'text',
        ...(overrides.options ? { options: overrides.options } : {}),
        ...(overrides.defaultValue !== undefined ? { defaultValue: overrides.defaultValue } : {}),
        ...(overrides.rationale ? { rationale: overrides.rationale } : {}),
        sources: overrides.sources ?? [{
            role: 'product',
            roleLabel: 'Product Agent',
            provider: 'copilot',
            model: 'gpt-5',
            provenanceLabel: 'Product Agent · copilot/gpt-5',
        }],
    };
}

describe('grill-agent-config', () => {
    it('falls back to standard depth for unknown or non-string input', () => {
        expect(normalizeRalphGrillDepth(undefined)).toBe('standard');
        expect(normalizeRalphGrillDepth('turbo')).toBe('standard');
        expect(normalizeRalphGrillDepth(3)).toBe('standard');
        expect(normalizeRalphGrillDepth('deep')).toBe('deep');
    });

    it('exposes one definition per role with a stable label and focus', () => {
        for (const definition of getRalphGrillAgentDefinitions('deep')) {
            expect(getRalphGrillAgentDefinition(definition.role)).toBe(definition);
            expect(definition.label.trim().length).toBeGreaterThan(0);
            expect(definition.focus.trim().length).toBeGreaterThan(0);
        }
    });
});

describe('grill-setup provenance', () => {
    it('prefers the effort tier over the concrete model when both are present', () => {
        expect(formatRalphGrillProvenance({
            roleLabel: 'UX Agent',
            provider: 'claude',
            model: 'claude-opus-5',
            effortTier: 'high',
        })).toBe('UX Agent · claude/high');
    });

    it('ignores unknown providers, effort tiers, and reasoning efforts when resolving setup', () => {
        const resolved = resolveRalphGrillSetup({
            enabled: true,
            depth: 'light',
            agents: [
                { role: 'product', provider: 'bogus' as never, effortTier: 'extreme' as never },
                { role: 'not-a-role' as never, provider: 'codex' },
            ],
        });
        const product = resolved.agents.find(agent => agent.role === 'product');
        expect(product?.provider).toBeUndefined();
        expect(product?.effortTier).toBeUndefined();
        expect(product?.provenanceLabel).toBe('Product Agent · model unavailable');
        expect(resolved.agents).toHaveLength(3);
    });
});

describe('grill-prompts', () => {
    it('keeps the strict JSON output contract in the shared system prompt', () => {
        expect(GRILL_AGENT_SYSTEM_PROMPT.mode).toBe('replace');
        expect(GRILL_AGENT_SYSTEM_PROMPT.content).toContain('STRICT OUTPUT CONTRACT');
        expect(GRILL_AGENT_SYSTEM_PROMPT.content).toContain('Respond with ONLY a valid JSON object');
        expect(GRILL_AGENT_SYSTEM_PROMPT.content).toContain('Do not include provenance fields');
    });

    it('builds a first-turn prompt with depth, role, focus, provenance, and the request', () => {
        const prompt = buildRalphGrillAgentPrompt(context({ setup: { enabled: true, depth: 'deep' } }), productAgent);
        expect(prompt).toContain('Selected Ralph grilling depth: deep');
        expect(prompt).toContain('Agent role: Product Agent');
        expect(prompt).toContain(`Agent focus: ${AGENT_DEFINITIONS.product.focus}.`);
        expect(prompt).toContain('Product Agent · copilot/gpt-5');
        expect(prompt).toContain('Add a repo-group workspace view.');
        expect(prompt).toContain('Return role-specific candidate questions as strict JSON.');
    });

    it('omits the provenance line when the agent has no provider, model, or tier', () => {
        const bare: ResolvedRalphGrillAgent = {
            ...AGENT_DEFINITIONS.ux,
            provenanceLabel: 'UX Agent · model unavailable',
        };
        expect(buildRalphGrillAgentPrompt(context(), bare)).not.toContain('provenance for this run');
    });

    it('asks the resumed session only for new answer-dependent follow-ups', () => {
        const prompt = buildRalphGrillAgentFollowUpPrompt(context({ prompt: 'Group by org, not by path.' }), productAgent);
        expect(prompt).toContain('follow-up round for your existing Product Agent session');
        expect(prompt).toContain('Group by org, not by path.');
        expect(prompt).toContain('Use your retained session context');
        expect(prompt).toContain('{"questions":[]}');
    });

    it('re-seeds the fallback prompt with asked questions and full prompt history', () => {
        const prompt = buildRalphGrillAgentResumeFallbackPrompt(context({
            prompt: 'Group by org, not by path.',
            previousState: {
                roundsRun: 1,
                maxRounds: RALPH_GRILL_MAX_ROUNDS,
                terminal: false,
                agents: {},
                askedQuestions: ['Which repos belong to a group?'],
                promptHistory: ['Add a repo-group workspace view.'],
                warnings: [],
            },
        }), productAgent);
        expect(prompt).toContain('fresh Product Agent fallback session');
        expect(prompt).toContain('1. Which repos belong to a group?');
        expect(prompt).toContain('Original request:\nAdd a repo-group workspace view.');
        expect(prompt).toContain('Round 1 user answers:\nGroup by org, not by path.');
    });

    it('reports missing asked questions and prompt history explicitly', () => {
        const prompt = buildRalphGrillAgentResumeFallbackPrompt({ prompt: '', setup: { enabled: true } }, productAgent);
        expect(prompt).toContain('- none recorded');
        expect(prompt).toContain('No prior prompt history was recorded.');
    });

    it('appends the current prompt to history without duplicating the last turn', () => {
        const previousState = {
            roundsRun: 1,
            maxRounds: RALPH_GRILL_MAX_ROUNDS,
            terminal: false,
            agents: {},
            askedQuestions: [],
            promptHistory: ['first', 'second'],
            warnings: [],
        };
        expect(buildRalphGrillPromptHistory({ prompt: 'second', previousState })).toEqual(['first', 'second']);
        expect(buildRalphGrillPromptHistory({ prompt: ' third ', previousState })).toEqual(['first', 'second', 'third']);
    });

    it('names the agent in the reduced-fidelity resume warning', () => {
        expect(formatRalphGrillResumeFallbackWarning(productAgent))
            .toBe('Product Agent resume history was unavailable; re-seeded with accumulated Q&A at reduced fidelity.');
    });
});

describe('grill-response-parser', () => {
    it('accepts a fenced JSON block', () => {
        const questions = parseRalphGrillAgentResponse(
            '```json\n{"questions":[{"question":"Which repos?","type":"text"}]}\n```',
            productAgent,
        );
        expect(questions).toHaveLength(1);
        expect(questions[0].sources[0].provenanceLabel).toBe('Product Agent · copilot/gpt-5');
    });

    it('throws a descriptive error for non-JSON, non-object, and missing-array responses', () => {
        expect(() => parseRalphGrillAgentResponse('sorry, I cannot', productAgent))
            .toThrow(/non-JSON Ralph grill questions/);
        expect(() => parseRalphGrillAgentResponse('[1,2,3]', productAgent))
            .toThrow('AI Ralph grill question response must be a JSON object');
        expect(() => parseRalphGrillAgentResponse('{"items":[]}', productAgent))
            .toThrow('AI Ralph grill question response must include a questions array');
    });

    it('drops malformed entries and falls back to the text question type', () => {
        const questions = parseRalphGrillAgentResponse(JSON.stringify({
            questions: [
                null,
                'not an object',
                { question: '   ' },
                { question: 'Pick one', type: 'dropdown' },
            ],
        }), productAgent);
        expect(questions).toHaveLength(1);
        expect(questions[0]).toMatchObject({ question: 'Pick one', type: 'text' });
    });

    it('sanitizes options and default values, discarding unusable entries', () => {
        const [question] = parseRalphGrillAgentResponse(JSON.stringify({
            questions: [{
                question: 'Pick one',
                type: 'multi-select',
                options: [
                    { value: ' a ', label: ' Alpha ', description: ' first ' },
                    { value: '', label: 'No value' },
                    { value: 'b', label: '' },
                    'nope',
                ],
                defaultValue: [' a ', '', 42],
                rationale: '  matters  ',
            }],
        }), productAgent);
        expect(question.options).toEqual([{ value: 'a', label: 'Alpha', description: 'first' }]);
        expect(question.defaultValue).toEqual(['a']);
        expect(question.rationale).toBe('matters');
    });

    it('omits options and default values that sanitize to nothing', () => {
        const [question] = parseRalphGrillAgentResponse(JSON.stringify({
            questions: [{ question: 'Free form', options: [], defaultValue: '   ' }],
        }), productAgent);
        expect(question).not.toHaveProperty('options');
        expect(question).not.toHaveProperty('defaultValue');
    });

    it('truncates to the per-agent question cap', () => {
        const questions = parseRalphGrillAgentResponse(JSON.stringify({
            questions: Array.from({ length: MAX_QUESTIONS_PER_AGENT + 4 }, (_, index) => ({ question: `Q${index}` })),
        }), productAgent);
        expect(questions).toHaveLength(MAX_QUESTIONS_PER_AGENT);
        expect(questions[questions.length - 1].question).toBe(`Q${MAX_QUESTIONS_PER_AGENT - 1}`);
    });
});

describe('grill-question-consolidator token seams', () => {
    it('normalizes punctuation and casing for exact matching', () => {
        expect(normalizeQuestionForExactMatch('  Which "repos" belong?  '))
            .toBe(normalizeQuestionForExactMatch('which repos belong'));
    });

    it('drops stop words and folds aliases and plurals to one token', () => {
        expect(normalizeQuestionToken('the')).toBeUndefined();
        expect(normalizeQuestionToken('!!')).toBeUndefined();
        expect(normalizeQuestionToken('customers')).toBe('user');
        expect(normalizeQuestionToken('stakeholders')).toBe('user');
        expect(normalizeQuestionToken('capabilities')).toBe('feature');
        expect(normalizeQuestionToken('disabling')).toBe('disable');
        expect(normalizeQuestionToken('policies')).toBe('policy');
        expect(normalizeQuestionToken('repos')).toBe('repo');
    });

    it('scores identical token sets at 1 and disjoint sets at 0', () => {
        expect(tokenSimilarity(questionTokenSet('Which repos?'), questionTokenSet('which repo'))).toBe(1);
        expect(tokenSimilarity(questionTokenSet('Which repos?'), questionTokenSet('timeout budget'))).toBe(0);
        expect(tokenSimilarity(new Set(), questionTokenSet('anything'))).toBe(0);
        expect(SEMANTIC_DUPLICATE_THRESHOLD).toBeGreaterThan(0.5);
    });

    it('starts from a zeroed consolidation summary', () => {
        expect(emptyRalphGrillConsolidationSummary()).toEqual({
            rawCandidateCount: 0,
            selectedQuestionCount: 0,
            exactDuplicatesMerged: 0,
            semanticDuplicatesMerged: 0,
            conflictsConverted: 0,
            duplicateOnlyAgents: [],
        });
    });

    it('suppresses candidates already asked in an earlier round', () => {
        const result = consolidateRalphGrillCandidateQuestions(
            [candidate('Which repos belong to the group?')],
            [],
            ['which repos belong to the group'],
        );
        expect(result.selectedQuestions).toHaveLength(0);
        expect(result.summary.exactDuplicatesMerged).toBe(1);
        expect(result.warnings).toEqual(['Product Agent contributed only duplicate candidate questions after consolidation.']);
    });

    it('keeps candidates that share no meaningful tokens with earlier rounds', () => {
        const result = consolidateRalphGrillCandidateQuestions(
            [candidate('What timeout budget applies per agent?')],
            [],
            ['Which repos belong to the group?'],
        );
        expect(result.selectedQuestions).toHaveLength(1);
        expect(result.summary.exactDuplicatesMerged).toBe(0);
        expect(result.summary.semanticDuplicatesMerged).toBe(0);
        expect(result.warnings).toEqual([]);
    });

    it('preserves both provenance sources when merging a duplicate', () => {
        const result = consolidateRalphGrillCandidateQuestions([
            candidate('Which repos belong to the group?'),
            candidate('Which repos belong to the group?', {
                sources: [{
                    role: 'ux',
                    roleLabel: 'UX Agent',
                    provider: 'claude',
                    effortTier: 'high',
                    provenanceLabel: 'UX Agent · claude/high',
                }],
            }),
        ]);
        expect(result.selectedQuestions).toHaveLength(1);
        expect(result.selectedQuestions[0].sources.map(source => source.provenanceLabel))
            .toEqual(['Product Agent · copilot/gpt-5', 'UX Agent · claude/high']);
        expect(result.selectedQuestions[0].consolidation).toMatchObject({
            kind: 'merged-duplicate',
            mergedCandidateCount: 2,
        });
    });
});

describe('grill-termination', () => {
    it('recognizes short stop phrases only', () => {
        expect(isRalphGrillUserStopSignal('Enough.')).toBe(true);
        expect(isRalphGrillUserStopSignal("that's enough")).toBe(true);
        expect(isRalphGrillUserStopSignal('proceed to synthesis')).toBe(true);
        expect(isRalphGrillUserStopSignal('')).toBe(false);
        expect(isRalphGrillUserStopSignal('enough about the repo groups, now answer this')).toBe(false);
        expect(isRalphGrillUserStopSignal(`done ${'x'.repeat(200)}`)).toBe(false);
    });

    it('explains every termination reason and the unset default', () => {
        expect(formatRalphGrillTerminationReason('all-agents-empty'))
            .toBe('all resumed grill agents returned no follow-up questions');
        expect(formatRalphGrillTerminationReason('user-ended'))
            .toBe('the user signaled that grilling is complete');
        expect(formatRalphGrillTerminationReason('round-cap'))
            .toBe(`the ${RALPH_GRILL_MAX_ROUNDS}-round grill cap has been reached`);
        expect(formatRalphGrillTerminationReason(undefined)).toBe('grilling is complete');
    });
});
