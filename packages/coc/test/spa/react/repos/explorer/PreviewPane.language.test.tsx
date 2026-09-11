// @vitest-environment jsdom
/**
 * AC-02: the Explorer's preview pane as the first host of language support.
 *
 * The real document store and the real `useLanguageDocument` hook run here;
 * only the socket underneath is faked, so what is asserted is the traffic the
 * pane actually causes. The two things worth pinning are the eligibility rule
 * — which files become live repo documents and which stay ordinary viewers —
 * and the save ordering, since `didSave` must never precede a successful write.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';
import { TRUSTED_PATH_PREFIX } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen';
import { resetLanguageDocumentStoresForTests } from '../../../../../src/server/spa/client/react/features/language-servers/documentStore';
import { MAX_FILE_VIEW_SIZE } from '../../../../../src/server/spa/client/react/shared/file-viewer/useFileContent';
import { FakeClient, readyState, diagnostic } from '../../language-servers/fakeLanguageTransport';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

const transport = vi.hoisted(() => ({
    client: null as any,
    clientCalls: [] as unknown[][],
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/features/language-servers/languageServerClient', () => ({
    getLanguageServerClient: (...args: unknown[]) => {
        transport.clientCalls.push(args);
        return transport.client.asClient();
    },
}));

// jsdom cannot run Monaco. The stub records the markers it is handed and hands
// the test a way to fire a change with a real Monaco-shaped change list.
const editor = vi.hoisted(() => ({
    onChange: undefined as any,
    markers: undefined as any,
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, onChange, markers }: any) => {
        editor.onChange = onChange;
        editor.markers = markers;
        return <textarea data-testid="mock-monaco-textarea" value={value} readOnly />;
    },
    getMonacoLanguage: () => 'typescript',
    LANGUAGE_MARKER_OWNER: 'coc-language-server',
}));

/** The attachment the pane opened for `path`, once it exists. */
async function attachmentFor(path: string) {
    await waitFor(() => expect(transport.client.attachments.has(path)).toBe(true));
    return transport.client.get(path);
}

