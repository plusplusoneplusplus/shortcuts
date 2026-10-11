/**
 * Tests for useNotesChat hook — dual-scope (per-note + per-workspace) model.
 *
 * Validates localStorage persistence, createChat task creation,
 * resetChat clearing, context injection with the current note,
 * task-bound note context from loaded process metadata,
 * and scope state management (defaultScope and setScope).
 */
/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
    formatNoteAttachmentLink,
    formatNoteAttachmentPrompt,
    notesChatDraftKey,
    useNotesChat,
} from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesChat';

const { cloneClient } = vi.hoisted(() => ({
    cloneClient: {
        notes: {
            listChatBindings: vi.fn(),
            createChat: vi.fn(),
            deleteChatBindingByPath: vi.fn(),
        },
    },
}));

vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => cloneClient,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isCommitChatLensEnabled: () => false,
}));

describe('useNotesChat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        cloneClient.notes.listChatBindings.mockResolvedValue({ bindings: {} });
        cloneClient.notes.createChat.mockResolvedValue({ task: { id: 'created-task' } });
        cloneClient.notes.deleteChatBindingByPath.mockResolvedValue(undefined);
    });

    describe('task-bound note context', () => {
        it('keeps context paired with the active task across A to B to A navigation', async () => {
            cloneClient.notes.listChatBindings.mockResolvedValue({
                bindings: {
                    'Notes/A.md': { taskId: 'task-a', createdAt: '2026-07-22T00:00:00.000Z' },
                    'Notes/B.md': { taskId: 'task-b', createdAt: '2026-07-22T00:00:01.000Z' },
                },
            });
            const { result, rerender } = renderHook(
                ({ notePath, noteTitle }) => useNotesChat({
                    workspaceId: 'workspace-1',
                    notePath,
                    noteTitle,
                }),
                { initialProps: { notePath: 'Notes/A.md', noteTitle: 'A' } },
            );

            await waitFor(() => expect(result.current.taskId).toBe('task-a'));
            act(() => result.current.syncChatNoteContext({
                id: 'queue_task-a',
                type: 'chat',
                status: 'completed',
                promptPreview: '',
                startTime: '2026-07-22T00:00:00.000Z',
                metadata: { queueTaskId: 'task-a', notePath: 'Notes/A.md', noteTitle: 'A' },
            }));
            expect(result.current.chatNoteContext).toEqual({ notePath: 'Notes/A.md', noteTitle: 'A' });

            rerender({ notePath: 'Notes/B.md', noteTitle: 'B' });
            expect(result.current.taskId).toBe('task-b');
            expect(result.current.chatNoteContext).toBeNull();

            act(() => result.current.syncChatNoteContext({
                id: 'queue_task-b',
                type: 'chat',
                status: 'completed',
                promptPreview: '',
                startTime: '2026-07-22T00:00:01.000Z',
                metadata: { queueTaskId: 'task-b', notePath: 'Notes/B.md', noteTitle: 'B' },
            }));
            expect(result.current.chatNoteContext).toEqual({ notePath: 'Notes/B.md', noteTitle: 'B' });

            // A late response for the old task must not replace B's context.
            act(() => result.current.syncChatNoteContext({
                id: 'queue_task-a',
                type: 'chat',
                status: 'completed',
                promptPreview: '',
                startTime: '2026-07-22T00:00:00.000Z',
                metadata: { queueTaskId: 'task-a', notePath: 'Notes/A.md', noteTitle: 'A' },
            }));
            expect(result.current.chatNoteContext).toEqual({ notePath: 'Notes/B.md', noteTitle: 'B' });

            rerender({ notePath: 'Notes/A.md', noteTitle: 'A' });
            expect(result.current.taskId).toBe('task-a');
            expect(result.current.chatNoteContext).toEqual({ notePath: 'Notes/A.md', noteTitle: 'A' });
        });

        it('ignores the legacy workspace-global context value', async () => {
            localStorage.setItem('coc-notes-chat-ctx-workspace-1', JSON.stringify({
                notePath: 'Learning/AI-learning-path.md',
                noteTitle: 'AI learning path',
            }));
            cloneClient.notes.listChatBindings.mockResolvedValue({
                bindings: {
                    'Travel/Baja.md': { taskId: 'task-baja', createdAt: '2026-07-22T00:00:00.000Z' },
                },
            });

            const { result } = renderHook(() => useNotesChat({
                workspaceId: 'workspace-1',
                notePath: 'Travel/Baja.md',
                noteTitle: 'Baja',
            }));

            await waitFor(() => expect(result.current.taskId).toBe('task-baja'));
            expect(result.current.chatNoteContext).toBeNull();
        });

        it('optimistically pairs a newly created task with its note without legacy storage', async () => {
            const { result } = renderHook(() => useNotesChat({
                workspaceId: 'workspace-1',
                notePath: 'Travel/Baja.md',
                noteTitle: 'Baja',
            }));
            await waitFor(() => expect(cloneClient.notes.listChatBindings).toHaveBeenCalled());

            let createdTaskId: string | null = null;
            await act(async () => {
                createdTaskId = await result.current.createChat('Plan the trip');
            });

            expect(createdTaskId).toBe('created-task');
            expect(result.current.taskId).toBe('created-task');
            expect(result.current.chatNoteContext).toEqual({
                notePath: 'Travel/Baja.md',
                noteTitle: 'Baja',
            });
            expect(localStorage.getItem('coc-notes-chat-ctx-workspace-1')).toBeNull();
        });
    });

    describe('note attachment link formatting', () => {
        it('formats note attachment as a markdown deep-link', () => {
            expect(formatNoteAttachmentLink('workspace-a', 'Features/Memory.md'))
                .toBe('[📝 Note: Features/Memory.md](#repos/workspace-a/notes/Features/Memory.md)');
        });

        it('encodes route segments while preserving readable link text', () => {
            expect(formatNoteAttachmentLink('my workspace', 'New Features/Memory (draft).md'))
                .toBe('[📝 Note: New Features/Memory (draft).md](#repos/my%20workspace/notes/New%20Features/Memory%20%28draft%29.md)');
        });

        it('escapes markdown metacharacters in the link text', () => {
            expect(formatNoteAttachmentLink('ws', 'Notes/[Memory]\\Plan.md'))
                .toBe('[📝 Note: Notes/\\[Memory\\]\\\\Plan.md](#repos/ws/notes/Notes/%5BMemory%5D%5CPlan.md)');
        });

        it('prepends the linked note attachment before the prompt', () => {
            expect(formatNoteAttachmentPrompt('Summarize this', 'ws', 'Features/Memory.md'))
                .toBe('[📝 Note: Features/Memory.md](#repos/ws/notes/Features/Memory.md)\n\nSummarize this');
        });

        it('returns the original prompt when no note is attached', () => {
            expect(formatNoteAttachmentPrompt('Summarize this', 'ws', null)).toBe('Summarize this');
        });
    });

    describe('notesChatDraftKey — scope-isolated draft identity (AC-05)', () => {
        it('gives each note its own draft in This note scope', () => {
            const a = notesChatDraftKey('ws', 'per-note', 'Features/Memory.md');
            const b = notesChatDraftKey('ws', 'per-note', 'Features/Plan.md');
            expect(a).not.toBe(b);
        });

        it('uses one draft per workspace in Workspace scope, independent of the selected note', () => {
            const withNote = notesChatDraftKey('ws', 'per-workspace', 'Features/Memory.md');
            const withOther = notesChatDraftKey('ws', 'per-workspace', 'Features/Plan.md');
            const withNone = notesChatDraftKey('ws', 'per-workspace', null);
            expect(withNote).toBe(withOther);
            expect(withNote).toBe(withNone);
        });

        it('never crosses scopes: This note and Workspace keys differ for the same workspace', () => {
            const perNote = notesChatDraftKey('ws', 'per-note', 'Features/Memory.md');
            const perWorkspace = notesChatDraftKey('ws', 'per-workspace', 'Features/Memory.md');
            expect(perNote).not.toBe(perWorkspace);
        });

        it('never crosses workspaces for the same note or scope', () => {
            expect(notesChatDraftKey('ws-a', 'per-note', 'Memory.md'))
                .not.toBe(notesChatDraftKey('ws-b', 'per-note', 'Memory.md'));
            expect(notesChatDraftKey('ws-a', 'per-workspace', null))
                .not.toBe(notesChatDraftKey('ws-b', 'per-workspace', null));
        });

        it('collapses equivalent spellings of the same note onto one draft', () => {
            const canonical = notesChatDraftKey('ws', 'per-note', 'Features/Memory.md');
            expect(notesChatDraftKey('ws', 'per-note', './Features/Memory.md')).toBe(canonical);
            expect(notesChatDraftKey('ws', 'per-note', '/Features/Memory.md')).toBe(canonical);
            expect(notesChatDraftKey('ws', 'per-note', 'Features/Memory.md/')).toBe(canonical);
            expect(notesChatDraftKey('ws', 'per-note', 'Features//Memory.md')).toBe(canonical);
            expect(notesChatDraftKey('ws', 'per-note', 'Features\\Memory.md')).toBe(canonical);
            expect(notesChatDraftKey('ws', 'per-note', '  Features/Memory.md  ')).toBe(canonical);
        });

        it('preserves case so two distinct notes never collapse onto one draft', () => {
            expect(notesChatDraftKey('ws', 'per-note', 'Memory.md'))
                .not.toBe(notesChatDraftKey('ws', 'per-note', 'memory.md'));
        });

        it('is delimiter-injection safe: a crafted note path cannot collide with the Workspace key or another note', () => {
            // A note path that textually contains the ':ws' marker must not alias the workspace draft.
            expect(notesChatDraftKey('ws', 'per-note', ':ws'))
                .not.toBe(notesChatDraftKey('ws', 'per-workspace', null));
            // A workspace id containing the delimiter must not let one note bleed into another key.
            expect(notesChatDraftKey('a:note:x', 'per-note', 'y'))
                .not.toBe(notesChatDraftKey('a', 'per-note', 'x:note:x:y'));
        });

        it('produces a stable key for the no-note edge in This note scope', () => {
            expect(notesChatDraftKey('ws', 'per-note', null))
                .toBe(notesChatDraftKey('ws', 'per-note', null));
            expect(notesChatDraftKey('ws', 'per-note', null))
                .not.toBe(notesChatDraftKey('ws', 'per-workspace', null));
        });
    });

});
