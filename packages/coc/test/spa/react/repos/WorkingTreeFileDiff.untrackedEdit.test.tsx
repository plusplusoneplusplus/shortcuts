/**
 * WorkingTreeFileDiff — the untracked view mounts the real PreviewPane, which
 * is editable and saves to disk through the explorer blob write API.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

const mockMonaco = vi.hoisted(() => ({
    onSave: undefined as (() => void) | undefined,
    selectionContext: undefined as { workspaceId: string; filePath: string; destinationId: string } | undefined,
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../src/server/spa/client/react/features/language-servers/useLanguageDocument', () => ({
    useLanguageDocument: () => ({
        view: null,
        status: 'detached',
        snapshot: null,
        diagnostics: [],
        markers: [],
        ready: false,
        handleChange: vi.fn(),
        markSaved: vi.fn(),
        restart: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, readOnly, onChange, onSave, selectionContext }: any) => {
        mockMonaco.onSave = onSave;
        mockMonaco.selectionContext = selectionContext;
        return (
            <textarea
                data-testid="mock-monaco-textarea"
                data-read-only={String(!!readOnly)}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        );
    },
    getMonacoLanguage: () => 'typescript',
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: () => ({
        comments: [], loading: false, error: null, isEphemeral: false,
        addComment: vi.fn(), updateComment: vi.fn(), deleteComment: vi.fn(),
        resolveComment: vi.fn(), unresolveComment: vi.fn(), askAI: vi.fn(),
        aiLoadingIds: new Set(), aiErrors: new Map(), clearAiError: vi.fn(),
        resolvingIds: new Set(), deletingIds: new Set(), runRelocation: vi.fn(),
        copyAllCommentsAsPrompt: vi.fn(), refresh: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ git: { getWorkingTreeFileDiff: vi.fn(() => Promise.resolve({ diff: '' })) } }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
}));

import { WorkingTreeFileDiff } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff';

function typeInEditor(text: string) {
    const textarea = screen.getByTestId('mock-monaco-textarea');
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setValue.call(textarea, text);
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('WorkingTreeFileDiff — editable untracked file', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMonaco.onSave = undefined;
        mockMonaco.selectionContext = undefined;
        mockExplorerApi.readBlob.mockResolvedValue({ content: 'new file', encoding: 'utf-8', mimeType: 'text/plain' });
        mockExplorerApi.writeBlob.mockResolvedValue({ success: true });
    });

    async function renderUntracked() {
        await act(async () => {
            render(
                <WorkingTreeFileDiff
                    workspaceId="ws-untracked"
                    filePath="/repo/src/new.ts"
                    repoRoot="/repo"
                    stage="untracked"
                />,
            );
        });
        await waitFor(() => expect(screen.getByTestId('mock-monaco-textarea')).toBeTruthy());
    }

    it.each([undefined, 'ws-untracked'])('keeps local preview I/O explicit for owner %s', async (attachmentDestinationId) => {
        render(<WorkingTreeFileDiff workspaceId="ws-untracked" attachmentDestinationId={attachmentDestinationId}
            filePath="/repo/src/new.ts" repoRoot="/repo" stage="untracked" />);
        await waitFor(() => expect(mockMonaco.selectionContext).toBeDefined());
        expect(mockMonaco.selectionContext).toEqual({
            workspaceId: 'ws-untracked', filePath: 'src/new.ts', destinationId: 'ws-untracked',
        });
        expect(mockExplorerApi.readBlob).toHaveBeenLastCalledWith('ws-untracked', 'src/new.ts', expect.anything(), null);
    });

    it('retains the concrete clone for selection attachments and edits across owner changes', async () => {
        const firstOwner = 'remote:server-a:ws-untracked';
        const secondOwner = 'remote:server-b:ws-untracked';
        mockExplorerApi.readBlob.mockImplementation(async (_workspace, _path, _options, owner) => ({
            content: owner === firstOwner ? 'first clone content' : 'second clone content',
            encoding: 'utf-8', mimeType: 'text/plain',
        }));
        const props = { workspaceId: 'ws-untracked', filePath: '/repo/src/new.ts', repoRoot: '/repo', stage: 'untracked' as const };
        const view = render(<WorkingTreeFileDiff {...props} attachmentDestinationId={firstOwner} />);
        await waitFor(() => expect(mockMonaco.selectionContext?.destinationId).toBe(firstOwner));
        expect(mockMonaco.selectionContext).toEqual({
            workspaceId: 'ws-untracked', filePath: 'src/new.ts', destinationId: firstOwner,
        });
        expect(mockExplorerApi.readBlob).toHaveBeenLastCalledWith('ws-untracked', 'src/new.ts', expect.anything(), firstOwner);
        await act(async () => { typeInEditor('first clone edits'); });
        await act(async () => { mockMonaco.onSave?.(); });
        expect(mockExplorerApi.writeBlob).toHaveBeenLastCalledWith('ws-untracked', 'src/new.ts', 'first clone edits', firstOwner);
        await act(async () => { typeInEditor('unsaved first clone edits'); });

        view.rerender(<WorkingTreeFileDiff {...props} attachmentDestinationId={secondOwner} />);
        await waitFor(() => expect(mockMonaco.selectionContext?.destinationId).toBe(secondOwner));
        expect(mockMonaco.selectionContext?.workspaceId).toBe('ws-untracked');
        expect(mockExplorerApi.readBlob).toHaveBeenLastCalledWith('ws-untracked', 'src/new.ts', expect.anything(), secondOwner);
        expect((screen.getByTestId('mock-monaco-textarea') as HTMLTextAreaElement).value).toBe('second clone content');
        await act(async () => { typeInEditor('second clone edits'); });
        await act(async () => { mockMonaco.onSave?.(); });
        expect(mockExplorerApi.writeBlob).toHaveBeenLastCalledWith('ws-untracked', 'src/new.ts', 'second clone edits', secondOwner);
    });

    it('opens the untracked file in an editable editor', async () => {
        await renderUntracked();
        expect(screen.getByTestId('mock-monaco-textarea').getAttribute('data-read-only')).toBe('false');
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith('ws-untracked', 'src/new.ts', expect.anything(), null);
    });

    it('saves edits to disk through the blob write API on Ctrl/Cmd+S', async () => {
        await renderUntracked();
        await act(async () => { typeInEditor('new file\nedited'); });
        await act(async () => { mockMonaco.onSave?.(); });

        expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith('ws-untracked', 'src/new.ts', 'new file\nedited', null);
    });

    it('saves edits through the Save button', async () => {
        await renderUntracked();
        await act(async () => { typeInEditor('changed'); });
        await act(async () => { screen.getByTestId('save-btn').click(); });

        expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith('ws-untracked', 'src/new.ts', 'changed', null);
    });
});
