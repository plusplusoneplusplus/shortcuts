// @vitest-environment jsdom
/**
 * Scratchpad comment-creation flow.
 *
 * Unlike ScratchpadPanel.test.tsx (which stubs the sidebar out to assert prop
 * wiring), this file keeps the real CommentsSidebar and the real useComments
 * hook so the create path is exercised end to end down to the notesApi call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommentThread, NoteSidecar } from '../../../../../../src/server/spa/client/react/features/notes/notesApi';

vi.mock('../../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ notes: { sendCommentResolutionMessage: vi.fn() } }),
}));

vi.mock('../../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

const mockGetComments = vi.fn<any[], Promise<NoteSidecar>>();
const mockCreateThread = vi.fn<any[], Promise<{ thread: CommentThread }>>();
const mockGetContent = vi.fn<any[], Promise<{ content: string }>>();

vi.mock('../../../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getComments: (...args: any[]) => mockGetComments(...args),
        createThread: (...args: any[]) => mockCreateThread(...args),
        getContent: (...args: any[]) => mockGetContent(...args),
        updateThread: vi.fn(),
        deleteThread: vi.fn(),
        addComment: vi.fn(),
        editComment: vi.fn(),
        deleteComment: vi.fn(),
        batchResolve: vi.fn(),
    },
}));

const ANCHOR = { quotedText: 'selected words', prefix: 'before ', suffix: ' after' };

const revealCommentThreadSpy = vi.fn();

vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring', () => ({
    createTextAnchorFromSelection: () => ANCHOR,
    findAnchorInDoc: () => null,
    applyCommentMark: vi.fn(),
    revealCommentThread: (...args: any[]) => revealCommentThreadSpy(...args),
}));

// A minimal editor stub: non-empty selection plus the chainable command API
// ScratchpadPanel uses after a thread is created.
const setCommentSpy = vi.fn();

function makeEditorStub() {
    const chain: any = {
        setTextSelection: () => chain,
        setComment: (id: string) => { setCommentSpy(id); return chain; },
        scrollIntoView: () => chain,
        run: () => true,
    };
    return {
        state: {
            selection: { empty: false, from: 1, to: 5 },
            doc: { descendants: () => { /* no marks in the stub doc */ } },
        },
        chain: () => chain,
        commands: { unsetComment: vi.fn() },
    };
}

vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: (props: { onEditorReady?: (e: any) => void; onCommentCreate?: () => void }) => (
        <div data-testid="mock-note-editor">
            <button
                data-testid="mock-editor-ready"
                onClick={() => props.onEditorReady?.(makeEditorStub())}
            >
                ready
            </button>
            <button data-testid="mock-add-comment" onClick={() => props.onCommentCreate?.()}>
                add comment
            </button>
        </div>
    ),
}));

import { ScratchpadPanel } from '../../../../../../src/server/spa/client/react/features/chat/scratchpad/ScratchpadPanel';

const CREATED_THREAD: CommentThread = {
    id: 'thread-created',
    anchor: ANCHOR,
    status: 'open',
    comments: [{ id: 'c1', content: 'Please clarify this', createdAt: '2024-01-15T10:00:00Z' }],
    createdAt: '2024-01-15T10:00:00Z',
};

async function openCommentDialog(user: ReturnType<typeof userEvent.setup>) {
    render(
        <ScratchpadPanel
            workspaceId="ws-1"
            notePath="/home/user/repo/docs/design.md"
            onClose={vi.fn()}
            height="50%"
        />,
    );
    await user.click(screen.getByTestId('mock-editor-ready'));
    await user.click(screen.getByTestId('mock-add-comment'));
}

describe('ScratchpadPanel — comment creation', () => {
    beforeEach(() => {
        mockGetComments.mockResolvedValue({ version: 1, threads: {} } as unknown as NoteSidecar);
        mockCreateThread.mockResolvedValue({ thread: CREATED_THREAD });
        mockGetContent.mockResolvedValue({ content: '' });
        setCommentSpy.mockClear();
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('prompts for comment text instead of creating an empty thread', async () => {
        const user = userEvent.setup();
        await openCommentDialog(user);

        expect(await screen.findByTestId('add-comment-dialog-confirm')).toBeTruthy();
        expect(mockCreateThread).not.toHaveBeenCalled();
    });

    it('creates the thread with the typed text and marks the selection', async () => {
        const user = userEvent.setup();
        await openCommentDialog(user);

        await user.type(await screen.findByRole('textbox'), 'Please clarify this');
        await user.click(screen.getByTestId('add-comment-dialog-confirm'));

        await waitFor(() => expect(mockCreateThread).toHaveBeenCalledTimes(1));
        const [, notePath, thread] = mockCreateThread.mock.calls[0];
        expect(notePath).toBe('/home/user/repo/docs/design.md');
        expect(thread.comments[0].content).toBe('Please clarify this');
        expect(thread.anchor).toEqual(ANCHOR);

        await waitFor(() => expect(setCommentSpy).toHaveBeenCalledWith('thread-created'));

        // The real sidebar renders the new thread.
        expect(await screen.findByTestId('comment-thread-thread-created')).toBeTruthy();
    });

    it('does not create a thread when the dialog is cancelled', async () => {
        const user = userEvent.setup();
        await openCommentDialog(user);

        await user.click(await screen.findByTestId('add-comment-dialog-cancel'));
        expect(mockCreateThread).not.toHaveBeenCalled();
        expect(screen.queryByTestId('add-comment-dialog-confirm')).toBeNull();
    });

    it('reveals the commented text when a comment card is clicked', async () => {
        const user = userEvent.setup();
        render(
            <ScratchpadPanel
                workspaceId="ws-1"
                notePath="/home/user/repo/docs/design.md"
                onClose={vi.fn()}
                height="50%"
            />,
        );
        await user.click(screen.getByTestId('mock-editor-ready'));
        // Creating a thread is what opens the sidebar in this panel.
        await user.click(screen.getByTestId('mock-add-comment'));
        await user.type(await screen.findByRole('textbox'), 'Please clarify this');
        await user.click(screen.getByTestId('add-comment-dialog-confirm'));

        const card = await screen.findByTestId('comment-thread-thread-created');
        revealCommentThreadSpy.mockClear();
        await user.click(card);

        await waitFor(() => expect(revealCommentThreadSpy).toHaveBeenCalledTimes(1));
        const [editor, threadId, thread] = revealCommentThreadSpy.mock.calls[0];
        expect(threadId).toBe('thread-created');
        expect(editor).toBeTruthy();
        // The thread is passed through so resolved cards can fall back to their anchor.
        expect(thread?.id).toBe('thread-created');
    });

    it('surfaces a create failure in the comments sidebar', async () => {
        mockCreateThread.mockRejectedValue(new Error('Access denied: path is outside workspace data directory'));
        const user = userEvent.setup();
        await openCommentDialog(user);

        await user.type(await screen.findByRole('textbox'), 'Please clarify this');
        await user.click(screen.getByTestId('add-comment-dialog-confirm'));

        const error = await screen.findByTestId('comments-error');
        expect(error.textContent).toContain('Access denied');
    });
});
