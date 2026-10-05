/**
 * AC-06 provider wiring on the diff's working-copy model: hover and
 * definition providers answer through the shared document, go-to-definition
 * leaves the file through `editorNavigation`, and cleanup removes everything.
 * Monaco is described structurally; the provider code under test is real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountDiffLanguageModel } from '../../../../../../src/server/spa/client/react/features/git/diff/diffLanguageMount';
import type { DiffLanguageMountContext } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffController';
import {
    LanguageDocumentStore,
    browserDocumentUri,
} from '../../../../../../src/server/spa/client/react/features/language-servers/documentStore';
import {
    installLanguageEditorOpener,
    resetEditorNavigationForTests,
} from '../../../../../../src/server/spa/client/react/features/language-servers/editorNavigation';
import { COC_SEMANTIC_TOKENS_LEGEND } from '../../../../../../src/server/spa/client/react/features/language-servers/semanticTokens';
import { FakeClient, readyState } from '../../../language-servers/fakeLanguageTransport';

const URI = browserDocumentUri('ws-1', 'src/a.ts');
const CAPS = { textDocumentSync: 1, hoverProvider: true, definitionProvider: true };

interface Registration { kind: string; languageId: string; provider: any; disposed: boolean }

function fakeMonaco() {
    const registrations: Registration[] = [];
    const register = (kind: string) => (languageId: string, provider: unknown) => {
        const entry: Registration = { kind, languageId, provider, disposed: false };
        registrations.push(entry);
        return { dispose: () => { entry.disposed = true; } };
    };
    let opener: any = null;
    const monaco = {
        Uri: { parse: (value: string) => ({ toString: () => value }) },
        languages: {
            registerHoverProvider: register('hover'),
            registerDefinitionProvider: register('definition'),
            registerReferenceProvider: register('references'),
            registerCompletionItemProvider: register('completion'),
            registerSignatureHelpProvider: register('signatureHelp'),
            registerDocumentSemanticTokensProvider: register('semanticFull'),
            registerDocumentRangeSemanticTokensProvider: register('semanticRange'),
        },
        editor: {
            getModel: () => null,
            registerEditorOpener: (o: unknown) => { opener = o; return { dispose: () => { opener = null; } }; },
        },
    };
    const live = () => registrations.filter(r => !r.disposed);
    return { monaco, registrations, live, opener: () => opener };
}

function fakeEditor() {
    const disposable = { dispose: vi.fn() };
    return {
        disposable,
        editor: {
            createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
            onDidChangeModelContent: () => disposable,
            onDidScrollChange: () => disposable,
            onKeyDown: () => disposable,
            onKeyUp: () => disposable,
            onMouseLeave: () => disposable,
            onMouseMove: () => disposable,
        },
    };
}

function model(uri = URI) {
    return {
        uri: { toString: () => uri },
        getLanguageId: () => 'typescript',
        getWordUntilPosition: () => ({ startColumn: 1, endColumn: 4 }),
        getWordAtPosition: () => null,
    };
}

const token = () => ({ isCancellationRequested: false, onCancellationRequested: () => undefined });

describe('mountDiffLanguageModel', () => {
    let client: FakeClient;
    let store: LanguageDocumentStore;

    beforeEach(() => {
        resetEditorNavigationForTests();
        client = new FakeClient();
        store = new LanguageDocumentStore({ workspaceId: 'ws-1', client: client.asClient() });
    });

    function mount(onNavigate?: (target: any) => boolean | void) {
        const view = store.open({ path: 'src/a.ts', text: 'const a = 1;\n' });
        client.get('src/a.ts').attach({ state: readyState(CAPS) });
        const fm = fakeMonaco();
        const fe = fakeEditor();
        const m = model();
        const context = { editor: fe.editor, monaco: fm.monaco, model: m } as unknown as DiffLanguageMountContext;
        const cleanup = mountDiffLanguageModel({ ...context, view, workspaceId: 'ws-1', languageId: 'typescript', onNavigate, loadSource: async () => '' });
        return { view, fm, fe, m, cleanup };
    }

    it('registers hover and definition providers for the model language', () => {
        const { fm } = mount();
        expect(fm.live().map(r => `${r.kind}:${r.languageId}`)).toEqual(['hover:typescript', 'definition:typescript']);
    });

    it('hover goes to the server through the shared document and only for this model', async () => {
        const { fm, m } = mount();
        const attachment = client.get('src/a.ts');
        attachment.respond('textDocument/hover', () => ({ contents: { kind: 'markdown', value: '**a**: number' } }));
        const hover = fm.live().find(r => r.kind === 'hover')!.provider;

        const answer = await hover.provideHover(m, { lineNumber: 1, column: 7 }, token());
        expect(answer?.contents?.[0]?.value).toBe('**a**: number');
        expect(attachment.lastRequest('textDocument/hover')?.params).toMatchObject({
            textDocument: { uri: URI },
            position: { line: 0, character: 6 },
        });

        // A model with another URI (e.g. the synthetic index side) gets nothing.
        const other = model('coc-diff-ref://ws-1/INDEX/src/a.ts');
        expect(await hover.provideHover(other, { lineNumber: 1, column: 7 }, token())).toBeNull();
    });

    it('go-to-definition in another file of this workspace navigates through editorNavigation', () => {
        const onNavigate = vi.fn(() => true);
        const { fm, m } = mount(onNavigate);
        installLanguageEditorOpener(fm.monaco as any);
        const opener = fm.opener();
        const source = { getModel: () => m };

        const handled = opener.openCodeEditor(source, { toString: () => browserDocumentUri('ws-1', 'src/b.ts') }, { startLineNumber: 4, startColumn: 2 });
        expect(handled).toBe(true);
        expect(onNavigate).toHaveBeenCalledWith({ workspaceId: 'ws-1', path: 'src/b.ts', line: 4, column: 2 });

        // Same file: Monaco moves the cursor itself.
        onNavigate.mockClear();
        expect(opener.openCodeEditor(source, { toString: () => URI }, { lineNumber: 2, column: 1 })).toBe(false);
        // Another workspace: declined, never opened in this repo.
        expect(opener.openCodeEditor(source, { toString: () => browserDocumentUri('ws-2', 'src/b.ts') }, { lineNumber: 1, column: 1 })).toBe(false);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('declines cross-file jumps when the host has no navigation target', () => {
        const { fm, m } = mount();
        installLanguageEditorOpener(fm.monaco as any);
        expect(fm.opener().openCodeEditor({ getModel: () => m }, { toString: () => browserDocumentUri('ws-1', 'src/b.ts') }, {})).toBe(false);
    });

    it('cleanup disposes every provider and the navigator', () => {
        const onNavigate = vi.fn(() => true);
        const { fm, m, cleanup } = mount(onNavigate);
        installLanguageEditorOpener(fm.monaco as any);
        cleanup();
        expect(fm.live()).toEqual([]);
        expect(fm.opener().openCodeEditor({ getModel: () => m }, { toString: () => browserDocumentUri('ws-1', 'src/b.ts') }, {})).toBe(false);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('registers nothing for features the server does not advertise', () => {
        const view = store.open({ path: 'src/a.ts', text: 'x' });
        client.get('src/a.ts').attach({ state: readyState({ textDocumentSync: 1 }) });
        const fm = fakeMonaco();
        const context = { editor: fakeEditor().editor, monaco: fm.monaco, model: model() } as unknown as DiffLanguageMountContext;
        const cleanup = mountDiffLanguageModel({ ...context, view, workspaceId: 'ws-1', languageId: 'typescript', loadSource: async () => '' });
        expect(fm.live()).toEqual([]);
        cleanup();
    });
});

/**
 * AC-02: semantic colors on the working-copy side of an eligible diff. The
 * provider is registered per language id, so these tests prove it only ever
 * answers for the mounted model and never touches the model's text.
 */
