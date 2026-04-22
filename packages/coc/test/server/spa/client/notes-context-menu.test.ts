import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteTreeNode } from '../../../../src/server/spa/client/react/features/notes/notesApi';

// Test the buildContextMenuItems logic from NotesSidebar in isolation.
// The function is a closure inside the component, so we replicate it here.

type ContextMenuItem = {
    label: string;
    onClick: () => void;
    separator?: boolean;
};

type NoteDialogAction = 'create-notebook' | 'create-section' | 'create-page' | 'rename' | 'delete';

function buildContextMenuItems(
    node: NoteTreeNode,
    notesRoot: string | null,
    openDialog: (action: NoteDialogAction, node: NoteTreeNode) => void,
    closeContextMenu: () => void,
): ContextMenuItem[] {
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
            { label: 'Copy Absolute Path', onClick: () => { if (notesRoot) void navigator.clipboard.writeText(notesRoot + '/' + node.path); closeContextMenu(); } },
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
        { label: 'Copy Absolute Path', onClick: () => { if (notesRoot) void navigator.clipboard.writeText(notesRoot + '/' + node.path); closeContextMenu(); } },
        { separator: true, label: '', onClick: () => {} },
        { label: 'Rename', onClick: () => openDialog('rename', node) },
        { label: 'Delete', onClick: () => openDialog('delete', node) },
    ];
}

describe('NotesSidebar buildContextMenuItems', () => {
    const openDialog = vi.fn();
    const closeContextMenu = vi.fn();
    const NOTES_ROOT = '/home/user/.coc/repos/ws-1/notes';

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
            const items = buildContextMenuItems(rootNode, NOTES_ROOT, openDialog, closeContextMenu);
            expect(items.map(i => i.label)).not.toContain('Copy Path');
        });

        it('does not include Copy Absolute Path', () => {
            const items = buildContextMenuItems(rootNode, NOTES_ROOT, openDialog, closeContextMenu);
            expect(items.map(i => i.label)).not.toContain('Copy Absolute Path');
        });

        it('includes New Notebook and New Note', () => {
            const items = buildContextMenuItems(rootNode, NOTES_ROOT, openDialog, closeContextMenu);
            const labels = items.map(i => i.label);
            expect(labels).toContain('New Notebook');
            expect(labels).toContain('New Note');
        });
    });

    describe('page node', () => {
        const pageNode: NoteTreeNode = { name: 'my-note.md', path: 'My Notebook/my-note.md', type: 'page' };

        it('includes Copy Path and Copy Absolute Path', () => {
            const items = buildContextMenuItems(pageNode, NOTES_ROOT, openDialog, closeContextMenu);
            const labels = items.map(i => i.label);
            expect(labels).toContain('Copy Path');
            expect(labels).toContain('Copy Absolute Path');
        });

        it('Copy Path is first, Copy Absolute Path is second', () => {
            const items = buildContextMenuItems(pageNode, NOTES_ROOT, openDialog, closeContextMenu);
            expect(items[0].label).toBe('Copy Path');
            expect(items[1].label).toBe('Copy Absolute Path');
        });

        it('separator follows the copy group', () => {
            const items = buildContextMenuItems(pageNode, NOTES_ROOT, openDialog, closeContextMenu);
            expect(items[2].separator).toBe(true);
        });

        it('Copy Path writes node.path to clipboard and closes menu', async () => {
            const items = buildContextMenuItems(pageNode, NOTES_ROOT, openDialog, closeContextMenu);
            items.find(i => i.label === 'Copy Path')!.onClick();
            await Promise.resolve();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('My Notebook/my-note.md');
            expect(closeContextMenu).toHaveBeenCalledOnce();
        });

        it('Copy Absolute Path writes notesRoot + "/" + node.path to clipboard and closes menu', async () => {
            const items = buildContextMenuItems(pageNode, NOTES_ROOT, openDialog, closeContextMenu);
            items.find(i => i.label === 'Copy Absolute Path')!.onClick();
            await Promise.resolve();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
                `${NOTES_ROOT}/My Notebook/my-note.md`,
            );
            expect(closeContextMenu).toHaveBeenCalledOnce();
        });

        it('Copy Absolute Path does not write if notesRoot is null', async () => {
            const items = buildContextMenuItems(pageNode, null, openDialog, closeContextMenu);
            items.find(i => i.label === 'Copy Absolute Path')!.onClick();
            await Promise.resolve();
            expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
            // Menu is still closed
            expect(closeContextMenu).toHaveBeenCalledOnce();
        });

        it('includes Rename and Delete', () => {
            const items = buildContextMenuItems(pageNode, NOTES_ROOT, openDialog, closeContextMenu);
            const labels = items.map(i => i.label);
            expect(labels).toContain('Rename');
            expect(labels).toContain('Delete');
        });
    });

    describe('notebook node', () => {
        const notebookNode: NoteTreeNode = { name: 'My Notebook', path: 'My Notebook', type: 'notebook' };

        it('includes Copy Path and Copy Absolute Path', () => {
            const items = buildContextMenuItems(notebookNode, NOTES_ROOT, openDialog, closeContextMenu);
            const labels = items.map(i => i.label);
            expect(labels).toContain('Copy Path');
            expect(labels).toContain('Copy Absolute Path');
        });

        it('Copy Path writes node.path', async () => {
            const items = buildContextMenuItems(notebookNode, NOTES_ROOT, openDialog, closeContextMenu);
            items.find(i => i.label === 'Copy Path')!.onClick();
            await Promise.resolve();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('My Notebook');
            expect(closeContextMenu).toHaveBeenCalledOnce();
        });

        it('Copy Absolute Path writes notesRoot + "/" + node.path', async () => {
            const items = buildContextMenuItems(notebookNode, NOTES_ROOT, openDialog, closeContextMenu);
            items.find(i => i.label === 'Copy Absolute Path')!.onClick();
            await Promise.resolve();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${NOTES_ROOT}/My Notebook`);
            expect(closeContextMenu).toHaveBeenCalledOnce();
        });

        it('Copy Path is first, Copy Absolute Path is second', () => {
            const items = buildContextMenuItems(notebookNode, NOTES_ROOT, openDialog, closeContextMenu);
            expect(items[0].label).toBe('Copy Path');
            expect(items[1].label).toBe('Copy Absolute Path');
        });

        it('includes Create Page and Create Section', () => {
            const items = buildContextMenuItems(notebookNode, NOTES_ROOT, openDialog, closeContextMenu);
            const labels = items.map(i => i.label);
            expect(labels).toContain('Create Page');
            expect(labels).toContain('Create Section');
        });
    });

    describe('section node', () => {
        const sectionNode: NoteTreeNode = { name: 'Section A', path: 'My Notebook/Section A', type: 'section' };

        it('includes Copy Path and Copy Absolute Path', () => {
            const items = buildContextMenuItems(sectionNode, NOTES_ROOT, openDialog, closeContextMenu);
            const labels = items.map(i => i.label);
            expect(labels).toContain('Copy Path');
            expect(labels).toContain('Copy Absolute Path');
        });

        it('Copy Absolute Path uses notesRoot correctly', async () => {
            const items = buildContextMenuItems(sectionNode, NOTES_ROOT, openDialog, closeContextMenu);
            items.find(i => i.label === 'Copy Absolute Path')!.onClick();
            await Promise.resolve();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
                `${NOTES_ROOT}/My Notebook/Section A`,
            );
        });
    });
});
