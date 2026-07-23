/**
 * Tests for useNotesChat hook — dual-scope (per-note + per-workspace) model.
 *
 * Validates localStorage persistence, createChat task creation,
 * resetChat clearing, context injection with the current note,
 * task-bound note context from loaded process metadata,
 * and scope state management (defaultScope and setScope).
 */
/* @vitest-environment jsdom */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
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

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'notes', 'hooks', 'useNotesChat.ts'
);

describe('useNotesChat', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        cloneClient.notes.listChatBindings.mockResolvedValue({ bindings: {} });
        cloneClient.notes.createChat.mockResolvedValue({ task: { id: 'created-task' } });
        cloneClient.notes.deleteChatBindingByPath.mockResolvedValue(undefined);
    });

    it('exports ChatScope type', () => {
        expect(source).toContain("export type ChatScope = 'per-note' | 'per-workspace'");
    });

    it('exports UseNotesChatOptions interface', () => {
        expect(source).toContain('export interface UseNotesChatOptions');
    });

    it('exports UseNotesChatReturn interface', () => {
        expect(source).toContain('export interface UseNotesChatReturn');
    });

    it('exports ChatNoteContext interface', () => {
        expect(source).toContain('export interface ChatNoteContext');
    });

    it('exports useNotesChat function', () => {
        expect(source).toContain('export function useNotesChat');
    });

    describe('scope management', () => {
        it('accepts defaultScope param in options', () => {
            expect(source).toContain('defaultScope?: ChatScope');
        });

        it('exposes scope and setScope in return value', () => {
            expect(source).toContain('scope: ChatScope');
            expect(source).toContain('setScope: (scope: ChatScope) => void');
        });

        it('returns scope and setScope', () => {
            expect(source).toContain('return { taskId, chatNoteContext, syncChatNoteContext, createChat, resetChat, scope, setScope }');
        });

        it('persists scope to workspace-scoped localStorage key', () => {
            expect(source).toContain('`coc-notes-chat-scope-${workspaceId}`');
        });

        it('falls back to defaultScope when no stored value', () => {
            expect(source).toContain("defaultScope = 'per-note'");
        });

        it('defaults scope to per-note (Chat with Note) rather than per-workspace', () => {
            // The chat launched from Notes must land on "This note" by default.
            expect(source).toContain("defaultScope = 'per-note'");
            expect(source).not.toContain("defaultScope = 'per-workspace'");
        });
    });

    describe('localStorage persistence', () => {
        it('reads initial per-workspace taskId from localStorage', () => {
            expect(source).toContain('localStorage.getItem(key)');
        });

        it('writes per-workspace taskId to localStorage when set', () => {
            expect(source).toContain('localStorage.setItem(key, perWorkspaceTaskId)');
        });

        it('removes from localStorage when per-workspace taskId is null', () => {
            expect(source).toContain('localStorage.removeItem(key)');
        });

        it('uses workspace-scoped storage key for per-workspace chat', () => {
            expect(source).toContain('`coc-notes-chat-${workspaceId}`');
        });

        it('seeds per-note map from server via listChatBindings', () => {
            expect(source).toContain('listChatBindings(workspaceId)');
        });

        it('does not persist per-note map to localStorage', () => {
            expect(source).not.toContain('coc-notes-chat-map-');
        });
    });

    describe('derived taskId', () => {
        it('derives taskId from perWorkspaceTaskId when scope is per-workspace', () => {
            expect(source).toContain("scope === 'per-workspace'");
            expect(source).toContain('? perWorkspaceTaskId');
        });

        it('derives taskId from perNoteMap when scope is per-note', () => {
            expect(source).toContain("perNoteMap[notePath] ?? null");
        });

        it('returns null when scope is per-note but no note selected', () => {
            expect(source).toContain('(notePath ? perNoteMap[notePath] ?? null : null)');
        });
    });

    describe('task-bound note context', () => {
        it('does not store note context as one workspace-wide localStorage value', () => {
            expect(source).not.toContain('coc-notes-chat-ctx-');
            expect(source).not.toContain('saveContext(');
            expect(source).not.toContain('loadContext(');
        });

        it('exposes guarded process metadata synchronization', () => {
            expect(source).toContain('syncChatNoteContext: (process: AIProcess) => void');
            expect(source).toContain('loadedTaskId !== activeTaskIdRef.current');
            expect(source).toContain('noteContextsByTaskId[taskId] ?? null');
        });

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

    describe('createChat creates queue task', () => {
        it('POSTs to /queue with chat payload', () => {
            expect(source).toContain('cloneClient.notes.createChat');
        });

        it('accepts ask and autopilot as valid modes', () => {
            expect(source).toContain("mode: 'ask' | 'autopilot'");
        });

        it('includes noteChat context with current note', () => {
            expect(source).toContain('notePath');
            expect(source).toContain('noteTitle');
        });

        it('prepends note path to prompt when notePath is set', () => {
            expect(source).toContain('prompt: formatNoteAttachmentPrompt(prompt, workspaceId, notePath)');
        });

        it('handles missing notePath gracefully (undefined context)', () => {
            expect(source).toContain('notePath,');
        });

        it('stores chat note context at creation time', () => {
            expect(source).toContain('setNoteContextsByTaskId(prev => ({');
            expect(source).toContain('[newTaskId]: notePath');
            expect(source).toContain('? { notePath, noteTitle: noteTitle ?? notePath }');
        });

        it('clears chat note context when no notePath', () => {
            expect(source).toContain(': null,');
        });

        it('extracts taskId from response', () => {
            expect(source).toContain('res.task.id');
        });

        it('sets per-workspace taskId when scope is per-workspace', () => {
            expect(source).toContain('setPerWorkspaceTaskId(newTaskId)');
        });

        it('updates per-note map when scope is per-note', () => {
            expect(source).toContain('setPerNoteMap(prev => ({ ...prev, [notePath]: newTaskId }))');
        });

        it('returns null on failure', () => {
            expect(source).toContain('return null');
        });

        it('accepts optional model, skills, attachments, and aiSelection parameters in createChat signature', () => {
            expect(source).toContain('createChat: (prompt: string, model?: string | null, mode?: \'ask\' | \'autopilot\', skills?: string[], attachments?: AttachmentPayload[], aiSelection?: NotesChatAiSelection)');
        });

        it('exposes a NotesChatAiSelection type carrying provider, effort, auto-routing, working dir, and context', () => {
            expect(source).toContain('export interface NotesChatAiSelection');
            expect(source).toContain('provider?: ChatProvider');
            expect(source).toContain('reasoningEffort?: ReasoningEffort');
            expect(source).toContain('effortTier?: EffortTierKey');
            expect(source).toContain('autoProviderRouting?: boolean');
            expect(source).toContain('workingDirectory?: string');
            expect(source).toContain('context?: Record<string, unknown>');
        });

        it('forwards the full AI selection to the chat-create request', () => {
            expect(source).toContain('aiSelection?.provider ? { provider: aiSelection.provider } : {}');
            expect(source).toContain('aiSelection?.reasoningEffort ? { reasoningEffort: aiSelection.reasoningEffort } : {}');
            expect(source).toContain('aiSelection?.effortTier ? { effortTier: aiSelection.effortTier } : {}');
            expect(source).toContain('aiSelection?.autoProviderRouting ? { autoProviderRouting: true } : {}');
            expect(source).toContain('aiSelection?.workingDirectory ? { workingDirectory: aiSelection.workingDirectory } : {}');
            expect(source).toContain('aiSelection?.context ? { context: aiSelection.context } : {}');
        });

        it('declares the active scope on the chat-create request so Workspace scope never binds per-note (AC-04)', () => {
            // The hook forwards its own scope state; the server drops the per-note
            // binding when scope is per-workspace even though the note path is present.
            expect(source).toContain('Declare the scope explicitly (AC-04)');
            expect(source).toContain('scope,');
        });

        it('includes skills in context when provided', () => {
            expect(source).toContain('skills,');
        });

        it('includes model in payload when provided', () => {
            expect(source).toContain('model,');
        });

        it('passes inherited Lens Chat mode only when the shared Lens flag is enabled', () => {
            expect(source).toContain('isCommitChatLensEnabled() ? { lensChat: INHERITED_LENS_CHAT_MODE } : {}');
            expect(source).not.toContain('coc-notes-lens');
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

    describe('resetChat clears correct bucket', () => {
        it('clears per-workspace taskId when scope is per-workspace', () => {
            expect(source).toContain('setPerWorkspaceTaskId(null)');
        });

        it('removes per-note entry when scope is per-note', () => {
            expect(source).toContain("delete next[notePath]");
        });

        it('calls deleteChatBindingByPath on the server when resetting a per-note chat', () => {
            expect(source).toContain('deleteChatBindingByPath(workspaceId, notePath)');
        });

        it('clears chat note context in both cases', () => {
            const resetBlock = source.substring(
                source.indexOf('const resetChat'),
                source.indexOf('return { taskId')
            );
            expect(resetBlock).toContain('delete next[taskId]');
        });
    });
});
