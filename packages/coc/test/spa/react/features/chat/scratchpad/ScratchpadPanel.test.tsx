import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
