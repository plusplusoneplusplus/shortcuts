/**
 * AC-04: file, note, canvas, and diff tabs render real views inside the unified
 * panel.
 *
 * These cases pin what the panel adds on top of the reused views rather than
 * the views themselves (which keep their own suites): that a file tab is the
 * Explorer's own buffer routed at the tab's owning clone, that the descriptor's
 * read-only bit really removes the write path, that a hidden tab's dirty and
 * failed state surface in the strip, that a canvas tab is routed at the
 * workspace that owns the canvas, and that a diff tab resolves its group
 * through the transient source registry (including the expired state), and that
 * a note tab rebuilds the editor's wiring from its own descriptor.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
// The canvas panel owns a large kernel stack of its own; here only the routing
// it is handed matters.
vi.mock('../../../../src/server/spa/client/react/features/canvas/CanvasPanel', () => ({
    CanvasPanel: ({ workspaceId, canvasId, onClose }: any) => (
        <div data-testid="mock-canvas">
            canvas:{workspaceId}:{canvasId}
            <button data-testid="mock-canvas-close" onClick={onClose}>close</button>
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-terminal">terminal:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <div data-testid="mock-notes" />,
}));
// The note editor is a full tiptap stack; only the wiring it is handed matters
// here. The IO adapters are tagged so the fetch-mode choice is observable.
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: ({ workspaceId, notePath, io, notesRoot, scrollToLine }: any) => (
        <div
            data-testid="mock-note-editor"
            data-ws={workspaceId}
            data-path={notePath}
            data-io={io?.tag ?? 'default'}
            data-root={notesRoot ?? 'none'}
            data-line={scrollToLine ?? 'none'}
        />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/tasks/TasksNoteEditorIO', () => ({
    createTasksNoteEditorIO: () => ({ tag: 'tasks' }),
}));
vi.mock('../../../../src/server/spa/client/react/tasks/WorkspaceFileNoteEditorIO', () => ({
    createWorkspaceFileNoteEditorIO: () => ({ tag: 'workspace-file' }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
}));
// The diff chrome has its own suite; the real `useWhisperDiffState` stays in
// play so what this stub receives is the reconstruction the chat would show.
vi.mock('../../../../src/server/spa/client/react/features/chat/whisper-diff', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    WhisperDiffPanel: ({ state, workspaceRootPath, onClose }: any) => (
        <div data-testid="mock-whisper-diff">
            diff:{state.view.fileCount}:{workspaceRootPath ?? 'none'}
            <button data-testid="mock-whisper-diff-close" onClick={onClose}>close</button>
        </div>
    ),
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { openUnifiedPanelTab, unifiedTabIdFor } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import {
    clearUnifiedDiffSources,
    registerUnifiedDiffSource,
    whisperDiffTabInput,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedDiffSources';
import type { WhisperDiffOpenContext } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import { unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { noteResourceId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedNoteTabs';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

const WS = 'ws-1';
const CHAT = 'chat-1';
/** A repo-group member: the clone the bytes come from, not the panel's scope. */
const MEMBER = 'ws-member';

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

function renderPanel(props: Partial<React.ComponentProps<typeof UnifiedRightPanel>> = {}) {
    return render(<UnifiedRightPanel workspaceId={WS} chatId={CHAT} dock={props.dock ?? dockStub()} {...props} />);
}

/** File the descriptor the way an entry point does, before the panel mounts. */
function openFile(opts: { owner?: string; path: string; readOnly?: boolean; line?: number } = { path: 'src/a.ts' }) {
    return openUnifiedPanelTab(WS, {
        kind: 'file',
        ownerWorkspaceId: opts.owner ?? WS,
        chatId: CHAT,
        resourceId: opts.path,
        label: opts.path.split('/').pop() ?? opts.path,
        ...(opts.readOnly ? { readOnly: true } : {}),
        ...(opts.line === undefined ? {} : { line: opts.line }),
    });
}

/** A whisper group, the way a chat's files popover would hand one over. */
function diffCtx(overrides: Partial<WhisperDiffOpenContext> = {}): WhisperDiffOpenContext {
    return {
        files: [{
            path: 'src/a.ts',
            insertions: 1, deletions: 0, netInsertions: 1, netDeletions: 0,
            isCreate: false, isDeleted: false,
        }],
        toolCalls: [{ toolName: 'edit', args: { path: 'src/a.ts', oldString: 'a', newString: 'b' } }],
        commits: [],
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    clearUnifiedDiffSources();
    mockExplorerApi.searchFiles.mockResolvedValue({ results: [] });
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.writeBlob.mockResolvedValue({ success: true });
    localStorage.clear();
    clearUnifiedPanelState();
});
afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearUnifiedDiffSources();
});

