// @vitest-environment jsdom
/**
 * AC-03: a definition in another file opens in the surface the user was in.
 *
 * The pane is the piece that knows which workspace it shows and which model is
 * its own, so this suite runs the real pane, the real document store and the
 * real navigation registry, and drives the opener the way Monaco would. What is
 * pinned is the handoff: the pane hands its surface a repo-relative path and a
 * one-based position, and refuses a target it has no business opening.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';
import { TRUSTED_PATH_PREFIX } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen';
import {
    browserDocumentUri,
    resetLanguageDocumentStoresForTests,
} from '../../../../../src/server/spa/client/react/features/language-servers/documentStore';
import {
    installLanguageEditorOpener,
    resetEditorNavigationForTests,
} from '../../../../../src/server/spa/client/react/features/language-servers/editorNavigation';
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

// jsdom cannot run Monaco, so the editor stub does the one thing this suite
// needs: hand the host a model, and take the registration down on unmount.
const monacoStub = vi.hoisted(() => ({
    editor: {
        createDecorationsCollection: () => ({ clear: () => undefined, set: () => [] }),
        onDidChangeModelContent: () => ({ dispose: () => undefined }),
        onDidScrollChange: () => ({ dispose: () => undefined }),
        onKeyDown: () => ({ dispose: () => undefined }),
        onKeyUp: () => ({ dispose: () => undefined }),
        onMouseLeave: () => ({ dispose: () => undefined }),
        onMouseMove: () => ({ dispose: () => undefined }),
    },
    namespace: {
        languages: {
            registerHoverProvider: () => ({ dispose: () => undefined }),
            registerDefinitionProvider: () => ({ dispose: () => undefined }),
            registerReferenceProvider: () => ({ dispose: () => undefined }),
            registerCompletionItemProvider: () => ({ dispose: () => undefined }),
            registerSignatureHelpProvider: () => ({ dispose: () => undefined }),
            register: () => undefined,
            setLanguageConfiguration: () => undefined,
            setMonarchTokensProvider: () => undefined,
        },
        Uri: { parse: (value: string) => ({ toString: () => value }) },
        editor: {
            setModelLanguage: () => undefined,
            setModelMarkers: () => undefined,
        },
    },
    /** One model per mounted pane, so two surfaces are tellable apart. */
    models: [] as any[],
    nextModel: (path: string) => ({
        uri: { toString: () => `coc-file://ws-1/${path}` },
        getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
        getLanguageId: () => 'plaintext',
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', async () => {
    const { useEffect, useMemo } = await import('react');
    return {
        MonacoFileEditor: ({ value, onModelMount, revealLine, revealColumn }: any) => {
            const model = useMemo(() => {
                const created = monacoStub.nextModel('src/a.ts');
                monacoStub.models.push(created);
                return created;
            }, []);
            useEffect(() => {
                if (!onModelMount) return;
                const cleanup = onModelMount({ editor: monacoStub.editor, monaco: monacoStub.namespace, model });
                return () => { cleanup?.(); };
            }, [onModelMount, model]);
            return (
                <textarea
                    data-testid="mock-monaco-textarea"
                    data-reveal={`${revealLine ?? ''}:${revealColumn ?? ''}`}
                    value={value}
                    readOnly
                />
            );
        },
        getMonacoLanguage: () => 'plaintext',
        LANGUAGE_MARKER_OWNER: 'coc-language-server',
    };
});

/** The opener Monaco would hold, captured so a test can drive a navigation. */
function installOpener() {
    let opener: any = null;
    installLanguageEditorOpener({
        editor: {
            registerEditorOpener: (registered: any) => {
                opener = registered;
                return { dispose: () => undefined };
            },
        },
    } as never);
    return (model: object, uri: string, selection?: Record<string, number>) =>
        opener.openCodeEditor({ getModel: () => model }, { toString: () => uri }, selection);
}

async function attachmentFor(path: string) {
    await waitFor(() => expect(transport.client.attachments.has(path)).toBe(true));
    return transport.client.get(path);
}

/** Render a pane and wait until its model has claimed its navigations. */
async function renderPane(props: Partial<Parameters<typeof PreviewPane>[0]> = {}) {
    const utils = render(
        <PreviewPane repoId="ws-1" filePath="src/a.ts" fileName="a.ts" {...props} />,
    );
    const path = (props.filePath as string | undefined) ?? 'src/a.ts';
    if (!path.startsWith(TRUSTED_PATH_PREFIX)) {
        const attachment = await attachmentFor(path);
        act(() => { attachment.attach({ state: readyState({ definitionProvider: true }) }); });
    }
    await waitFor(() => expect(monacoStub.models.length).toBeGreaterThan(0));
    return { ...utils, model: monacoStub.models[monacoStub.models.length - 1] };
}

