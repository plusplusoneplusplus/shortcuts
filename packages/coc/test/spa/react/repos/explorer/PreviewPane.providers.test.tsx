// @vitest-environment jsdom
/**
 * AC-03: the Explorer preview pane registering Monaco language providers over
 * its live document.
 *
 * This is the first place the feature actually asks the language server a
 * question, so the suite runs the real document store, the real hook and the
 * real provider module; only the socket and Monaco itself are faked. What is
 * pinned here is the join: a live repo document gets providers registered under
 * the file's Monaco language, those providers ask *this* document, and a blob
 * that is not a live repo document gets none at all.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';
import { TRUSTED_PATH_PREFIX } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen';
import { resetLanguageDocumentStoresForTests } from '../../../../../src/server/spa/client/react/features/language-servers/documentStore';
import { MAX_FILE_VIEW_SIZE } from '../../../../../src/server/spa/client/react/shared/file-viewer/useFileContent';
import {
    SHADOW_LANGUAGE_PREFIX,
    registerShadowLanguages,
    resetShadowLanguagesForTests,
} from '../../../../../src/server/spa/client/react/features/language-servers/shadowLanguage';
import { FakeClient, readyState } from '../../language-servers/fakeLanguageTransport';
import {
    readExternalSourceRecord,
    resetExternalSourceStoreForTests,
} from '../../../../../src/server/spa/client/react/features/language-servers/externalSourceStore';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

const transport = vi.hoisted(() => ({ client: null as any }));
const cueStub = vi.hoisted(() => {
    const installed: { options: any; disposed: boolean }[] = [];
    return {
        installed,
        reset: () => { installed.length = 0; },
        live: () => installed.filter(entry => !entry.disposed),
    };
});

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/features/language-servers/languageServerClient', () => ({
    getLanguageServerClient: () => transport.client.asClient(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/language-servers/definitionLinkCue', () => ({
    installDefinitionLinkCue: (options: any) => {
        const entry = { options, disposed: false };
        cueStub.installed.push(entry);
        return { dispose: () => { entry.disposed = true; } };
    },
}));

// jsdom cannot run Monaco. This stub stands in for the editor and does the one
// thing the real editor does for this suite: once it has a model, it offers it
// to the host and takes the registration back down on unmount.
const monacoStub = vi.hoisted(() => {
    const registered: { kind: string; languageId: string; provider: any; disposed: boolean }[] = [];
    const shadowLanguages: string[] = [];
    const clearedMarkers: { owner: string; count: number }[] = [];
    const previewModels = new Map<string, any>();
    const record = (kind: string, languageId: string, provider: any) => {
        const entry = { kind, languageId, provider, disposed: false };
        registered.push(entry);
        return { dispose: () => { entry.disposed = true; } };
    };
    return {
        registered,
        shadowLanguages,
        clearedMarkers,
        reset: () => {
            registered.length = 0;
            shadowLanguages.length = 0;
            clearedMarkers.length = 0;
            previewModels.clear();
        },
        live: () => registered.filter(entry => !entry.disposed),
        provider: (kind: string) => {
            const entry = [...registered].reverse().find(item => item.kind === kind && !item.disposed);
            if (!entry) throw new Error(`No live ${kind} provider`);
            return entry.provider;
        },
        resolvePreview: (uri: string) => previewModels.get(uri) ?? null,
        namespace: {
            Uri: { parse: (value: string) => ({ toString: () => value }) },
            languages: {
                registerHoverProvider: (id: string, p: any) => record('hover', id, p),
                registerDefinitionProvider: (id: string, p: any) => record('definition', id, p),
                registerReferenceProvider: (id: string, p: any) => record('references', id, p),
                registerCompletionItemProvider: (id: string, p: any) => record('completion', id, p),
                registerSignatureHelpProvider: (id: string, p: any) => record('signatureHelp', id, p),
                // Reached through `registerShadowLanguages`, which the real
                // `monaco-setup` module cannot run under jsdom.
                register: ({ id }: { id: string }) => { shadowLanguages.push(id); },
                setLanguageConfiguration: () => undefined,
                setMonarchTokensProvider: () => undefined,
            },
            editor: {
                setModelLanguage: (model: any, languageId: string) => { model.languageId = languageId; },
                setModelMarkers: (_model: any, owner: string, markers: unknown[]) => {
                    clearedMarkers.push({ owner, count: markers.length });
                },
                getModel: (resource: { toString(): string }) => previewModels.get(resource.toString()) ?? null,
                createModel: (content: string, _language: string | undefined, resource: { toString(): string }) => {
                    const model = {
                        uri: resource,
                        content,
                        setValue: (value: string) => { model.content = value; },
                    };
                    previewModels.set(resource.toString(), model);
                    return model;
                },
            },
        },
        // The pane builds a real navigation controller off this editor the
        // moment a model mounts, so the stub has to answer the six calls that
        // controller makes. A fixed cursor is enough: this suite is about
        // providers, and the navigation behaviour itself is pinned in
        // `PreviewPane.navigation.test.tsx`.
        editor: {
            updateOptions: vi.fn(),
            getSelection: () => ({
                selectionStartLineNumber: 1,
                selectionStartColumn: 1,
                positionLineNumber: 1,
                positionColumn: 1,
            }),
            saveViewState: () => ({ cursorState: [], viewState: {}, contributionsState: {} }),
            restoreViewState: () => undefined,
            setSelection: () => undefined,
            onDidChangeCursorSelection: () => ({ dispose: () => undefined }),
            onDidScrollChange: () => ({ dispose: () => undefined }),
        },
        model: {
            languageId: 'typescript',
            uri: { toString: () => 'coc-file://ws-1/src/a.ts' },
            getWordUntilPosition: () => ({ startColumn: 1, endColumn: 5 }),
            getLanguageId(): string { return this.languageId; },
        },
    };
});

// Only the React component is faked. Everything else the module exports —
// `createEditorNavigationController` above all — is kept real, because the pane
// calls it on model mount: replacing the whole module would leave that call
// reaching for an export the mock never defined, and every test here would die
// on a bare `<div />`.
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor')>();
    const { useEffect } = await import('react');
    return {
        ...actual,
        MonacoFileEditor: ({ value, onModelMount }: any) => {
            useEffect(() => {
                if (!onModelMount) return;
                const cleanup = onModelMount({
                    editor: monacoStub.editor,
                    monaco: monacoStub.namespace,
                    model: monacoStub.model,
                });
                return () => { cleanup?.(); };
            }, [onModelMount]);
            return <textarea data-testid="mock-monaco-textarea" value={value} readOnly />;
        },
        getMonacoLanguage: (name: string) => name.endsWith('.cpp') ? 'cpp' : 'typescript',
        LANGUAGE_MARKER_OWNER: 'coc-language-server',
    };
});

const token = { isCancellationRequested: false, onCancellationRequested: () => undefined };

/** A session advertising every feature the first release uses. */
const FULL_CAPABILITIES = {
    textDocumentSync: 1,
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    completionProvider: { triggerCharacters: ['.'] },
    signatureHelpProvider: { triggerCharacters: ['('] },
};

