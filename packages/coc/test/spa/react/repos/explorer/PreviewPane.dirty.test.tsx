// @vitest-environment jsdom
/**
 * AC-03 of preserve-explorer-state: PreviewPane surfaces its unsaved-edits state
 * through the `onDirtyChange` callback so the workspace-switch guard can prompt
 * before the buffer is discarded. Verifies the callback fires true on edit, false
 * on save, and false on unmount.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

// Keep Monaco out of the graph — a textarea stub stands in for the editor.
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, onChange, onSave }: any) => (
        <div data-testid="mock-monaco-editor">
            <textarea data-testid="mock-monaco-textarea" value={value} onChange={e => onChange(e.target.value)} />
            {onSave && <button data-testid="mock-monaco-save" onClick={onSave}>Save</button>}
        </div>
    ),
    getMonacoLanguage: () => 'plaintext',
}));

describe('PreviewPane — onDirtyChange (AC-03)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reports dirty on edit and clean again on save', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
        mockExplorerApi.writeBlob.mockResolvedValue({});
        const onDirtyChange = vi.fn();

        render(<PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" onDirtyChange={onDirtyChange} />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeInTheDocument());

        // Initial report is clean.
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);

        act(() => {
            fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'hello world' } });
        });
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);

        await act(async () => {
            fireEvent.click(screen.getByTestId('mock-monaco-save'));
        });
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    });

    it('reports clean on unmount so a torn-down preview never leaves a stale dirty flag', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
        const onDirtyChange = vi.fn();

        const view = render(<PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" onDirtyChange={onDirtyChange} />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeInTheDocument());

        act(() => {
            fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'dirty' } });
        });
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);

        onDirtyChange.mockClear();
        act(() => { view.unmount(); });
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('never reports dirty for a read-only preview', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
        const onDirtyChange = vi.fn();

        render(<PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" readOnly onDirtyChange={onDirtyChange} />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeInTheDocument());

        act(() => {
            fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'edited' } });
        });
        // read-only ignores edits → dirty never becomes true.
        expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    });
});
