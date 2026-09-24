import { describe, expect, it } from 'vitest';
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
    it('offers common close commands for every tab kind and file commands only for files', () => {
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
            expect(actions.includes('copy-path')).toBe(kind === 'file');
            expect(actions).not.toContain('split-right');
            expect(actions).not.toContain('pin');
        }
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

        expect(unifiedPanelBulkCloseTargets(visible, visible[0].id, 'close-all', new Set()))
            .toEqual(visible.map(item => item.id));
        expect(unifiedPanelBulkCloseTargets(visible, visible[0].id, 'close-all', new Set()))
            .not.toContain('file:chat-2:ws-1:src/hidden.ts');
    });

    it('resolves local, Windows, trusted, and unavailable absolute paths', () => {
        const file = tab('file', 'src/a.ts');
        expect(unifiedPanelAbsoluteFilePath(file, '/repo/root/')).toBe('/repo/root/src/a.ts');
        expect(unifiedPanelAbsoluteFilePath(file, 'C:\\repo\\root\\')).toBe('C:\\repo\\root\\src\\a.ts');
        expect(unifiedPanelRelativeFilePath(file)).toBe('src/a.ts');

        const trusted = tab('file', `${TRUSTED_PATH_PREFIX}/home/user/.config/file.json`);
        expect(unifiedPanelAbsoluteFilePath(trusted, undefined)).toBe('/home/user/.config/file.json');
        expect(unifiedPanelRelativeFilePath(trusted)).toBeNull();
        expect(unifiedPanelFileActionAvailability(file, undefined)).toEqual({
            copyPath: false,
            copyRelativePath: true,
            revealInExplorer: true,
        });
    });
});
