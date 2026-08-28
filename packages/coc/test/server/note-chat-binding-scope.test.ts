/**
 * Enqueue-time note-binding scope rules (AC-04).
 *
 * `resolveNoteChatBinding` is the pure decision the `POST /api/queue`
 * `maybeBindNoteChat` step runs after enqueue: it returns the (workspaceId,
 * notePath) to bind, or null when no per-note binding should be created.
 *
 * The load-bearing case is Workspace scope: a workspace-level chat may carry the
 * currently-selected note path as first-message context, but must NOT create or
 * replace that note's per-note binding.
 */

import { describe, it, expect } from 'vitest';
import { resolveNoteChatBinding } from '../../src/server/routes/queue-enqueue';

function chatInput(context: Record<string, unknown> | undefined, workspaceId: unknown = 'ws-a') {
    return {
        type: 'chat',
        payload: { kind: 'chat', mode: 'ask', prompt: 'hi', workspaceId, context },
    };
}

describe('resolveNoteChatBinding — declared Notes scope (AC-04)', () => {
    it('binds per-note when scope is explicitly per-note', () => {
        const binding = resolveNoteChatBinding(
            chatInput({ noteChat: { notePath: 'Features/Memory.md', noteTitle: 'Memory', scope: 'per-note' } }),
        );
        expect(binding).toEqual({ workspaceId: 'ws-a', notePath: 'Features/Memory.md' });
    });

    it('binds per-note when scope is omitted (legacy default preserved)', () => {
        const binding = resolveNoteChatBinding(
            chatInput({ noteChat: { notePath: 'Features/Memory.md', noteTitle: 'Memory' } }),
        );
        expect(binding).toEqual({ workspaceId: 'ws-a', notePath: 'Features/Memory.md' });
    });

    it('does NOT bind per-note for a Workspace-scope submission even with a selected note path', () => {
        // AC-04 DoD #4: Workspace scope must not create or replace the note's binding.
        const binding = resolveNoteChatBinding(
            chatInput({ noteChat: { notePath: 'Features/Memory.md', noteTitle: 'Memory', scope: 'per-workspace' } }),
        );
        expect(binding).toBeNull();
    });

    it('does not bind for a Workspace-scope submission with no note path', () => {
        const binding = resolveNoteChatBinding(chatInput({ noteChat: { notePath: '', scope: 'per-workspace' } }));
        expect(binding).toBeNull();
    });

    describe('per-section scope', () => {
        it('binds the note\'s nearest parent folder, not the note', () => {
            const binding = resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: 'MultiModal/first-five-days.plan.md', scope: 'per-section' } }),
            );
            expect(binding).toEqual({ workspaceId: 'ws-a', notePath: 'MultiModal' });
        });

        it('resolves two notes in one folder to the same binding key', () => {
            const a = resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: 'MultiModal/a.md', scope: 'per-section' } }),
            );
            const b = resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: 'MultiModal/b.md', scope: 'per-section' } }),
            );
            expect(a).toEqual(b);
        });

        it('keeps two notes in one folder apart under per-note scope', () => {
            const a = resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: 'MultiModal/a.md', scope: 'per-note' } }),
            );
            const b = resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: 'MultiModal/b.md', scope: 'per-note' } }),
            );
            expect(a).not.toEqual(b);
        });

        it('uses the nearest parent, so a nested note is its own section', () => {
            // `MultiModal/sub/note.md` belongs to `MultiModal/sub`; a chat bound
            // to `MultiModal` deliberately does not pick it up.
            const binding = resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: 'MultiModal/sub/note.md', scope: 'per-section' } }),
            );
            expect(binding).toEqual({ workspaceId: 'ws-a', notePath: 'MultiModal/sub' });
        });

        it('falls back to a per-note binding for a note at the notes root', () => {
            // A root note has no section. Binding the note keeps the chat
            // resolvable, and matches the client's folder-then-note lookup.
            const binding = resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: 'inbox.md', scope: 'per-section' } }),
            );
            expect(binding).toEqual({ workspaceId: 'ws-a', notePath: 'inbox.md' });
        });

        it('normalizes before deriving the section', () => {
            const binding = resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: 'MultiModal\\\\notes\\\\a.md', scope: 'per-section' } }),
            );
            expect(binding).toEqual({ workspaceId: 'ws-a', notePath: 'MultiModal/notes' });
        });

        it('still rejects traversal and absolute paths', () => {
            expect(resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: '../secret/a.md', scope: 'per-section' } }),
            )).toBeNull();
            expect(resolveNoteChatBinding(
                chatInput({ noteChat: { notePath: '/etc/passwd', scope: 'per-section' } }),
            )).toBeNull();
        });
    });

    it('normalizes the note path (separators, duplicate slashes) before binding', () => {
        const binding = resolveNoteChatBinding(
            chatInput({ noteChat: { notePath: 'Features\\\\Memory.md', scope: 'per-note' } }),
        );
        expect(binding).toEqual({ workspaceId: 'ws-a', notePath: 'Features/Memory.md' });
    });

    it('rejects traversal / absolute note paths', () => {
        expect(resolveNoteChatBinding(chatInput({ noteChat: { notePath: '/etc/passwd' } }))).toBeNull();
        expect(resolveNoteChatBinding(chatInput({ noteChat: { notePath: '../secret.md' } }))).toBeNull();
    });

    it('returns null when there is no noteChat context', () => {
        expect(resolveNoteChatBinding(chatInput(undefined))).toBeNull();
        expect(resolveNoteChatBinding(chatInput({ lensChat: { inherited: true } }))).toBeNull();
    });

    it('returns null when the workspaceId is missing or non-string', () => {
        // Built inline: the helper's default workspaceId would mask an absent one.
        expect(resolveNoteChatBinding({
            type: 'chat',
            payload: { kind: 'chat', context: { noteChat: { notePath: 'A.md', scope: 'per-note' } } },
        })).toBeNull();
        expect(resolveNoteChatBinding({
            type: 'chat',
            payload: { kind: 'chat', workspaceId: 42, context: { noteChat: { notePath: 'A.md', scope: 'per-note' } } },
        })).toBeNull();
    });

    it('returns null for a non-chat task type carrying note context', () => {
        expect(
            resolveNoteChatBinding({
                type: 'run-workflow',
                payload: { workspaceId: 'ws-a', context: { noteChat: { notePath: 'A.md' } } },
            }),
        ).toBeNull();
    });
});
