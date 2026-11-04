import { describe, expect, it } from 'vitest';
import { APIError } from '../../src/server/errors';
import {
    AiSelectionParseError,
    isReasoningEffort,
    parseAiSelection,
    parseChatProvider,
    parseReasoningEffort,
} from '../../src/server/tasks/ai-selection';
import { parseAiSelection as parseRequestSelection } from '../../src/server/shared/ai-selection';
import {
    parseRalphAiSelection,
    resolveRalphContinuationAiSelection,
    type RalphAiSelection,
    type RecoveredIterationPaths,
} from '../../src/server/routes/ralph-route-utils';
import { parseWorkItemAiSettings } from '../../src/server/work-items/work-item-execution-settings';

describe('shared AI selection parsing', () => {
    it('keeps omitted selections undefined without applying defaults', () => {
        const selection = parseAiSelection({});
        expect(Object.keys(selection)).toEqual(['provider', 'model', 'reasoningEffort']);
        expect(selection).toStrictEqual({ provider: undefined, model: undefined, reasoningEffort: undefined });
    });

    it.each(['copilot', 'codex', 'claude', 'opencode'])('accepts provider %s', provider => {
        expect(parseAiSelection({ provider }).provider).toBe(provider);
    });

    it.each(['low', 'medium', 'high', 'xhigh'])('accepts effort %s', reasoningEffort => {
        expect(parseAiSelection({ config: { reasoningEffort } }).reasoningEffort).toBe(reasoningEffort);
        expect(isReasoningEffort(reasoningEffort)).toBe(true);
    });

    it.each([null, '', 'auto', 'COPILOT', 1, false, {}, []])('rejects invalid provider %j', provider => {
        expect(() => parseChatProvider(provider)).toThrow(AiSelectionParseError);
        expect(() => parseChatProvider(provider)).toThrow(
            `Invalid provider: '${String(provider)}'. Valid providers: copilot, codex, claude, opencode`,
        );
    });

    it.each([null, '', 'max', 'HIGH', 1, false, {}, []])('rejects invalid effort %j', reasoningEffort => {
        expect(isReasoningEffort(reasoningEffort)).toBe(false);
        expect(() => parseReasoningEffort(reasoningEffort)).toThrow(
            `Invalid reasoningEffort: '${String(reasoningEffort)}'. Valid reasoningEffort values: low, medium, high, xhigh`,
        );
    });

    it.each([null, [], false, '', 1])('rejects malformed config %j', config => {
        expect(() => parseAiSelection({ config })).toThrow('config must be an object');
    });

    it('trims models, omits null/blank models and rejects non-string models', () => {
        expect(parseAiSelection({ config: { model: '  model-id  ' } }).model).toBe('model-id');
        for (const model of [undefined, null, '', '  ']) {
            expect(parseAiSelection({ config: { model } }).model).toBeUndefined();
        }
        for (const model of [1, false, {}, []]) {
            expect(() => parseAiSelection({ config: { model } })).toThrow('config.model must be a string');
        }
    });

    it('preserves provider/config/model/effort validation order', () => {
        expect(() => parseAiSelection({ provider: 'invalid', config: null })).toThrow('Invalid provider');
        expect(() => parseAiSelection({ config: { model: 1, reasoningEffort: 'invalid' } }))
            .toThrow('config.model must be a string');
    });

    it('converts only selection errors to HTTP 400', () => {
        try {
            parseRequestSelection({ provider: 'auto' });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(APIError);
            expect(error).toMatchObject({
                statusCode: 400,
                message: "Invalid provider: 'auto'. Valid providers: copilot, codex, claude, opencode",
            });
        }
    });
});