describe('mountDiffLanguageModel — semantic tokens', () => {
    const CPP_URI = browserDocumentUri('ws-1', 'src/a.cpp');
    const CPP_TEXT = 'class Widget {};\nWidget w;\n';
    const LEGEND = { tokenTypes: ['variable', 'class'], tokenModifiers: [] };
    const SEMANTIC_CAPS = { textDocumentSync: 1, semanticTokensProvider: { legend: LEGEND, full: true } };
    const classIndex = COC_SEMANTIC_TOKENS_LEGEND.tokenTypes.indexOf('lsp.class');

    let client: FakeClient;
    let store: LanguageDocumentStore;
    let cleanups: Array<() => void> = [];

    beforeEach(() => {
        resetEditorNavigationForTests();
        client = new FakeClient();
        store = new LanguageDocumentStore({ workspaceId: 'ws-1', client: client.asClient() });
    });

    // Semantic claims are keyed by model URI across the page; release them all.
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    function cppModel(uri = CPP_URI, text = CPP_TEXT) {
        const target = {
            text,
            setValue: vi.fn(),
            uri: { toString: () => uri },
            getLanguageId: () => 'cpp',
            getValue: () => target.text,
            getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
            getWordAtPosition: () => null,
        };
        return target;
    }

    function open(caps: Record<string, unknown> = SEMANTIC_CAPS) {
        const view = store.open({ path: 'src/a.cpp', text: CPP_TEXT });
        const attachment = client.get('src/a.cpp');
        attachment.attach({ definitionId: 'clangd', languageId: 'cpp', state: { ...readyState(caps), definitionId: 'clangd' } });
        attachment.respondTo('clangd', 'textDocument/semanticTokens/full', () => ({ data: [0, 6, 6, 1, 0] }));
        return { view, attachment };
    }

    function mountOn(view: ReturnType<LanguageDocumentStore['open']>, m = cppModel()) {
        const fm = fakeMonaco();
        const context = { editor: fakeEditor().editor, monaco: fm.monaco, model: m } as unknown as DiffLanguageMountContext;
        const cleanup = mountDiffLanguageModel({ ...context, view, workspaceId: 'ws-1', languageId: 'cpp', loadSource: async () => '' });
        cleanups.push(cleanup);
        const semantic = () => fm.live().find(r => r.kind === 'semanticFull')?.provider;
        return { fm, m, cleanup, semantic };
    }

    it('registers one full-document provider on the modified model and colors it', async () => {
        const { view, attachment } = open();
        const { fm, m, semantic } = mountOn(view);
        expect(fm.live().filter(r => r.kind.startsWith('semantic')).map(r => `${r.kind}:${r.languageId}`)).toEqual(['semanticFull:cpp']);

        const result = await semantic().provideDocumentSemanticTokens(m, null, token());
        expect(Array.from(result.data)).toEqual([0, 6, 6, classIndex, 0]);
        expect(attachment.lastRequest('textDocument/semanticTokens/full')?.params).toEqual({ textDocument: { uri: CPP_URI } });
        expect(m.setValue).not.toHaveBeenCalled();
    });

    it('never colors the original side, a historical snapshot, or another workspace', async () => {
        const { view, attachment } = open();
        const { semantic } = mountOn(view);
        // Same text as the working copy, so only the URI check keeps them out.
        for (const uri of [
            'coc-diff-ref://ws-1/INDEX/src/a.cpp',
            'coc-diff-ref://ws-1/HEAD~1/src/a.cpp',
            browserDocumentUri('ws-2', 'src/a.cpp'),
            'inmemory://model/7',
        ]) {
            expect(await semantic().provideDocumentSemanticTokens(cppModel(uri), null, token())).toBeNull();
        }
        expect(attachment.lastRequest('textDocument/semanticTokens/full')).toBeUndefined();
    });

    it('asks nothing while the shared buffer holds unsaved text the diff model does not show', async () => {
        const { view, attachment } = open();
        const { m, semantic } = mountOn(view);
        view.update('class Gadget {};\nGadget g;\n');
        expect(await semantic().provideDocumentSemanticTokens(m, null, token())).toBeNull();
        expect(attachment.lastRequest('textDocument/semanticTokens/full')).toBeUndefined();
        expect(m.setValue).not.toHaveBeenCalled();
        expect(view.getText()).toBe('class Gadget {};\nGadget g;\n');
    });

    it('two diffs sharing a model send one request; closing the first hands over', async () => {
        const { view, attachment } = open();
        const shared = cppModel();
        const first = mountOn(view, shared);
        const second = mountOn(store.open({ path: 'src/a.cpp', text: CPP_TEXT }), shared);

        expect(await second.semantic().provideDocumentSemanticTokens(shared, null, token())).toBeNull();
        await first.semantic().provideDocumentSemanticTokens(shared, null, token());
        expect(attachment.requests.filter(r => r.method === 'textDocument/semanticTokens/full')).toHaveLength(1);

        first.cleanup();
        expect(first.fm.live()).toEqual([]);
        const handed = await second.semantic().provideDocumentSemanticTokens(shared, null, token());
        expect(Array.from(handed.data)).toEqual([0, 6, 6, classIndex, 0]);
    });

    it('registers no semantic provider without the capability and removes it on cleanup', () => {
        const plain = mountOn(open({ textDocumentSync: 1 }).view);
        expect(plain.fm.live().filter(r => r.kind.startsWith('semantic'))).toEqual([]);
        plain.cleanup();

        const { fm, cleanup } = mountOn(store.open({ path: 'src/b.cpp', text: CPP_TEXT }), cppModel(browserDocumentUri('ws-1', 'src/b.cpp')));
        client.get('src/b.cpp').attach({ definitionId: 'clangd', languageId: 'cpp', state: { ...readyState(SEMANTIC_CAPS), definitionId: 'clangd' } });
        expect(fm.live().filter(r => r.kind === 'semanticFull')).toHaveLength(1);
        cleanup();
        expect(fm.live()).toEqual([]);
    });
});
