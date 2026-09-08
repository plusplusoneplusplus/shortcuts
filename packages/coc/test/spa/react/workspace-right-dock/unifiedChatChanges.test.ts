/**
 * AC-01/AC-02: the whole-chat "Changes" source behind the panel's `+` entry.
 *
 * These cases pin the two things that separate a chat's Changes from a whisper
 * group's diff: the entry has to be readable (and reactive) *before* anything is
 * opened, so the menu can decide whether to list it at all; and its tab id has
 * to stay fixed as the chat grows, so a later edit refreshes the tab the user
 * has open instead of stacking a second one. Scoping is the third: two panels,
 * two chats, and two clones must never read each other's entry.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    chatChangesSourceId,
    chatChangesTabInput,
    clearUnifiedChatChanges,
    getUnifiedChatChanges,
    publishUnifiedChatChanges,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedChatChanges';
import {
    clearUnifiedDiffSources,
    getUnifiedDiffSource,
    registerUnifiedDiffSource,
    whisperDiffSourceId,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedDiffSources';
import type { WhisperDiffOpenContext } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { FileEdit } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

function fileEdit(path: string, overrides: Partial<FileEdit> = {}): FileEdit {
    return {
        path,
        insertions: 2,
        deletions: 1,
        netInsertions: 2,
        netDeletions: 1,
        isCreate: false,
        isDeleted: false,
        ...overrides,
    };
}

function ctxOf(paths: readonly string[] = ['src/a.ts'], workspaceId = 'ws-1'): WhisperDiffOpenContext {
    return {
        files: paths.map(path => fileEdit(path)),
        toolCalls: paths.map(path => ({ toolName: 'edit', args: { path, oldString: 'a', newString: 'b' } })),
        commits: [],
        workspaceId,
    };
}

beforeEach(() => {
    clearUnifiedChatChanges();
    clearUnifiedDiffSources();
});

describe('publishing a chat\'s changes', () => {
    it('reads back what a chat published, and null for a chat that published nothing', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf() });
        expect(getUnifiedChatChanges('ws-1', 'chat-1')?.ctx.files).toHaveLength(1);
        expect(getUnifiedChatChanges('ws-1', 'chat-2')).toBeNull();
    });

    it('answers null with no chat selected', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf() });
        expect(getUnifiedChatChanges('ws-1', null)).toBeNull();
    });

    it('keeps chats, panel scopes, and clones apart', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(['src/a.ts'], 'ws-1') });
        publishUnifiedChatChanges('group-x', 'chat-1', { ctx: ctxOf(['src/b.ts'], 'ws-2') });

        expect(getUnifiedChatChanges('ws-1', 'chat-1')?.ctx.files[0].path).toBe('src/a.ts');
        expect(getUnifiedChatChanges('group-x', 'chat-1')?.ctx.files[0].path).toBe('src/b.ts');
        expect(getUnifiedChatChanges('ws-2', 'chat-1')).toBeNull();
    });

    it('withdraws an entry when a chat republishes nothing', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf() });
        expect(publishUnifiedChatChanges('ws-1', 'chat-1', null)).toBe(true);
        expect(getUnifiedChatChanges('ws-1', 'chat-1')).toBeNull();
        // A second withdrawal is not a change, so nothing is woken for it.
        expect(publishUnifiedChatChanges('ws-1', 'chat-1', null)).toBe(false);
    });

    it('reports no movement when the same context object is republished', () => {
        const changes = { ctx: ctxOf() };
        expect(publishUnifiedChatChanges('ws-1', 'chat-1', changes)).toBe(true);
        expect(publishUnifiedChatChanges('ws-1', 'chat-1', { ...changes })).toBe(false);
        expect(publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(['src/a.ts', 'src/b.ts']) })).toBe(true);
    });

    it('notifies only the subscribers of the chat that moved', () => {
        // The subscribe seam is exercised through the hook elsewhere; here the
        // point is that publishing chat-2 does not disturb chat-1's entry.
        const first = { ctx: ctxOf(['src/a.ts']) };
        publishUnifiedChatChanges('ws-1', 'chat-1', first);
        publishUnifiedChatChanges('ws-1', 'chat-2', { ctx: ctxOf(['src/z.ts']) });
        expect(getUnifiedChatChanges('ws-1', 'chat-1')).toBe(first);
    });
});

describe('the tab a Changes entry opens', () => {
    it('is a chat-owned diff tab labelled Changes on the clone that was edited', () => {
        const input = chatChangesTabInput({
            changes: { ctx: ctxOf(['src/a.ts'], 'ws-member') },
            ownerWorkspaceId: 'ws-member',
            chatId: 'chat-1',
        });
        expect(input.kind).toBe('diff');
        expect(input.label).toBe('Changes');
        expect(input.chatId).toBe('chat-1');
        expect(input.ownerWorkspaceId).toBe('ws-member');
    });

    it('keeps one id per chat as the chat records more edits', () => {
        const first = chatChangesTabInput({
            changes: { ctx: ctxOf(['src/a.ts']) },
            ownerWorkspaceId: 'ws-1',
            chatId: 'chat-1',
        });
        const grown = chatChangesTabInput({
            changes: { ctx: ctxOf(['src/a.ts', 'src/b.ts']) },
            ownerWorkspaceId: 'ws-1',
            chatId: 'chat-1',
        });
        expect(first.resourceId).toBe(chatChangesSourceId('chat-1'));
        expect(grown.resourceId).toBe(first.resourceId);
        // ...and the tab now renders the grown context, not the first one.
        expect(getUnifiedDiffSource(first.resourceId)?.ctx.files).toHaveLength(2);
    });

    it('gives two chats two tabs', () => {
        const a = chatChangesTabInput({ changes: { ctx: ctxOf() }, ownerWorkspaceId: 'ws-1', chatId: 'chat-1' });
        const b = chatChangesTabInput({ changes: { ctx: ctxOf() }, ownerWorkspaceId: 'ws-1', chatId: 'chat-2' });
        expect(a.resourceId).not.toBe(b.resourceId);
    });

    it('does not collide with a whisper group that happens to hold the same edits', () => {
        const ctx = ctxOf();
        const changesTab = chatChangesTabInput({ changes: { ctx }, ownerWorkspaceId: 'ws-1', chatId: 'chat-1' });
        expect(changesTab.resourceId).not.toBe(whisperDiffSourceId(ctx));
    });

    it('reuses the stored context when the same edits are re-registered', () => {
        const ctx = ctxOf();
        chatChangesTabInput({ changes: { ctx }, ownerWorkspaceId: 'ws-1', chatId: 'chat-1' });
        const stored = getUnifiedDiffSource(chatChangesSourceId('chat-1'));
        // A re-render recomputes an equal context; the panel's file selection
        // keys on context identity, so the stored object must not be swapped.
        chatChangesTabInput({ changes: { ctx: ctxOf() }, ownerWorkspaceId: 'ws-1', chatId: 'chat-1' });
        expect(getUnifiedDiffSource(chatChangesSourceId('chat-1'))).toBe(stored);
    });

    it('carries the repo label through for a group member', () => {
        const input = chatChangesTabInput({
            changes: { ctx: ctxOf() },
            ownerWorkspaceId: 'ws-member',
            chatId: 'chat-1',
            repoLabel: 'api',
        });
        expect(input.repoLabel).toBe('api');
    });
});

describe('registerUnifiedDiffSource with an explicit id', () => {
    it('leaves the content-addressed path untouched', () => {
        const ctx = ctxOf();
        expect(registerUnifiedDiffSource(ctx)).toBe(whisperDiffSourceId(ctx));
    });

    it('replaces the record under a fixed id only when the content actually changed', () => {
        const id = registerUnifiedDiffSource(ctxOf(), { sourceId: 'fixed' });
        const stored = getUnifiedDiffSource(id);
        registerUnifiedDiffSource(ctxOf(), { sourceId: 'fixed' });
        expect(getUnifiedDiffSource(id)).toBe(stored);
        registerUnifiedDiffSource(ctxOf(['src/a.ts', 'src/c.ts']), { sourceId: 'fixed' });
        expect(getUnifiedDiffSource(id)).not.toBe(stored);
        expect(getUnifiedDiffSource(id)?.ctx.files).toHaveLength(2);
    });

    it('notices a content change that keeps the same file list', () => {
        // Guard against the fixed-id path comparing ids instead of content and
        // leaving the tab on a stale context.
        registerUnifiedDiffSource(ctxOf(['src/a.ts'], 'ws-1'), { sourceId: 'fixed' });
        registerUnifiedDiffSource(ctxOf(['src/a.ts'], 'ws-other'), { sourceId: 'fixed' });
        expect(getUnifiedDiffSource('fixed')?.ctx.workspaceId).toBe('ws-other');
    });
});
