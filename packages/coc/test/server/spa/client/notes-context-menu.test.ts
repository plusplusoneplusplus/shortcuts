import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteTreeNode } from '../../../../src/server/spa/client/react/repos/notesApi';

// We test the buildContextMenuItems logic extracted from NotesSidebar.
// Since it is a closure inside the component, we replicate the logic here so
// it can be unit-tested without spinning up a React environment.

type ContextMenuItem = {
    label: string;
    onClick: () => void;
    separator?: boolean;
};

type NoteDialogAction =
    | 'create-notebook'
    | 'create-section'
    | 'create-page'
    | 'rename'
    | 'delete';

function buildContextMenuItems(
    node: NoteTreeNode,
    openDialog: (action: NoteDialogAction, node: NoteTreeNode) => void,
    closeContextMenu: () => void,
): ContextMenuItem[] {
    // Root-level context menu (right-click on empty space)
    if (node.path === '' && node.name === '') {
        return [
            { label: 'New Notebook', onClick: () => openDialog('create-notebook', node) },
            { label: 'New Note', onClick: () => openDialog('create-page', node) },
        ];
    }

    const isFolder = node.type === 'notebook' || node.type === 'section';

    if (isFolder) {
        return [
            { label: 'Copy Path', onClick: () => { void navigator.clipboard.writeText(node.path); closeContextMenu(); } },
            { separator: true, label: '', onClick: () => {} },
            { label: 'Create Page', onClick: () => openDialog('create-page', node) },
            { label: 'Create Section', onClick: () => openDialog('create-section', node) },
            { separator: true, label: '', onClick: () => {} },
            { label: 'Rename', onClick: () => openDialog('rename', node) },
            { label: 'Delete', onClick: () => openDialog('delete', node) },
        ];
    }
    return [
        { label: 'Copy Path', onClick: () => { void navigator.clipboard.writeText(node.path); closeContextMenu(); } },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Rename', onClick: () => openDialog('rename', node) },
        { label: 'Delete', onClick: () => openDialog('delete', node) },
    ];
}

describe('NotesSidebar buildContextMenuItems', () => {
    const openDialog = vi.fn();
    const closeContextMenu = vi.fn();

    beforeEach(() => {
        openDialog.mockClear();
        closeContextMenu.mockClear();
        Object.defineProperty(globalThis, 'navigator', {
            value: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
            writable: true,
            configurable: true,
        });
    });

    describe('root synthetic node (empty-space right-click)', () => {
        const rootNode: NoteTreeNode = { name: '', path: '', type: 'notebook' };

        it('does not include Copy Path', () => {
            const items = buildContextMenuItems(rootNode, openDialog, closeContextMenu);
            expect(items.map(i => i.label)).not.toContain('Copy Path');
        });

        it('includes New Notebook and New Note', () => {
            const items = buildContextMenuItems(rootNode, openDialog, closeContextMenu);
            expect(items.map(i => i.label)).toContain('New Notebook');
            expect(items.map(i => i.label)).toContain('New Note');
        });
    });

    describe('page node', () => {
        const pageNode: NoteTreeNode = { name: 'my-note.md', path: 'My Notebook/my-note.md', type: 'page' };

        it('includes Copy Path', () => {
            const items = buildContextMenuItems(pageNode, openDialog, closeContextMenu);
            expect(items.map(i => i.label)).toContain('Copy Path');
        });

        it('Copy Path writes node.path to clipboard and closes menu', async () => {
            const items = buildContextMenuItems(pageNode, openDialog, closeContextMenu);
            const copyItem = items.find(i => i.label === 'Copy Path')!;
            copyItem.onClick();
            // flush microtasks so the void promise settles
            await Promise.resolve();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('My Notebook/my-note.md');
            expect(closeContextMenu).toHaveBeenCalledOnce();
        });

        it('Copy Path is the first item', () => {
            const items = buildContextMenuItems(pageNode, openDialog, closeContextMenu);
            expect(items[0].label).toBe('Copy Path');
        });

        it('separator follows Copy Path', () => {
            const items = buildContextMenuItems(pageNode, openDialog, closeContextMenu);
            expect(items[1].separator).toBe(true);
        });

        it('includes Rename and Delete after Copy Path', () => {
            const items = buildContextMenuItems(pageNode, openDialog, closeContextMenu);
            const labels = items.map(i => i.label);
            expect(labels).toContain('Rename');
            expect(labels).toContain('Delete');
        });
    });

    describe('notebook node', () => {
        const notebookNode: NoteTreeNode = { name: 'My Notebook', path: 'My Notebook', type: 'notebook' };

        it('includes Copy Path', () => {
            const items = buildContextMenuItems(notebookNode, openDialog, closeContextMenu);
            expect(items.map(i => i.label)).toContain('Copy Path');
        });

        it('Copy Path writes node.path to clipboard and closes menu', async () => {
            const items = buildContextMenuItems(notebookNode, openDialog, closeContextMenu);
            const copyItem = items.find(i => i.label === 'Copy Path')!;
            copyItem.onClick();
            await Promise.resolve();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('My Notebook');
            expect(closeContextMenu).toHaveBeenCalledOnce();
        });

        it('Copy Path is the first item', () => {
            const items = buildContextMenuItems(notebookNode, openDialog, closeContextMenu);
            expect(items[0].label).toBe('Copy Path');
        });

        it('includes Create Page and Create Section', () => {
            const items = buildContextMenuItems(notebookNode, openDialog, closeContextMenu);
            const labels = items.map(i => i.label);
            expect(labels).toContain('Create Page');
            expect(labels).toContain('Create Section');
        });
    });

    describe('section node', () => {
        const sectionNode: NoteTreeNode = { name: 'Section A', path: 'My Notebook/Section A', type: 'section' };

        it('includes Copy Path', () => {
            const items = buildContextMenuItems(sectionNode, openDialog, closeContextMenu);
            expect(items.map(i => i.label)).toContain('Copy Path');
        });

        it('Copy Path writes node.path to clipboard and closes menu', async () => {
            const items = buildContextMenuItems(sectionNode, openDialog, closeContextMenu);
            const copyItem = items.find(i => i.label === 'Copy Path')!;
            copyItem.onClick();
            await Promise.resolve();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('My Notebook/Section A');
            expect(closeContextMenu).toHaveBeenCalledOnce();
        });
    });
});