function renderPane(props: Partial<Parameters<typeof PreviewPane>[0]> = {}) {
    return render(
        <PreviewPane repoId="ws-1" filePath="src/a.ts" fileName="a.ts" {...props} />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    resetLanguageDocumentStoresForTests();
    transport.client = new FakeClient();
    transport.clientCalls = [];
    editor.onChange = undefined;
    editor.markers = undefined;
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'const a = 1;', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.readTrustedBlob.mockResolvedValue({ content: 'const a = 1;', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.writeBlob.mockResolvedValue(undefined);
});

afterEach(() => {
    resetLanguageDocumentStoresForTests();
});

describe('PreviewPane — language document (AC-02)', () => {
    it('opens a document for a live repo file and sends the disk text on attach', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');

        act(() => { attachment.attach(); });

        expect(attachment.methods()).toContain('textDocument/didOpen');
        const opened = attachment.lastOf('textDocument/didOpen') as any;
        expect(opened.textDocument.text).toBe('const a = 1;');
    });

    it('uses the concrete clone identity for the file read and language transport', async () => {
        const routingRef = 'remote:server-owner:ws-1';
        renderPane({ routingRef });
        await attachmentFor('src/a.ts');

        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith(
            'ws-1',
            'src/a.ts',
            expect.anything(),
            routingRef,
        );
        expect(transport.clientCalls).toContainEqual(['ws-1', undefined, routingRef]);
    });

    it('forwards an edit as an incremental change when the server negotiated one', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        act(() => { attachment.attach({ state: readyState({ textDocumentSync: 2 }) }); });

        act(() => {
            editor.onChange('const b = 1;', [
                { range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 8 }, rangeLength: 1, text: 'b' },
            ]);
        });

        const changed = attachment.lastOf('textDocument/didChange') as any;
        // Monaco's one-based (1, 7)-(1, 8) is LSP's zero-based (0, 6)-(0, 7).
        expect(changed.contentChanges).toEqual([
            { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, rangeLength: 1, text: 'b' },
        ]);
    });

    it('sends didSave only after the write succeeds', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        act(() => { attachment.attach(); });

        act(() => { editor.onChange('const b = 1;', []); });
        expect(attachment.methods()).not.toContain('textDocument/didSave');

        fireEvent.click(await screen.findByTestId('save-btn'));
        await waitFor(() => expect(attachment.methods()).toContain('textDocument/didSave'));
        expect((attachment.lastOf('textDocument/didSave') as any).textDocument.uri)
            .toBe(attachment.info.documentUri);
    });

    it('sends no didSave when the write fails, leaving the server on the old content', async () => {
        // Driven through the registered save so the failure does not swap the
        // pane for its error view before the assertion.
        let registered: (() => Promise<boolean>) | null = null;
        renderPane({ onRegisterSave: (save) => { registered = save; } });
        const attachment = await attachmentFor('src/a.ts');
        act(() => { attachment.attach(); });
        act(() => { editor.onChange('const b = 1;', []); });

        mockExplorerApi.writeBlob.mockRejectedValueOnce(new Error('disk full'));
        let result: boolean | undefined;
        await act(async () => { result = await registered!(); });

        expect(result).toBe(false);
        expect(attachment.methods()).not.toContain('textDocument/didSave');
    });

    it('keeps the saved text as the buffer instead of resetting it to the stale disk read', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        act(() => { attachment.attach(); });

        act(() => { editor.onChange('const b = 1;', []); });
        fireEvent.click(await screen.findByTestId('save-btn'));
        await waitFor(() => expect(attachment.methods()).toContain('textDocument/didSave'));

        // The pane still holds the original blob; offering it back would undo
        // the save inside the server's copy.
        const changes = attachment.notifications.filter((n: any) => n.method === 'textDocument/didChange');
        expect((changes[changes.length - 1].params as any).contentChanges[0].text).toBe('const b = 1;');
    });

    it('publishes the document diagnostics to the editor as markers', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        act(() => { attachment.attach(); });

        act(() => {
            attachment.notify('textDocument/publishDiagnostics', {
                uri: attachment.info.documentUri,
                diagnostics: [diagnostic('cannot find name')],
            });
        });

        await waitFor(() => expect(editor.markers).toHaveLength(1));
        expect(editor.markers[0].message).toBe('cannot find name');
    });

    it('shows the language status beside the file and restarts the server on request', async () => {
        renderPane();
        const attachment = await attachmentFor('src/a.ts');
        act(() => { attachment.attach({ state: readyState() }); });

        expect(screen.getByTestId('language-status-label').textContent).toBe('TypeScript');

        // The server dies. The status follows it, and the retry the user is
        // offered goes all the way down to the transport.
        act(() => {
            attachment.status({
                status: 'failed',
                definitionId: 'typescript',
                displayName: 'TypeScript',
                detail: 'Handshake failed',
            });
        });

        expect(screen.getByTestId('language-status-label').textContent).toBe('TypeScript failed');
        fireEvent.click(screen.getByTestId('language-restart-btn'));
        expect(attachment.restarts).toBe(1);
    });

    it('shows no language status for a file that is not a live repo document', async () => {
        renderPane({ filePath: `${TRUSTED_PATH_PREFIX}/etc/hosts`, fileName: 'hosts' });
        await screen.findByTestId('mock-monaco-textarea');

        expect(screen.queryByTestId('language-status')).toBeNull();
    });

    it('opens no document for a trusted absolute path, which belongs to no workspace', async () => {
        renderPane({ filePath: `${TRUSTED_PATH_PREFIX}/etc/hosts`, fileName: 'hosts' });
        await screen.findByTestId('mock-monaco-textarea');

        expect(transport.client.attachments.size).toBe(0);
        expect(editor.markers).toBeUndefined();
    });

    it('opens no document for an oversize file, which is shown truncated', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'x'.repeat(MAX_FILE_VIEW_SIZE + 1),
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });
        renderPane();
        await screen.findByTestId('mock-monaco-textarea');

        expect(transport.client.attachments.size).toBe(0);
    });

    it('opens no document for a binary blob, which has no text to synchronize', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({ content: 'AAAA', encoding: 'base64', mimeType: 'image/png' });
        renderPane({ fileName: 'logo.png' });
        await screen.findByTestId('preview-image');

        expect(transport.client.attachments.size).toBe(0);
    });

    it('releases the document when the pane unmounts', async () => {
        const { unmount } = renderPane();
        const attachment = await attachmentFor('src/a.ts');
        act(() => { attachment.attach(); });

        unmount();
        expect(attachment.methods()).toContain('textDocument/didClose');
        expect(attachment.released).toBe(true);
    });
});
