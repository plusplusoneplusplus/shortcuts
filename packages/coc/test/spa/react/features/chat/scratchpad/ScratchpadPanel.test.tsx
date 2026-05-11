import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScratchpadPanel } from '../../../../../../src/server/spa/client/react/features/chat/scratchpad/ScratchpadPanel';

vi.mock('../../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: {},
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: (props: { workspaceId: string; notePath: string | null; onNotFound?: () => void; commentsEnabled?: boolean; onCommentCreate?: () => void }) => (
        <div
            data-testid="mock-note-editor"
            data-workspace-id={props.workspaceId}
            data-note-path={props.notePath ?? ''}
            data-has-not-found={props.onNotFound !== undefined ? 'true' : 'false'}
            data-comments-enabled={String(props.commentsEnabled ?? false)}
            data-has-comment-create={props.onCommentCreate !== undefined ? 'true' : 'false'}
        />
    ),
}));

vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/useComments', () => ({
    useComments: () => ({
        threads: [],
        allThreads: [],
        selectedThreadId: null,
        filter: 'all',
        loading: false,
        error: null,
        totalCount: 0,
        openCount: 0,
        resolvedCount: 0,
        setFilter: vi.fn(),
        selectThread: vi.fn(),
        createThread: vi.fn().mockResolvedValue({ id: 't1' }),
        resolveThread: vi.fn(),
        reopenThread: vi.fn(),
        deleteThread: vi.fn(),
        addComment: vi.fn(),
        editComment: vi.fn(),
        deleteComment: vi.fn(),
        reload: vi.fn(),
    }),
}));

vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring', () => ({
    createTextAnchorFromSelection: vi.fn(),
    findAnchorInDoc: vi.fn(),
    applyCommentMark: vi.fn(),
}));

vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/CommentsSidebar', () => ({
    CommentsSidebar: () => <div data-testid="mock-comments-sidebar" />,
}));

afterEach(() => {
    cleanup();
});

function renderScratchpadWithTabs(workspaceRootPath = 'C:\\repo\\project\\') {
    const onSelectFile = vi.fn();
    render(
        <ScratchpadPanel
            workspaceId="ws-1"
            notePath="tasks/coc/foo.md"
            onClose={vi.fn()}
            height="50%"
            headerBar={{
                expandMode: 'split',
                isDragging: false,
                onExpandTop: vi.fn(),
                onExpandBottom: vi.fn(),
                onSplitReset: vi.fn(),
                files: ['tasks/coc/foo.md', 'tasks/coc/bar.md'],
                onSelectFile,
                workspaceRootPath,
            }}
        />,
    );
    return { onSelectFile };
}

describe('ScratchpadPanel — headerBar prop', () => {
    it('does NOT render scratchpad-divider when headerBar is not provided', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="50%" />);
        expect(screen.queryByTestId('scratchpad-divider')).toBeNull();
    });

    it('renders scratchpad-divider when headerBar is provided', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws-1"
                notePath="note.md"
                onClose={vi.fn()}
                height="50%"
                headerBar={{
                    expandMode: 'split',
                    isDragging: false,
                    onExpandTop: vi.fn(),
                    onExpandBottom: vi.fn(),
                    onSplitReset: vi.fn(),
                }}
            />,
        );
        expect(screen.getByTestId('scratchpad-divider')).toBeTruthy();
    });

    it('renders expand, split and close buttons inside the header bar', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws-1"
                notePath="note.md"
                onClose={vi.fn()}
                height="50%"
                headerBar={{
                    expandMode: 'split',
                    isDragging: false,
                    onExpandTop: vi.fn(),
                    onExpandBottom: vi.fn(),
                    onSplitReset: vi.fn(),
                }}
            />,
        );
        expect(screen.getByTestId('scratchpad-expand-top-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-expand-bottom-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-split-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-close-btn')).toBeTruthy();
    });

    it('header bar uses border-b (panelHeader styling)', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws-1"
                notePath="note.md"
                onClose={vi.fn()}
                height="50%"
                headerBar={{
                    expandMode: 'split',
                    isDragging: false,
                    onExpandTop: vi.fn(),
                    onExpandBottom: vi.fn(),
                    onSplitReset: vi.fn(),
                }}
            />,
        );
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.className).toContain('border-b');
        expect(divider.className).not.toContain('border-t');
    });

    it('renders tab strip in header bar when files are provided', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws-1"
                notePath="a.md"
                onClose={vi.fn()}
                height="50%"
                headerBar={{
                    expandMode: 'split',
                    isDragging: false,
                    onExpandTop: vi.fn(),
                    onExpandBottom: vi.fn(),
                    onSplitReset: vi.fn(),
                    files: ['a.md', 'b.md'],
                    onSelectFile: vi.fn(),
                }}
            />,
        );
        expect(screen.getByTestId('scratchpad-file-tabs')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-tab-a')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-tab-b')).toBeTruthy();
    });

    it('still renders NoteEditor when headerBar is provided', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws-abc"
                notePath="tasks/plan.md"
                onClose={vi.fn()}
                height="50%"
                headerBar={{
                    expandMode: 'split',
                    isDragging: false,
                    onExpandTop: vi.fn(),
                    onExpandBottom: vi.fn(),
                    onSplitReset: vi.fn(),
                }}
            />,
        );
        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-workspace-id')).toBe('ws-abc');
        expect(editor.getAttribute('data-note-path')).toBe('tasks/plan.md');
    });
});

