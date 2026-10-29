import { describe, expect, it } from 'vitest';
import { WORKSPACE_PREVIEW_PREFIX } from '../../../../src/server/spa/client/react/shared/file-viewer/workspacePreview';
import { TRUSTED_PATH_PREFIX } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen';
import {
    EMPTY_UNIFIED_PANEL,
    openTab,
    visibleTabs,
    type UnifiedPanelTab,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    unifiedPanelAbsoluteFilePath,
    unifiedPanelBulkCloseTargets,
    unifiedPanelFileActionAvailability,
    unifiedPanelRelativeFilePath,
    unifiedPanelTabMenuItems,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabMenuModel';

const WS = 'ws-1';
const CHAT = 'chat-1';

function tab(
    kind: UnifiedPanelTab['kind'],
    resourceId: string,
    overrides: Partial<UnifiedPanelTab> = {},
): UnifiedPanelTab {
    return {
        id: `${kind}:${resourceId}`,
        kind,
        ownerWorkspaceId: WS,
        chatId: kind === 'terminal' || kind === 'notes' || kind === 'note' ? null : CHAT,
        resourceId,
        label: resourceId,
        ...overrides,
    };
}

describe('unified panel tab menu model', () => {
    it('offers common close commands for every tab kind and path copy only for file-backed tabs', () => {
        const kinds: UnifiedPanelTab['kind'][] = ['terminal', 'notes', 'note', 'file', 'canvas', 'diff', 'external'];
        for (const kind of kinds) {
            const current = tab(kind, kind);
            const actions = unifiedPanelTabMenuItems(current, [current], new Set(), {
                copyPath: true,
                copyRelativePath: true,
                revealInExplorer: true,
            }).map(item => item.action);
            expect(actions.slice(0, 5)).toEqual([
                'close', 'close-others', 'close-right', 'close-saved', 'close-all',
            ]);
            expect(actions.includes('copy-path')).toBe(kind === 'file' || kind === 'note');
            expect(actions).not.toContain('split-right');
            expect(actions).not.toContain('pin');
        }
    });

    it('offers Open to the Right only for file tabs when the source split is available', () => {
        const kinds: UnifiedPanelTab['kind'][] = ['terminal', 'browser', 'file', 'canvas', 'external'];
        for (const kind of kinds) {
            const current = tab(kind, kind);
            const enabled = unifiedPanelTabMenuItems(current, [current], new Set(), {
                copyPath: false, copyRelativePath: false, revealInExplorer: false, openToSide: true,
            }).map(item => item.action);
            expect(enabled.includes('open-to-side'), kind).toBe(kind === 'file');
            const disabled = unifiedPanelTabMenuItems(current, [current], new Set()).map(item => item.action);
            expect(disabled).not.toContain('open-to-side');
        }
    });

    it('offers Copy path for a remote file using its owner root', () => {
        const remote = tab('file', 'src/remote.ts', { ownerRoutingRef: 'remote:server-b:ws-1' });
        const actions = unifiedPanelTabMenuItems(
            remote,
            [remote],
            new Set(),
            unifiedPanelFileActionAvailability(remote, '/remote/repo'),
        ).map(item => item.action);

        expect(actions).toContain('copy-path');
        expect(actions).toContain('copy-relative-path');
    });

    it('puts Keep Open before close commands only for a preview tab', () => {
        const preview = tab('file', 'src/a.ts', { preview: true });
        expect(unifiedPanelTabMenuItems(preview, [preview], new Set())[0].action).toBe('keep-open');
        expect(unifiedPanelTabMenuItems({ ...preview, preview: undefined }, [preview], new Set())[0].action)
            .toBe('close');
    });

    it('selects bulk targets from visible rendered order across the section boundary', () => {
        const workspace = tab('terminal', 'terminal');
        const firstChat = tab('file', 'src/a.ts');
        const secondChat = tab('canvas', 'canvas-1');
        const tabs = [workspace, firstChat, secondChat];
        const dirty = new Set([firstChat.id]);

        expect(unifiedPanelBulkCloseTargets(tabs, workspace.id, 'close-others', dirty))
            .toEqual([firstChat.id, secondChat.id]);
        expect(unifiedPanelBulkCloseTargets(tabs, workspace.id, 'close-right', dirty))
            .toEqual([firstChat.id, secondChat.id]);
        expect(unifiedPanelBulkCloseTargets(tabs, firstChat.id, 'close-saved', dirty))
            .toEqual([workspace.id, secondChat.id]);
        expect(unifiedPanelBulkCloseTargets(tabs, firstChat.id, 'close-all', dirty))
            .toEqual([workspace.id, firstChat.id, secondChat.id]);
    });

    it('offers group-only closes behind the flag and retains saved order and dirty tabs', () => {
        const first = tab('file', 'first.ts');
        const note = tab('note', 'note.md');
        const last = tab('diff', 'last.diff');
        const tabs = [first, tab('browser', 'web'), note, tab('canvas', 'canvas'), last];
        const dirty = new Set([last.id]);
        expect(unifiedPanelBulkCloseTargets(tabs, note.id, 'close-group', dirty))
            .toEqual([first.id, note.id, last.id]);
        expect(unifiedPanelBulkCloseTargets(tabs, note.id, 'close-others-in-group', dirty))
            .toEqual([first.id, last.id]);
        const off = unifiedPanelTabMenuItems(note, tabs, dirty);
        expect(off.some(item => item.action === 'close-group')).toBe(false);
        const on = unifiedPanelTabMenuItems(note, tabs, dirty, undefined, undefined, true);
        expect(on.find(item => item.action === 'close-group')?.disabled).toBe(false);
        expect(on.find(item => item.action === 'close-others-in-group')?.disabled).toBe(false);
        const singleton = unifiedPanelTabMenuItems(tabs[1], tabs, dirty, undefined, undefined, true);
        expect(singleton.find(item => item.action === 'close-others-in-group')?.disabled).toBe(true);
    });

    it('bounds grouped menu moves even when given mixed movable ids', () => {
        const first = tab('file', 'first.ts');
        const last = tab('note', 'last.md');
        const tabs = [tab('terminal', 'terminal'), first, tab('browser', 'web'), last, tab('canvas', 'canvas')];
        const ids = tabs.map(item => item.id);
        const firstItems = unifiedPanelTabMenuItems(first, tabs, new Set(), undefined, ids, true);
        expect(firstItems.find(item => item.action === 'move-left')?.disabled).toBe(true);
        expect(firstItems.find(item => item.action === 'move-right')?.disabled).toBe(false);
        const lastItems = unifiedPanelTabMenuItems(last, tabs, new Set(), undefined, ids, true);
        expect(lastItems.find(item => item.action === 'move-left')?.disabled).toBe(false);
        expect(lastItems.find(item => item.action === 'move-right')?.disabled).toBe(true);
    });

    it('never targets tabs hidden under another chat', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal', label: 'Terminal',
        });
        state = openTab(state, {
            kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/a.ts', label: 'a.ts',
        });
        state = openTab(state, {
            kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-2', resourceId: 'src/hidden.ts', label: 'hidden.ts',
        });
        const visible = visibleTabs(state, CHAT);
        const hiddenId = state.chatTabs['chat-2'][0].id;

        expect(unifiedPanelBulkCloseTargets(visible, visible[0].id, 'close-all', new Set()))
            .toEqual(visible.map(item => item.id));
        expect(unifiedPanelBulkCloseTargets(visible, visible[0].id, 'close-all', new Set()))
            .not.toContain(hiddenId);
    });

    it('resolves local, Windows, trusted, remote, and unavailable absolute paths', () => {
        const file = tab('file', 'src/a.ts');
        expect(unifiedPanelAbsoluteFilePath(file, '/repo/root/')).toBe('/repo/root/src/a.ts');
        expect(unifiedPanelAbsoluteFilePath(file, 'C:\\repo\\root\\')).toBe('C:\\repo\\root\\src\\a.ts');
        expect(unifiedPanelRelativeFilePath(file)).toBe('src/a.ts');

        const trusted = tab('file', `${TRUSTED_PATH_PREFIX}/home/user/.config/file.json`);
        expect(unifiedPanelAbsoluteFilePath(trusted, undefined)).toBe('/home/user/.config/file.json');
        expect(unifiedPanelRelativeFilePath(trusted)).toBeNull();
        const remote = { ...file, ownerRoutingRef: 'remote:server-b:ws-1' };
        expect(unifiedPanelAbsoluteFilePath(remote, '/remote/repo')).toBe('/remote/repo/src/a.ts');
        expect(unifiedPanelFileActionAvailability(remote, '/remote/repo').copyPath).toBe(true);
        expect(unifiedPanelFileActionAvailability(file, undefined)).toEqual({
            copyPath: false,
            copyRelativePath: true,
            revealInExplorer: true,
        });
    });

    it.each([
        ['auto||/remote/docs/actual.md', undefined, '/remote/docs/actual.md'],
        ['tasks|/remote/custom/tasks|plan.md', '/wrong/repo', '/remote/custom/tasks/plan.md'],
        ['tasks||plan.md', '/wrong/repo', null],
        ['auto||docs/plan.md', '/owner/repo', '/owner/repo/docs/plan.md'],
        ['auto||docs/plan.md', undefined, null],
        ['auto||https://host/plan.md', '/owner/repo', null],
        ['invalid', '/owner/repo', null],
        ['auto||C:\\docs\\actual.md', undefined, 'C:\\docs\\actual.md'],
        ['tasks|\\\\host\\share\\tasks|plan.md', undefined, '\\\\host\\share\\tasks\\plan.md'],
    ])('resolves a Markdown tab from its saved resource %s', (resourceId, root, expected) => {
        const note = tab('note', resourceId, { label: 'unrelated title', ownerRoutingRef: 'remote:other:ws-1' });
        expect(unifiedPanelAbsoluteFilePath(note, root)).toBe(expected);
        const items = unifiedPanelTabMenuItems(note, [note], new Set(), unifiedPanelFileActionAvailability(note, root));
        expect(items.some(item => item.action === 'copy-path')).toBe(expected !== null);
        expect(items.some(item => item.action === 'copy-relative-path')).toBe(false);
    });

    it('uses exact preview paths and rejects missing paths and non-file content', () => {
        const preview = tab('file', WORKSPACE_PREVIEW_PREFIX + '/remote/actual.md', { ownerRoutingRef: 'remote:b:ws-1' });
        expect(unifiedPanelAbsoluteFilePath(preview, '/wrong')).toBe('/remote/actual.md');
        for (const resource of ['', TRUSTED_PATH_PREFIX, WORKSPACE_PREVIEW_PREFIX, TRUSTED_PATH_PREFIX + 'relative.md']) {
            expect(unifiedPanelAbsoluteFilePath(tab('file', resource), '/repo')).toBeNull();
        }
        for (const kind of ['paste', 'browser', 'canvas', 'external', 'notes'] as const) {
            expect(unifiedPanelAbsoluteFilePath(tab(kind, '/looks/like/a/path.md'), '/repo')).toBeNull();
        }
        expect(unifiedPanelAbsoluteFilePath(tab('file', 'a.md'), 'relative/root')).toBeNull();
        expect(unifiedPanelAbsoluteFilePath(tab('file', 'a.md'), '/')).toBe('/a.md');
    });
});