beforeEach(() => {
    vi.clearAllMocks();
    resetLanguageDocumentStoresForTests();
    resetEditorNavigationForTests();
    monacoStub.models.length = 0;
    transport.client = new FakeClient();
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'const a = 1;', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.readTrustedBlob.mockResolvedValue({ content: 'const a = 1;', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.writeBlob.mockResolvedValue(undefined);
});

afterEach(() => {
    resetLanguageDocumentStoresForTests();
    resetEditorNavigationForTests();
});

describe('PreviewPane — surface-aware navigation (AC-03)', () => {
    it('hands its surface the target path and one-based position', async () => {
        const open = installOpener();
        const onNavigate = vi.fn();
        const { model } = await renderPane({ onNavigate });

        const handled = await open(model, browserDocumentUri('ws-1', 'src/nested dir/types.ts'), {
            startLineNumber: 12, startColumn: 17, endLineNumber: 12, endColumn: 25,
        });

        expect(handled).toBe(true);
        expect(onNavigate).toHaveBeenCalledWith({
            path: 'src/nested dir/types.ts',
            name: 'types.ts',
            line: 12,
            column: 17,
        });
    });

    it('lands at the top of the target when the server named no position', async () => {
        const open = installOpener();
        const onNavigate = vi.fn();
        const { model } = await renderPane({ onNavigate });

        await open(model, browserDocumentUri('ws-1', 'src/types.ts'));

        expect(onNavigate).toHaveBeenCalledWith({
            path: 'src/types.ts', name: 'types.ts', line: 1, column: 1,
        });
    });

    it('refuses a target in another workspace', async () => {
        const open = installOpener();
        const onNavigate = vi.fn();
        const { model } = await renderPane({ onNavigate });

        // Opening this would read the wrong repo's file on the wrong host.
        const handled = await open(model, browserDocumentUri('ws-2', 'src/types.ts'));

        expect(handled).toBe(false);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('declines a cross-file jump when its host wires no navigation', async () => {
        const open = installOpener();
        const { model } = await renderPane();

        expect(await open(model, browserDocumentUri('ws-1', 'src/types.ts'))).toBe(false);
    });

    it('claims nothing for a blob that is not a live repo document', async () => {
        const open = installOpener();
        const onNavigate = vi.fn();
        render(
            <PreviewPane
                repoId="ws-1"
                filePath={`${TRUSTED_PATH_PREFIX}/etc/hosts`}
                fileName="hosts"
                onNavigate={onNavigate}
            />,
        );
        await waitFor(() => expect(mockExplorerApi.readTrustedBlob).toHaveBeenCalled());
        await act(async () => { await Promise.resolve(); });

        // The stub editor still made a model; without a live document behind it
        // the pane must not have claimed its navigations.
        const model = monacoStub.models[monacoStub.models.length - 1];
        expect(await open(model, browserDocumentUri('ws-1', 'src/types.ts'))).toBe(false);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('routes to the surface the jump started in, not the one that mounted last', async () => {
        const open = installOpener();
        const explorerNavigate = vi.fn();
        const panelNavigate = vi.fn();
        const explorer = await renderPane({ onNavigate: explorerNavigate });
        const panel = await renderPane({ onNavigate: panelNavigate });
        expect(explorer.model).not.toBe(panel.model);

        await open(explorer.model, browserDocumentUri('ws-1', 'src/types.ts'), {
            lineNumber: 4, column: 2,
        });

        expect(explorerNavigate).toHaveBeenCalledWith({
            path: 'src/types.ts', name: 'types.ts', line: 4, column: 2,
        });
        expect(panelNavigate).not.toHaveBeenCalled();
    });

    it('stops answering once the pane is gone', async () => {
        const open = installOpener();
        const onNavigate = vi.fn();
        const { model, unmount } = await renderPane({ onNavigate });

        await act(async () => { unmount(); });

        expect(await open(model, browserDocumentUri('ws-1', 'src/types.ts'))).toBe(false);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('passes the reveal position down to the editor', async () => {
        const { getByTestId } = await renderPane({ revealLine: 12, revealColumn: 17 });

        expect(getByTestId('mock-monaco-textarea').getAttribute('data-reveal')).toBe('12:17');
    });
});
