/**
 * Semantic tokens: legend translation, capability reading, theme rules, and
 * the Monaco provider registered over a live language document.
 *
 * The provider tests run the real document store and registration code over
 * the fake transport; Monaco is a recorder that hands providers back so the
 * test can call them the way the editor would.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageDocumentStore } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import {
    registerLanguageProviders,
    selectSemanticTokensServer,
    type MonacoLike,
    type ProviderCancellationToken,
    type ProviderDisposable,
    type ProviderModel,
} from '../../../../src/server/spa/client/react/features/language-servers/languageProviders';
import {
    COC_SEMANTIC_TOKENS_LEGEND,
    installSemanticTokenThemes,
    readSemanticTokensSupport,
    semanticThemeRules,
    semanticTokensFingerprint,
    translateSemanticTokens,
    type SemanticThemeMonaco,
} from '../../../../src/server/spa/client/react/features/language-servers/semanticTokens';
import { FakeClient, readyState } from './fakeLanguageTransport';

const CLANGD_LEGEND = {
    // clangd's own order, with its non-standard entries mixed in.
    tokenTypes: ['variable', 'parameter', 'function', 'method', 'class', 'unknown', 'operator', 'comment', 'type'],
    tokenModifiers: ['declaration', 'definition', 'readonly', 'static'],
};

function cocType(name: string): number {
    return COC_SEMANTIC_TOKENS_LEGEND.tokenTypes.indexOf(`lsp.${name}`);
}

describe('readSemanticTokensSupport', () => {
    it('reads the legend and both request modes from initialize capabilities', () => {
        const support = readSemanticTokensSupport(readyState({
            semanticTokensProvider: { legend: CLANGD_LEGEND, full: { delta: true }, range: true },
        }));
        expect(support).toEqual({ legend: CLANGD_LEGEND, full: true, range: true });
    });

    it('accepts a range-only server', () => {
        const support = readSemanticTokensSupport(readyState({
            semanticTokensProvider: { legend: CLANGD_LEGEND, range: {} },
        }));
        expect(support).toMatchObject({ full: false, range: true });
    });

    it('falls back to a dynamic registration', () => {
        const state = {
            ...readyState({}),
            dynamicRegistrations: [
                { id: '1', method: 'textDocument/hover' },
                { id: '2', method: 'textDocument/semanticTokens', registerOptions: { legend: CLANGD_LEGEND, full: true } },
            ],
        };
        expect(readSemanticTokensSupport(state)).toMatchObject({ full: true, range: false });
    });

    it('refuses missing, malformed and mode-less capabilities', () => {
        expect(readSemanticTokensSupport(null)).toBeNull();
        expect(readSemanticTokensSupport(readyState({}))).toBeNull();
        expect(readSemanticTokensSupport(readyState({ semanticTokensProvider: true }))).toBeNull();
        expect(readSemanticTokensSupport(readyState({
            semanticTokensProvider: { legend: { tokenTypes: [1, 2] }, full: true },
        }))).toBeNull();
        expect(readSemanticTokensSupport(readyState({
            semanticTokensProvider: { legend: { tokenTypes: [] }, full: true },
        }))).toBeNull();
        expect(readSemanticTokensSupport(readyState({
            semanticTokensProvider: { legend: { tokenTypes: ['class'], tokenModifiers: 'x' }, full: true },
        }))).toBeNull();
        expect(readSemanticTokensSupport(readyState({
            semanticTokensProvider: { legend: CLANGD_LEGEND, full: false },
        }))).toBeNull();
    });

    it('fingerprints the parts a registration depends on', () => {
        const full = readSemanticTokensSupport(readyState({ semanticTokensProvider: { legend: CLANGD_LEGEND, full: true } }));
        const range = readSemanticTokensSupport(readyState({ semanticTokensProvider: { legend: CLANGD_LEGEND, range: true } }));
        expect(semanticTokensFingerprint(null)).toBe('none');
        expect(semanticTokensFingerprint(full)).not.toBe(semanticTokensFingerprint(range));
        expect(semanticTokensFingerprint(full)).toBe(semanticTokensFingerprint({ ...full!, legend: { ...CLANGD_LEGEND } }));
    });
});

describe('translateSemanticTokens', () => {
    it('re-encodes styled tokens against the CoC legend and keeps positions', () => {
        // line 0 col 6 "Widget" class; line 2 col 4 "gadget" variable+readonly; line 2 col 11 "run" function
        const data = [
            0, 6, 6, 4, 0,
            2, 4, 6, 0, 0b100,
            0, 7, 3, 2, 0b1,
        ];
        const out = translateSemanticTokens(data, CLANGD_LEGEND)!;
        expect(Array.from(out)).toEqual([
            0, 6, 6, cocType('class'), 0,
            2, 4, 6, cocType('variable'), 0b1,
            0, 7, 3, cocType('function'), 0,
        ]);
    });

    it('drops unstyled types and re-bases the next token on the last kept one', () => {
        const data = [
            0, 2, 1, 6, 0, // operator at (0,2): dropped
            0, 3, 4, 4, 0, // class at (0,5)
            1, 0, 9, 7, 0, // comment at (1,0): dropped
            0, 4, 2, 5, 0, // unknown at (1,4): dropped
            0, 3, 3, 8, 0, // type at (1,7)
        ];
        expect(Array.from(translateSemanticTokens(data, CLANGD_LEGEND)!)).toEqual([
            0, 5, 4, cocType('class'), 0,
            1, 7, 3, cocType('type'), 0,
        ]);
    });

    it('skips out-of-range type indices and empty tokens', () => {
        const data = [0, 0, 3, 99, 0, 0, 4, 0, 4, 0, 0, 1, 2, 4, 0];
        expect(Array.from(translateSemanticTokens(data, CLANGD_LEGEND)!)).toEqual([0, 5, 2, cocType('class'), 0]);
    });

    it('accepts a Uint32Array and returns an empty result for no tokens', () => {
        expect(Array.from(translateSemanticTokens(new Uint32Array([0, 1, 2, 4, 0]), CLANGD_LEGEND)!))
            .toEqual([0, 1, 2, cocType('class'), 0]);
        expect(Array.from(translateSemanticTokens([], CLANGD_LEGEND)!)).toEqual([]);
    });

    it('refuses malformed data', () => {
        expect(translateSemanticTokens(undefined, CLANGD_LEGEND)).toBeNull();
        expect(translateSemanticTokens('0,1,2,3,4', CLANGD_LEGEND)).toBeNull();
        expect(translateSemanticTokens([0, 1, 2, 3], CLANGD_LEGEND)).toBeNull();
        expect(translateSemanticTokens([0, 1, 2, 3, -1], CLANGD_LEGEND)).toBeNull();
        expect(translateSemanticTokens([0, 1, 2.5, 3, 0], CLANGD_LEGEND)).toBeNull();
        expect(translateSemanticTokens([0, 1, '2', 3, 0], CLANGD_LEGEND)).toBeNull();
        expect(translateSemanticTokens([0, 1, 2, 3, 2 ** 32], CLANGD_LEGEND)).toBeNull();
    });
});

describe('semantic token themes', () => {
    it('gives every CoC legend type a rule in both themes, with different colors per theme', () => {
        const light = semanticThemeRules('vs');
        const dark = semanticThemeRules('vs-dark');
        for (const type of COC_SEMANTIC_TOKENS_LEGEND.tokenTypes) {
            expect(light.some(rule => rule.token === type)).toBe(true);
            expect(dark.some(rule => rule.token === type)).toBe(true);
        }
        const lightClass = light.find(rule => rule.token === 'lsp.class')!.foreground;
        const darkClass = dark.find(rule => rule.token === 'lsp.class')!.foreground;
        expect(lightClass).not.toBe(darkClass);
        expect(light.find(rule => rule.token === 'lsp.variable')!.foreground).not.toBe(lightClass);
    });

    it('only ever names prefixed tokens, so Monarch tokens are never recolored', () => {
        for (const rule of [...semanticThemeRules('vs'), ...semanticThemeRules('vs-dark')]) {
            expect(rule.token.startsWith('lsp.')).toBe(true);
        }
    });

    it('extends the built-in themes in place', () => {
        const defined: Array<{ name: string; base: string; inherit: boolean }> = [];
        const monaco: SemanticThemeMonaco = {
            editor: { defineTheme: (name, data) => { defined.push({ name, base: data.base, inherit: data.inherit }); } },
        };
        installSemanticTokenThemes(monaco);
        expect(defined).toEqual([
            { name: 'vs', base: 'vs', inherit: true },
            { name: 'vs-dark', base: 'vs-dark', inherit: true },
        ]);
    });
});

// ============================================================================
// Provider registration
// ============================================================================

interface Registered {
    kind: string;
    languageId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider: any;
    disposed: boolean;
}

class FakeMonaco {
    readonly registered: Registered[] = [];
    readonly languages = {
        registerHoverProvider: (id: string, p: unknown) => this.record('hover', id, p),
        registerDefinitionProvider: (id: string, p: unknown) => this.record('definition', id, p),
        registerReferenceProvider: (id: string, p: unknown) => this.record('references', id, p),
        registerCompletionItemProvider: (id: string, p: unknown) => this.record('completion', id, p),
        registerSignatureHelpProvider: (id: string, p: unknown) => this.record('signatureHelp', id, p),
        registerDocumentSemanticTokensProvider: (id: string, p: unknown) => this.record('semanticFull', id, p),
        registerDocumentRangeSemanticTokensProvider: (id: string, p: unknown) => this.record('semanticRange', id, p),
    };
    readonly Uri = { parse: (value: string) => ({ toString: () => value }) };

    private record(kind: string, languageId: string, provider: unknown): ProviderDisposable {
        const entry: Registered = { kind, languageId, provider, disposed: false };
        this.registered.push(entry);
        return { dispose: () => { entry.disposed = true; } };
    }

    live(kind: string): Registered[] {
        return this.registered.filter(entry => entry.kind === kind && !entry.disposed);
    }

    asMonaco(): MonacoLike {
        return this as unknown as MonacoLike;
    }
}

const TEXT = 'Widget gadget;\n';

function model(uri: string, text = TEXT): ProviderModel & { text: string } {
    const target = {
        text,
        uri: { toString: () => uri },
        getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
        getValue: () => target.text,
    };
    return target;
}

function cancellable(): { token: ProviderCancellationToken; cancel: () => void } {
    const listeners: Array<() => void> = [];
    const token = {
        isCancellationRequested: false,
        onCancellationRequested: (listener: () => void) => {
            listeners.push(listener);
            return { dispose: () => {} };
        },
    };
    return {
        token,
        cancel: () => {
            token.isCancellationRequested = true;
            for (const listener of listeners) listener();
        },
    };
}

function token(): ProviderCancellationToken {
    return cancellable().token;
}

const FULL = { legend: CLANGD_LEGEND, full: true, range: true };
const RANGE_ONLY = { legend: CLANGD_LEGEND, range: true };

function clangdState(semanticTokensProvider: unknown, generation = 1) {
    return {
        ...readyState({ textDocumentSync: 1, ...(semanticTokensProvider ? { semanticTokensProvider } : {}) }, generation),
        definitionId: 'clangd',
    };
}

describe('semantic tokens provider', () => {
    let client: FakeClient;
    let store: LanguageDocumentStore;
    let monaco: FakeMonaco;
    // Registrations claim their model URI for semantic tokens; every test
    // releases its own so the next one starts unclaimed.
    let registrations: ProviderDisposable[] = [];

    function register(options: Parameters<typeof registerLanguageProviders>[0]): ProviderDisposable {
        const registration = registerLanguageProviders(options);
        registrations.push(registration);
        return registration;
    }

    function open(options: { semantic?: unknown; path?: string; text?: string } = {}) {
        const path = options.path ?? 'src/a.cpp';
        const view = store.open({ path, text: options.text ?? TEXT });
        const attachment = client.get(path);
        attachment.attach({
            attachmentId: 'att-clangd',
            sessionKey: 'clangd-key',
            definitionId: 'clangd',
            languageId: 'cpp',
            state: clangdState('semantic' in options ? options.semantic : FULL),
        });
        const target = model(view.uri, options.text ?? TEXT);
        const registration = register({ monaco: monaco.asMonaco(), model: target, view, languageId: 'cpp' });
        return { view, attachment, target, registration };
    }

    beforeEach(() => {
        client = new FakeClient();
        store = new LanguageDocumentStore({ workspaceId: 'ws-1', client: client.asClient() });
        monaco = new FakeMonaco();
    });

    afterEach(() => {
        for (const registration of registrations) registration.dispose();
        registrations = [];
    });

    it('registers a full-document provider with the CoC legend when the server offers full', () => {
        open();
        expect(monaco.live('semanticFull')).toHaveLength(1);
        expect(monaco.live('semanticRange')).toHaveLength(0);
        expect(monaco.live('semanticFull')[0].languageId).toBe('cpp');
        expect(monaco.live('semanticFull')[0].provider.getLegend()).toBe(COC_SEMANTIC_TOKENS_LEGEND);
    });

    it('registers a range provider when range is the only mode', async () => {
        const { attachment, target } = open({ semantic: RANGE_ONLY });
        expect(monaco.live('semanticFull')).toHaveLength(0);
        const [range] = monaco.live('semanticRange');
        attachment.respondTo('clangd', 'textDocument/semanticTokens/range', () => ({ data: [0, 0, 6, 4, 0] }));

        const result = await range.provider.provideDocumentRangeSemanticTokens(
            target,
            { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 },
            token(),
        );

        expect(Array.from(result.data)).toEqual([0, 0, 6, cocType('class'), 0]);
        expect(attachment.lastRequest('textDocument/semanticTokens/range')?.params).toEqual({
            textDocument: { uri: 'coc-file://ws-1/src/a.cpp' },
            range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
        });
    });

    it('registers nothing without the capability and keeps the other features', () => {
        open({ semantic: undefined });
        expect(monaco.live('semanticFull')).toHaveLength(0);
        expect(monaco.live('semanticRange')).toHaveLength(0);
    });

    it('requests full tokens from the selected server and translates them', async () => {
        const { attachment, target } = open();
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => ({
            resultId: '1',
            data: [0, 0, 6, 4, 0, 0, 7, 6, 0, 0b100],
        }));

        const result = await monaco.live('semanticFull')[0].provider.provideDocumentSemanticTokens(target, null, token());

        expect(Array.from(result.data)).toEqual([0, 0, 6, cocType('class'), 0, 0, 7, 6, cocType('variable'), 1]);
        const request = attachment.lastRequest('textDocument/semanticTokens/full')!;
        expect(request.definitionId).toBe('clangd');
        expect(request.params).toEqual({ textDocument: { uri: 'coc-file://ws-1/src/a.cpp' } });
    });

    it('prefers the first server in host order that advertises tokens', () => {
        const view = store.open({ path: 'src/b.cpp', text: TEXT });
        const attachment = client.get('src/b.cpp');
        attachment.attach({
            attachmentId: 'att-symbols', sessionKey: 'symbols-key', definitionId: 'coc-symbols',
            state: { ...readyState({ definitionProvider: true }), definitionId: 'coc-symbols' },
        });
        attachment.attach({
            attachmentId: 'att-clangd', sessionKey: 'clangd-key', definitionId: 'clangd',
            state: clangdState(FULL),
        });
        attachment.attach({
            attachmentId: 'att-other', sessionKey: 'other-key', definitionId: 'other',
            state: { ...readyState({ semanticTokensProvider: FULL }), definitionId: 'other' },
        });
        expect(selectSemanticTokensServer(view)).toMatchObject({ definitionId: 'clangd', sessionKey: 'clangd-key' });
    });

    it('returns null for a model it was not registered for, without asking', async () => {
        const { attachment } = open();
        const other = model('inmemory://model/9');
        expect(await monaco.live('semanticFull')[0].provider.provideDocumentSemanticTokens(other, null, token()))
            .toBeNull();
        expect(attachment.lastRequest('textDocument/semanticTokens/full')).toBeUndefined();
    });

    it('never asks when the model text differs from the document buffer', async () => {
        const { attachment, target } = open();
        target.text = 'different text\n';
        expect(await monaco.live('semanticFull')[0].provider.provideDocumentSemanticTokens(target, null, token()))
            .toBeNull();
        expect(attachment.lastRequest('textDocument/semanticTokens/full')).toBeUndefined();
    });

    it('asks for the edited buffer after an update', async () => {
        const { view, attachment, target } = open();
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => ({ data: [] }));
        target.text = 'Widget renamed;\n';
        view.update(target.text);

        await monaco.live('semanticFull')[0].provider.provideDocumentSemanticTokens(target, null, token());

        expect(attachment.lastRequest('textDocument/semanticTokens/full')).toBeDefined();
        expect(attachment.lastOf('textDocument/didChange')).toMatchObject({
            contentChanges: [{ text: 'Widget renamed;\n' }],
        });
    });

    it('returns null for a malformed reply', async () => {
        const { attachment, target } = open();
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => ({ data: [1, 2, 3] }));
        expect(await monaco.live('semanticFull')[0].provider.provideDocumentSemanticTokens(target, null, token()))
            .toBeNull();
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => null);
        expect(await monaco.live('semanticFull')[0].provider.provideDocumentSemanticTokens(target, null, token()))
            .toBeNull();
    });

    it('reports busy on a failed request so Monaco keeps the colors it has', async () => {
        const { attachment, target } = open();
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => { throw new Error('content modified'); });
        await expect(monaco.live('semanticFull')[0].provider.provideDocumentSemanticTokens(target, null, token()))
            .rejects.toThrow(/busy/);
    });

    it('aborts the request when Monaco cancels and discards the answer', async () => {
        const { attachment, target } = open();
        let release!: () => void;
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => new Promise((resolve) => {
            release = () => resolve({ data: [0, 0, 6, 4, 0] });
        }));
        const { token: cancelToken, cancel } = cancellable();

        const pending = monaco.live('semanticFull')[0].provider.provideDocumentSemanticTokens(target, null, cancelToken);
        await Promise.resolve();
        cancel();
        release();

        expect(await pending).toBeNull();
        expect(attachment.lastRequest('textDocument/semanticTokens/full')?.signal?.aborted).toBe(true);
    });

    it('never asks when the token is already cancelled', async () => {
        const { attachment, target } = open();
        const { token: cancelToken, cancel } = cancellable();
        cancel();
        expect(await monaco.live('semanticFull')[0].provider.provideDocumentSemanticTokens(target, null, cancelToken))
            .toBeNull();
        expect(attachment.lastRequest('textDocument/semanticTokens/full')).toBeUndefined();
    });

    it('discards an answer from a server that was replaced while the request ran', async () => {
        const { attachment, target } = open();
        let release!: () => void;
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => new Promise((resolve) => {
            release = () => resolve({ data: [0, 0, 6, 4, 0] });
        }));
        const provider = monaco.live('semanticFull')[0].provider;
        const pending = provider.provideDocumentSemanticTokens(target, null, token());
        await Promise.resolve();

        attachment.status(clangdState(RANGE_ONLY, 2));
        release();

        expect(await pending).toBeNull();
        expect(monaco.live('semanticFull')).toHaveLength(0);
        expect(monaco.live('semanticRange')).toHaveLength(1);
    });

    it('removes the provider when the server stops advertising tokens or detaches', () => {
        const { attachment } = open();
        attachment.status(clangdState(undefined, 1));
        expect(monaco.live('semanticFull')).toHaveLength(0);

        attachment.status(clangdState(FULL, 1));
        expect(monaco.live('semanticFull')).toHaveLength(1);

        attachment.detach();
        expect(monaco.live('semanticFull')).toHaveLength(0);
    });

    it('leaves the registration alone for status churn', () => {
        const { attachment } = open();
        const before = monaco.registered.length;
        attachment.status({ ...clangdState(FULL), status: 'indexing' });
        expect(monaco.registered).toHaveLength(before);
    });

    it('fires onDidChange for a refresh from the selected server only', () => {
        const { attachment } = open();
        let changes = 0;
        monaco.live('semanticFull')[0].provider.onDidChange(() => { changes += 1; });

        attachment.notify('workspace/semanticTokens/refresh', undefined);
        expect(changes).toBe(1);

        attachment.attach({
            attachmentId: 'att-other', sessionKey: 'other-key', definitionId: 'other',
            state: { ...readyState({}), definitionId: 'other' },
        });
        const afterAttach = changes;
        attachment.notify('workspace/semanticTokens/refresh', undefined, 'other');
        attachment.notify('textDocument/publishDiagnostics', { uri: 'x', diagnostics: [] });
        expect(changes).toBe(afterAttach);
    });

    it('fires onDidChange when a restarted server receives the buffer again', () => {
        const { attachment } = open();
        let changes = 0;
        monaco.live('semanticFull')[0].provider.onDidChange(() => { changes += 1; });

        attachment.status(clangdState(FULL, 2));

        expect(changes).toBe(1);
    });

    it('stops answering and listening once disposed', async () => {
        const { attachment, target, registration } = open();
        const provider = monaco.live('semanticFull')[0].provider;
        let changes = 0;
        provider.onDidChange(() => { changes += 1; });

        registration.dispose();

        expect(monaco.live('semanticFull')).toHaveLength(0);
        attachment.notify('workspace/semanticTokens/refresh', undefined);
        expect(changes).toBe(0);
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => ({ data: [0, 0, 6, 4, 0] }));
        expect(await provider.provideDocumentSemanticTokens(target, null, token())).toBeNull();
    });

    it('asks once for a model shared by two registrations and hands over on dispose', async () => {
        const { view, attachment, target, registration } = open();
        const second = register({ monaco: monaco.asMonaco(), model: target, view, languageId: 'cpp' });
        const [first, other] = monaco.live('semanticFull');
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => ({ data: [0, 0, 6, 4, 0] }));
        let promoted = 0;
        other.provider.onDidChange(() => { promoted += 1; });

        expect(await first.provider.provideDocumentSemanticTokens(target, null, token())).not.toBeNull();
        expect(await other.provider.provideDocumentSemanticTokens(target, null, token())).toBeNull();
        expect(attachment.requests.filter(request => request.method === 'textDocument/semanticTokens/full'))
            .toHaveLength(1);

        registration.dispose();

        expect(promoted).toBe(1);
        expect(await other.provider.provideDocumentSemanticTokens(target, null, token())).not.toBeNull();
        second.dispose();
    });

    it('keeps workspaces and clones apart: each document asks only its own transport', async () => {
        const otherClient = new FakeClient('ws-2');
        const otherStore = new LanguageDocumentStore({ workspaceId: 'ws-2', client: otherClient.asClient() });
        const { attachment, target } = open();
        const otherView = otherStore.open({ path: 'src/a.cpp', text: TEXT });
        const otherAttachment = otherClient.get('src/a.cpp');
        otherAttachment.attach({
            attachmentId: 'att-clangd', sessionKey: 'clangd-key', definitionId: 'clangd', state: clangdState(FULL),
        });
        const otherTarget = model(otherView.uri);
        register({ monaco: monaco.asMonaco(), model: otherTarget, view: otherView, languageId: 'cpp' });
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => ({ data: [0, 0, 6, 4, 0] }));
        otherAttachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => ({ data: [0, 7, 6, 0, 0] }));
        const [mine, theirs] = monaco.live('semanticFull');

        // Each provider refuses the other workspace's model outright.
        expect(await mine.provider.provideDocumentSemanticTokens(otherTarget, null, token())).toBeNull();
        expect(await theirs.provider.provideDocumentSemanticTokens(target, null, token())).toBeNull();
        expect(Array.from((await theirs.provider.provideDocumentSemanticTokens(otherTarget, null, token())).data))
            .toEqual([0, 7, 6, cocType('variable'), 0]);
        expect(attachment.requests.filter(request => request.method === 'textDocument/semanticTokens/full'))
            .toHaveLength(0);
        expect(otherAttachment.lastRequest('textDocument/semanticTokens/full')?.params)
            .toEqual({ textDocument: { uri: 'coc-file://ws-2/src/a.cpp' } });
    });

    it('skips semantic tokens on a Monaco without the registration API', () => {
        const legacy = new FakeMonaco();
        const languages = legacy.languages as Partial<typeof legacy.languages>;
        delete languages.registerDocumentSemanticTokensProvider;
        delete languages.registerDocumentRangeSemanticTokensProvider;
        const view = store.open({ path: 'src/c.cpp', text: TEXT });
        client.get('src/c.cpp').attach({ definitionId: 'clangd', state: clangdState(FULL) });
        expect(() => register({
            monaco: legacy.asMonaco(), model: model(view.uri), view, languageId: 'cpp',
        })).not.toThrow();
        expect(legacy.registered.some(entry => entry.kind.startsWith('semantic'))).toBe(false);
    });
});

describe('explorer editor options', () => {
    it('turn semantic coloring on, since the built-in themes leave it off', async () => {
        const { EXPLORER_EDITOR_OPTIONS } = await import(
            '../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor'
        );
        expect(EXPLORER_EDITOR_OPTIONS['semanticHighlighting.enabled']).toBe(true);
    });
});
