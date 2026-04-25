/**
 * @vitest-environment jsdom
 *
 * Unit tests for ScratchpadPanel — Run Skill button visibility, dispatch,
 * and comment integration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockQueueDispatch = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: {},
        dispatch: mockQueueDispatch,
    }),
}));

// Mock useComments to provide controllable comment state.
const mockCreateThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
const mockDeleteThread = vi.fn().mockResolvedValue(undefined);
const mockResolveThread = vi.fn().mockResolvedValue(undefined);
const mockReopenThread = vi.fn().mockResolvedValue(undefined);
const mockUseComments = vi.fn().mockReturnValue({
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
    createThread: mockCreateThread,
    resolveThread: mockResolveThread,
    reopenThread: mockReopenThread,
    deleteThread: mockDeleteThread,
    addComment: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    reload: vi.fn(),
});

vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/useComments', () => ({
    useComments: (...args: unknown[]) => mockUseComments(...args),
}));

vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring', () => ({
    createTextAnchorFromSelection: vi.fn(),
    findAnchorInDoc: vi.fn(),
    applyCommentMark: vi.fn(),
}));

// Stub NoteEditor to expose comment props for assertion.
let capturedNoteEditorProps: Record<string, unknown> = {};
vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: (props: Record<string, unknown>) => {
        capturedNoteEditorProps = props;
        return (
            <div data-testid="note-editor">
                {props.toolbarRight as React.ReactNode}
            </div>
        );
    },
}));

// Stub CommentsSidebar
vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/CommentsSidebar', () => ({
    CommentsSidebar: (props: Record<string, unknown>) => (
        <div data-testid="comments-sidebar" data-workspace-id={props.workspaceId as string} />
    ),
}));

import { ScratchpadPanel } from '../../../../../src/server/spa/client/react/features/chat/scratchpad/ScratchpadPanel';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ScratchpadPanel — Run Skill button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedNoteEditorProps = {};
    });

    afterEach(() => {
        cleanup();
    });

    // ── isPlanFile detection ───────────────────────────────────────────────

    it('shows Run Skill button for exact "plan.md" filename', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.getByTestId('scratchpad-run-skill')).toBeTruthy();
    });

    it('shows Run Skill button for "*.plan.md" pattern', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/tasks/my-feature.plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.getByTestId('scratchpad-run-skill')).toBeTruthy();
    });

    it('shows Run Skill button for Windows-style backslash path with plan.md', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="C:\\Users\\user\\.coc\\repos\\ws1\\tasks\\coc\\something.plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.getByTestId('scratchpad-run-skill')).toBeTruthy();
    });

    it('does NOT show Run Skill button for a regular .md file', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/notes.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.queryByTestId('scratchpad-run-skill')).toBeNull();
    });

    it('does NOT show Run Skill button for a file containing "plan" but not ending in "plan.md"', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/plan-notes.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.queryByTestId('scratchpad-run-skill')).toBeNull();
    });

    it('does NOT show Run Skill button when notePath is null', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath={null}
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.queryByTestId('scratchpad-run-skill')).toBeNull();
    });

    it('does NOT show Run Skill button for a non-md file named plan', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/plan.ts"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.queryByTestId('scratchpad-run-skill')).toBeNull();
    });

    // ── Dispatch behavior ──────────────────────────────────────────────────

    it('dispatches OPEN_DIALOG with correct workspaceId and contextFiles on click', async () => {
        const user = userEvent.setup();
        render(
            <ScratchpadPanel
                workspaceId="ws-abc"
                notePath="/tasks/feature.plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        const btn = screen.getByTestId('scratchpad-run-skill');
        await user.click(btn);

        expect(mockQueueDispatch).toHaveBeenCalledOnce();
        expect(mockQueueDispatch).toHaveBeenCalledWith({
            type: 'OPEN_DIALOG',
            workspaceId: 'ws-abc',
            contextFiles: ['/tasks/feature.plan.md'],
        });
    });

    it('passes toolbarRight into NoteEditor', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        // The Run Skill button should be rendered inside the (mocked) NoteEditor
        const editor = screen.getByTestId('note-editor');
        expect(editor.querySelector('[data-testid="scratchpad-run-skill"]')).toBeTruthy();
    });
});

describe('ScratchpadPanel — Comment integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedNoteEditorProps = {};
    });

    afterEach(() => {
        cleanup();
    });

    it('calls useComments with workspaceId and notePath', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws-42"
                notePath="/some/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(mockUseComments).toHaveBeenCalledWith({
            workspaceId: 'ws-42',
            notePath: '/some/note.md',
        });
    });

    it('passes commentsEnabled=true to NoteEditor', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(capturedNoteEditorProps.commentsEnabled).toBe(true);
    });

    it('passes onCommentCreate callback to NoteEditor', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(typeof capturedNoteEditorProps.onCommentCreate).toBe('function');
    });

    it('passes onEditorReady callback to NoteEditor', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(typeof capturedNoteEditorProps.onEditorReady).toBe('function');
    });

    it('passes threads from useComments to NoteEditor', () => {
        const threads = [{ id: 't1', status: 'open', anchor: {}, comments: [] }];
        mockUseComments.mockReturnValueOnce({
            ...mockUseComments(),
            allThreads: threads,
        });
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(capturedNoteEditorProps.threads).toBe(threads);
    });

    it('passes commentCount to NoteEditor', () => {
        mockUseComments.mockReturnValueOnce({
            ...mockUseComments(),
            totalCount: 5,
        });
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(capturedNoteEditorProps.commentCount).toBe(5);
    });

    it('does not render comments panel by default', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.queryByTestId('scratchpad-comments-panel')).toBeNull();
    });

    it('opens comments panel when onToggleCommentsPanel is invoked', async () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        // Invoke the toggle callback that was passed to NoteEditor
        const toggleFn = capturedNoteEditorProps.onToggleCommentsPanel as () => void;
        expect(typeof toggleFn).toBe('function');

        // Use act to trigger state update
        const { act } = await import('@testing-library/react');
        await act(() => { toggleFn(); });

        expect(screen.getByTestId('scratchpad-comments-panel')).toBeTruthy();
        expect(screen.getByTestId('comments-sidebar')).toBeTruthy();
    });

    it('closes comments panel when close button is clicked', async () => {
        const user = userEvent.setup();
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        // Open panel first
        const { act } = await import('@testing-library/react');
        const toggleFn = capturedNoteEditorProps.onToggleCommentsPanel as () => void;
        await act(() => { toggleFn(); });

        expect(screen.getByTestId('scratchpad-comments-panel')).toBeTruthy();

        // Click close button
        await user.click(screen.getByTestId('scratchpad-comments-close'));
        expect(screen.queryByTestId('scratchpad-comments-panel')).toBeNull();
    });

    it('NoteEditor wrapper does not have overflow-hidden (scroll regression guard)', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        const noteEditor = screen.getByTestId('note-editor');
        const wrapper = noteEditor.parentElement!;
        expect(wrapper.className).not.toContain('overflow-hidden');
        expect(wrapper.className).toContain('flex');
        expect(wrapper.className).toContain('flex-col');
    });

    it('does not render comments panel when notePath is null even if toggled', async () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath={null}
                onClose={vi.fn()}
                height="auto"
            />
        );

        const { act } = await import('@testing-library/react');
        const toggleFn = capturedNoteEditorProps.onToggleCommentsPanel as () => void;
        await act(() => { toggleFn(); });

        expect(screen.queryByTestId('scratchpad-comments-panel')).toBeNull();
    });
});

describe('ScratchpadPanel — right-side comments layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedNoteEditorProps = {};
    });

    afterEach(() => {
        cleanup();
    });

    it('body container uses flex-row when comments panel is open', async () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        const { act } = await import('@testing-library/react');
        const toggleFn = capturedNoteEditorProps.onToggleCommentsPanel as () => void;
        await act(() => { toggleFn(); });

        const panel = screen.getByTestId('scratchpad-comments-panel');
        // The body container is the grandparent of note-editor (parent of editor wrapper)
        const editorWrapper = screen.getByTestId('note-editor').parentElement!;
        const bodyContainer = editorWrapper.parentElement!;
        expect(bodyContainer.className).toContain('flex-row');
        expect(bodyContainer.className).not.toContain('flex-col');
        // The sidebar is a sibling of the editor wrapper inside the body
        expect(panel.parentElement).toBe(bodyContainer);
    });

    it('body container uses flex-col when comments panel is closed', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        const editorWrapper = screen.getByTestId('note-editor').parentElement!;
        const bodyContainer = editorWrapper.parentElement!;
        expect(bodyContainer.className).toContain('flex-col');
        expect(bodyContainer.className).not.toContain('flex-row');
    });

    it('comments panel has border-l (right-side separator), not border-t', async () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        const { act } = await import('@testing-library/react');
        const toggleFn = capturedNoteEditorProps.onToggleCommentsPanel as () => void;
        await act(() => { toggleFn(); });

        const panel = screen.getByTestId('scratchpad-comments-panel');
        expect(panel.className).toContain('border-l');
        expect(panel.className).not.toContain('border-t');
    });

    it('comments panel has fixed width w-64', async () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        const { act } = await import('@testing-library/react');
        const toggleFn = capturedNoteEditorProps.onToggleCommentsPanel as () => void;
        await act(() => { toggleFn(); });

        const panel = screen.getByTestId('scratchpad-comments-panel');
        expect(panel.className).toContain('w-64');
    });

    it('comments panel has no maxHeight inline style', async () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        const { act } = await import('@testing-library/react');
        const toggleFn = capturedNoteEditorProps.onToggleCommentsPanel as () => void;
        await act(() => { toggleFn(); });

        const panel = screen.getByTestId('scratchpad-comments-panel');
        expect(panel.style.maxHeight).toBe('');
    });

    it('editor wrapper has flex-1 and min-w-0 to yield space to sidebar', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/note.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        const editorWrapper = screen.getByTestId('note-editor').parentElement!;
        expect(editorWrapper.className).toContain('flex-1');
        expect(editorWrapper.className).toContain('min-w-0');
    });
});
