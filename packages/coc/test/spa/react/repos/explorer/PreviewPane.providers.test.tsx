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

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

const transport = vi.hoisted(() => ({ client: null as any }));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/features/language-servers/languageServerClient', () => ({
    getLanguageServerClient: () => transport.client.asClient(),
}));

// jsdom cannot run Monaco. This stub stands in for the editor and does the one
// thing the real editor does for this suite: once it has a model, it offers it
// to the host and takes the registration back down on unmount.
const monacoStub = vi.hoisted(() => {
    const registered: { kind: string; languageId: string; provider: any; disposed: boolean }[] = [];
    const shadowLanguages: string[] = [];
    const clearedMarkers: { owner: string; count: number }[] = [];
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
        },
        live: () => registered.filter(entry => !entry.disposed),
        provider: (kind: string) => {
            const entry = [...registered].reverse().find(item => item.kind === kind && !item.disposed);
            if (!entry) throw new Error(`No live ${kind} provider`);
            return entry.provider;
        },
        namespace: {
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
            Uri: { parse: (value: string) => ({ toString: () => value }) },
            editor: {
                setModelLanguage: (model: any, languageId: string) => { model.languageId = languageId; },
                setModelMarkers: (_model: any, owner: string, markers: unknown[]) => {
                    clearedMarkers.push({ owner, count: markers.length });
                },
            },
        },
        model: {
            languageId: 'typescript',
            uri: { toString: () => 'coc-file://ws-1/src/a.ts' },
            getWordUntilPosition: () => ({ startColumn: 1, endColumn: 5 }),
            getLanguageId(): string { return this.languageId; },
        },
    };
});

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', async () => {
    const { useEffect } = await import('react');
    return {
        MonacoFileEditor: ({ value, onModelMount }: any) => {
            useEffect(() => {
                if (!onModelMount) return;
                const cleanup = onModelMount({ monaco: monacoStub.namespace, model: monacoStub.model });
                return () => { cleanup?.(); };
            }, [onModelMount]);
            return <textarea data-testid="mock-monaco-textarea" value={value} readOnly />;
        },
        getMonacoLanguage: () => 'typescript',
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
    monacoStub.reset();
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
});
