/**
 * AC-03: the shadow languages that keep Monaco's bundled TypeScript worker from
 * answering for an LSP-managed model.
 *
 * What is pinned here is the whole point of the module: a model that a language
 * server owns must leave `typescript`/`javascript` behind, taking the base
 * language's tokenizer with it and dropping the worker's leftover markers,
 * while every model the feature does not manage is left exactly as it was.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
    SHADOW_LANGUAGE_PREFIX,
    applyShadowLanguage,
    baseLanguageId,
    registerShadowLanguages,
    resetShadowLanguagesForTests,
    shadowLanguageId,
    type ShadowMonaco,
} from '../../../../src/server/spa/client/react/features/language-servers/shadowLanguage';

interface Recorded {
    registered: string[];
    configurations: { languageId: string; conf: unknown }[];
    tokenizers: { languageId: string; language: unknown }[];
    languageChanges: { model: unknown; languageId: string }[];
    markers: { model: unknown; owner: string; markers: unknown[] }[];
}

function fakeMonaco(): ShadowMonaco & { recorded: Recorded } {
    const recorded: Recorded = {
        registered: [], configurations: [], tokenizers: [], languageChanges: [], markers: [],
    };
    return {
        recorded,
        languages: {
            register: ({ id }) => { recorded.registered.push(id); },
            setLanguageConfiguration: (languageId, conf) => {
                recorded.configurations.push({ languageId, conf });
            },
            setMonarchTokensProvider: (languageId, language) => {
                recorded.tokenizers.push({ languageId, language });
            },
        },
        editor: {
            setModelLanguage: (model, languageId) => {
                (model as unknown as FakeModel).languageId = languageId;
                recorded.languageChanges.push({ model, languageId });
            },
            setModelMarkers: (model, owner, markers) => {
                recorded.markers.push({ model, owner, markers });
            },
        },
    };
}

class FakeModel {
    constructor(public languageId: string) {}
    getLanguageId(): string { return this.languageId; }
}

const DEFINITIONS = {
    typescript: { conf: { comments: 'ts' }, language: { tokenizer: 'ts' } },
    javascript: { conf: { comments: 'js' }, language: { tokenizer: 'js' } },
};

beforeEach(() => {
    resetShadowLanguagesForTests();
});

describe('shadow language ids', () => {
    it('shadows only the base languages Monaco already provides for', () => {
        expect(shadowLanguageId('typescript')).toBe(`${SHADOW_LANGUAGE_PREFIX}typescript`);
        expect(shadowLanguageId('javascript')).toBe(`${SHADOW_LANGUAGE_PREFIX}javascript`);
        // Nothing in the bundle provides for these, so a shadow would only cost
        // the model its highlighting.
        expect(shadowLanguageId('python')).toBeNull();
        expect(shadowLanguageId('plaintext')).toBeNull();
        expect(shadowLanguageId(null)).toBeNull();
    });

    it('maps a shadow id back to its base language', () => {
        expect(baseLanguageId(`${SHADOW_LANGUAGE_PREFIX}typescript`)).toBe('typescript');
        expect(baseLanguageId('typescript')).toBeNull();
        expect(baseLanguageId(undefined)).toBeNull();
    });
});

describe('registerShadowLanguages', () => {
    it('registers each shadow with the base language’s configuration and tokenizer', () => {
        const monaco = fakeMonaco();
        registerShadowLanguages(monaco, DEFINITIONS);

        expect(monaco.recorded.registered).toEqual([
            `${SHADOW_LANGUAGE_PREFIX}typescript`,
            `${SHADOW_LANGUAGE_PREFIX}javascript`,
        ]);
        expect(monaco.recorded.configurations).toEqual([
            { languageId: `${SHADOW_LANGUAGE_PREFIX}typescript`, conf: DEFINITIONS.typescript.conf },
            { languageId: `${SHADOW_LANGUAGE_PREFIX}javascript`, conf: DEFINITIONS.javascript.conf },
        ]);
        expect(monaco.recorded.tokenizers.map(entry => entry.language))
            .toEqual([DEFINITIONS.typescript.language, DEFINITIONS.javascript.language]);
    });

    it('registers once however often it is called', () => {
        const monaco = fakeMonaco();
        registerShadowLanguages(monaco, DEFINITIONS);
        registerShadowLanguages(monaco, DEFINITIONS);

        // A second registration would stack a duplicate tokenizer on the id.
        expect(monaco.recorded.registered).toHaveLength(2);
        expect(monaco.recorded.tokenizers).toHaveLength(2);
    });

    it('ignores a base language that has no shadow', () => {
        const monaco = fakeMonaco();
        registerShadowLanguages(monaco, { python: { conf: {}, language: {} } });

        expect(monaco.recorded.registered).toEqual([]);
    });
});

describe('applyShadowLanguage', () => {
    it('moves the model onto the shadow id and clears the worker’s markers', () => {
        const monaco = fakeMonaco();
        registerShadowLanguages(monaco, DEFINITIONS);
        const model = new FakeModel('typescript');

        const applied = applyShadowLanguage(monaco, model);

        expect(applied!.languageId).toBe(`${SHADOW_LANGUAGE_PREFIX}typescript`);
        expect(model.getLanguageId()).toBe(`${SHADOW_LANGUAGE_PREFIX}typescript`);
        // The built-in worker will never revisit this model again, so the
        // diagnostics it already published have to be dropped here or they stay
        // on screen next to the language server's.
        expect(monaco.recorded.markers).toEqual([{ model, owner: 'typescript', markers: [] }]);
    });

    it('puts the model back on its base language when reverted', () => {
        const monaco = fakeMonaco();
        registerShadowLanguages(monaco, DEFINITIONS);
        const model = new FakeModel('javascript');

        applyShadowLanguage(monaco, model)!.revert();

        expect(model.getLanguageId()).toBe('javascript');
    });

    it('leaves a model whose language needs no shadow untouched', () => {
        const monaco = fakeMonaco();
        registerShadowLanguages(monaco, DEFINITIONS);
        const model = new FakeModel('python');

        expect(applyShadowLanguage(monaco, model)).toBeNull();
        expect(model.getLanguageId()).toBe('python');
        expect(monaco.recorded.markers).toEqual([]);
    });

    it('refuses when the shadow was never registered', () => {
        // Monaco would tokenize the model as plain text under an unknown id.
        const monaco = fakeMonaco();
        const model = new FakeModel('typescript');

        expect(applyShadowLanguage(monaco, model)).toBeNull();
        expect(model.getLanguageId()).toBe('typescript');
    });

    it('does not shadow a model that is already shadowed', () => {
        const monaco = fakeMonaco();
        registerShadowLanguages(monaco, DEFINITIONS);
        const model = new FakeModel('typescript');
        applyShadowLanguage(monaco, model);

        expect(applyShadowLanguage(monaco, model)).toBeNull();
        expect(monaco.recorded.languageChanges).toHaveLength(1);
    });
});
