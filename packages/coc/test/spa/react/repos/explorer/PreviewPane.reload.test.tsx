// @vitest-environment jsdom
/**
 * "Reload from disk" on a file buffer: the same file is re-read in place
 * through its owner, unsaved edits are only replaced after confirmation, a
 * failed or outdated read never touches the buffer, and the editor keeps the
 * reader's cursor/scroll instead of re-running the opening reveal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PreviewPane, type FileReloadControl } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

const mockLanguageDocument = vi.hoisted(() => ({
    handleChange: vi.fn(),
    markSaved: vi.fn(),
    restart: vi.fn(),
}));

const fakeEditor = vi.hoisted(() => ({
    saveViewState: vi.fn(() => ({ scrollTop: 420, cursor: { lineNumber: 7, column: 3 } })),
    restoreViewState: vi.fn(),
    getSelection: () => null,
    setSelection: () => undefined,
    revealRangeInCenterIfOutsideViewport: () => undefined,
    getLayoutInfo: () => ({ height: 100 }),
    onDidLayoutChange: () => ({ dispose: () => undefined }),
    onDidChangeCursorSelection: () => ({ dispose: () => undefined }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/features/language-servers/useLanguageDocument', () => ({
    useLanguageDocument: () => ({
        view: null,
        status: 'detached',
        snapshot: null,
        diagnostics: [],
        markers: [],
        ready: false,
        ...mockLanguageDocument,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', async () => {
    const actual = await vi.importActual<typeof import('../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor')>(
        '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor',
    );
    return {
        ...actual,
        MonacoFileEditor: ({ value, onChange, revealLine, onModelMount }: any) => {
            useEffect(() => onModelMount?.({ editor: fakeEditor, monaco: {}, model: {} }) ?? undefined, [onModelMount]);
            return (
                <div data-testid="mock-monaco-editor" data-reveal-line={revealLine ?? ''}>
                    <textarea data-testid="mock-monaco-textarea" value={value} onChange={e => onChange(e.target.value)} />
                </div>
            );
        },
    };
});

const text = (content: string) => ({ content, encoding: 'utf-8', mimeType: 'text/plain' });

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const editorText = () => (screen.getByTestId('mock-monaco-textarea') as HTMLTextAreaElement).value;
const reloadButton = () => screen.getByRole('button', { name: 'Reload from disk' });

async function renderLoaded(props: Partial<React.ComponentProps<typeof PreviewPane>> = {}) {
    const view = render(<PreviewPane repoId="ws-1" filePath="src/a.ts" fileName="a.ts" {...props} />);
    await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeTruthy());
    return view;
}

describe('PreviewPane — Reload from disk', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => cleanup());

    it('shows the changed bytes on disk without a loading flash and keeps the reader\'s place', async () => {
        mockExplorerApi.readBlob.mockResolvedValueOnce(text('v1'));
        await renderLoaded({ revealLine: 12 });
        expect(editorText()).toBe('v1');
        expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-reveal-line')).toBe('12');

        const next = deferred<ReturnType<typeof text>>();
        mockExplorerApi.readBlob.mockReturnValueOnce(next.promise);
        fireEvent.click(reloadButton());
        // The old buffer stays on screen while the read runs.
        expect(screen.queryByTestId('preview-loading')).toBeNull();
        expect(editorText()).toBe('v1');
        expect(reloadButton()).toHaveProperty('disabled', true);

        await act(async () => { next.resolve(text('v2 from disk')); });
        expect(editorText()).toBe('v2 from disk');
        expect(mockExplorerApi.readBlob).toHaveBeenLastCalledWith('ws-1', 'src/a.ts', { signal: expect.any(AbortSignal) });
        expect(fakeEditor.restoreViewState).toHaveBeenCalledWith({ scrollTop: 420, cursor: { lineNumber: 7, column: 3 } });
        // The opening reveal does not re-run over the reloaded text.
        expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-reveal-line')).toBe('');
        expect(mockLanguageDocument.markSaved).toHaveBeenCalledWith('v2 from disk');
        expect(reloadButton()).toHaveProperty('disabled', false);
    });

    it('asks before replacing unsaved edits; Cancel keeps them and reads nothing', async () => {
        mockExplorerApi.readBlob.mockResolvedValueOnce(text('v1'));
        const onDirtyChange = vi.fn();
        await renderLoaded({ onDirtyChange });
        fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'my edit' } });
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);

        fireEvent.click(reloadButton());
        const dialog = screen.getByRole('dialog', { name: 'Confirm reload' });
        expect(dialog.textContent).toContain('Your unsaved changes will be lost.');
        expect(reloadButton()).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByTestId('unified-panel-close-confirm-cancel'));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(editorText()).toBe('my edit');
        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(1);
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it('replaces unsaved edits with the disk text once confirmed', async () => {
        mockExplorerApi.readBlob.mockResolvedValueOnce(text('v1'));
        const onDirtyChange = vi.fn();
        await renderLoaded({ onDirtyChange });
        fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'my edit' } });

        mockExplorerApi.readBlob.mockResolvedValueOnce(text('v2'));
        fireEvent.click(reloadButton());
        await act(async () => { fireEvent.click(screen.getByText('Discard and reload')); });

        await waitFor(() => expect(editorText()).toBe('v2'));
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        expect(screen.queryByTestId('dirty-indicator')).toBeNull();
        expect(mockLanguageDocument.markSaved).toHaveBeenCalledWith('v2');
    });

    it('keeps the buffer and shows the error when the read fails', async () => {
        mockExplorerApi.readBlob.mockResolvedValueOnce(text('v1'));
        await renderLoaded();
        fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'kept' } });
        mockExplorerApi.readBlob.mockRejectedValueOnce(new Error('disk unreachable'));

        fireEvent.click(reloadButton());
        await act(async () => { fireEvent.click(screen.getByText('Discard and reload')); });

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('Could not reload from disk: disk unreachable');
        expect(editorText()).toBe('kept');
        expect(screen.getByTestId('dirty-indicator')).toBeTruthy();
        expect(screen.queryByTestId('preview-error')).toBeNull();
        expect(reloadButton()).toHaveProperty('disabled', false);
    });

    it('never overwrites edits typed while the read was in flight', async () => {
        mockExplorerApi.readBlob.mockResolvedValueOnce(text('v1'));
        await renderLoaded();
        const next = deferred<ReturnType<typeof text>>();
        mockExplorerApi.readBlob.mockReturnValueOnce(next.promise);
        fireEvent.click(reloadButton());

        fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'typed during read' } });
        await act(async () => { next.resolve(text('v2')); });

        expect(editorText()).toBe('typed during read');
        expect(screen.getByRole('status').textContent).toContain('your buffer was kept');
        expect(fakeEditor.restoreViewState).not.toHaveBeenCalled();
    });

    it('drops a late reload answer after the pane moved to another file', async () => {
        mockExplorerApi.readBlob.mockResolvedValueOnce(text('a v1'));
        const view = await renderLoaded();
        const late = deferred<ReturnType<typeof text>>();
        mockExplorerApi.readBlob.mockReturnValueOnce(late.promise);
        fireEvent.click(reloadButton());

        mockExplorerApi.readBlob.mockResolvedValueOnce(text('b content'));
        view.rerender(<PreviewPane repoId="ws-1" filePath="src/b.ts" fileName="b.ts" />);
        await waitFor(() => expect(editorText()).toBe('b content'));

        await act(async () => { late.resolve(text('a v2')); });
        expect(editorText()).toBe('b content');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(reloadButton()).toHaveProperty('disabled', false);
    });

    it('reads only through the owning workspace and route, leaving other workspaces alone', async () => {
        mockExplorerApi.readBlob.mockImplementation(async (workspaceId: string) => text(`${workspaceId} v1`));
        render(<>
            <PreviewPane repoId="ws-a" routingRef="route-a" filePath="src/a.ts" fileName="a.ts" />
            <PreviewPane repoId="ws-b" filePath="src/a.ts" fileName="a.ts" />
        </>);
        await waitFor(() => expect(screen.getAllByTestId('mock-monaco-textarea')).toHaveLength(2));
        mockExplorerApi.readBlob.mockClear();
        mockExplorerApi.readBlob.mockImplementation(async (workspaceId: string) => text(`${workspaceId} v2`));

        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Reload from disk' })[0]); });

        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(1);
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith('ws-a', 'src/a.ts', { signal: expect.any(AbortSignal) }, 'route-a');
        const values = screen.getAllByTestId('mock-monaco-textarea').map(el => (el as HTMLTextAreaElement).value);
        expect(values).toEqual(['ws-a v2', 'ws-b v1']);
    });

    it('hands a hosting toolbar the control instead of rendering its own button', async () => {
        mockExplorerApi.readBlob.mockResolvedValueOnce(text('v1'));
        let control: FileReloadControl | null = null;
        const onReloadControlChange = vi.fn((next: FileReloadControl | null) => { control = next; });
        const view = await renderLoaded({ onReloadControlChange });
        expect(screen.queryByRole('button', { name: 'Reload from disk' })).toBeNull();
        expect(control).toMatchObject({ busy: false });

        const next = deferred<ReturnType<typeof text>>();
        mockExplorerApi.readBlob.mockReturnValueOnce(next.promise);
        act(() => control!.reload());
        expect(control).toMatchObject({ busy: true });
        // A repeat while busy issues no second read.
        act(() => control!.reload());
        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(2);

        await act(async () => { next.resolve(text('v2')); });
        expect(editorText()).toBe('v2');
        expect(control).toMatchObject({ busy: false });

        view.unmount();
        expect(onReloadControlChange).toHaveBeenLastCalledWith(null);
    });
});
