// @vitest-environment jsdom
/**
 * AC-04: PreviewPane hands its owner a save entry point so a tab-close prompt
 * can write the buffer without the user visiting the tab. Pins the whole
 * contract: registered only while editable, `null` for read-only and trusted
 * buffers, resolves true/false by write outcome, always writes the CURRENT
 * text, and unregisters on unmount.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';
import { TRUSTED_PATH_PREFIX } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, onChange }: any) => (
        <textarea data-testid="mock-monaco-textarea" value={value} onChange={e => onChange(e.target.value)} />
    ),
    getMonacoLanguage: () => 'plaintext',
}));

/** The last save function the pane registered (null once it unregisters). */
function saveRegistry() {
    let current: (() => Promise<boolean>) | null = null;
    const calls: (unknown)[] = [];
    const onRegisterSave = (save: (() => Promise<boolean>) | null) => {
        calls.push(save);
        current = save;
    };
    return { onRegisterSave, calls, get save() { return current; } };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.readTrustedBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
});

describe('PreviewPane — onRegisterSave (AC-04)', () => {
    it('registers a save that writes the current text and resolves true', async () => {
        mockExplorerApi.writeBlob.mockResolvedValue({});
        const registry = saveRegistry();

        render(<PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" onRegisterSave={registry.onRegisterSave} />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeInTheDocument());
        expect(registry.save).toBeTypeOf('function');

        act(() => {
            fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'edited text' } });
        });

        let result: boolean | undefined;
        await act(async () => { result = await registry.save!(); });
        expect(result).toBe(true);
        expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith('ws-1', 'a.ts', 'edited text');
        expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });

    it('resolves false and shows the error when the write fails, leaving the buffer dirty', async () => {
        mockExplorerApi.writeBlob.mockRejectedValue(new Error('EACCES: permission denied'));
        const registry = saveRegistry();

        render(<PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" onRegisterSave={registry.onRegisterSave} />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeInTheDocument());
        act(() => {
            fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'edited' } });
        });

        let result: boolean | undefined;
        await act(async () => { result = await registry.save!(); });
        expect(result).toBe(false);
        expect(await screen.findByTestId('preview-error')).toHaveTextContent('EACCES: permission denied');
    });

    it('registers null for a read-only buffer, so no close path can write it', async () => {
        const registry = saveRegistry();
        render(<PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" readOnly onRegisterSave={registry.onRegisterSave} />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeInTheDocument());
        expect(registry.save).toBeNull();
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
    });

    it('registers null for a trusted absolute-path buffer', async () => {
        const registry = saveRegistry();
        render(
            <PreviewPane
                repoId="ws-1"
                filePath={`${TRUSTED_PATH_PREFIX}/etc/hosts`}
                fileName="hosts"
                onRegisterSave={registry.onRegisterSave}
            />,
        );
        await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeInTheDocument());
        expect(registry.save).toBeNull();
    });

    it('unregisters on unmount', async () => {
        const registry = saveRegistry();
        const { unmount } = render(
            <PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" onRegisterSave={registry.onRegisterSave} />,
        );
        await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeInTheDocument());
        expect(registry.save).toBeTypeOf('function');
        unmount();
        expect(registry.save).toBeNull();
    });
});
