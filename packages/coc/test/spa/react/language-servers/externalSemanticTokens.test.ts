/**
 * Semantic colors for external definition sources: tokens are fetched once
 * through the capability while Peek has a live attachment, stored on the
 * external-source record, and served to exactly the Peek model and the
 * read-only tab model. Anything stale, foreign or failed keeps basic syntax.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    registerDefinitionPreviewSource,
    type DefinitionPreviewUri,
} from '../../../../src/server/spa/client/react/features/language-servers/definitionPreview';
import { externalResourceUri } from '../../../../src/server/spa/client/react/features/language-servers/externalSource';
import {
    onExternalSourceChange,
    publishExternalSemanticTokens,
    publishExternalSource,
    readExternalSourceRecord,
    resetExternalSourceStoreForTests,
} from '../../../../src/server/spa/client/react/features/language-servers/externalSourceStore';
import { registerExternalSemanticTokens } from '../../../../src/server/spa/client/react/features/language-servers/externalSemanticTokens';
import { COC_SEMANTIC_TOKENS_LEGEND } from '../../../../src/server/spa/client/react/features/language-servers/semanticTokens';

const TOKENS = Uint32Array.from([0, 6, 11, 2, 0]);
const CONTENT = 'class string_view;';

interface Provider {
    languageId: string;
    onDidChange(listener: () => void): { dispose(): void };
    getLegend(): unknown;
    provideDocumentSemanticTokens(model: { getValue(): string }): { data: Uint32Array } | null;
    disposed: boolean;
}

function fakeLanguages() {
    const providers: Provider[] = [];
    return {
        providers,
        live: () => providers.filter(provider => !provider.disposed),
        languages: {
            registerDocumentSemanticTokensProvider(languageId: string, provider: Omit<Provider, 'languageId' | 'disposed'>) {
                const entry = { ...provider, languageId, disposed: false } as Provider;
                providers.push(entry);
                return { dispose: () => { entry.disposed = true; } };
            },
        },
    };
}

function textModel(value: string) {
    let text = value;
    return { getValue: () => text, setValue: (next: string) => { text = next; } };
}

beforeEach(() => {
    resetExternalSourceStoreForTests();
});

afterEach(() => {
    resetExternalSourceStoreForTests();
});

describe('external source store semantic tokens', () => {
    it('attaches tokens to the record for the text they describe, and notifies', () => {
        publishExternalSource({ resourceId: 'cap-1', content: CONTENT, displayName: 'string_view' });
        const listener = vi.fn();
        onExternalSourceChange('cap-1', listener);

        publishExternalSemanticTokens('cap-1', CONTENT, TOKENS);

        expect(readExternalSourceRecord('cap-1')?.semanticTokens).toBe(TOKENS);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('drops tokens for other text, a failed record, or a record that is gone', () => {
        publishExternalSemanticTokens('missing', CONTENT, TOKENS);
        expect(readExternalSourceRecord('missing')).toBeUndefined();

        publishExternalSource({ resourceId: 'cap-1', content: CONTENT, displayName: 'string_view' });
        publishExternalSemanticTokens('cap-1', 'other text', TOKENS);
        expect(readExternalSourceRecord('cap-1')?.semanticTokens).toBeUndefined();

        publishExternalSource({ resourceId: 'cap-2', content: 'expired', displayName: 'x', failure: 'expired' });
        publishExternalSemanticTokens('cap-2', 'expired', TOKENS);
        expect(readExternalSourceRecord('cap-2')?.semanticTokens).toBeUndefined();
    });

    it('keeps tokens across a republish of the same text and clears them for new text', () => {
        publishExternalSource({ resourceId: 'cap-1', content: CONTENT, displayName: 'string_view' });
        publishExternalSemanticTokens('cap-1', CONTENT, TOKENS);

        publishExternalSource({ resourceId: 'cap-1', content: CONTENT, displayName: 'string_view' });
        expect(readExternalSourceRecord('cap-1')?.semanticTokens).toBe(TOKENS);

        publishExternalSource({ resourceId: 'cap-1', content: 'changed', displayName: 'string_view' });
        expect(readExternalSourceRecord('cap-1')?.semanticTokens).toBeUndefined();
    });
});

describe('registerExternalSemanticTokens', () => {
    it('serves stored tokens to its own model only, in the CoC legend', () => {
        const { languages, live } = fakeLanguages();
        const model = textModel(CONTENT);
        publishExternalSource({ resourceId: 'cap-1', content: CONTENT, displayName: 'string_view' });
        publishExternalSemanticTokens('cap-1', CONTENT, TOKENS);

        registerExternalSemanticTokens({ monaco: { languages }, languageId: 'cpp', model, resourceId: 'cap-1' });
        const [provider] = live();

        expect(provider.languageId).toBe('cpp');
        expect(provider.getLegend()).toBe(COC_SEMANTIC_TOKENS_LEGEND);
        expect(Array.from(provider.provideDocumentSemanticTokens(model)!.data)).toEqual(Array.from(TOKENS));
        // Another model of the same language with identical text is not this one.
        expect(provider.provideDocumentSemanticTokens(textModel(CONTENT))).toBeNull();
    });

    it('returns null without tokens, or when the model text no longer matches', () => {
        const { languages, live } = fakeLanguages();
        const model = textModel(CONTENT);
        publishExternalSource({ resourceId: 'cap-1', content: CONTENT, displayName: 'string_view' });
        registerExternalSemanticTokens({ monaco: { languages }, languageId: 'cpp', model, resourceId: 'cap-1' });
        const [provider] = live();

        expect(provider.provideDocumentSemanticTokens(model)).toBeNull();
        publishExternalSemanticTokens('cap-1', CONTENT, TOKENS);
        model.setValue('edited elsewhere');
        expect(provider.provideDocumentSemanticTokens(model)).toBeNull();
    });

    it('repaints when tokens arrive and stops listening once disposed', () => {
        const { languages, live } = fakeLanguages();
        const model = textModel(CONTENT);
        publishExternalSource({ resourceId: 'cap-1', content: CONTENT, displayName: 'string_view' });
        const dispose = registerExternalSemanticTokens({
            monaco: { languages }, languageId: 'cpp', model, resourceId: 'cap-1',
        });
        const [provider] = live();
        const changed = vi.fn();
        provider.onDidChange(changed);

        publishExternalSemanticTokens('cap-1', CONTENT, TOKENS);
        expect(changed).toHaveBeenCalledTimes(1);

        dispose();
        expect(live()).toHaveLength(0);
        publishExternalSource({ resourceId: 'cap-1', content: 'new', displayName: 'string_view' });
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it('does nothing on a Monaco build without semantic tokens', () => {
        const dispose = registerExternalSemanticTokens({
            monaco: { languages: {} }, languageId: 'cpp', model: textModel(CONTENT), resourceId: 'cap-1',
        });
        expect(() => dispose()).not.toThrow();
    });
});

describe('definition preview semantic tokens', () => {
    const EXTERNAL = externalResourceUri('cap-1', 'widget.hpp');

    function createMonaco() {
        const { languages, live } = fakeLanguages();
        const models = new Map<string, ReturnType<typeof makeModel>>();
        function makeModel(content: string, resource: DefinitionPreviewUri) {
            const model = {
                uri: resource,
                content,
                language: 'plaintext',
                getValue: () => model.content,
                getLanguageId: () => model.language,
                setValue: (value: string) => { model.content = value; },
                dispose: () => { models.delete(resource.toString()); },
            };
            return model;
        }
        const monaco = {
            Uri: { parse: (value: string) => ({ toString: () => value }) },
            languages,
            editor: {
                getModel: (resource: DefinitionPreviewUri) => models.get(resource.toString()) ?? null,
                setModelLanguage: (model: { language: string }, languageId: string) => { model.language = languageId; },
                createModel: (content: string, _language: string | undefined, resource: DefinitionPreviewUri) => {
                    const model = makeModel(content, resource);
                    models.set(resource.toString(), model);
                    return model;
                },
            },
        };
        return { monaco, live, model: (uri: string) => models.get(uri) };
    }

    function source(
        monaco: ReturnType<typeof createMonaco>['monaco'],
        readTokens: (resourceId: string, signal: AbortSignal) => Promise<Uint32Array | null>,
        readSource = vi.fn().mockResolvedValue({ content: CONTENT, displayName: 'widget.hpp' }),
    ) {
        return registerDefinitionPreviewSource({
            monaco,
            workspaceId: 'ws-1',
            load: vi.fn(),
            readExternalSource: readSource,
            readExternalSemanticTokens: readTokens,
            languageForFileName: (name: string) => (name.endsWith('.hpp') ? 'cpp' : 'plaintext'),
        });
    }

    it('fetches tokens through the same capability and colors the Peek model from the store', async () => {
        const { monaco, live, model } = createMonaco();
        const readTokens = vi.fn().mockResolvedValue(TOKENS);
        const preview = source(monaco, readTokens);

        await preview.prepare(EXTERNAL, new AbortController().signal, undefined, true);
        await vi.waitFor(() => expect(readExternalSourceRecord('cap-1')?.semanticTokens).toBe(TOKENS));

        expect(readTokens).toHaveBeenCalledWith('cap-1', expect.any(AbortSignal));
        const [provider] = live();
        expect(provider.languageId).toBe('cpp');
        expect(Array.from(provider.provideDocumentSemanticTokens(model(EXTERNAL)!)!.data)).toEqual(Array.from(TOKENS));
    });

    it('asks for no tokens when the read failed', async () => {
        const { monaco } = createMonaco();
        const readTokens = vi.fn();
        const preview = source(monaco, readTokens, vi.fn().mockRejectedValue(new Error('expired')));

        await preview.prepare(EXTERNAL, new AbortController().signal, undefined, true);

        expect(readTokens).not.toHaveBeenCalled();
        expect(readExternalSourceRecord('cap-1')?.semanticTokens).toBeUndefined();
    });

    it('keeps basic colors when the server cannot analyze the file', async () => {
        const { monaco, live, model } = createMonaco();
        const preview = source(monaco, vi.fn().mockRejectedValue(new Error('failed')));

        await preview.prepare(EXTERNAL, new AbortController().signal, undefined, true);
        await Promise.resolve();

        expect(readExternalSourceRecord('cap-1')?.content).toBe(CONTENT);
        expect(live()[0].provideDocumentSemanticTokens(model(EXTERNAL)!)).toBeNull();
    });

    it('cancels the token request and removes the provider when the source is disposed', async () => {
        const { monaco, live } = createMonaco();
        let signal: AbortSignal | undefined;
        let answer!: (tokens: Uint32Array) => void;
        const preview = source(monaco, (_id, requestSignal) => {
            signal = requestSignal;
            return new Promise(resolve => { answer = resolve; });
        });

        await preview.prepare(EXTERNAL, new AbortController().signal, undefined, true);
        expect(live()).toHaveLength(1);
        preview.dispose();
        answer(TOKENS);
        await Promise.resolve();

        expect(signal?.aborted).toBe(true);
        expect(live()).toHaveLength(0);
        // The record Peek published stays for the tab, without late tokens.
        expect(readExternalSourceRecord('cap-1')?.semanticTokens).toBeUndefined();
    });

    it('hands tokens that arrived to the tab after Peek is gone', async () => {
        const { monaco } = createMonaco();
        const preview = source(monaco, vi.fn().mockResolvedValue(TOKENS));

        await preview.prepare(EXTERNAL, new AbortController().signal, undefined, true);
        await vi.waitFor(() => expect(readExternalSourceRecord('cap-1')?.semanticTokens).toBe(TOKENS));
        preview.dispose();

        // The tab registers against its own model from the same record.
        const { languages, live } = fakeLanguages();
        const tabModel = textModel(CONTENT);
        registerExternalSemanticTokens({ monaco: { languages }, languageId: 'cpp', model: tabModel, resourceId: 'cap-1' });
        expect(live()[0].provideDocumentSemanticTokens(tabModel)).not.toBeNull();
    });
});