describe('ScratchpadPanel', () => {
    it('renders with data-testid="scratchpad-panel"', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="40%" />);
        expect(screen.getByTestId('scratchpad-panel')).toBeTruthy();
    });

    it('applies height as inline style', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="40%" />);
        const panel = screen.getByTestId('scratchpad-panel');
        expect(panel.style.height).toBe('40%');
    });

    it('applies numeric height as px in inline style', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height={240} />);
        const panel = screen.getByTestId('scratchpad-panel');
        expect(panel.style.height).toBe('240px');
    });

    it('sets minHeight to 0 in inline style', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="50%" />);
        const panel = screen.getByTestId('scratchpad-panel');
        expect(panel.style.minHeight).toBe('0');
    });

    it('renders NoteEditor with correct workspaceId and notePath', () => {
        render(<ScratchpadPanel workspaceId="ws-abc" notePath="tasks/plan.md" onClose={vi.fn()} height="50%" />);
        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-workspace-id')).toBe('ws-abc');
        expect(editor.getAttribute('data-note-path')).toBe('tasks/plan.md');
    });

    it('renders without crashing when notePath is null', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath={null} onClose={vi.fn()} height="50%" />);
        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-note-path')).toBe('');
    });

    it('has overflow-hidden class', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="40%" />);
        const panel = screen.getByTestId('scratchpad-panel');
        expect(panel.className).toContain('overflow-hidden');
    });

    it('forwards onNotFound to NoteEditor when provided', () => {
        const onNotFound = vi.fn();
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="50%" onNotFound={onNotFound} />);
        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-has-not-found')).toBe('true');
    });

    it('passes undefined onNotFound to NoteEditor when not provided', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="50%" />);
        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-has-not-found')).toBe('false');
    });

    it('passes commentsEnabled=true to NoteEditor', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="50%" />);
        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-comments-enabled')).toBe('true');
    });

    it('passes onCommentCreate to NoteEditor', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="50%" />);
        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-has-comment-create')).toBe('true');
    });
});

describe('ScratchpadPanel — tab copy path context menu', () => {
    const writeText = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        writeText.mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
    });

    it('opens the copy-path menu on tab context-menu and prevents the native menu', () => {
        renderScratchpadWithTabs();

        const prevented = !fireEvent.contextMenu(screen.getByTestId('scratchpad-tab-bar'), {
            clientX: 40,
            clientY: 50,
        });

        expect(prevented).toBe(true);
        expect(screen.getByTestId('scratchpad-tab-context-menu')).toBeTruthy();
        expect(screen.getByText('Copy Absolute Path')).toBeTruthy();
        expect(screen.getByText('Copy Relative Path')).toBeTruthy();
    });

    it('copies the exact relative path for the selected tab', async () => {
        renderScratchpadWithTabs();

        fireEvent.contextMenu(screen.getByTestId('scratchpad-tab-bar'), { clientX: 40, clientY: 50 });
        fireEvent.click(screen.getByTestId('scratchpad-copy-relative-path'));

        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith('tasks/coc/bar.md');
        });
    });

    it('copies a normalized absolute path with stripped root slash and no duplicate slash', async () => {
        renderScratchpadWithTabs('C:\\repo\\project\\');

        fireEvent.contextMenu(screen.getByTestId('scratchpad-tab-bar'), { clientX: 40, clientY: 50 });
        fireEvent.click(screen.getByTestId('scratchpad-copy-absolute-path'));

        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith('C:/repo/project/tasks/coc/bar.md');
        });
    });

    it('disables absolute path copy when the workspace root path is empty', () => {
        renderScratchpadWithTabs('');

        fireEvent.contextMenu(screen.getByTestId('scratchpad-tab-bar'), { clientX: 40, clientY: 50 });

        const absolute = screen.getByTestId('scratchpad-copy-absolute-path') as HTMLButtonElement;
        expect(absolute.disabled).toBe(true);
        expect(absolute.title).toBe('Workspace has no root path');
        expect(screen.getByTestId('scratchpad-copy-relative-path')).toBeTruthy();
    });

    it('closes the menu on outside click and Escape', () => {
        renderScratchpadWithTabs();

        fireEvent.contextMenu(screen.getByTestId('scratchpad-tab-bar'), { clientX: 40, clientY: 50 });
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('scratchpad-tab-context-menu')).toBeNull();

        fireEvent.contextMenu(screen.getByTestId('scratchpad-tab-bar'), { clientX: 40, clientY: 50 });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('scratchpad-tab-context-menu')).toBeNull();
    });

    it('keeps left-click tab selection behavior unchanged', async () => {
        const user = userEvent.setup();
        const { onSelectFile } = renderScratchpadWithTabs();

        await user.click(screen.getByTestId('scratchpad-tab-bar'));

        expect(onSelectFile).toHaveBeenCalledWith('tasks/coc/bar.md');
    });

    it('supports arrow-key focus movement and Enter activation', async () => {
        renderScratchpadWithTabs();

        fireEvent.contextMenu(screen.getByTestId('scratchpad-tab-bar'), { clientX: 40, clientY: 50 });
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByTestId('scratchpad-copy-absolute-path'));
        });

        fireEvent.keyDown(screen.getByTestId('scratchpad-tab-context-menu'), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByTestId('scratchpad-copy-relative-path'));

        fireEvent.keyDown(screen.getByTestId('scratchpad-tab-context-menu'), { key: 'Tab' });
        expect(document.activeElement).toBe(screen.getByTestId('scratchpad-copy-absolute-path'));

        fireEvent.keyDown(screen.getByTestId('scratchpad-tab-context-menu'), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByTestId('scratchpad-copy-relative-path'));

        fireEvent.keyDown(screen.getByTestId('scratchpad-tab-context-menu'), { key: 'Enter' });
        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith('tasks/coc/bar.md');
        });
    });
});
