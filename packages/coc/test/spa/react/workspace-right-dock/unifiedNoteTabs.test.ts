/**
 * AC-04: the descriptor a recognized note link opens in the unified panel.
 *
 * Two rules are pinned here. First, a note tab is WORKSPACE-owned and editable:
 * a note belongs to the workspace rather than to the chat that linked it, and
 * an editable plan-note link keeps its edit capability — unlike a code source
 * link, which stays read-only. Second, the descriptor has to carry enough to
 * rebuild the editor after a reload, when the link and the workspace list that
 * resolved it are gone: the fetch mode and the notes root travel inside
 * `resourceId`, and two notes with the same relative path under different roots
 * stay different resources.
 */
import { describe, expect, it } from 'vitest';
import {
    noteResourceId,
    noteTabInput,
    parseNoteResourceId,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedNoteTabs';
import { unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import type { WorkspaceLike } from '../../../../src/server/spa/client/react/shared/markdown-review/resolveMarkdownReviewTarget';

const WORKSPACES: WorkspaceLike[] = [
    { id: 'ws-1', name: 'main-repo', rootPath: '/repos/main' },
    { id: 'ws-2', name: 'member-repo', rootPath: '/repos/member' },
];

function input(fileRef: Record<string, unknown>, scopeWorkspaceId = 'ws-1') {
    return noteTabInput({
        fileRef: fileRef as never,
        workspaces: WORKSPACES,
        scopeWorkspaceId,
    });
}

describe('note resource identity', () => {
    it('round-trips the fetch mode, the notes root, and the path', () => {
        const resource = { fetchMode: 'tasks' as const, notesRoot: '/repos/main/.vscode/tasks', notePath: 'plan/goal.md' };
        expect(parseNoteResourceId(noteResourceId(resource))).toEqual(resource);
    });

    it('round-trips a rootless note, and a path containing the separator', () => {
        expect(parseNoteResourceId(noteResourceId({ fetchMode: 'auto', notePath: '/repos/main/a|b.md' })))
            .toEqual({ fetchMode: 'auto', notePath: '/repos/main/a|b.md' });
    });

    it('keeps the same relative path under two roots apart', () => {
        const a = noteResourceId({ fetchMode: 'tasks', notesRoot: '/repos/main/.vscode/tasks', notePath: 'goal.md' });
        const b = noteResourceId({ fetchMode: 'tasks', notesRoot: '/repos/member/.vscode/tasks', notePath: 'goal.md' });
        expect(a).not.toBe(b);
        expect(unifiedTabId({ kind: 'note', ownerWorkspaceId: 'ws-1', chatId: null, resourceId: a }))
            .not.toBe(unifiedTabId({ kind: 'note', ownerWorkspaceId: 'ws-1', chatId: null, resourceId: b }));
    });

    it('rejects a descriptor that is not a note resource', () => {
        expect(parseNoteResourceId('src/app.ts')).toBeNull();
        expect(parseNoteResourceId('auto|')).toBeNull();
        expect(parseNoteResourceId('auto||')).toBeNull();
        expect(parseNoteResourceId('http|/x|/n.md')).toBeNull();
    });
});

describe('noteTabInput — what a note link opens', () => {
    it('opens a workspace-owned, editable note tab', () => {
        expect(input({ fullPath: '/repos/main/notes/plan.md', wsId: 'ws-1', line: 8 })).toEqual({
            kind: 'note',
            ownerWorkspaceId: 'ws-1',
            chatId: null,
            resourceId: 'auto||/repos/main/notes/plan.md',
            label: 'plan.md',
            line: 8,
        });
    });

    it('never marks a note read-only — a plan-note link stays editable', () => {
        expect(input({ fullPath: '/repos/main/notes/plan.md', wsId: 'ws-1' })).not.toHaveProperty('readOnly');
    });

    it('keeps a task note task-relative so the tasks adapter can load it', () => {
        const result = input({ fullPath: '/repos/main/.vscode/tasks/t1/goal.md', wsId: 'ws-1' });
        expect(result?.resourceId).toBe('tasks||t1/goal.md');
        expect(result?.label).toBe('goal.md');
    });

    it('routes to the clone that owns the path, labelled when it is not the panel scope', () => {
        // The hint says the group; the longest matching root says the member.
        expect(input({ fullPath: '/repos/member/notes/n.md', wsId: 'ws-1' })).toMatchObject({
            ownerWorkspaceId: 'ws-2',
            repoLabel: 'member-repo',
        });
        // Same owner as the panel's scope earns no label.
        expect(input({ fullPath: '/repos/member/notes/n.md', wsId: 'ws-2' }, 'ws-2')).not.toHaveProperty('repoLabel');
    });

    it('resolves a relative link against the file it was mentioned in', () => {
        expect(input({ fullPath: './sibling.md', wsId: 'ws-1', sourceFilePath: '/repos/main/docs/index.md' }))
            .toMatchObject({ resourceId: 'auto||/repos/main/docs/sibling.md' });
    });

    it('declines when no workspace owns the path, so the caller keeps the docked canvas', () => {
        expect(input({ fullPath: '/elsewhere/n.md' })).toBeNull();
        expect(input({ fullPath: '' })).toBeNull();
    });
});
