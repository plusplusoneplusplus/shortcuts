/**
 * Unsaved-edit close guard in the unified panel (AC-05).
 *
 * "Switching tabs or chats must never discard drafts" and "closing dirty files
 * resolves unsaved edits first" are two halves of one rule, so these cases
 * cover both against the real buffer: the Explorer's `PreviewPane` with a
 * textarea standing in for Monaco and `explorerApi` standing in for the server.
 *
 * The outcomes pinned here are the ones a user would notice going wrong — a
 * close that silently ate an edit, a Save that reported success after a failed
 * write, and a draft that vanished because its tab was hidden.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
    searchFiles: vi.fn(async () => ({ results: [] as { path: string }[] })),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));
// Monaco never loads in jsdom; the textarea stands in for the edit buffer.
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, onChange, readOnly }: any) => (
        <textarea
            data-testid="mock-monaco-textarea"
            data-readonly={readOnly ? 'true' : 'false'}
            value={value}
            onChange={e => onChange?.(e.target.value)}
        />
    ),
    getMonacoLanguage: () => 'plaintext',
}));
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="mock-terminal" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openUnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

const WS = 'ws-1';
const CHAT = 'chat-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        view: 'terminal',
        setView: vi.fn(),
        views: ['terminal', 'explorer', 'notes'],
        target: WS,
        setTarget: vi.fn(),
        targets: [],
        width: 420,
        maxWidth: 900,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        ...overrides,
    };
}

function openFile(opts: { path: string; readOnly?: boolean; chatId?: string | null } = { path: 'src/a.ts' }) {
    return openUnifiedPanelTab(WS, {
        kind: 'file',
        ownerWorkspaceId: WS,
        chatId: opts.chatId === undefined ? CHAT : opts.chatId,
        resourceId: opts.path,
        label: opts.path.split('/').pop() ?? opts.path,
        ...(opts.readOnly ? { readOnly: true } : {}),
    });
}

/** Open a dirty file tab and hand back its id and its ✕. */
async function dirtyFileTab(path = 'src/a.ts') {
    const tabId = openFile({ path });
    render(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={dockStub()} />);
    const editor = await screen.findByTestId('mock-monaco-textarea');
    fireEvent.change(editor, { target: { value: 'edited' } });
    await waitFor(() => expect(screen.getByTestId(`unified-panel-tab-dirty-${tabId}`)).toBeTruthy());
    return { tabId, closeButton: screen.getByTestId(`unified-panel-tab-close-${tabId}`) };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockExplorerApi.searchFiles.mockResolvedValue({ results: [] });
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.writeBlob.mockResolvedValue({ success: true });
    localStorage.clear();
    clearUnifiedPanelState();
});
afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
});

describe('UnifiedRightPanel dirty close guard (AC-05)', () => {
    it('asks before closing a file tab with unsaved edits', async () => {
        const { tabId, closeButton } = await dirtyFileTab();

        fireEvent.click(closeButton);

        expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeTruthy();
        expect(screen.getByTestId('explorer-close-tabs-file').textContent).toBe('src/a.ts');
        // Nothing has happened yet.
        expect(screen.getByTestId(`unified-panel-tab-${tabId}`)).toBeTruthy();
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
    });

    it('cancel leaves the tab and its draft alone', async () => {
        const { tabId, closeButton } = await dirtyFileTab();
        fireEvent.click(closeButton);

        fireEvent.click(screen.getByTestId('explorer-close-cancel-btn'));

        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
        expect(screen.getByTestId(`unified-panel-tab-${tabId}`)).toBeTruthy();
        expect((screen.getByTestId('mock-monaco-textarea') as HTMLTextAreaElement).value).toBe('edited');
        expect(screen.getByTestId(`unified-panel-tab-dirty-${tabId}`)).toBeTruthy();
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
    });

    it("Don't Save closes the tab without writing", async () => {
        const { tabId, closeButton } = await dirtyFileTab();
        fireEvent.click(closeButton);

        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));

        await waitFor(() => expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull());
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
    });

    it('Save writes the buffer, then closes the tab', async () => {
        const { tabId, closeButton } = await dirtyFileTab();
        fireEvent.click(closeButton);

        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));

        await waitFor(() => expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith(WS, 'src/a.ts', 'edited'));
        await waitFor(() => expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull());
    });

    it('a failed save keeps the tab, the draft, and the prompt', async () => {
        mockExplorerApi.writeBlob.mockRejectedValueOnce(new Error('disk full'));
        const { tabId, closeButton } = await dirtyFileTab();
        fireEvent.click(closeButton);

        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));

        await screen.findByTestId('explorer-close-tabs-error');
        // The tab survives, and the strip still shows it as unsaved — the write
        // failed, so the buffer is exactly as dirty as it was. (PreviewPane
        // swaps in its own error/retry state, as it does for the flag-off
        // Explorer tabs; the panel does not second-guess that.)
        expect(screen.getByTestId(`unified-panel-tab-${tabId}`)).toBeTruthy();
        expect(screen.getByTestId(`unified-panel-tab-dirty-${tabId}`)).toBeTruthy();

        // The prompt is a retry, not a dead end.
        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));
        await waitFor(() => expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull());
        expect(mockExplorerApi.writeBlob).toHaveBeenCalledTimes(2);
    });

    it('closes a clean file tab with no prompt', async () => {
        const tabId = openFile({ path: 'src/a.ts' });
        render(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={dockStub()} />);
        await screen.findByTestId('mock-monaco-textarea');

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${tabId}`));

        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
    });

    it('never prompts for a read-only tab, which has no write path to offer', async () => {
        const tabId = openFile({ path: 'src/a.ts', readOnly: true });
        render(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={dockStub()} />);
        await screen.findByTestId('mock-monaco-textarea');

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${tabId}`));

        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
    });

    it('keeps a draft alive while its tab is hidden behind another', async () => {
        // The guard only matters if the draft is still there to guard. Switching
        // to another tab hides the buffer with display:none rather than
        // unmounting it, so the edit — and the strip's dirty marker — survive.
        const fileTab = openFile({ path: 'src/a.ts' });
        render(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={dockStub()} />);
        fireEvent.change(await screen.findByTestId('mock-monaco-textarea'), { target: { value: 'edited' } });

        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.click(screen.getByTestId('unified-panel-open-notes'));
        await screen.findByTestId('mock-notes');
        expect(screen.getByTestId(`unified-panel-view-${fileTab}`).getAttribute('data-active')).toBe('false');
        expect(screen.getByTestId(`unified-panel-tab-dirty-${fileTab}`)).toBeTruthy();

        fireEvent.click(screen.getByTestId(`unified-panel-tab-${fileTab}`));

        expect((screen.getByTestId('mock-monaco-textarea') as HTMLTextAreaElement).value).toBe('edited');
        // And its ✕ still asks, from the other side of the switch.
        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${fileTab}`));
        expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeTruthy();
    });

    it('drops a pending prompt whose tab went away with a chat switch', async () => {
        const { tabId, closeButton } = await dirtyFileTab();
        fireEvent.click(closeButton);
        expect(screen.getByTestId('explorer-close-tabs-prompt')).toBeTruthy();

        cleanup();
        // The same panel, now showing another chat: the file tab is chat-owned,
        // so it is not in this scope and there is nothing left to ask about.
        render(<UnifiedRightPanel workspaceId={WS} chatId="chat-2" dock={dockStub()} />);

        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
    });
});
