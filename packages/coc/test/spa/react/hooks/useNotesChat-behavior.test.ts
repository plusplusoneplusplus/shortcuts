// @vitest-environment jsdom
/**
 * Rendered (renderHook) behavioral tests for useNotesChat (Verification #2).
 *
 * The source-string suite in useNotesChat.test.ts and the adapter render tests in
 * NoteChatPanel-render.test.tsx stub the hook, so neither exercises what the REAL
 * hook does at the coc-client boundary. These tests mount the genuine hook with a
 * mocked `api/cocClient` (an unregistered workspace id resolves to the local
 * origin client via the real cloneRouting) and capture the actual chat-create
 * request the hook sends, proving:
 *
 *  - AC-04 DoD #2 — the note-path link is prepended exactly once, ahead of the
 *    selected-text reference block, the shared attached-context block, and the
 *    user's typed text, each appearing once in a deterministic order. The inner
 *    reference/context/text ordering is produced by the SAME production formatters
 *    the shared composer uses (formatNoteReferences + formatAttachedContext), so
 *    the captured prompt reflects the real end-to-end composition seam.
 *  - AC-04 DoD #4 (client half) — a Workspace-scope submission with a selected
 *    note carries the path as prompt context AND declares scope=per-workspace, and
 *    updates only the per-workspace bucket, never that note's per-note binding.
 *  - AC-06 DoD #4 — a deferred create started under note A that completes after the
 *    selected note switches to B binds A (its originating context), leaves B
 *    unbound, and records the note context of A rather than B.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Fake coc-client: a single stable local client whose notes.createChat records
// every request and can be gated to simulate an in-flight remote response. ──────
interface CreatedChat { workspaceId: string; request: any }
const state = {
    createdRequests: [] as CreatedChat[],
    bindings: {} as Record<string, { taskId: string }>,
    nextTaskId: 'task-1',
    gate: null as null | { promise: Promise<void>; resolve: () => void },
};

function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
}

const LOCAL = {
    notes: {
        listChatBindings: vi.fn(async () => ({ bindings: state.bindings })),
        createChat: vi.fn(async (workspaceId: string, request: any) => {
            state.createdRequests.push({ workspaceId, request });
            if (state.gate) await state.gate.promise;
            return { task: { id: state.nextTaskId } };
        }),
        deleteChatBindingByPath: vi.fn(async () => undefined),
    },
};

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    // An unregistered workspace id resolves baseUrl→undefined, so useCocClient
    // hands back the local origin client for both accessors.
    getSpaCocClient: () => LOCAL,
    getCocClientFor: () => LOCAL,
}));

import {
    useNotesChat,
    formatNoteAttachmentLink,
} from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesChat';
import { formatNoteReferences } from '../../../../src/server/spa/client/react/features/notes/editor/useNoteReferences';
import type { NoteTextReference } from '../../../../src/server/spa/client/react/features/notes/editor/useNoteReferences';
import { formatAttachedContext } from '../../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import type { AttachedContextItem } from '../../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';

const WS = 'ws-1';

// Flush the mount-time listChatBindings seeding effect so its state update is
// wrapped in act (bindings are empty, so the per-note map stays {}).
async function flushSeed() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
    localStorage.clear();
    state.createdRequests = [];
    state.bindings = {};
    state.nextTaskId = 'task-1';
    state.gate = null;
    LOCAL.notes.listChatBindings.mockClear();
    LOCAL.notes.createChat.mockClear();
    LOCAL.notes.deleteChatBindingByPath.mockClear();
});

describe('useNotesChat — real-hook behavior', () => {
    describe('prompt composition order (AC-04 DoD #2)', () => {
        it('prepends the note-path link once, ahead of references, shared context, and user text, each in deterministic order', async () => {
            const notePath = 'Docs/Note.md';
            const { result } = renderHook(() =>
                useNotesChat({ workspaceId: WS, notePath, noteTitle: 'Note' }),
            );
            await flushSeed();

            // Build the body exactly as the shared composer's handleSend does:
            // pendingPrefix (references) + attached-context blocks + typed text.
            const refs: NoteTextReference[] = [{
                id: 'r1',
                text: 'selected note text',
                preview: 'selected note text',
                noteTitle: 'Note',
                notePath,
            }];
            const items: AttachedContextItem[] = [{
                kind: 'turn',
                id: 'c1',
                turnIndex: 2,
                role: 'user',
                snippet: 'earlier turn snippet',
                preview: 'earlier turn snippet',
            }];
            const userText = 'What does this reference mean?';
            const body = formatNoteReferences(refs) + formatAttachedContext(items) + userText;

            await act(async () => { await result.current.createChat(body); });

            expect(state.createdRequests).toHaveLength(1);
            const prompt: string = state.createdRequests[0].request.prompt;

            const link = formatNoteAttachmentLink(WS, notePath);
            const refMarker = '<note_reference path="Docs/Note.md" title="Note">';
            const ctxMarker = '<context from="user" turn="2">';

            // The captured prompt IS the note link joined to the composer body — no
            // reordering, no duplication.
            expect(prompt).toBe(`${link}\n\n${body}`);

            // Deterministic order: link → reference block → shared context → user text.
            const iLink = prompt.indexOf(link);
            const iRef = prompt.indexOf(refMarker);
            const iCtx = prompt.indexOf(ctxMarker);
            const iText = prompt.indexOf(userText);
            expect(iLink).toBe(0);
            expect(iLink).toBeLessThan(iRef);
            expect(iRef).toBeLessThan(iCtx);
            expect(iCtx).toBeLessThan(iText);

            // Each block appears exactly once (guards against a double-prepend or a
            // dropped/duplicated section).
            expect(prompt.indexOf(link)).toBe(prompt.lastIndexOf(link));
            expect(prompt.indexOf(refMarker)).toBe(prompt.lastIndexOf(refMarker));
            expect(prompt.indexOf(ctxMarker)).toBe(prompt.lastIndexOf(ctxMarker));
            expect(prompt.indexOf(userText)).toBe(prompt.lastIndexOf(userText));
        });

        it('sends the body unchanged with no note-path link when no note is selected', async () => {
            const { result } = renderHook(() =>
                useNotesChat({ workspaceId: WS, notePath: null, defaultScope: 'per-workspace' }),
            );
            await flushSeed();

            const body = 'Ask about my notes in general';
            await act(async () => { await result.current.createChat(body); });

            const prompt: string = state.createdRequests[0].request.prompt;
            expect(prompt).toBe(body);
            expect(prompt).not.toContain('📝 Note:');
            expect(state.createdRequests[0].request.notePath).toBeNull();
        });
    });

    describe('Workspace scope keeps path context separate from binding (AC-04 DoD #4)', () => {
        it('declares per-workspace scope, still attaches the note path as context, and updates only the workspace bucket', async () => {
            const notePath = 'Docs/Note.md';
            const { result } = renderHook(() =>
                useNotesChat({ workspaceId: WS, notePath, noteTitle: 'Note', defaultScope: 'per-workspace' }),
            );
            await flushSeed();

            state.nextTaskId = 'ws-task';
            await act(async () => { await result.current.createChat('Ask about my notes'); });

            const request = state.createdRequests[0].request;
            // Scope is declared so the server never binds this note per-note (AC-04),
            // yet the selected note path still rides as prompt context.
            expect(request.scope).toBe('per-workspace');
            expect(request.prompt.startsWith(formatNoteAttachmentLink(WS, notePath))).toBe(true);

            // Only the workspace bucket updated.
            expect(result.current.taskId).toBe('ws-task');

            // Switching to This-note scope for the SAME note shows no chat — the
            // per-note binding map was never touched by the Workspace submission.
            act(() => { result.current.setScope('per-note'); });
            expect(result.current.taskId).toBeNull();
            expect(LOCAL.notes.deleteChatBindingByPath).not.toHaveBeenCalled();
        });
    });

    describe('deferred-response isolation (AC-06 DoD #4)', () => {
        it('binds the originating note when a create resolves after the selected note switched', async () => {
            const { result, rerender } = renderHook(
                (props: { workspaceId: string; notePath: string | null; noteTitle?: string }) =>
                    useNotesChat(props),
                { initialProps: { workspaceId: WS, notePath: 'A.md', noteTitle: 'A' } },
            );
            await flushSeed();

            // Start a create under note A that stays in flight (gated).
            state.nextTaskId = 'task-A';
            state.gate = makeDeferred();
            let createPromise!: Promise<string | null>;
            act(() => { createPromise = result.current.createChat('question about A'); });

            // Switch the selected note to B before the response arrives.
            rerender({ workspaceId: WS, notePath: 'B.md', noteTitle: 'B' });

            // The response completes now, while B is selected.
            await act(async () => { state.gate!.resolve(); await createPromise; });

            // The result stayed with its originating context, not the current one:
            // B is unbound, and the recorded note context is A.
            expect(result.current.taskId).toBeNull();
            expect(result.current.chatNoteContext?.notePath).toBe('A.md');

            // Switching back to A surfaces the binding the deferred response created.
            rerender({ workspaceId: WS, notePath: 'A.md', noteTitle: 'A' });
            expect(result.current.taskId).toBe('task-A');

            // The request the server received carried A's path, not B's.
            expect(state.createdRequests).toHaveLength(1);
            expect(state.createdRequests[0].request.notePath).toBe('A.md');
        });
    });
});
