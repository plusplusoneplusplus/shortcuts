/**
 * AC-06 provider wiring on the diff's working-copy model: hover and
 * definition providers answer through the shared document, go-to-definition
 * leaves the file through `editorNavigation`, and cleanup removes everything.
 * Monaco is described structurally; the provider code under test is real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
