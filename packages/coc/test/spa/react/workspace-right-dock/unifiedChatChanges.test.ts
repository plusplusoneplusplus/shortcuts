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
    getUnifiedChatChangesEntry,
    publishUnifiedChatChanges,
    withdrawUnifiedChatChanges,
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

    it('drops the entry when a chat republishes nothing', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf() });
        expect(publishUnifiedChatChanges('ws-1', 'chat-1', null)).toBe(true);
        expect(getUnifiedChatChanges('ws-1', 'chat-1')).toBeNull();
        // Publishing the same nothing twice is not a change, so nothing is woken.
        expect(publishUnifiedChatChanges('ws-1', 'chat-1', null)).toBe(false);
    });

    it('separates "no changes" from "nothing has spoken for this chat"', () => {
        // A restored Changes tab reads these two apart: the first is an empty
        // diff, the second is still loading. `getUnifiedChatChanges` — what the
        // `+` menu asks — answers null for both, so the entry stays hidden
        // either way.
        expect(getUnifiedChatChangesEntry('ws-1', 'chat-1')).toBeUndefined();

        publishUnifiedChatChanges('ws-1', 'chat-1', null);
        expect(getUnifiedChatChangesEntry('ws-1', 'chat-1')).toBeNull();
        expect(getUnifiedChatChanges('ws-1', 'chat-1')).toBeNull();

        // Un-hosting the chat is not the same statement — it goes back to unknown.
        expect(withdrawUnifiedChatChanges('ws-1', 'chat-1')).toBe(true);
        expect(getUnifiedChatChangesEntry('ws-1', 'chat-1')).toBeUndefined();
        // A second withdrawal moves nothing.
        expect(withdrawUnifiedChatChanges('ws-1', 'chat-1')).toBe(false);
        expect(getUnifiedChatChangesEntry('ws-1', null)).toBeUndefined();
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

describe('an already-open Changes tab (AC-03)', () => {
    // The menu registers the source when the entry is clicked. Later edits reach
    // the open tab only because publishing refreshes the source it is already
    // rendering — otherwise the tab would freeze at the moment it was opened.
    it('refreshes the open source as further edits arrive', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(['src/a.ts']), workspaceRootPath: '/root' });
        const input = chatChangesTabInput({
            changes: getUnifiedChatChanges('ws-1', 'chat-1')!,
            ownerWorkspaceId: 'ws-1',
            chatId: 'chat-1',
        });
        expect(getUnifiedDiffSource(input.resourceId)?.ctx.files).toHaveLength(1);

        publishUnifiedChatChanges('ws-1', 'chat-1', {
            ctx: ctxOf(['src/a.ts', 'src/b.ts']),
            workspaceRootPath: '/root',
        });
        const refreshed = getUnifiedDiffSource(input.resourceId);
        expect(refreshed?.ctx.files.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(refreshed?.workspaceRootPath).toBe('/root');
    });

    it('does not mint a source for a tab that was never opened', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(), workspaceRootPath: '/root' });
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(['src/a.ts', 'src/b.ts']), workspaceRootPath: '/root' });
        expect(getUnifiedDiffSource(chatChangesSourceId('chat-1'))).toBeNull();
    });

    it('keeps the stored record when the republished content is identical', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(), workspaceRootPath: '/root' });
        const input = chatChangesTabInput({
            changes: getUnifiedChatChanges('ws-1', 'chat-1')!,
            ownerWorkspaceId: 'ws-1',
            chatId: 'chat-1',
        });
        const stored = getUnifiedDiffSource(input.resourceId);
        // A re-render rebuilds an equal context; the tab must not lose the user's
        // file selection over it.
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(), workspaceRootPath: '/root' });
        expect(getUnifiedDiffSource(input.resourceId)).toBe(stored);
    });

    it('leaves the open source alone when the chat withdraws', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(), workspaceRootPath: '/root' });
        const input = chatChangesTabInput({
            changes: getUnifiedChatChanges('ws-1', 'chat-1')!,
            ownerWorkspaceId: 'ws-1',
            chatId: 'chat-1',
        });
        // Switching chats un-hosts the publisher; a tab that is simply off-screen
        // must not expire.
        withdrawUnifiedChatChanges('ws-1', 'chat-1');
        expect(getUnifiedChatChanges('ws-1', 'chat-1')).toBeNull();
        expect(getUnifiedDiffSource(input.resourceId)?.ctx.files).toHaveLength(1);
    });

    it('a background chat\'s publish cannot repoint another chat\'s open tab', () => {
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(['src/a.ts']), workspaceRootPath: '/root' });
        const input = chatChangesTabInput({
            changes: getUnifiedChatChanges('ws-1', 'chat-1')!,
            ownerWorkspaceId: 'ws-1',
            chatId: 'chat-1',
        });
        publishUnifiedChatChanges('ws-1', 'chat-2', { ctx: ctxOf(['other/z.ts']), workspaceRootPath: '/root' });
        expect(getUnifiedDiffSource(input.resourceId)?.ctx.files.map(f => f.path)).toEqual(['src/a.ts']);
        // Two chats, two sources — the second one is registered only once its
        // own tab is opened.
        expect(getUnifiedDiffSource(chatChangesSourceId('chat-2'))).toBeNull();
    });

    it('is chat-scoped, not panel-scoped: one chat has one Changes source', () => {
        // The registry of published entries is keyed by (panel scope, chat), but
        // the diff source is keyed by the chat alone. A chat id is globally
        // unique, so the same chat hosted by two panels is the same transcript
        // and the same changes — splitting it per scope would only duplicate the
        // identical source under two ids.
        publishUnifiedChatChanges('ws-1', 'chat-1', { ctx: ctxOf(['src/a.ts']), workspaceRootPath: '/root' });
        const input = chatChangesTabInput({
            changes: getUnifiedChatChanges('ws-1', 'chat-1')!,
            ownerWorkspaceId: 'ws-1',
            chatId: 'chat-1',
        });
        expect(input.resourceId).toBe(chatChangesSourceId('chat-1'));
        publishUnifiedChatChanges('group-scope', 'chat-1', {
            ctx: ctxOf(['src/a.ts', 'src/b.ts']),
            workspaceRootPath: '/root',
        });
        expect(getUnifiedDiffSource(input.resourceId)?.ctx.files).toHaveLength(2);
        // The published entries themselves stay separate per scope.
        expect(getUnifiedChatChanges('ws-1', 'chat-1')!.ctx.files).toHaveLength(1);
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
