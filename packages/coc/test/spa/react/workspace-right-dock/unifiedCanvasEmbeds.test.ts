/**
 * AC-04: the descriptor an inline canvas embed opens in the unified panel.
 *
 * The rules pinned here: the canvas is owned by the chat it was embedded in
 * (never an unowned workspace tab), it is routed at the clone the embed itself
 * read from rather than the panel's scope, a differing owner earns a repo
 * label, and the descriptor is identical to the one the "+" menu files for the
 * same canvas so both entry points reach one tab.
 */
import { describe, expect, it } from 'vitest';
import { canvasEmbedTabInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedCanvasEmbeds';
import { canvasOpenInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpenMenuModel';

const WORKSPACES = [
    { id: 'ws-1', name: 'main-repo' },
    { id: 'ws-2', name: 'member-repo' },
];

function input(overrides: Partial<Parameters<typeof canvasEmbedTabInput>[0]> = {}) {
    return canvasEmbedTabInput({
        canvasId: 'canvas-9',
        title: 'Release plan',
        ownerWorkspaceId: 'ws-1',
        scopeWorkspaceId: 'ws-1',
        chatId: 'task-A',
        workspaces: WORKSPACES,
        ...overrides,
    });
}

describe('canvasEmbedTabInput — what an inline canvas embed opens', () => {
    it('files the canvas under the chat it was embedded in', () => {
        expect(input()).toEqual({
            kind: 'canvas',
            ownerWorkspaceId: 'ws-1',
            chatId: 'task-A',
            resourceId: 'canvas-9',
            label: 'Release plan',
        });
    });

    it('routes at the embed’s own clone and labels it when it is not the panel’s', () => {
        // A repo group: the panel is scoped to the group, the canvas lives on a
        // member clone, and the strip has to say which one.
        const tab = input({ ownerWorkspaceId: 'ws-2', scopeWorkspaceId: 'group-acme' });
        expect(tab?.ownerWorkspaceId).toBe('ws-2');
        expect(tab?.repoLabel).toBe('member-repo');
    });

    it('leaves off the repo label when the owner is the panel’s own workspace', () => {
        expect(input()).not.toHaveProperty('repoLabel');
    });

    it('leaves off the repo label when the owning clone has no known name', () => {
        expect(input({ ownerWorkspaceId: 'ws-unknown', scopeWorkspaceId: 'group-acme' }))
            .not.toHaveProperty('repoLabel');
    });

    it('falls back to a placeholder label for an untitled canvas', () => {
        expect(input({ title: '   ' })?.label).toBe('Untitled canvas');
        expect(input({ title: undefined })?.label).toBe('Untitled canvas');
    });

    it.each([
        ['no chat owns it', { chatId: null }],
        ['the canvas id is blank', { canvasId: '  ' }],
        ['the owning clone is unnamed', { ownerWorkspaceId: '' }],
    ])('declines when %s', (_label, overrides) => {
        expect(input(overrides)).toBeNull();
    });

    it('produces the same descriptor as the "+" menu for the same canvas', () => {
        // Both entry points must land on one tab id, so the shared descriptor
        // builder is the one place the shape is decided.
        expect(input()).toEqual(
            canvasOpenInput(
                { id: 'canvas-9', title: 'Release plan' },
                { ownerWorkspaceId: 'ws-1', scopeWorkspaceId: 'ws-1', chatId: 'task-A' },
            ),
        );
    });
});