describe('UnifiedRightPanel — file tabs (AC-04)', () => {
    it('reads and writes through the tab\'s owning clone, not the panel workspace', async () => {
        openFile({ owner: MEMBER, path: 'src/a.ts' });
        renderPanel();

        await screen.findByTestId('mock-monaco-textarea');
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith(MEMBER, 'src/a.ts', expect.anything());

        fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: 'edited' } });
        fireEvent.click(screen.getByTestId('save-btn'));
        await waitFor(() => expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith(MEMBER, 'src/a.ts', 'edited'));
    });

    it('keeps a read-only descriptor read-only: no save path at all', async () => {
        const tabId = openFile({ path: 'src/a.ts', readOnly: true });
        renderPanel();

        const editor = await screen.findByTestId('mock-monaco-textarea');
        expect(editor.getAttribute('data-readonly')).toBe('true');
        expect(screen.getByTestId(`unified-panel-tab-${tabId}`).getAttribute('data-readonly')).toBe('true');

        fireEvent.change(editor, { target: { value: 'sneaky' } });
        expect(screen.queryByTestId('save-btn')).toBeNull();
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
    });

    it('shows a hidden tab\'s unsaved edits in the strip, and clears them when it closes', async () => {
        const fileId = openFile({ path: 'src/a.ts' });
        const terminalId = openUnifiedPanelTab(WS, {
            kind: 'terminal', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'terminal', label: 'Terminal',
        });
        renderPanel();

        // Select the file, dirty it, then switch away: the marker is how an
        // unsaved buffer behind another tab stays findable.
        fireEvent.click(screen.getByTestId(`unified-panel-tab-${fileId}`));
        const editor = await screen.findByTestId('mock-monaco-textarea');
        fireEvent.change(editor, { target: { value: 'edited' } });
        await screen.findByTestId(`unified-panel-tab-dirty-${fileId}`);

        fireEvent.click(screen.getByTestId(`unified-panel-tab-${terminalId}`));
        expect(screen.getByTestId(`unified-panel-view-${fileId}`).getAttribute('data-active')).toBe('false');
        expect(screen.getByTestId(`unified-panel-tab-dirty-${fileId}`)).toBeTruthy();

        // Closing it now goes through AC-05's unsaved-changes prompt; the
        // marker clears once the buffer is actually discarded.
        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${fileId}`));
        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));
        await waitFor(() => expect(screen.queryByTestId(`unified-panel-tab-dirty-${fileId}`)).toBeNull());

        // Reopening the same file is a fresh, clean buffer rather than a tab
        // still wearing the closed one's dirty marker.
        openFile({ path: 'src/a.ts' });
        await screen.findByTestId(`unified-panel-tab-${fileId}`);
        expect(screen.queryByTestId(`unified-panel-tab-dirty-${fileId}`)).toBeNull();
    });

    it('marks a tab whose file failed to load, and keeps it retryable', async () => {
        mockExplorerApi.readBlob.mockRejectedValueOnce(new Error('ENOENT: no such file'));
        const fileId = openFile({ path: 'src/gone.ts' });
        renderPanel();

        await screen.findByTestId(`unified-panel-tab-error-${fileId}`);
        expect(screen.getByTestId('preview-error')).toHaveTextContent('ENOENT: no such file');

        fireEvent.click(screen.getByTestId('preview-retry-btn'));
        await screen.findByTestId('mock-monaco-textarea');
        expect(screen.queryByTestId(`unified-panel-tab-error-${fileId}`)).toBeNull();
    });

    it('closes its own tab from the view\'s close control', async () => {
        const fileId = openFile({ path: 'src/a.ts' });
        renderPanel();

        await screen.findByTestId('mock-monaco-textarea');
        fireEvent.click(screen.getByTestId('preview-close-btn'));
        expect(screen.queryByTestId(`unified-panel-tab-${fileId}`)).toBeNull();
    });
});

describe('UnifiedRightPanel — canvas and diff tabs (AC-04)', () => {
    it('routes a canvas tab at the workspace that owns the canvas', () => {
        openUnifiedPanelTab(WS, {
            kind: 'canvas', ownerWorkspaceId: MEMBER, chatId: CHAT, resourceId: 'canvas-7', label: 'Plan',
        });
        renderPanel();

        expect(screen.getByTestId('mock-canvas')).toHaveTextContent(`canvas:${MEMBER}:canvas-7`);
    });

    it('closes the canvas tab from the canvas panel\'s own close action', () => {
        openUnifiedPanelTab(WS, {
            kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'canvas-7', label: 'Plan',
        });
        const tabId = unifiedTabId({ kind: 'canvas', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'canvas-7' });
        renderPanel();

        fireEvent.click(screen.getByTestId('mock-canvas-close'));
        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
    });

    it('renders a registered group through the chat\'s own diff panel', () => {
        const input = whisperDiffTabInput({
            ctx: diffCtx(), ownerWorkspaceId: MEMBER, chatId: CHAT, workspaceRootPath: '/repo',
        });
        openUnifiedPanelTab(WS, input);
        renderPanel();

        expect(screen.getByTestId('mock-whisper-diff')).toHaveTextContent('diff:1:/repo');
        expect(screen.getByTestId(`unified-panel-tab-${unifiedTabIdFor(input)}`)).toHaveTextContent('1 file changed');
    });

    it('opens one tab for the footer and a file row of the same group', () => {
        const first = whisperDiffTabInput({ ctx: diffCtx(), ownerWorkspaceId: WS, chatId: CHAT });
        const second = whisperDiffTabInput({
            ctx: diffCtx({ focusPath: 'src/a.ts' }), ownerWorkspaceId: WS, chatId: CHAT,
        });
        openUnifiedPanelTab(WS, first);
        openUnifiedPanelTab(WS, second);
        renderPanel();

        expect(unifiedTabIdFor(second)).toBe(unifiedTabIdFor(first));
        expect(screen.getAllByTestId(/^unified-panel-tab-diff\|/).length).toBe(1);
    });

    it('shows the expired state, and marks it, when the group is gone', () => {
        // A reload keeps the descriptor but not the in-memory transcript.
        const tabId = openUnifiedPanelTab(WS, {
            kind: 'diff', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'whisper-1-gone', label: '1 file changed',
        });
        renderPanel();

        expect(screen.getByTestId('unified-panel-diff-expired')).toHaveTextContent('no longer available');
        expect(screen.getByTestId(`unified-panel-tab-error-${tabId}`)).toBeTruthy();

        fireEvent.click(screen.getByTestId('unified-panel-diff-expired-close'));
        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
    });

    it('replaces the expired state when the chat registers the group afterwards', () => {
        const input = whisperDiffTabInput({ ctx: diffCtx(), ownerWorkspaceId: WS, chatId: CHAT });
        const tabId = openUnifiedPanelTab(WS, input);
        clearUnifiedDiffSources();
        renderPanel();

        expect(screen.getByTestId('unified-panel-diff-expired')).toBeTruthy();

        // The transcript mounts and re-registers the same group: the live tab
        // has to pick it up rather than stay dead until it is reopened.
        act(() => {
            registerUnifiedDiffSource(diffCtx());
        });
        expect(screen.getByTestId('mock-whisper-diff')).toBeTruthy();
        expect(screen.queryByTestId(`unified-panel-tab-error-${tabId}`)).toBeNull();
    });

    it('closes its own tab from the diff panel\'s close action', () => {
        const input = whisperDiffTabInput({ ctx: diffCtx(), ownerWorkspaceId: WS, chatId: CHAT });
        const tabId = openUnifiedPanelTab(WS, input);
        renderPanel();

        fireEvent.click(screen.getByTestId('mock-whisper-diff-close'));
        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
    });
});

describe('UnifiedRightPanel — note tabs (AC-04)', () => {
    /** File a note descriptor the way a chat note link does. */
    function openNote(resourceId: string, opts: { owner?: string; line?: number } = {}) {
        return openUnifiedPanelTab(WS, {
            kind: 'note',
            ownerWorkspaceId: opts.owner ?? WS,
            chatId: CHAT,
            resourceId,
            label: 'plan.md',
            ...(opts.line === undefined ? {} : { line: opts.line }),
        });
    }

    it('rebuilds the editor wiring from the descriptor alone, at the owning clone', () => {
        openNote(noteResourceId({ fetchMode: 'auto', notePath: '/repos/member/notes/plan.md' }), {
            owner: MEMBER, line: 9,
        });
        renderPanel();

        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-ws')).toBe(MEMBER);
        expect(editor.getAttribute('data-path')).toBe('/repos/member/notes/plan.md');
        expect(editor.getAttribute('data-io')).toBe('workspace-file');
        expect(editor.getAttribute('data-line')).toBe('9');
    });

    it('uses the tasks adapter and root for a note under a tasks root', () => {
        openNote(noteResourceId({
            fetchMode: 'tasks', notesRoot: '/repos/main/.vscode/tasks', notePath: 't1/goal.md',
        }));
        renderPanel();

        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-io')).toBe('tasks');
        expect(editor.getAttribute('data-root')).toBe('/repos/main/.vscode/tasks');
        expect(editor.getAttribute('data-path')).toBe('t1/goal.md');
    });

    it('stays visible after a chat switch — a note belongs to the workspace', () => {
        const tabId = openNote(noteResourceId({ fetchMode: 'auto', notePath: '/repos/main/notes/plan.md' }));
        const { rerender } = renderPanel();
        expect(screen.getByTestId(`unified-panel-tab-${tabId}`)).toBeTruthy();

        rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-other" dock={dockStub()} />);
        expect(screen.getByTestId(`unified-panel-tab-${tabId}`)).toBeTruthy();
        expect(screen.getByTestId('mock-note-editor')).toBeTruthy();
    });

    it('shows an explicit state, and marks the tab, for a descriptor it cannot decode', () => {
        const tabId = openNote('notes/plan.md');
        renderPanel();

        expect(screen.getByTestId('unified-panel-note-invalid')).toBeTruthy();
        expect(screen.queryByTestId('mock-note-editor')).toBeNull();
        expect(screen.getByTestId(`unified-panel-tab-error-${tabId}`)).toBeTruthy();

        fireEvent.click(screen.getByTestId('unified-panel-note-invalid-close'));
        expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
    });
});