/** Report a live session with `capabilities`, as the host would on attach. */
function attachWith(attachment: any, capabilities: Record<string, unknown> = FULL_CAPABILITIES) {
    act(() => { attachment.attach({ state: readyState(capabilities) }); });
}

function attachCppServers(attachment: any, includeClangd = true) {
    act(() => {
        if (includeClangd) {
            attachment.attach({
                attachmentId: 'att-clangd',
                definitionId: 'clangd',
                state: { ...readyState({ textDocumentSync: 1, definitionProvider: true }), definitionId: 'clangd' },
            });
        }
        attachment.attach({
            attachmentId: 'att-symbols',
            definitionId: 'coc-symbols',
            state: { ...readyState({ textDocumentSync: 1, definitionProvider: true }), definitionId: 'coc-symbols' },
        });
    });
}

async function attachmentFor(path: string) {
    await waitFor(() => expect(transport.client.attachments.has(path)).toBe(true));
    return transport.client.get(path);
}

function renderPane(props: Partial<Parameters<typeof PreviewPane>[0]> = {}) {
    return render(<PreviewPane repoId="ws-1" filePath="src/a.ts" fileName="a.ts" {...props} />);
}

beforeEach(() => {
    vi.clearAllMocks();
    resetLanguageDocumentStoresForTests();
    resetExternalSourceStoreForTests();
    monacoStub.reset();
    cueStub.reset();
    monacoStub.model.languageId = 'typescript';
    // `monaco-setup` does this at import time in the browser; jsdom cannot load
    // it, so the same registration is made against the stub.
    resetShadowLanguagesForTests();
    registerShadowLanguages(monacoStub.namespace as any, {
        typescript: { conf: {}, language: {} },
        javascript: { conf: {}, language: {} },
    });
    transport.client = new FakeClient();
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'const a = 1;', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.readTrustedBlob.mockResolvedValue({ content: 'const a = 1;', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.writeBlob.mockResolvedValue(undefined);
});

afterEach(() => {
    resetLanguageDocumentStoresForTests();
});

describe('PreviewPane — language providers (AC-03)', () => {
    // Regression guard. The pane builds its navigation handle from a
    // non-component export of the editor module, and this suite fakes that
    // module. When the fake replaced it wholesale the export went missing, the
    // mount effect threw before a single provider was registered, and all
    // tests below failed against an empty DOM with nothing pointing at
    // the cause. Asserting the handle here fails first, and says why.
    it('builds its navigation handle from the real editor module on mount', async () => {
        const onNavigationMount = vi.fn();
        const onNavigationLocation = vi.fn();
        renderPane({ onNavigationMount, onNavigationLocation });

        await waitFor(() => expect(onNavigationMount).toHaveBeenCalled());
        const controller = onNavigationMount.mock.calls[0][0];
        expect(controller).not.toBeNull();
        // The handle answers out of the mounted editor, not out of a stub the
        // mock invented — that is what the missing export cost us.
        expect(controller.capture()).toEqual({
            selection: {
                selectionStartLineNumber: 1,
                selectionStartColumn: 1,
                positionLineNumber: 1,
                positionColumn: 1,
            },
            viewState: { cursorState: [], viewState: {}, contributionsState: {} },
        });
        expect(onNavigationLocation).toHaveBeenCalledWith(controller.capture(), 'programmatic');
    });

    it('registers the selected features under the document’s shadow language', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        attachWith(attachment);

        await waitFor(() => expect(monacoStub.live().length).toBeGreaterThan(0));
        const kinds = monacoStub.live().map(entry => entry.kind).sort();
        expect(kinds).toEqual(['completion', 'definition', 'hover', 'references', 'signatureHelp']);
        // Registering under `typescript` would put these next to Monaco's own
        // worker, and every answer would arrive twice.
        expect(new Set(monacoStub.live().map(entry => entry.languageId)))
            .toEqual(new Set([`${SHADOW_LANGUAGE_PREFIX}typescript`]));
    });

    it('installs the definition cue with the model and disposes it with the pane', async () => {
        const { unmount } = renderPane();
        const attachment = await attachmentFor('src/a.ts');
        attachWith(attachment);

        await waitFor(() => expect(cueStub.live()).toHaveLength(1));
        expect(cueStub.live()[0].options.editor).toBe(monacoStub.editor);
        expect(cueStub.live()[0].options.model).toBe(monacoStub.model);

        await act(async () => { unmount(); });

        expect(cueStub.live()).toHaveLength(0);
    });

    it('does not keep a definition cue when the server lacks definition support', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        attachWith(attachment, { textDocumentSync: 1, hoverProvider: true });

        await waitFor(() => expect(monacoStub.live().map(entry => entry.kind)).toEqual(['hover']));
        expect(cueStub.live()).toHaveLength(0);
    });

    it('moves the model off Monaco’s TypeScript id and clears the worker’s markers', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        attachWith(attachment);

        await waitFor(() => expect(monacoStub.live().length).toBeGreaterThan(0));
        expect(monacoStub.model.getLanguageId()).toBe(`${SHADOW_LANGUAGE_PREFIX}typescript`);
        expect(monacoStub.clearedMarkers).toContainEqual({ owner: 'typescript', count: 0 });
    });

    it('leaves a file with no built-in provider on its own language', async () => {
        monacoStub.model.languageId = 'python';
        renderPane({ filePath: 'src/a.py', fileName: 'a.py' });
        const attachment = await attachmentFor('src/a.py');
        attachWith(attachment);

        await waitFor(() => expect(monacoStub.live().length).toBeGreaterThan(0));
        expect(monacoStub.model.getLanguageId()).toBe('python');
        expect(monacoStub.clearedMarkers).toEqual([]);
    });

    it('gives the model its base language back when the pane goes away', async () => {
        const { unmount } = renderPane();
        const attachment = await attachmentFor('src/a.ts');
        attachWith(attachment);
        await waitFor(() => expect(monacoStub.live().length).toBeGreaterThan(0));

        await act(async () => { unmount(); });

        // The model can outlive this pane; leaving it on a private id would
        // strand it with no providers at all.
        expect(monacoStub.model.getLanguageId()).toBe('typescript');
    });

    it('answers a hover out of this document’s buffer', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        attachWith(attachment);
        attachment.respond('textDocument/hover', () => ({
            contents: { kind: 'plaintext', value: 'const a: 1' },
        }));

        await waitFor(() => expect(monacoStub.live().length).toBeGreaterThan(0));
        const hover = await monacoStub.provider('hover').provideHover(
            monacoStub.model,
            { lineNumber: 1, column: 7 },
            token,
        );

        expect(hover.contents[0].value).toContain('const a: 1');
        const sent = attachment.lastRequest('textDocument/hover');
        expect((sent!.params as any).textDocument.uri).toBe('coc-file://ws-1/src/a.ts');
        // Zero-based on the wire, one-based in Monaco.
        expect((sent!.params as any).position).toEqual({ line: 0, character: 6 });
    });

    it('queries the routed coc-symbols attachment for C++ definitions', async () => {
        monacoStub.model.languageId = 'cpp';
        renderPane({ filePath: 'src/a.cpp', fileName: 'a.cpp', routingRef: 'remote:ws-1' });
        const attachment = await attachmentFor('src/a.cpp');
        attachCppServers(attachment, false);
        attachment.respondTo('coc-symbols', 'textDocument/definition', () => [{
            uri: 'coc-file://ws-1/include/widget.hpp',
            range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } },
        }]);

        await waitFor(() => expect(monacoStub.live().map(entry => entry.kind)).toContain('definition'));
        const links = await monacoStub.provider('definition').provideDefinition(
            monacoStub.model,
            { lineNumber: 1, column: 3 },
            token,
        );

        expect(attachment.lastRequest('textDocument/definition')).toMatchObject({
            definitionId: 'coc-symbols',
            params: {
                textDocument: { uri: 'coc-file://ws-1/src/a.cpp' },
                position: { line: 0, character: 2 },
            },
        });
        expect(links[0].uri.toString()).toContain('include/widget.hpp#symbol-index-candidate');
    });

    it('preserves symbol-server ranges and marks every candidate URI', async () => {
        monacoStub.model.languageId = 'cpp';
        renderPane({ filePath: 'src/a.cpp', fileName: 'a.cpp' });
        const attachment = await attachmentFor('src/a.cpp');
        attachCppServers(attachment, false);
        attachment.respondTo('coc-symbols', 'textDocument/definition', () => [
            {
                uri: 'coc-file://ws-1/include/Serde.h',
                range: { start: { line: 41, character: 8 }, end: { line: 41, character: 14 } },
            },
            {
                uri: 'coc-file://ws-1/src/z.cpp',
                range: { start: { line: 72, character: 2 }, end: { line: 72, character: 8 } },
            },
        ]);

        await waitFor(() => expect(monacoStub.live().map(entry => entry.kind)).toContain('definition'));
        const links = await monacoStub.provider('definition').provideDefinition(
            monacoStub.model,
            { lineNumber: 1, column: 3 },
            token,
        );

        expect(links).toHaveLength(2);
        expect(links[0]).toMatchObject({
            range: {
                startLineNumber: 42,
                startColumn: 9,
                endLineNumber: 42,
                endColumn: 15,
            },
        });
        expect(links[0].uri.toString()).toBe('coc-file://ws-1/include/Serde.h#symbol-index-candidate');
        expect(links.map((link: any) => link.uri.toString())).toEqual([
            'coc-file://ws-1/include/Serde.h#symbol-index-candidate',
            'coc-file://ws-1/src/z.cpp#symbol-index-candidate',
        ]);
    });

    it('drops every symbol-index candidate once clangd answers', async () => {
        monacoStub.model.languageId = 'cpp';
        renderPane({ filePath: 'src/a.cpp', fileName: 'a.cpp' });
        const attachment = await attachmentFor('src/a.cpp');
        attachCppServers(attachment);
        attachment.respondTo('clangd', 'textDocument/definition', () => ({
            uri: 'coc-file://ws-1/include/Serde.h',
            range: { start: { line: 41, character: 8 }, end: { line: 41, character: 14 } },
        }));
        attachment.respondTo('coc-symbols', 'textDocument/definition', () => [{
            uri: 'coc-file://ws-1/src/candidate.cpp',
            range: { start: { line: 17, character: 4 }, end: { line: 17, character: 10 } },
        }]);

        await waitFor(() => expect(monacoStub.live().map(entry => entry.kind)).toContain('definition'));
        const links = await monacoStub.provider('definition').provideDefinition(
            monacoStub.model,
            { lineNumber: 1, column: 3 },
            token,
        );

        expect(links).toHaveLength(1);
        expect(links[0].uri.toString()).toBe('coc-file://ws-1/include/Serde.h');
        expect(links[0].range.startLineNumber).toBe(42);
        expect(links[0].range.startColumn).toBe(9);
    });

    it('routes repo-group definition previews across live members and rejects outsiders', async () => {
        const first = renderPane({
            repoId: 'member-1',
            routingRef: 'remote:server-a:member-1',
            definitionPreviewOwners: [
                { workspaceId: 'member-1', routingRef: 'remote:server-a:member-1' },
                { workspaceId: 'member-2', routingRef: 'remote:server-a:member-2' },
            ],
            filePath: 'src/first.ts',
            fileName: 'first.ts',
        });
        const firstAttachment = await attachmentFor('src/first.ts');
        attachWith(firstAttachment);
        firstAttachment.respond('textDocument/definition', () => [
            {
                uri: 'coc-file://member-1/src/target.ts',
                range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } },
            },
            {
                uri: 'coc-file://member-2/src/shared.ts',
                range: { start: { line: 8, character: 5 }, end: { line: 8, character: 11 } },
            },
            {
                uri: 'coc-file://outside/src/private.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            },
        ]);
        await waitFor(() => expect(monacoStub.live().some(entry => entry.kind === 'definition')).toBe(true));

        const firstLinks = await monacoStub.provider('definition').provideDefinition(
            monacoStub.model,
            { lineNumber: 1, column: 3 },
            token,
        );
        expect(firstLinks.map((link: any) => link.uri.toString()))
            .toEqual([
                'coc-file://member-1/src/target.ts',
                'coc-file://member-2/src/shared.ts',
                'coc-file://outside/src/private.ts',
            ]);
        expect(monacoStub.resolvePreview('coc-file://member-1/src/target.ts'))
            .toMatchObject({ content: 'const a = 1;' });
        expect(monacoStub.resolvePreview('coc-file://member-2/src/shared.ts'))
            .toMatchObject({ content: 'const a = 1;' });
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith(
            'member-1',
            'src/target.ts',
            { signal: expect.any(AbortSignal) },
            'remote:server-a:member-1',
        );
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith(
            'member-2',
            'src/shared.ts',
            { signal: expect.any(AbortSignal) },
            'remote:server-a:member-2',
        );
        expect(monacoStub.resolvePreview('coc-file://outside/src/private.ts'))
            .toMatchObject({ content: 'Definition source unavailable.' });
        expect(mockExplorerApi.readBlob).not.toHaveBeenCalledWith(
            'outside',
            expect.anything(),
            expect.anything(),
            expect.anything(),
        );

        first.unmount();
        const second = renderPane({
            repoId: 'member-2',
            routingRef: 'remote:server-a:member-2',
            filePath: 'src/second.ts',
            fileName: 'second.ts',
        });
        const secondAttachment = await attachmentFor('src/second.ts');
        attachWith(secondAttachment);
        secondAttachment.respond('textDocument/definition', () => ({
            uri: 'coc-file://member-2/src/target.ts',
            range: { start: { line: 8, character: 5 }, end: { line: 8, character: 11 } },
        }));
        await waitFor(() => expect(monacoStub.live().some(entry => entry.kind === 'definition')).toBe(true));

        await monacoStub.provider('definition').provideDefinition(
            monacoStub.model,
            { lineNumber: 1, column: 3 },
            token,
        );
        expect(monacoStub.resolvePreview('coc-file://member-2/src/target.ts'))
            .toMatchObject({ content: 'const a = 1;' });
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith(
            'member-2',
            'src/target.ts',
            { signal: expect.any(AbortSignal) },
            'remote:server-a:member-2',
        );
        second.unmount();
    });

    it('ignores a model that is not this document', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        attachWith(attachment);
        await waitFor(() => expect(monacoStub.live().length).toBeGreaterThan(0));

        const other = {
            uri: { toString: () => 'coc-file://ws-1/src/other.ts' },
            getWordUntilPosition: () => ({ startColumn: 1, endColumn: 5 }),
        };
        const hover = await monacoStub.provider('hover').provideHover(other, { lineNumber: 1, column: 1 }, token);

        expect(hover).toBeNull();
        expect(attachment.lastRequest('textDocument/hover')).toBeUndefined();
    });

    it('registers nothing for a blob that is not a live repo document', async () => {
        // A trusted absolute path belongs to no workspace.
        renderPane({ filePath: `${TRUSTED_PATH_PREFIX}/etc/hosts`, fileName: 'hosts' });
        await waitFor(() => expect(mockExplorerApi.readTrustedBlob).toHaveBeenCalled());
        await act(async () => { await Promise.resolve(); });

        expect(monacoStub.live()).toHaveLength(0);
        expect(transport.client.attachments.size).toBe(0);
    });

    it('registers nothing for a truncated oversize file', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'x'.repeat(MAX_FILE_VIEW_SIZE + 10),
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });
        renderPane();
        await waitFor(() => expect(mockExplorerApi.readBlob).toHaveBeenCalled());
        await act(async () => { await Promise.resolve(); });

        expect(monacoStub.live()).toHaveLength(0);
    });

    it('drops a provider the replacement server no longer advertises', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        attachWith(attachment);
        await waitFor(() => expect(monacoStub.live()).toHaveLength(5));

        // A restart or a configuration change can hand the document a server
        // with a smaller feature set; the registration follows it down.
        act(() => { attachment.status(readyState({ textDocumentSync: 1, hoverProvider: true })); });

        await waitFor(() => expect(monacoStub.live().map(entry => entry.kind)).toEqual(['hover']));
    });

    it('disposes the registrations when the pane goes away', async () => {
        const { unmount } = renderPane();
        const attachment = await attachmentFor('src/a.ts');
        attachWith(attachment);
        await waitFor(() => expect(monacoStub.live().length).toBeGreaterThan(0));

        await act(async () => { unmount(); });

        expect(monacoStub.live()).toHaveLength(0);
    });

    it('reads an external definition through this document\'s own attachment', async () => {
        monacoStub.model.languageId = 'cpp';
        renderPane({ filePath: 'src/a.cpp', fileName: 'a.cpp', routingRef: 'remote:server-a:ws-1' });
        const attachment = await attachmentFor('src/a.cpp');
        attachCppServers(attachment);
        attachment.externalSources.set('cap-1', {
            content: 'namespace std { class string_view; }',
            displayName: 'string_view',
            languageHint: 'cpp',
        });
        attachment.respondTo('clangd', 'textDocument/definition', () => ({
            uri: 'coc-lsp-external://cap-1/string_view',
            range: { start: { line: 41, character: 8 }, end: { line: 41, character: 14 } },
        }));
        attachment.respondTo('coc-symbols', 'textDocument/definition', () => [{
            uri: 'coc-file://ws-1/src/z.cpp',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
        }]);

        await waitFor(() => expect(monacoStub.live().map(entry => entry.kind)).toContain('definition'));
        const links = await monacoStub.provider('definition').provideDefinition(
            monacoStub.model,
            { lineNumber: 1, column: 3 },
            token,
        );

        // The capability belongs to this attachment, so the read rides its
        // routed connection rather than the page's own server, and the exact
        // result suppresses the index candidate.
        expect(attachment.externalReads).toEqual([{ resourceId: 'cap-1', signal: expect.any(AbortSignal) }]);
        expect(links.map((link: any) => link.uri.toString())).toEqual(['coc-lsp-external://cap-1/string_view']);
        expect(monacoStub.resolvePreview('coc-lsp-external://cap-1/string_view'))
            .toMatchObject({ content: 'namespace std { class string_view; }' });
        expect(mockExplorerApi.readBlob).not.toHaveBeenCalledWith(
            expect.anything(), 'string_view', expect.anything(), expect.anything(),
        );
    });

    it('waits for a lone external reference before handing it to Monaco', async () => {
        monacoStub.model.languageId = 'cpp';
        renderPane({ filePath: 'src/a.cpp', fileName: 'a.cpp' });
        const attachment = await attachmentFor('src/a.cpp');
        attachWith(attachment);
        attachment.externalSources.set('cap-ref', {
            content: 'namespace std { class string_view; }',
            displayName: 'string_view',
            languageHint: 'cpp',
        });
        attachment.respond('textDocument/references', () => [{
            uri: 'coc-lsp-external://cap-ref/string_view',
            range: { start: { line: 41, character: 8 }, end: { line: 41, character: 14 } },
        }]);
        // Keep the read in flight, so only an actual wait can produce content.
        attachment.externalReadGate = new Promise<void>(resolve => { setTimeout(resolve, 10); });

        await waitFor(() => expect(monacoStub.live().map(entry => entry.kind)).toContain('references'));
        const links = await monacoStub.provider('references').provideReferences(
            monacoStub.model,
            { lineNumber: 1, column: 3 },
            { includeDeclaration: true },
            token,
        );

        // A single result navigates straight through, which unmounts the pane
        // whose attachment holds the capability: the content has to be here
        // already, not in flight.
        expect(links.map((link: any) => link.uri.toString())).toEqual(['coc-lsp-external://cap-ref/string_view']);
        expect(readExternalSourceRecord('cap-ref'))
            .toMatchObject({ content: 'namespace std { class string_view; }' });
        expect(monacoStub.resolvePreview('coc-lsp-external://cap-ref/string_view'))
            .toMatchObject({ content: 'namespace std { class string_view; }' });
    });

    it('shows an unavailable model when the external read fails', async () => {
        monacoStub.model.languageId = 'cpp';
        renderPane({ filePath: 'src/a.cpp', fileName: 'a.cpp' });
        const attachment = await attachmentFor('src/a.cpp');
        attachCppServers(attachment);
        attachment.respondTo('clangd', 'textDocument/definition', () => ({
            uri: 'coc-lsp-external://cap-expired/string_view',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        }));
        attachment.respondTo('coc-symbols', 'textDocument/definition', () => []);

        await waitFor(() => expect(monacoStub.live().map(entry => entry.kind)).toContain('definition'));
        const links = await monacoStub.provider('definition').provideDefinition(
            monacoStub.model,
            { lineNumber: 1, column: 3 },
            token,
        );

        // The exact location stays identified as an external definition; it is
        // not replaced by textually similar repository symbols.
        expect(links.map((link: any) => link.uri.toString())).toEqual(['coc-lsp-external://cap-expired/string_view']);
        expect(monacoStub.resolvePreview('coc-lsp-external://cap-expired/string_view'))
            .toMatchObject({ content: 'Definition source unavailable.' });
    });
});
