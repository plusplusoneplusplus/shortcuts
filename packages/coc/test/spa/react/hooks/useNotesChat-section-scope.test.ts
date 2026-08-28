// @vitest-environment jsdom
/**
 * Section scope in the real useNotesChat hook.
 *
 * The point of `per-section` is that switching between siblings in one folder
 * keeps the chat you were just having. That rests on three things agreeing on a
 * single key — the note's nearest parent folder:
 *
 *  - resolution reads `perNoteMap[folder]`,
 *  - createChat mirrors the binding under `folder` (matching what the server
 *    binds, so the local map and the server don't drift until reload),
 *  - resetChat and the server cleanup drop that same `folder` key.
 *
 * Plus two things that would otherwise read as broken: the scope survives a
 * reload, and a half-typed draft survives a sibling click.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const state = {
    createdRequests: [] as Array<{ workspaceId: string; request: any }>,
    deletedPaths: [] as Array<{ workspaceId: string; notePath: string }>,
    movedNotes: [] as Array<{ processId: string; request: any }>,
    boundPaths: [] as Array<{ workspaceId: string; notePath: string; taskId: string }>,
    bindings: {} as Record<string, { taskId: string }>,
    nextTaskId: 'task-1',
    moveFails: false,
};

const LOCAL = {
    notes: {
        listChatBindings: vi.fn(async () => ({ bindings: state.bindings })),
        createChat: vi.fn(async (workspaceId: string, request: any) => {
            state.createdRequests.push({ workspaceId, request });
            return { task: { id: state.nextTaskId } };
        }),
        deleteChatBindingByPath: vi.fn(async (workspaceId: string, notePath: string) => {
            state.deletedPaths.push({ workspaceId, notePath });
        }),
        setChatBindingByPath: vi.fn(async (workspaceId: string, notePath: string, taskId: string) => {
            state.boundPaths.push({ workspaceId, notePath, taskId });
            return { notePath, taskId, createdAt: '2026-01-01T00:00:00.000Z' };
        }),
        setChatNote: vi.fn(async (processId: string, request: any) => {
            if (state.moveFails) throw new Error('rejected');
            state.movedNotes.push({ processId, request });
            return request;
        }),
    },
};

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => LOCAL,
    getCocClientFor: () => LOCAL,
}));

import {
    useNotesChat,
    notesChatDraftKey,
    noteSectionOf,
} from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesChat';

const WS = 'ws-1';
const SECTION = 'MultiModal';
const NOTE_A = 'MultiModal/first-five-days.md';
const NOTE_B = 'MultiModal/project.md';

async function flushSeed() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
    localStorage.clear();
    state.createdRequests = [];
    state.deletedPaths = [];
    state.movedNotes = [];
    state.boundPaths = [];
    state.bindings = {};
    state.nextTaskId = 'task-1';
    state.moveFails = false;
    LOCAL.notes.listChatBindings.mockClear();
    LOCAL.notes.createChat.mockClear();
    LOCAL.notes.deleteChatBindingByPath.mockClear();
    LOCAL.notes.setChatNote.mockClear();
    LOCAL.notes.setChatBindingByPath.mockClear();
});

// ── noteSectionOf ────────────────────────────────────────────────────────────

describe('noteSectionOf', () => {
    it('returns the nearest parent folder', () => {
        expect(noteSectionOf(NOTE_A)).toBe('MultiModal');
    });

    it('uses the nearest parent, not the top-level folder', () => {
        expect(noteSectionOf('MultiModal/sub/deep.md')).toBe('MultiModal/sub');
    });

    it('returns null for a note at the notes root — it has no section', () => {
        expect(noteSectionOf('inbox.md')).toBeNull();
    });

    it('returns null for no note', () => {
        expect(noteSectionOf(null)).toBeNull();
        expect(noteSectionOf(undefined)).toBeNull();
    });

    it('normalizes separators and stray slashes before splitting', () => {
        expect(noteSectionOf('MultiModal\\project.md')).toBe('MultiModal');
        expect(noteSectionOf('./MultiModal//project.md')).toBe('MultiModal');
    });

    it('agrees with the server: both key on the same folder string', () => {
        // The client resolves from `perNoteMap[noteSectionOf(path)]` while the
        // server binds `noteSectionPath(path)`. Divergence here would mean a
        // chat binds to one key and resolves from another.
        expect(noteSectionOf('MultiModal/a.md')).toBe('MultiModal');
        expect(noteSectionOf('MultiModal/sub/a.md')).toBe('MultiModal/sub');
    });
});

// ── Scope persistence ────────────────────────────────────────────────────────

describe('scope persistence', () => {
    it('round-trips per-section through localStorage', async () => {
        const first = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_A }));
        await flushSeed();
        act(() => { first.result.current.setScope('per-section'); });
        expect(localStorage.getItem(`coc-notes-chat-scope-${WS}`)).toBe('per-section');

        // A fresh mount is what a reload looks like. The restore guard has to
        // whitelist 'per-section' or the toggle silently snaps back to per-note.
        const second = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_A }));
        await flushSeed();
        expect(second.result.current.scope).toBe('per-section');
    });

    it('still ignores an unrecognized stored value', async () => {
        localStorage.setItem(`coc-notes-chat-scope-${WS}`, 'per-galaxy');
        const { result } = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_A }));
        await flushSeed();
        expect(result.current.scope).toBe('per-note');
    });
});

// ── Task resolution ──────────────────────────────────────────────────────────

describe('task resolution', () => {
    it('resolves two notes in one folder to the same chat under section scope', async () => {
        state.bindings = { [SECTION]: { taskId: 'task-section' } };

        const a = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_A, defaultScope: 'per-section' }),
        );
        await flushSeed();
        const b = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_B, defaultScope: 'per-section' }),
        );
        await flushSeed();

        expect(a.result.current.taskId).toBe('task-section');
        expect(b.result.current.taskId).toBe('task-section');
    });

    it('keeps those same two notes on separate chats under per-note scope', async () => {
        state.bindings = {
            [NOTE_A]: { taskId: 'task-a' },
            [NOTE_B]: { taskId: 'task-b' },
        };

        const a = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_A }));
        await flushSeed();
        const b = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_B }));
        await flushSeed();

        expect(a.result.current.taskId).toBe('task-a');
        expect(b.result.current.taskId).toBe('task-b');
    });

    it('a nested note does not join its grandparent folder chat', async () => {
        state.bindings = { [SECTION]: { taskId: 'task-section' } };
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: 'MultiModal/sub/deep.md', defaultScope: 'per-section' }),
        );
        await flushSeed();
        expect(result.current.taskId).toBeNull();
    });

    it('falls back to the note key for a root note, which has no section', async () => {
        state.bindings = { 'inbox.md': { taskId: 'task-inbox' } };
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: 'inbox.md', defaultScope: 'per-section' }),
        );
        await flushSeed();
        expect(result.current.taskId).toBe('task-inbox');
    });

    it('a section binding does not leak into per-note scope', async () => {
        state.bindings = { [SECTION]: { taskId: 'task-section' } };
        const { result } = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_A }));
        await flushSeed();
        expect(result.current.taskId).toBeNull();
    });
});

// ── createChat / resetChat keying ────────────────────────────────────────────

describe('binding key', () => {
    it('declares per-section scope and mirrors the binding under the folder', async () => {
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_A, defaultScope: 'per-section' }),
        );
        await flushSeed();

        state.nextTaskId = 'task-new';
        await act(async () => { await result.current.createChat('hello'); });

        // The server needs the scope to bind the folder rather than the note.
        expect(state.createdRequests[0].request.scope).toBe('per-section');
        // …and the local mirror must land on that same folder key, or a sibling
        // click would resolve to nothing until the next reload.
        expect(result.current.taskId).toBe('task-new');
    });

    it('the mirrored binding is visible from a sibling note', async () => {
        const { result, rerender } = renderHook(
            ({ notePath }: { notePath: string }) =>
                useNotesChat({ workspaceId: WS, notePath, defaultScope: 'per-section' }),
            { initialProps: { notePath: NOTE_A } },
        );
        await flushSeed();

        state.nextTaskId = 'task-new';
        await act(async () => { await result.current.createChat('hello'); });

        rerender({ notePath: NOTE_B });
        expect(result.current.taskId).toBe('task-new');
    });

    it('resetChat drops the folder key on the server, not the note key', async () => {
        state.bindings = { [SECTION]: { taskId: 'task-section' } };
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_A, defaultScope: 'per-section' }),
        );
        await flushSeed();

        act(() => { result.current.resetChat(); });
        await act(async () => { await Promise.resolve(); });

        expect(state.deletedPaths).toEqual([{ workspaceId: WS, notePath: SECTION }]);
        expect(result.current.taskId).toBeNull();
    });

    it('resetChat still drops the note key under per-note scope', async () => {
        state.bindings = { [NOTE_A]: { taskId: 'task-a' } };
        const { result } = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_A }));
        await flushSeed();

        act(() => { result.current.resetChat(); });
        await act(async () => { await Promise.resolve(); });

        expect(state.deletedPaths).toEqual([{ workspaceId: WS, notePath: NOTE_A }]);
    });
});

// ── moveChatNote ─────────────────────────────────────────────────────────────

describe('moveChatNote', () => {
    it('posts the new note and updates the chat note context', async () => {
        state.bindings = { [SECTION]: { taskId: 'task-section' } };
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_A, defaultScope: 'per-section' }),
        );
        await flushSeed();

        let moved: boolean | undefined;
        await act(async () => { moved = await result.current.moveChatNote(NOTE_B, 'project'); });

        expect(moved).toBe(true);
        expect(state.movedNotes).toHaveLength(1);
        expect(state.movedNotes[0].request).toEqual({ notePath: NOTE_B, noteTitle: 'project' });
        // The header, the 📎 indicator, and the banner all read this.
        expect(result.current.chatNoteContext).toEqual({ notePath: NOTE_B, noteTitle: 'project' });
    });

    it('targets the process ID, adding the queue prefix a bare task ID lacks', async () => {
        state.bindings = { [SECTION]: { taskId: 'task-section' } };
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_A, defaultScope: 'per-section' }),
        );
        await flushSeed();

        await act(async () => { await result.current.moveChatNote(NOTE_B); });
        expect(state.movedNotes[0].processId).toBe('queue_task-section');
    });

    it('derives the title from the file name when none is given', async () => {
        state.bindings = { [SECTION]: { taskId: 'task-section' } };
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_A, defaultScope: 'per-section' }),
        );
        await flushSeed();

        await act(async () => { await result.current.moveChatNote(NOTE_B); });
        expect(state.movedNotes[0].request.noteTitle).toBe('project');
    });

    it('leaves the note context alone when the server rejects the move', async () => {
        state.bindings = { [SECTION]: { taskId: 'task-section' } };
        state.moveFails = true;
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_A, defaultScope: 'per-section' }),
        );
        await flushSeed();

        let moved: boolean | undefined;
        await act(async () => { moved = await result.current.moveChatNote(NOTE_B); });

        expect(moved).toBe(false);
        expect(result.current.chatNoteContext).toBeNull();
    });

    it('is a no-op with no active chat', async () => {
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_A, defaultScope: 'per-section' }),
        );
        await flushSeed();

        let moved: boolean | undefined;
        await act(async () => { moved = await result.current.moveChatNote(NOTE_B); });

        expect(moved).toBe(false);
        expect(state.movedNotes).toHaveLength(0);
    });
});

// ── Draft isolation ──────────────────────────────────────────────────────────

describe('draft keys', () => {
    it('shares one draft across siblings under section scope', () => {
        // Typing on A then clicking B must not lose the message.
        expect(notesChatDraftKey(WS, 'per-section', NOTE_A))
            .toBe(notesChatDraftKey(WS, 'per-section', NOTE_B));
    });

    it('does not share that draft under per-note scope', () => {
        expect(notesChatDraftKey(WS, 'per-note', NOTE_A))
            .not.toBe(notesChatDraftKey(WS, 'per-note', NOTE_B));
    });

    it('keeps different folders on different drafts', () => {
        expect(notesChatDraftKey(WS, 'per-section', 'MultiModal/a.md'))
            .not.toBe(notesChatDraftKey(WS, 'per-section', 'Other/a.md'));
    });

    it('keeps a nested folder on its own draft', () => {
        expect(notesChatDraftKey(WS, 'per-section', 'MultiModal/a.md'))
            .not.toBe(notesChatDraftKey(WS, 'per-section', 'MultiModal/sub/a.md'));
    });

    it('never collides with the per-note or per-workspace keys', () => {
        const section = notesChatDraftKey(WS, 'per-section', NOTE_A);
        expect(section).not.toBe(notesChatDraftKey(WS, 'per-note', NOTE_A));
        expect(section).not.toBe(notesChatDraftKey(WS, 'per-workspace', NOTE_A));
    });

    it('falls back to the note key for a root note, which has no folder', () => {
        expect(notesChatDraftKey(WS, 'per-section', 'inbox.md'))
            .toBe(notesChatDraftKey(WS, 'per-note', 'inbox.md'));
    });

    it('encodes the folder so a path cannot inject the key delimiter', () => {
        expect(notesChatDraftKey(WS, 'per-section', 'a:b/note.md'))
            .toBe(`notes-chat:${WS}:section:${encodeURIComponent('a:b')}`);
    });

    it('does not cross workspaces', () => {
        expect(notesChatDraftKey('ws-1', 'per-section', NOTE_A))
            .not.toBe(notesChatDraftKey('ws-2', 'per-section', NOTE_A));
    });
});

// ── Widening scope ───────────────────────────────────────────────────────────

describe('widening a per-note chat to section scope', () => {
    it('carries the chat onto the folder so it survives a sibling click', async () => {
        state.bindings = { [NOTE_A]: { taskId: 'task-a' } };
        const { result, rerender } = renderHook(
            ({ notePath }: { notePath: string }) => useNotesChat({ workspaceId: WS, notePath }),
            { initialProps: { notePath: NOTE_A } },
        );
        await flushSeed();
        expect(result.current.taskId).toBe('task-a');

        act(() => { result.current.setScope('per-section'); });
        await act(async () => { await Promise.resolve(); });

        // The whole point: clicking a sibling keeps the conversation.
        rerender({ notePath: NOTE_B });
        expect(result.current.taskId).toBe('task-a');
    });

    it('persists the folder binding so it survives a reload', async () => {
        state.bindings = { [NOTE_A]: { taskId: 'task-a' } };
        const { result } = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_A }));
        await flushSeed();

        act(() => { result.current.setScope('per-section'); });
        await act(async () => { await Promise.resolve(); });

        expect(state.boundPaths).toEqual([{ workspaceId: WS, notePath: SECTION, taskId: 'task-a' }]);
    });

    it('joins an existing section chat rather than overwriting it', async () => {
        state.bindings = {
            [NOTE_A]: { taskId: 'task-a' },
            [SECTION]: { taskId: 'task-section' },
        };
        const { result } = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_A }));
        await flushSeed();

        act(() => { result.current.setScope('per-section'); });
        await act(async () => { await Promise.resolve(); });

        expect(result.current.taskId).toBe('task-section');
        expect(state.boundPaths).toHaveLength(0);
    });

    it('writes nothing when there is no chat to carry', async () => {
        const { result } = renderHook(() => useNotesChat({ workspaceId: WS, notePath: NOTE_A }));
        await flushSeed();

        act(() => { result.current.setScope('per-section'); });
        await act(async () => { await Promise.resolve(); });

        expect(state.boundPaths).toHaveLength(0);
        expect(result.current.scope).toBe('per-section');
    });

    it('writes nothing for a root note, which has no folder to widen into', async () => {
        state.bindings = { 'inbox.md': { taskId: 'task-inbox' } };
        const { result } = renderHook(() => useNotesChat({ workspaceId: WS, notePath: 'inbox.md' }));
        await flushSeed();

        act(() => { result.current.setScope('per-section'); });
        await act(async () => { await Promise.resolve(); });

        expect(state.boundPaths).toHaveLength(0);
        // The note-key fallback keeps the chat resolvable either way.
        expect(result.current.taskId).toBe('task-inbox');
    });

    it('does not adopt when narrowing back to per-note', async () => {
        state.bindings = { [SECTION]: { taskId: 'task-section' } };
        const { result } = renderHook(() =>
            useNotesChat({ workspaceId: WS, notePath: NOTE_A, defaultScope: 'per-section' }),
        );
        await flushSeed();

        act(() => { result.current.setScope('per-note'); });
        await act(async () => { await Promise.resolve(); });

        expect(state.boundPaths).toHaveLength(0);
        expect(result.current.taskId).toBeNull();
    });

    it('tolerates a failed server write, keeping the local mirror', async () => {
        state.bindings = { [NOTE_A]: { taskId: 'task-a' } };
        LOCAL.notes.setChatBindingByPath.mockRejectedValueOnce(new Error('offline'));
        const { result, rerender } = renderHook(
            ({ notePath }: { notePath: string }) => useNotesChat({ workspaceId: WS, notePath }),
            { initialProps: { notePath: NOTE_A } },
        );
        await flushSeed();

        act(() => { result.current.setScope('per-section'); });
        await act(async () => { await Promise.resolve(); });

        rerender({ notePath: NOTE_B });
        expect(result.current.taskId).toBe('task-a');
    });
});