describe('caller-specific AI selection semantics', () => {
    it.each([undefined, null, [], 'invalid', { config: null }, { config: 3 }, { config: { model: 7 } }])(
        'Ralph tolerates non-record selections and unusable config/models: %j', body => {
            expect(parseRalphAiSelection(body)).toStrictEqual({
                value: {
                    provider: undefined, model: undefined, reasoningEffort: undefined,
                    effortTier: undefined, autoProviderRouting: undefined,
                },
            });
        },
    );

    describe('Ralph continuation AI selection', () => {
        const emptyRequest: RalphAiSelection = {
            provider: undefined, model: undefined, reasoningEffort: undefined,
            effortTier: undefined, autoProviderRouting: undefined,
        };
        const recovered: RecoveredIterationPaths = {
            workingDirectory: undefined, folderPath: undefined,
            provider: 'claude', model: 'expanded-model', reasoningEffort: 'high',
            effortTier: 'medium',
        };
        const recoveredAuto: RecoveredIterationPaths = { ...recovered, autoProviderRouting: true };

        it('preserves concrete recovery when neither selection requests Auto', () => {
            expect(resolveRalphContinuationAiSelection(emptyRequest, recovered)).toStrictEqual({
                provider: 'claude', model: 'expanded-model', reasoningEffort: 'high',
                effortTier: undefined, autoProviderRouting: false,
            });
        });

        it('inherits recovered Auto intent and tier without its concrete expansion', () => {
            expect(resolveRalphContinuationAiSelection(emptyRequest, recoveredAuto)).toStrictEqual({
                provider: undefined, model: undefined, reasoningEffort: undefined,
                effortTier: 'medium', autoProviderRouting: true,
            });
        });

        it('explicit false disables recovered Auto and recovers concrete settings', () => {
            expect(resolveRalphContinuationAiSelection({
                ...emptyRequest, autoProviderRouting: false,
            }, recoveredAuto)).toStrictEqual({
                provider: 'claude', model: 'expanded-model', reasoningEffort: 'high',
                effortTier: undefined, autoProviderRouting: false,
            });
        });

        it('an explicit Auto request discards recovered concrete settings', () => {
            expect(resolveRalphContinuationAiSelection({
                ...emptyRequest, autoProviderRouting: true,
            }, recovered)).toStrictEqual({
                provider: undefined, model: undefined, reasoningEffort: undefined,
                effortTier: 'medium', autoProviderRouting: true,
            });
        });

        it('explicit concrete provider wins over both requested and recovered Auto', () => {
            expect(resolveRalphContinuationAiSelection({
                ...emptyRequest, provider: 'codex', autoProviderRouting: true,
            }, recoveredAuto)).toStrictEqual({
                provider: 'codex', model: 'expanded-model', reasoningEffort: 'high',
                effortTier: undefined, autoProviderRouting: false,
            });
        });

        it('preserves concrete recovery with a concrete provider override', () => {
            expect(resolveRalphContinuationAiSelection({
                ...emptyRequest, provider: 'copilot',
            }, recovered)).toStrictEqual({
                provider: 'copilot', model: 'expanded-model', reasoningEffort: 'high',
                effortTier: undefined, autoProviderRouting: false,
            });
        });

        it('inherits Auto model and effort without a persisted tier', () => {
            expect(resolveRalphContinuationAiSelection(undefined, {
                ...recoveredAuto, model: 'user-selected-model', effortTier: undefined,
            })).toStrictEqual({
                provider: undefined, model: 'user-selected-model', reasoningEffort: 'high',
                effortTier: undefined, autoProviderRouting: true,
            });
        });

        it('an explicit Auto request preserves concrete model fallback without a persisted tier', () => {
            expect(resolveRalphContinuationAiSelection({
                ...emptyRequest, autoProviderRouting: true,
            }, { ...recovered, effortTier: undefined })).toStrictEqual({
                provider: undefined, model: 'expanded-model', reasoningEffort: 'high',
                effortTier: undefined, autoProviderRouting: true,
            });
        });

        it.each([recovered, recoveredAuto])('explicit tier suppresses recovered model and effort: %j', previous => {
            expect(resolveRalphContinuationAiSelection({
                ...emptyRequest, effortTier: 'low',
            }, previous)).toMatchObject({
                model: undefined, reasoningEffort: undefined, effortTier: 'low',
            });
        });

        it.each([recovered, recoveredAuto])('explicit model and effort win even with a tier: %j', previous => {
            expect(resolveRalphContinuationAiSelection({
                ...emptyRequest, model: 'explicit-model', reasoningEffort: 'xhigh', effortTier: 'high',
            }, previous)).toMatchObject({
                model: 'explicit-model', reasoningEffort: 'xhigh', effortTier: 'high',
            });
        });

        it('inherits each concrete field independently when explicit overrides are partial', () => {
            expect(resolveRalphContinuationAiSelection({
                ...emptyRequest, model: 'explicit-model',
            }, recovered)).toMatchObject({ model: 'explicit-model', reasoningEffort: 'high' });
            expect(resolveRalphContinuationAiSelection({
                ...emptyRequest, reasoningEffort: 'low',
            }, recovered)).toMatchObject({ model: 'expanded-model', reasoningEffort: 'low' });
        });

        it('keeps absent settings absent and emits a complete resolved shape', () => {
            expect(resolveRalphContinuationAiSelection(emptyRequest, {
                workingDirectory: undefined, folderPath: undefined,
                provider: undefined, model: undefined, reasoningEffort: undefined,
            })).toStrictEqual({ ...emptyRequest, autoProviderRouting: false });
        });

        it.each([recovered, recoveredAuto])('accepts omitted requested selection for new loops: %j', previous => {
            expect(resolveRalphContinuationAiSelection(undefined, previous))
                .toStrictEqual(resolveRalphContinuationAiSelection(emptyRequest, previous));
        });
    });

    it('Ralph retains nullish nested effort fallback, tier fallback and exact opt-in', () => {
        expect(parseRalphAiSelection({
            provider: 'opencode',
            reasoningEffort: 'high',
            effortTier: 'low',
            config: { model: '  model-id  ', reasoningEffort: null, effortTier: null },
            autoProviderRouting: true,
        })).toStrictEqual({
            value: {
                provider: 'opencode', model: 'model-id', reasoningEffort: 'high',
                effortTier: 'low', autoProviderRouting: true,
            },
        });
        expect(parseRalphAiSelection({
            reasoningEffort: 'invalid', config: { reasoningEffort: 'medium' }, autoProviderRouting: 'true',
        })).toMatchObject({ value: { reasoningEffort: 'medium', autoProviderRouting: false } });
    });

    it('Ralph preserves omitted versus explicitly disabled Auto selection', () => {
        expect(parseRalphAiSelection({})).toMatchObject({ value: { autoProviderRouting: undefined } });
        for (const autoProviderRouting of [false, null, '', 'true', 1]) {
            expect(parseRalphAiSelection({ autoProviderRouting }))
                .toMatchObject({ value: { autoProviderRouting: false } });
        }
        const parsed = parseRalphAiSelection({ autoProviderRouting: false });
        if ('error' in parsed) throw new Error(parsed.error);
        expect(resolveRalphContinuationAiSelection(parsed.value, {
            provider: 'claude', model: 'model-id', reasoningEffort: 'high',
            workingDirectory: undefined, folderPath: undefined, autoProviderRouting: true,
        })).toMatchObject({ provider: 'claude', autoProviderRouting: false });
    });

    it('Ralph returns detailed errors, rejecting empty effort rather than falling back', () => {
        expect(parseRalphAiSelection({ provider: null })).toStrictEqual({
            error: "Invalid provider: 'null'. Valid providers: copilot, codex, claude, opencode",
        });
        expect(parseRalphAiSelection({ config: { reasoningEffort: '' }, reasoningEffort: 'high' })).toStrictEqual({
            error: "Invalid reasoningEffort: ''. Valid reasoningEffort values: low, medium, high, xhigh",
        });
    });

    it('Work Items retain flat untrimmed model passthrough and model property omission', () => {
        for (const model of ['  model-id  ', '', null, false, 7]) {
            expect(parseWorkItemAiSettings({ model }).model).toBe(model);
        }
        expect(parseWorkItemAiSettings({})).not.toHaveProperty('model');
        expect(parseWorkItemAiSettings({ config: { model: 'ignored', reasoningEffort: 'invalid' } }))
            .not.toHaveProperty('model');
    });

    it.each([null, '', 7])('Work Items preserve short errors for invalid values %j', value => {
        expect(() => parseWorkItemAiSettings({ provider: value }))
            .toThrow(`Invalid provider: '${value}'`);
        expect(() => parseWorkItemAiSettings({ reasoningEffort: value }))
            .toThrow(`Invalid reasoningEffort: '${value}'`);
        try {
            parseWorkItemAiSettings({ provider: value });
        } catch (error) {
            expect(error).toBeInstanceOf(APIError);
            expect((error as Error).message).toBe(`Invalid provider: '${value}'`);
        }
    });
});
