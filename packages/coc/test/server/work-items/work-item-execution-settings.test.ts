import { describe, it, expect } from 'vitest';
import { APIError } from '../../../src/server/errors';
import {
    aiSettingsExecutionMetadata,
    aiSettingsTaskConfig,
    parseAutoProviderRoutingField,
    parseChatProviderField,
    parseEffortTierField,
    parseExecutionModeField,
    parseReasoningEffortField,
    parseSkillNamesField,
    parseWorkItemAiSettings,
} from '../../../src/server/work-items/work-item-execution-settings';

function expectBadRequest(fn: () => unknown, messageFragment: string): void {
    let thrown: unknown;
    try {
        fn();
    } catch (err) {
        thrown = err;
    }
    expect(thrown).toBeInstanceOf(APIError);
    expect((thrown as APIError).statusCode).toBe(400);
    expect((thrown as APIError).message).toContain(messageFragment);
}

describe('Work Item execution settings parsers', () => {
    describe('parseChatProviderField', () => {
        it('accepts a known provider and passes undefined through', () => {
            expect(parseChatProviderField('claude')).toBe('claude');
            expect(parseChatProviderField(undefined)).toBeUndefined();
        });

        it('rejects unknown and non-string providers', () => {
            expectBadRequest(() => parseChatProviderField('not-a-provider'), "Invalid provider: 'not-a-provider'");
            expectBadRequest(() => parseChatProviderField(7), 'Invalid provider');
            expectBadRequest(() => parseChatProviderField(null), 'Invalid provider');
        });
    });

    describe('parseReasoningEffortField', () => {
        it('accepts a known effort and passes undefined through', () => {
            expect(parseReasoningEffortField('high')).toBe('high');
            expect(parseReasoningEffortField(undefined)).toBeUndefined();
        });

        it('rejects unknown efforts', () => {
            expectBadRequest(() => parseReasoningEffortField('extreme'), "Invalid reasoningEffort: 'extreme'");
        });
    });

    describe('parseEffortTierField', () => {
        it('accepts every supported tier', () => {
            for (const tier of ['very-low', 'low', 'medium', 'high']) {
                expect(parseEffortTierField(tier)).toBe(tier);
            }
            expect(parseEffortTierField(undefined)).toBeUndefined();
        });

        it('rejects unknown tiers', () => {
            expectBadRequest(() => parseEffortTierField('ultra'), "Invalid effortTier: 'ultra'");
        });
    });

    describe('parseAutoProviderRoutingField', () => {
        it('opts in only on a literal true', () => {
            expect(parseAutoProviderRoutingField(true)).toBe(true);
            expect(parseAutoProviderRoutingField('true')).toBe(false);
            expect(parseAutoProviderRoutingField(1)).toBe(false);
            expect(parseAutoProviderRoutingField(undefined)).toBe(false);
        });
    });

    describe('parseExecutionModeField', () => {
        it('accepts the two known modes', () => {
            expect(parseExecutionModeField('one-shot')).toBe('one-shot');
            expect(parseExecutionModeField('ralph')).toBe('ralph');
            expect(parseExecutionModeField(undefined)).toBeUndefined();
        });

        it('rejects anything else', () => {
            expectBadRequest(() => parseExecutionModeField('turbo'), "Invalid executionMode: 'turbo'");
        });
    });

    describe('parseSkillNamesField', () => {
        it('keeps only non-blank strings', () => {
            expect(parseSkillNamesField(['impl', '', '   ', 3, null, 'code-review'])).toEqual(['impl', 'code-review']);
        });

        it('returns undefined for non-arrays and all-empty arrays', () => {
            expect(parseSkillNamesField(undefined)).toBeUndefined();
            expect(parseSkillNamesField('impl')).toBeUndefined();
            expect(parseSkillNamesField([])).toBeUndefined();
            expect(parseSkillNamesField(['', '  '])).toBeUndefined();
        });
    });

    describe('parseWorkItemAiSettings', () => {
        it('parses a full settings block', () => {
            expect(parseWorkItemAiSettings({
                model: 'claude-opus-5',
                provider: 'claude',
                reasoningEffort: 'high',
                effortTier: 'medium',
                autoProviderRouting: true,
            })).toEqual({
                model: 'claude-opus-5',
                provider: 'claude',
                reasoningEffort: 'high',
                effortTier: 'medium',
                autoProviderRouting: true,
            });
        });

        it('passes the model through without validation', () => {
            expect(parseWorkItemAiSettings({ model: 'some-unreleased-model' }).model).toBe('some-unreleased-model');
        });

        it('defaults to an empty selection for an empty body', () => {
            expect(parseWorkItemAiSettings({})).toEqual({
                provider: undefined,
                reasoningEffort: undefined,
                effortTier: undefined,
                autoProviderRouting: false,
            });
        });

        it('tolerates non-object bodies', () => {
            expect(parseWorkItemAiSettings(undefined).autoProviderRouting).toBe(false);
            expect(parseWorkItemAiSettings(null).provider).toBeUndefined();
            expect(parseWorkItemAiSettings([]).effortTier).toBeUndefined();
        });

        it('rejects an invalid field inside the block', () => {
            expectBadRequest(() => parseWorkItemAiSettings({ provider: 'nope' }), 'Invalid provider');
            expectBadRequest(() => parseWorkItemAiSettings({ effortTier: 'nope' }), 'Invalid effortTier');
        });
    });

    describe('derived queue config and execution metadata', () => {
        it('derives both shapes from the same parsed settings', () => {
            const settings = parseWorkItemAiSettings({
                model: 'claude-opus-5',
                provider: 'claude',
                reasoningEffort: 'high',
                effortTier: 'low',
                autoProviderRouting: true,
            });
            expect(aiSettingsTaskConfig(settings)).toEqual({
                model: 'claude-opus-5',
                reasoningEffort: 'high',
                effortTier: 'low',
            });
            expect(aiSettingsExecutionMetadata(settings)).toEqual({
                provider: 'claude',
                model: 'claude-opus-5',
                reasoningEffort: 'high',
                effortTier: 'low',
                autoProviderRouting: true,
            });
        });

        it('omits an empty model rather than overriding the queue default', () => {
            const settings = parseWorkItemAiSettings({ model: '' });
            expect(aiSettingsTaskConfig(settings)).toEqual({});
            expect(aiSettingsExecutionMetadata(settings)).toBeUndefined();
        });

        it('returns no execution metadata when nothing was selected', () => {
            expect(aiSettingsExecutionMetadata(parseWorkItemAiSettings({}))).toBeUndefined();
        });

        it('records auto provider routing on its own', () => {
            expect(aiSettingsExecutionMetadata(parseWorkItemAiSettings({ autoProviderRouting: true })))
                .toEqual({ autoProviderRouting: true });
        });
    });
});
