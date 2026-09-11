/**
 * unifiedPanelOpenMenuModel — the pure part of the unified panel's searchable
 * "+" menu (AC-03): which actions exist for a target/chat, how the three
 * sources flatten into one keyboard list, which rows the cursor may land on,
 * and the descriptor a selection opens with.
 */
import { describe, expect, it } from 'vitest';
import {
    buildOpenMenuItems,
    canvasOpenInput,
    fileOpenInput,
    firstOpenMenuIndex,
    isOpenMenuItemEnabled,
    nextOpenMenuIndex,
    normalizeResourcePath,
    openMenuActions,
    resourcePathName,
    type OpenMenuAction,
    type OpenMenuItem,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpenMenuModel';
import { unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const REPO = 'ws-repo';
const GROUP = 'group-acme';

function ids(actions: readonly OpenMenuAction[]): string[] {
    return actions.map(action => action.id);
}

describe('openMenuActions', () => {
    it('offers terminal, explorer, notes and canvas for a concrete repo with a chat', () => {
        const actions = openMenuActions({ targetWorkspaceId: REPO, chatId: 'chat-1' });
        expect(ids(actions)).toEqual(['terminal', 'explorer', 'notes', 'canvas']);
        expect(actions.every(action => action.disabled !== true)).toBe(true);
    });

    it('omits Explorer for a repo group root, which has no single file tree', () => {
        const actions = openMenuActions({ targetWorkspaceId: GROUP, chatId: 'chat-1' });
        expect(ids(actions)).toEqual(['terminal', 'notes', 'canvas']);
    });

    it('disables Canvas with a reason when no chat is selected, rather than hiding it', () => {
        const canvas = openMenuActions({ targetWorkspaceId: REPO, chatId: null })
            .find(action => action.id === 'canvas');
        expect(canvas?.disabled).toBe(true);
        expect(canvas?.disabledReason).toMatch(/chat/i);
    });

    it('disables only the repo-bound actions when the target is unavailable', () => {
        const actions = openMenuActions({
            targetWorkspaceId: REPO,
            chatId: 'chat-1',
            targetUnavailable: true,
            targetUnavailableReason: 'api is offline.',
        });
        const byId = Object.fromEntries(actions.map(action => [action.id, action]));
        expect(byId.terminal.disabled).toBe(true);
        expect(byId.terminal.disabledReason).toBe('api is offline.');
        expect(byId.explorer.disabled).toBe(true);
        // Notes belongs to the panel's workspace, not to the target repo.
        expect(byId.notes.disabled).toBeUndefined();
        expect(byId.canvas.disabled).toBeUndefined();
    });

    it('lists Changes right after New Canvas for a chat that changed files', () => {
        const actions = openMenuActions({ targetWorkspaceId: REPO, chatId: 'chat-1', chatHasChanges: true });
        expect(ids(actions)).toEqual(['terminal', 'explorer', 'notes', 'canvas', 'changes']);
        expect(actions.find(action => action.id === 'changes')?.disabled).toBeUndefined();
    });

    it('hides Changes for a chat that changed nothing', () => {
        expect(ids(openMenuActions({ targetWorkspaceId: REPO, chatId: 'chat-1' }))).not.toContain('changes');
        expect(ids(openMenuActions({ targetWorkspaceId: REPO, chatId: 'chat-1', chatHasChanges: false })))
            .not.toContain('changes');
    });

    it('hides Changes when no chat is selected, even if something was published', () => {
        const actions = openMenuActions({ targetWorkspaceId: REPO, chatId: null, chatHasChanges: true });
        expect(ids(actions)).not.toContain('changes');
    });

    it('keeps Changes usable on an unavailable target — the diff is replayed, not read', () => {
        const actions = openMenuActions({
            targetWorkspaceId: REPO,
            chatId: 'chat-1',
            chatHasChanges: true,
            targetUnavailable: true,
            targetUnavailableReason: 'api is offline.',
        });
        expect(actions.find(action => action.id === 'changes')?.disabled).toBeUndefined();
    });
});

describe('buildOpenMenuItems', () => {
    const actions = openMenuActions({ targetWorkspaceId: REPO, chatId: 'chat-1' });
    const files = [{ path: 'src/app.ts' }, { path: 'src/terminal.ts' }];
    const canvases = [{ id: 'c1', title: 'Design notes' }];

    it('lists actions and chat canvases and fetches nothing with an empty query', () => {
        const items = buildOpenMenuItems({ actions, files, canvases, query: '' });
        expect(items.map(item => item.key)).toEqual([
            'action:terminal', 'action:explorer', 'action:notes', 'action:canvas', 'canvas:c1',
        ]);
    });

    it('puts file results first once a query is typed, so Enter opens the top hit', () => {
        const items = buildOpenMenuItems({ actions, files, canvases, query: 'app' });
        expect(items[0]).toMatchObject({ type: 'file', file: { path: 'src/app.ts' } });
    });

    it('still reaches a matching action from the search box', () => {
        const items = buildOpenMenuItems({ actions, files: [], canvases, query: 'term' });
        expect(items.map(item => item.key)).toEqual(['action:terminal']);
    });

    it('filters canvases by title', () => {
        const items = buildOpenMenuItems({ actions, files: [], canvases, query: 'design' });
        expect(items).toEqual([{ key: 'canvas:c1', type: 'canvas', canvas: canvases[0] }]);
    });
});

describe('cursor movement', () => {
    const disabledAction: OpenMenuItem = {
        key: 'action:canvas',
        type: 'action',
        action: { id: 'canvas', label: 'New Canvas', disabled: true, disabledReason: 'no chat' },
    };
    const enabled = (key: string): OpenMenuItem => ({
        key: `action:${key}`,
        type: 'action',
        action: { id: 'terminal', label: key },
    });

    it('treats a disabled action as unselectable', () => {
        expect(isOpenMenuItemEnabled(disabledAction)).toBe(false);
        expect(isOpenMenuItemEnabled(enabled('a'))).toBe(true);
    });

    it('skips disabled rows and wraps in both directions', () => {
        const items = [enabled('a'), disabledAction, enabled('b')];
        expect(nextOpenMenuIndex(items, 0, 1)).toBe(2);
        expect(nextOpenMenuIndex(items, 2, 1)).toBe(0);
        expect(nextOpenMenuIndex(items, 0, -1)).toBe(2);
    });

    it('reports -1 when nothing in the list is selectable', () => {
        expect(nextOpenMenuIndex([disabledAction], 0, 1)).toBe(-1);
        expect(firstOpenMenuIndex([disabledAction])).toBe(-1);
        expect(nextOpenMenuIndex([], 0, 1)).toBe(-1);
    });

    it('seats the first cursor on the first selectable row', () => {
        expect(firstOpenMenuIndex([disabledAction, enabled('a')])).toBe(1);
    });
});

describe('selection descriptors', () => {
    const context = { ownerWorkspaceId: REPO, scopeWorkspaceId: REPO, chatId: 'chat-1' };

    it('normalizes a path so two spellings reach one tab', () => {
        expect(normalizeResourcePath('./src//app.ts')).toBe('src/app.ts');
        expect(normalizeResourcePath('/src/app.ts')).toBe('src/app.ts');
        expect(resourcePathName('src/app.ts')).toBe('app.ts');

        const a = fileOpenInput('./src//app.ts', context);
        const b = fileOpenInput('src/app.ts', context);
        expect(unifiedTabId(a)).toBe(unifiedTabId(b));
    });

    it('opens a searched file as an editable, chat-scoped tab on the owning clone', () => {
        const input = fileOpenInput('src/app.ts', {
            ...context,
            ownerWorkspaceId: 'ws-member',
            ownerRoutingRef: 'remote:server-b:ws-member',
            ownerLabel: 'member',
        });
        expect(input).toEqual({
            kind: 'file',
            ownerWorkspaceId: 'ws-member',
            ownerRoutingRef: 'remote:server-b:ws-member',
            chatId: 'chat-1',
            resourceId: 'src/app.ts',
            label: 'app.ts',
            repoLabel: 'member',
        });
        // The "+" menu is an authorized entry point; it must not mark the tab
        // read-only, and it must not silently grant anything else either.
        expect(input.readOnly).toBeUndefined();
    });

    it('omits the repo label when the resource comes from the panel own workspace', () => {
        expect(fileOpenInput('a.ts', { ...context, ownerLabel: 'self' }).repoLabel).toBeUndefined();
    });

    it('labels an untitled canvas rather than opening a blank tab', () => {
        expect(canvasOpenInput({ id: 'c1', title: '  ' }, context)).toMatchObject({
            kind: 'canvas',
            resourceId: 'c1',
            label: 'Untitled canvas',
            chatId: 'chat-1',
        });
    });
});
