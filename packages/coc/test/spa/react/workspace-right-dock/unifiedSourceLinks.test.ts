/**
 * AC-04: the descriptor a clicked chat source link opens in the unified panel.
 *
 * The rules being pinned: a source link is always READ-ONLY (a reference, not an
 * authorization), it is owned by the clone the resolution picked rather than the
 * panel's own workspace, its `resourceId` is repo-relative because the panel's
 * file view reads through a repo's blob API, and it declines — returning null —
 * for every ref only the docked source canvas's probing transport can fetch, so
 * the caller keeps that surface instead of opening a tab that could only error.
 */
import { describe, expect, it } from 'vitest';
import {
    sourceLinkTabInput,
    type SourceLinkWorkspace,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedSourceLinks';

const WORKSPACES: SourceLinkWorkspace[] = [
    { id: 'ws-1', name: 'main-repo', rootPath: '/repos/main' },
    { id: 'ws-2', name: 'member-repo', rootPath: '/repos/member' },
    { id: 'ws-no-root', name: 'rootless' },
    // A repo group that does carry a root path: the relative-result guard, not a
    // missing root, is what has to keep a group ref off the panel.
    { id: 'group-1', name: 'the group', rootPath: '/repos/group' },
];

function input(fileRef: Record<string, unknown>, scopeWorkspaceId = 'ws-1') {
    return sourceLinkTabInput({
        fileRef: fileRef as never,
        workspaces: WORKSPACES,
        scopeWorkspaceId,
        chatId: 'task-A',
    });
}

describe('sourceLinkTabInput — what a chat source link opens', () => {
    it('opens an absolute in-repo path as a read-only, chat-scoped file tab', () => {
        expect(input({ fullPath: '/repos/main/src/app.ts', wsId: 'ws-1', line: 42 })).toEqual({
            kind: 'file',
            ownerWorkspaceId: 'ws-1',
            chatId: 'task-A',
            resourceId: 'src/app.ts',
            label: 'app.ts',
            readOnly: true,
            line: 42,
        });
    });

    it('omits the reveal line when the ref carried none', () => {
        expect(input({ fullPath: '/repos/main/src/app.ts', wsId: 'ws-1' })).not.toHaveProperty('line');
    });

    it('resolves a relative ref against the file it was mentioned in', () => {
        const tab = input({
            fullPath: '../lib/util.ts',
            wsId: 'ws-1',
            sourceFilePath: '/repos/main/src/app.ts',
        });
        expect(tab?.resourceId).toBe('lib/util.ts');
        expect(tab?.label).toBe('util.ts');
    });

    it('routes to the clone whose root actually contains the path, and labels it', () => {
        // The chat hints its own workspace, but the path lives in a member repo:
        // the read must reach that clone, and the strip must say which.
        const tab = input({ fullPath: '/repos/member/src/a.ts', wsId: 'ws-1' });
        expect(tab?.ownerWorkspaceId).toBe('ws-2');
        expect(tab?.repoLabel).toBe('member-repo');
    });

    it('leaves off the repo label when the owner is the panel’s own workspace', () => {
        expect(input({ fullPath: '/repos/main/src/a.ts', wsId: 'ws-1' })).not.toHaveProperty('repoLabel');
    });

    it.each([
        ['a note ref', { fullPath: '/repos/main/notes/n.md', wsId: 'ws-1', kind: 'note' }],
        ['a folder ref', { fullPath: '/repos/main/src', wsId: 'ws-1', kind: 'dir' }],
        ['an empty path', { fullPath: '', wsId: 'ws-1' }],
    ])('declines %s', (_label, ref) => {
        expect(input(ref)).toBeNull();
    });

    it('declines a repo-group ref, which only the server can probe', () => {
        // A `group-` hint keeps the path relative on purpose — there is no single
        // clone to route a blob read at.
        expect(input({ fullPath: 'src/a.ts', wsId: 'group-1' }, 'group-1')).toBeNull();
    });

    it('declines an absolute path outside every known workspace root', () => {
        expect(input({ fullPath: '/elsewhere/src/a.ts', wsId: 'ws-1' })).toBeNull();
    });

    it('declines a workspace with no known root', () => {
        expect(input({ fullPath: 'src/a.ts', wsId: 'ws-no-root' })).toBeNull();
    });

    it('declines the workspace root itself, which is not a file', () => {
        expect(input({ fullPath: '/repos/main', wsId: 'ws-1' })).toBeNull();
    });

    it('declines when nothing resolves at all', () => {
        expect(sourceLinkTabInput({
            fileRef: { fullPath: 'src/a.ts' } as never,
            workspaces: [],
            scopeWorkspaceId: 'ws-1',
            chatId: 'task-A',
        })).toBeNull();
    });
});
