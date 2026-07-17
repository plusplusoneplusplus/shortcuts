/**
 * NotesSidebar — integration tests for the sidebar tree component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { NotesRootEntry, NoteTreeNode } from '../../../src/server/spa/client/react/features/notes/notesApi';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

const mockGetProcess = vi.fn().mockResolvedValue({});
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        processes: {
            get: (...args: any[]) => mockGetProcess(...args),
        },
    }),
}));

const mockGetTree = vi.fn<[], Promise<{ tree: NoteTreeNode[]; notesRoot: string }>>();
const mockCreateNode = vi.fn();
const mockRenameNode = vi.fn();
const mockDeleteNode = vi.fn();
const mockRemoveRoot = vi.fn();
const mockCreateWithAI = vi.fn();
const mockGetGitStatus = vi.fn().mockResolvedValue({ initialized: false });
const mockGetContent = vi.fn();
const mockSaveContent = vi.fn();
const mockClipboardWriteText = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getTree: (...args: any[]) => mockGetTree(...args),
        createNode: (...args: any[]) => mockCreateNode(...args),
        renameNode: (...args: any[]) => mockRenameNode(...args),
        deleteNode: (...args: any[]) => mockDeleteNode(...args),
        removeRoot: (...args: any[]) => mockRemoveRoot(...args),
        createWithAI: (...args: any[]) => mockCreateWithAI(...args),
        getGitStatus: (...args: any[]) => mockGetGitStatus(...args),
        getContent: (...args: any[]) => mockGetContent(...args),
        saveContent: (...args: any[]) => mockSaveContent(...args),
    },
}));

vi.mock('../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({
        addToast: mockAddToast,
        removeToast: vi.fn(),
        toasts: [],
    }),
}));

// Import component after mocks
import { NotesSidebar } from '../../../src/server/spa/client/react/features/notes/editor/NotesSidebar';

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_TREE: NoteTreeNode[] = [
    {
        name: 'Notebook1',
        path: 'Notebook1',
        type: 'notebook',
        children: [
            {
                name: 'Section1',
                path: 'Notebook1/Section1',
                type: 'section',
                children: [
                    { name: 'Page1', path: 'Notebook1/Section1/Page1', type: 'page' },
                ],
            },
            { name: 'TopPage', path: 'Notebook1/TopPage', type: 'page' },
        ],
    },
    { name: 'Notebook2', path: 'Notebook2', type: 'notebook', children: [] },
];

const ROOTS: NotesRootEntry[] = [
    { rootId: 'default', label: 'Notes', isDefault: true },
    { rootId: 'docs', label: 'Docs', isDefault: false },
    { rootId: 'plans', label: 'Plans', isDefault: false },
    { rootId: 'archive', label: 'Archive', isDefault: false },
    { rootId: 'task:primary', label: 'Task Plans', isDefault: false, isProtected: true },
    { rootId: 'task:legacy', label: 'Legacy Plans (.vscode/tasks)', isDefault: false, isProtected: true },
];

// ── Helpers ────────────────────────────────────────────────────────────

function renderSidebar(
    selectedPath: string | null = null,
    onSelectPage = vi.fn(),
    extraProps: Partial<ComponentProps<typeof NotesSidebar>> = {},
) {
    return render(
        <NotesSidebar workspaceId="ws1" selectedPath={selectedPath} onSelectPage={onSelectPage} {...extraProps} />,
    );
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('NotesSidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: mockClipboardWriteText },
        });
        mockGetTree.mockResolvedValue({ tree: SAMPLE_TREE, notesRoot: '/mock/notes' });
        mockCreateNode.mockResolvedValue({ path: 'new', type: 'page' });
        mockRenameNode.mockResolvedValue({ oldPath: 'x', newPath: 'y' });
        mockDeleteNode.mockResolvedValue(undefined);
        mockRemoveRoot.mockResolvedValue({ removed: 'docs' });
        mockGetGitStatus.mockResolvedValue({ initialized: false });
        mockGetContent.mockResolvedValue({ content: 'body', path: 'x', mtime: 0 });
        mockSaveContent.mockResolvedValue({ path: 'x', mtime: 1 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders loading state while fetching tree', async () => {
        let resolve!: (v: NoteTreeNode[]) => void;
        mockGetTree.mockReturnValue(new Promise(r => { resolve = r as any; }));

        const { getByTestId } = renderSidebar();
        expect(getByTestId('notes-loading')).toBeTruthy();

        await act(async () => resolve({ tree: [], notesRoot: '/mock/notes' } as any));
    });

    it('renders empty state when tree has no nodes', async () => {
        mockGetTree.mockResolvedValue({ tree: [], notesRoot: '/mock/notes' });
        const { findByTestId } = renderSidebar();
        const empty = await findByTestId('notes-empty');
        expect(empty.textContent).toContain('No notebooks yet');
        expect(empty.className).toContain('italic');
    });

    it('renders notebooks, sections, and pages with folder chevrons', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        expect(nb1).toBeTruthy();

        // Folders show a chevron; pages do not
        expect(nb1.querySelector('[data-testid="chevron"]')).toBeTruthy();

        // Expand notebook to see children
        fireEvent.click(nb1);

        const section = await findByTestId('notes-tree-item-Section1');
        expect(section).toBeTruthy();
        expect(section.querySelector('[data-testid="chevron"]')).toBeTruthy();

        const page = await findByTestId('notes-tree-item-TopPage');
        expect(page.querySelector('[data-testid="chevron"]')).toBeNull();
    });

    it('expands and collapses folders on click', async () => {
        const { findByTestId, queryByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        // Initially collapsed — children not visible
        expect(queryByTestId('notes-tree-item-Section1')).toBeNull();

        // Click to expand
        fireEvent.click(nb1);
        expect(queryByTestId('notes-tree-item-Section1')).toBeTruthy();
        expect(queryByTestId('notes-tree-item-TopPage')).toBeTruthy();

        // Click again to collapse
        fireEvent.click(nb1);
        expect(queryByTestId('notes-tree-item-Section1')).toBeNull();
    });

    it('calls onSelectPage when a page is clicked', async () => {
        const onSelect = vi.fn();
        const { findByTestId } = renderSidebar(null, onSelect);

        // Expand notebook to see the page
        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        const page = await findByTestId('notes-tree-item-TopPage');
        fireEvent.click(page);
        expect(onSelect).toHaveBeenCalledWith('Notebook1/TopPage');
    });

    it('indents nested items by depth', async () => {
        const { findByTestId } = renderSidebar();

        // Depth 0 — notebook (base 10px indent + depth * 16px)
        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        expect(nb1.style.paddingLeft).toBe('10px');

        // Expand to depth 1
        fireEvent.click(nb1);
        const section = await findByTestId('notes-tree-item-Section1');
        expect(section.style.paddingLeft).toBe('26px');

        // Expand section to depth 2
        fireEvent.click(section);
        const page = await findByTestId('notes-tree-item-Page1');
        expect(page.style.paddingLeft).toBe('42px');
    });

    it('shows context menu on right-click', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        fireEvent.contextMenu(nb1, { clientX: 50, clientY: 50 });

        await waitFor(() => {
            expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy();
        });
    });

    it('context menu shows correct items for page vs folder', async () => {
        const { findByTestId } = renderSidebar();

        // Expand notebook
        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        // Right-click page
        const page = await findByTestId('notes-tree-item-TopPage');
        fireEvent.contextMenu(page, { clientX: 50, clientY: 50 });

        await waitFor(() => {
            const menu = document.querySelector('[data-testid="context-menu"]');
            expect(menu).toBeTruthy();
            const items = menu!.querySelectorAll('[role="menuitem"]');
            const labels = Array.from(items).map(i => i.textContent);
            expect(labels).toContain('Rename');
            expect(labels).toContain('Delete');
            expect(labels).not.toContain('Create Page');
            expect(labels).not.toContain('Create Section');
        });
    });

    it('folder context menu shows create options', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        fireEvent.contextMenu(nb1, { clientX: 50, clientY: 50 });

        await waitFor(() => {
            const menu = document.querySelector('[data-testid="context-menu"]');
            expect(menu).toBeTruthy();
            const items = menu!.querySelectorAll('[role="menuitem"]');
            const labels = Array.from(items).map(i => i.textContent);
            expect(labels).toContain('Create Page');
            expect(labels).toContain('Create Section');
            expect(labels).toContain('Rename');
            expect(labels).toContain('Delete');
        });
    });

    it('copy link writes a note link and asks the parent to restore editor focus', async () => {
        const onRestoreEditorFocus = vi.fn();
        render(
            <NotesSidebar
                workspaceId="ws1"
                selectedPath={null}
                onSelectPage={vi.fn()}
                onRestoreEditorFocus={onRestoreEditorFocus}
            />,
        );

        const notebook = await screen.findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(notebook);
        const page = await screen.findByTestId('notes-tree-item-TopPage');
        fireEvent.contextMenu(page, { clientX: 50, clientY: 50 });

        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());
        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const copyLinkBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Copy Link') as HTMLElement;
        fireEvent.click(copyLinkBtn);

        expect(mockClipboardWriteText).toHaveBeenCalledWith('[[note:Notebook1/TopPage]]');
        expect(onRestoreEditorFocus).toHaveBeenCalledOnce();
    });

    it('opens create-page dialog from context menu', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        fireEvent.contextMenu(nb1, { clientX: 50, clientY: 50 });

        await waitFor(() => {
            expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy();
        });

        // Click "Create Page" menu item
        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const items = menu.querySelectorAll('[role="menuitem"]');
        const createPageBtn = Array.from(items).find(i => i.textContent === 'Create Page') as HTMLElement;
        fireEvent.click(createPageBtn);

        await waitFor(() => {
            expect(document.querySelector('[data-testid="dialog-overlay"]')).toBeTruthy();
            expect(document.querySelector('[data-testid="notes-dialog-input"]')).toBeTruthy();
        });
    });

    it('creates a page via dialog and reports the server-returned path', async () => {
        mockCreateNode.mockResolvedValueOnce({ path: 'Notebook1/NewPage.md', type: 'page' });
        const onNoteCreated = vi.fn();
        const { findByTestId } = renderSidebar(null, vi.fn(), { onNoteCreated });
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        // Open context menu → Create Page
        fireEvent.contextMenu(nb1, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const createPageBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Create Page') as HTMLElement;
        fireEvent.click(createPageBtn);

        await waitFor(() => expect(document.querySelector('[data-testid="notes-dialog-input"]')).toBeTruthy());

        // Fill in name and confirm
        const input = document.querySelector('[data-testid="notes-dialog-input"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'NewPage' } });

        const confirmBtn = document.querySelector('[data-testid="notes-dialog-confirm"]') as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(confirmBtn);
        });

        await waitFor(() => {
            expect(mockCreateNode).toHaveBeenCalledWith('ws1', 'Notebook1/NewPage', 'page', undefined);
            expect(onNoteCreated).toHaveBeenCalledWith('Notebook1/NewPage.md');
        });

        // Tree should refresh (getTree called again)
        expect(mockGetTree.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('opens delete confirmation dialog', async () => {
        const { findByTestId } = renderSidebar();

        // Expand notebook then right-click page
        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        const page = await findByTestId('notes-tree-item-TopPage');
        fireEvent.contextMenu(page, { clientX: 50, clientY: 50 });

        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const deleteBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Delete') as HTMLElement;
        fireEvent.click(deleteBtn);

        await waitFor(() => {
            const dialog = document.querySelector('[data-testid="dialog-overlay"]');
            expect(dialog).toBeTruthy();
            expect(dialog!.textContent).toContain('Are you sure');
            expect(dialog!.textContent).toContain('TopPage');
        });
    });

    it('deletes a node and refreshes tree', async () => {
        const { findByTestId } = renderSidebar();

        // Expand → right-click page → Delete → confirm
        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        const page = await findByTestId('notes-tree-item-TopPage');
        fireEvent.contextMenu(page, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const deleteBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Delete') as HTMLElement;
        fireEvent.click(deleteBtn);

        await waitFor(() => expect(document.querySelector('[data-testid="notes-dialog-confirm"]')).toBeTruthy());

        const confirmBtn = document.querySelector('[data-testid="notes-dialog-confirm"]') as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(confirmBtn);
        });

        await waitFor(() => {
            expect(mockDeleteNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage', undefined);
        });
    });

    it('context-menu Rename opens an inline editor pre-filled with the current name (AC-06)', async () => {
        const { findByTestId } = renderSidebar();

        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        const page = await findByTestId('notes-tree-item-TopPage');
        fireEvent.contextMenu(page, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const renameBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Rename') as HTMLElement;
        fireEvent.click(renameBtn);

        // Inline editor appears in the tree row — NOT a modal dialog.
        await waitFor(() => {
            const input = document.querySelector('[data-testid="notes-inline-rename-input"]') as HTMLInputElement;
            expect(input).toBeTruthy();
            expect(input.value).toBe('TopPage');
        });
        expect(document.querySelector('[data-testid="notes-dialog-input"]')).toBeNull();
    });

    it('inline rename commits via renameNode and reports the server-returned path (AC-06)', async () => {
        mockRenameNode.mockResolvedValueOnce({
            oldPath: 'Notebook1/TopPage',
            newPath: 'Notebook1/RenamedPage.md',
        });
        const onNoteRenamed = vi.fn();
        const { findByTestId } = renderSidebar(null, vi.fn(), { onNoteRenamed });

        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        const page = await findByTestId('notes-tree-item-TopPage');
        fireEvent.contextMenu(page, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const renameBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Rename') as HTMLElement;
        fireEvent.click(renameBtn);

        await waitFor(() => expect(document.querySelector('[data-testid="notes-inline-rename-input"]')).toBeTruthy());

        const input = document.querySelector('[data-testid="notes-inline-rename-input"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'RenamedPage' } });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        await waitFor(() => {
            expect(mockRenameNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage', 'Notebook1/RenamedPage', undefined);
            expect(onNoteRenamed).toHaveBeenCalledWith('Notebook1/TopPage', 'Notebook1/RenamedPage.md');
        });
        // Editor closes after commit.
        await waitFor(() => expect(document.querySelector('[data-testid="notes-inline-rename-input"]')).toBeNull());
    });

    it('inline rename via double-click on the name commits (AC-06)', async () => {
        mockRenameNode.mockResolvedValueOnce({
            oldPath: 'Notebook1/TopPage',
            newPath: 'Notebook1/Renamed2.md',
        });
        const { findByTestId } = renderSidebar();

        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        const page = await findByTestId('notes-tree-item-TopPage');
        const nameEl = page.querySelector('[data-testid="notes-tree-item-name"]') as HTMLElement;
        fireEvent.doubleClick(nameEl);

        await waitFor(() => expect(document.querySelector('[data-testid="notes-inline-rename-input"]')).toBeTruthy());
        const input = document.querySelector('[data-testid="notes-inline-rename-input"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Renamed2' } });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        await waitFor(() => {
            expect(mockRenameNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage', 'Notebook1/Renamed2', undefined);
        });
    });

    it('inline rename Esc cancels without calling renameNode and restores the label (AC-06)', async () => {
        const { findByTestId } = renderSidebar();

        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        const page = await findByTestId('notes-tree-item-TopPage');
        const nameEl = page.querySelector('[data-testid="notes-tree-item-name"]') as HTMLElement;
        fireEvent.doubleClick(nameEl);

        await waitFor(() => expect(document.querySelector('[data-testid="notes-inline-rename-input"]')).toBeTruthy());
        const input = document.querySelector('[data-testid="notes-inline-rename-input"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'ShouldNotStick' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        await waitFor(() => expect(document.querySelector('[data-testid="notes-inline-rename-input"]')).toBeNull());
        expect(mockRenameNode).not.toHaveBeenCalled();
        // Original label restored.
        const restored = await findByTestId('notes-tree-item-TopPage');
        expect(restored.querySelector('[data-testid="notes-tree-item-name"]')!.textContent).toBe('TopPage');
    });

    it('disables confirm button when input is empty', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        fireEvent.contextMenu(nb1, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const createBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Create Page') as HTMLElement;
        fireEvent.click(createBtn);

        await waitFor(() => expect(document.querySelector('[data-testid="notes-dialog-confirm"]')).toBeTruthy());

        const confirmBtn = document.querySelector('[data-testid="notes-dialog-confirm"]') as HTMLButtonElement;
        expect(confirmBtn.disabled).toBe(true);
    });

    it('disables confirm button for invalid characters', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        fireEvent.contextMenu(nb1, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const createBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Create Page') as HTMLElement;
        fireEvent.click(createBtn);

        await waitFor(() => expect(document.querySelector('[data-testid="notes-dialog-input"]')).toBeTruthy());

        const input = document.querySelector('[data-testid="notes-dialog-input"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'page<1>' } });

        const confirmBtn = document.querySelector('[data-testid="notes-dialog-confirm"]') as HTMLButtonElement;
        expect(confirmBtn.disabled).toBe(true);

        const errorMsg = document.querySelector('[data-testid="notes-dialog-error"]');
        expect(errorMsg).toBeTruthy();
        expect(errorMsg!.textContent).toContain('<');
    });

    it('closes context menu on Escape', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        fireEvent.contextMenu(nb1, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeNull());
    });

    it('closes dialog on Escape', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        // Open context menu → Create Page → dialog
        fireEvent.contextMenu(nb1, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const createBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Create Page') as HTMLElement;
        fireEvent.click(createBtn);

        await waitFor(() => expect(document.querySelector('[data-testid="dialog-overlay"]')).toBeTruthy());

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(document.querySelector('[data-testid="dialog-overlay"]')).toBeNull());
    });

    it('right-click on empty tree area shows New Notebook and New Note', async () => {
        const { findByTestId } = renderSidebar();
        const treeArea = await findByTestId('notes-tree-area');

        fireEvent.contextMenu(treeArea, { clientX: 100, clientY: 100 });

        await waitFor(() => {
            const menu = document.querySelector('[data-testid="context-menu"]');
            expect(menu).toBeTruthy();
            const items = menu!.querySelectorAll('[role="menuitem"]');
            const labels = Array.from(items).map(i => i.textContent);
            expect(labels).toContain('New Notebook');
            expect(labels).toContain('New Note');
            expect(labels).toHaveLength(2);
        });
    });

    it('right-click on empty state shows New Notebook and New Note', async () => {
        mockGetTree.mockResolvedValue({ tree: [], notesRoot: '/mock/notes' });
        const { findByTestId } = renderSidebar();
        const empty = await findByTestId('notes-empty');

        fireEvent.contextMenu(empty, { clientX: 100, clientY: 100 });

        await waitFor(() => {
            const menu = document.querySelector('[data-testid="context-menu"]');
            expect(menu).toBeTruthy();
            const items = menu!.querySelectorAll('[role="menuitem"]');
            const labels = Array.from(items).map(i => i.textContent);
            expect(labels).toContain('New Notebook');
            expect(labels).toContain('New Note');
        });
    });

    it('New Notebook from background context menu opens create-notebook dialog', async () => {
        const { findByTestId } = renderSidebar();
        const treeArea = await findByTestId('notes-tree-area');

        fireEvent.contextMenu(treeArea, { clientX: 100, clientY: 100 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const newNotebookBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'New Notebook') as HTMLElement;
        fireEvent.click(newNotebookBtn);

        await waitFor(() => {
            const dialog = document.querySelector('[data-testid="dialog-overlay"]');
            expect(dialog).toBeTruthy();
            expect(dialog!.textContent).toContain('Create Notebook');
        });
    });

    it('New Note from background context menu opens create-page dialog', async () => {
        const { findByTestId } = renderSidebar();
        const treeArea = await findByTestId('notes-tree-area');

        fireEvent.contextMenu(treeArea, { clientX: 100, clientY: 100 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const newNoteBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'New Note') as HTMLElement;
        fireEvent.click(newNoteBtn);

        await waitFor(() => {
            const dialog = document.querySelector('[data-testid="dialog-overlay"]');
            expect(dialog).toBeTruthy();
            expect(dialog!.textContent).toContain('Create');
            expect(document.querySelector('[data-testid="notes-dialog-input"]')).toBeTruthy();
        });
    });

    it('shift+right-click on tree area allows native context menu', async () => {
        const { findByTestId } = renderSidebar();
        const treeArea = await findByTestId('notes-tree-area');

        fireEvent.contextMenu(treeArea, { clientX: 100, clientY: 100, shiftKey: true });

        // No custom context menu should appear
        await new Promise(r => setTimeout(r, 50));
        expect(document.querySelector('[data-testid="context-menu"]')).toBeNull();
    });

    it('New Notebook button opens create-notebook dialog', async () => {
        const { findByTestId } = renderSidebar();
        await findByTestId('notes-tree');

        // Click the add dropdown button
        const addBtn = await findByTestId('add-note-btn');
        fireEvent.click(addBtn);

        // Click "New Notebook" in the dropdown
        const newNotebookBtn = await findByTestId('add-note-new-notebook');
        fireEvent.click(newNotebookBtn);

        await waitFor(() => {
            const dialog = document.querySelector('[data-testid="dialog-overlay"]');
            expect(dialog).toBeTruthy();
            expect(dialog!.textContent).toContain('Create Notebook');
        });
    });

    it('Refresh button re-fetches the tree', async () => {
        const { findByTestId } = renderSidebar();
        // Wait for the initial fetch to settle (tree renders)
        await findByTestId('notes-tree');
        const initialCalls = mockGetTree.mock.calls.length;
        expect(initialCalls).toBeGreaterThanOrEqual(1);

        const btn = await findByTestId('refresh-notes-btn');
        await act(async () => {
            fireEvent.click(btn);
        });

        await waitFor(() => {
            expect(mockGetTree.mock.calls.length).toBeGreaterThan(initialCalls);
        });
    });

    it('refreshes the tree when notes-changed is dispatched for the workspace', async () => {
        const { findByTestId } = renderSidebar();
        await findByTestId('notes-tree');
        const initialCalls = mockGetTree.mock.calls.length;

        act(() => {
            window.dispatchEvent(new CustomEvent('notes-changed', { detail: { wsId: 'ws1', changedPaths: ['Notebook1/TopPage'] } }));
        });

        await waitFor(() => {
            expect(mockGetTree.mock.calls.length).toBeGreaterThan(initialCalls);
        });
    });

    it('shows update indicators on updated pages and ancestor folders', async () => {
        window.localStorage.setItem('coc-notes-seen-ws1', JSON.stringify({
            'Notebook1/TopPage': '2024-01-01T00:00:00.000Z',
        }));
        mockGetTree.mockResolvedValue({
            tree: [
                {
                    ...SAMPLE_TREE[0],
                    children: [
                        SAMPLE_TREE[0].children![0],
                        {
                            ...SAMPLE_TREE[0].children![1],
                            lastModifiedAt: '2024-01-02T00:00:00.000Z',
                        },
                    ],
                },
                SAMPLE_TREE[1],
            ],
            notesRoot: '/mock/notes',
        });

        const { findByTestId } = renderSidebar();
        const notebook = await findByTestId('notes-tree-item-Notebook1');
        expect(notebook.querySelector('[data-testid="note-update-indicator"]')).toBeTruthy();

        fireEvent.click(notebook);
        const page = await findByTestId('notes-tree-item-TopPage');
        expect(page.querySelector('[data-testid="note-update-indicator"]')).toBeTruthy();
    });

    it('clears the update indicator when a note is selected', async () => {
        window.localStorage.setItem('coc-notes-seen-ws1', JSON.stringify({
            'Notebook1/TopPage': '2024-01-01T00:00:00.000Z',
        }));
        mockGetTree.mockResolvedValue({
            tree: [
                {
                    ...SAMPLE_TREE[0],
                    children: [
                        SAMPLE_TREE[0].children![0],
                        {
                            ...SAMPLE_TREE[0].children![1],
                            lastModifiedAt: '2024-01-02T00:00:00.000Z',
                        },
                    ],
                },
                SAMPLE_TREE[1],
            ],
            notesRoot: '/mock/notes',
        });

        const { findByTestId } = renderSidebar('Notebook1/TopPage');
        const page = await findByTestId('notes-tree-item-TopPage');

        await waitFor(() => {
            expect(page.querySelector('[data-testid="note-update-indicator"]')).toBeNull();
        });
    });

    it('treats newly discovered notes as already seen', async () => {
        window.localStorage.setItem('coc-notes-seen-ws1', JSON.stringify({}));
        mockGetTree.mockResolvedValue({
            tree: [
                {
                    name: 'Notebook1',
                    path: 'Notebook1',
                    type: 'notebook',
                    children: [
                        {
                            name: 'NewPage.md',
                            path: 'Notebook1/NewPage.md',
                            type: 'page',
                            lastModifiedAt: '2024-01-02T00:00:00.000Z',
                        },
                    ],
                },
            ],
            notesRoot: '/mock/notes',
        });

        const { findByTestId } = renderSidebar();
        const notebook = await findByTestId('notes-tree-item-Notebook1');
        expect(notebook.querySelector('[data-testid="note-update-indicator"]')).toBeNull();

        fireEvent.click(notebook);
        const page = await findByTestId('notes-tree-item-NewPage.md');
        expect(page.querySelector('[data-testid="note-update-indicator"]')).toBeNull();
    });

    it('Refresh button is disabled while loading', async () => {
        // Hold the initial fetch unresolved so the button is rendered in loading state
        let resolve!: (v: { tree: NoteTreeNode[]; notesRoot: string }) => void;
        mockGetTree.mockReturnValue(new Promise(r => { resolve = r; }));

        const { findByTestId } = renderSidebar();
        const btn = await findByTestId('refresh-notes-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);

        await act(async () => resolve({ tree: SAMPLE_TREE, notesRoot: '/mock/notes' }));

        await waitFor(() => {
            const refreshed = screen.getByTestId('refresh-notes-btn') as HTMLButtonElement;
            expect(refreshed.disabled).toBe(false);
        });
    });

    // ── onNotesRootReady ────────────────────────────────────────────────

    it('calls onNotesRootReady with notesRoot once the tree loads', async () => {
        mockGetTree.mockResolvedValue({ tree: SAMPLE_TREE, notesRoot: '/home/user/.coc/repos/ws1/notes' });
        const onNotesRootReady = vi.fn();

        await act(async () => {
            render(
                <NotesSidebar
                    workspaceId="ws1"
                    selectedPath={null}
                    onSelectPage={vi.fn()}
                    onNotesRootReady={onNotesRootReady}
                />,
            );
        });

        await waitFor(() => {
            expect(onNotesRootReady).toHaveBeenCalledWith('/home/user/.coc/repos/ws1/notes');
        });
    });

    it('does not call onNotesRootReady when tree response has no notesRoot', async () => {
        mockGetTree.mockResolvedValue({ tree: [], notesRoot: '' });
        const onNotesRootReady = vi.fn();

        await act(async () => {
            render(
                <NotesSidebar
                    workspaceId="ws1"
                    selectedPath={null}
                    onSelectPage={vi.fn()}
                    onNotesRootReady={onNotesRootReady}
                />,
            );
        });

        // An empty string is falsy — callback should not fire
        await new Promise(r => setTimeout(r, 50));
        expect(onNotesRootReady).not.toHaveBeenCalled();
    });

    // ── Add dropdown tests ────────────────────────────────────────────────

    it('renders add dropdown with 3 options when + button is clicked', async () => {
        const { findByTestId, queryByTestId } = renderSidebar();
        await findByTestId('notes-tree');

        // Dropdown should not be visible initially
        expect(queryByTestId('add-note-dropdown')).toBeNull();

        // Click the + ▾ button
        const addBtn = await findByTestId('add-note-btn');
        fireEvent.click(addBtn);

        // Dropdown should appear with 3 options
        const dropdown = await findByTestId('add-note-dropdown');
        expect(dropdown).toBeTruthy();
        expect(queryByTestId('add-note-new-notebook')).toBeTruthy();
        expect(queryByTestId('add-note-new-page')).toBeTruthy();
        expect(queryByTestId('add-note-ai-create')).toBeTruthy();
    });

    it('"New Page" is disabled when no notebook is selected', async () => {
        const { findByTestId } = renderSidebar(null);
        await findByTestId('notes-tree');

        const addBtn = await findByTestId('add-note-btn');
        fireEvent.click(addBtn);

        const newPageBtn = await findByTestId('add-note-new-page') as HTMLButtonElement;
        expect(newPageBtn.disabled).toBe(true);
    });

    it('"New Page" is enabled when a page inside a notebook is selected', async () => {
        const { findByTestId } = renderSidebar('Notebook1/TopPage');
        await findByTestId('notes-tree');

        const addBtn = await findByTestId('add-note-btn');
        fireEvent.click(addBtn);

        const newPageBtn = await findByTestId('add-note-new-page') as HTMLButtonElement;
        expect(newPageBtn.disabled).toBe(false);
    });

    it('"New Page with AI" opens the AI create dialog', async () => {
        const { findByTestId } = renderSidebar();
        await findByTestId('notes-tree');

        const addBtn = await findByTestId('add-note-btn');
        fireEvent.click(addBtn);

        const aiBtn = await findByTestId('add-note-ai-create');
        fireEvent.click(aiBtn);

        await waitFor(() => {
            const dialog = document.querySelector('[data-testid="dialog-overlay"]');
            expect(dialog).toBeTruthy();
            expect(dialog!.textContent).toContain('Create Note with AI');
        });
    });

    it('dropdown closes when clicking outside', async () => {
        const { findByTestId, queryByTestId } = renderSidebar();
        await findByTestId('notes-tree');

        const addBtn = await findByTestId('add-note-btn');
        fireEvent.click(addBtn);
        expect(queryByTestId('add-note-dropdown')).toBeTruthy();

        // Click outside
        fireEvent.mouseDown(document.body);
        await waitFor(() => {
            expect(queryByTestId('add-note-dropdown')).toBeNull();
        });
    });

    it('AI create polls process with queue_ prefix (not queue-)', async () => {
        // Regression test: process IDs use queue_ prefix, not queue-
        const onCreated = vi.fn();
        const onSelect = vi.fn();
        const processIds: string[] = [];

        mockCreateWithAI.mockResolvedValue({ taskId: 'abc-123' });
        mockGetProcess.mockImplementation(async (processId: string) => {
            processIds.push(processId);
            if (processId === 'queue_abc-123') {
                return {
                    process: {
                        status: 'completed',
                        metadata: { noteCreate: { path: 'Notebook1/My Note.md', title: 'My Note', notebook: 'Notebook1' } },
                    },
                };
            };
            return {};
        });

        const { findByTestId } = render(
            <NotesSidebar workspaceId="ws1" selectedPath={null} onSelectPage={onSelect} onNoteCreated={onCreated} />,
        );
        await findByTestId('notes-tree');

        // Open dropdown and click AI create
        const addBtn = await findByTestId('add-note-btn');
        fireEvent.click(addBtn);
        const aiBtn = await findByTestId('add-note-ai-create');
        fireEvent.click(aiBtn);

        // Fill in the dialog and submit
        await waitFor(() => {
            expect(document.querySelector('[data-testid="ai-create-note-textarea"]')).toBeTruthy();
        });
        const textarea = document.querySelector('[data-testid="ai-create-note-textarea"]') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'My test note' } });
        const confirmBtn = document.querySelector('[data-testid="ai-create-note-confirm"]') as HTMLButtonElement;
        fireEvent.click(confirmBtn);

        // Wait for the 2s poll interval to fire and the process request to complete
        await waitFor(() => {
            expect(processIds.includes('queue_abc-123')).toBe(true);
        }, { timeout: 5000 });

        // Verify no call with wrong prefix (queue- hyphen)
        expect(processIds.includes('queue-abc-123')).toBe(false);
    });

    // ── Root selector dropdown ───────────────────────────────────────────

    it('plain root click switches the active root and closes the dropdown', async () => {
        const onSelectRoot = vi.fn();
        const { findByTestId, queryByTestId } = renderSidebar(null, vi.fn(), {
            roots: ROOTS,
            selectedRootId: 'default',
            selectedRootLabel: 'Notes',
            onSelectRoot,
        });
        await findByTestId('notes-tree');

        fireEvent.click(await findByTestId('notes-root-selector'));
        fireEvent.click(await findByTestId('notes-root-option-docs'));

        expect(onSelectRoot).toHaveBeenCalledWith('docs');
        await waitFor(() => expect(queryByTestId('notes-root-dropdown')).toBeNull());
    });

    it('ctrl/cmd-click toggles additional roots without switching roots or closing the dropdown', async () => {
        const onSelectRoot = vi.fn();
        const { findByTestId, queryByTestId } = renderSidebar(null, vi.fn(), {
            roots: ROOTS,
            selectedRootId: 'default',
            selectedRootLabel: 'Notes',
            onSelectRoot,
        });
        await findByTestId('notes-tree');

        fireEvent.click(await findByTestId('notes-root-selector'));
        fireEvent.click(await findByTestId('notes-root-option-docs'), { ctrlKey: true });
        fireEvent.click(await findByTestId('notes-root-option-plans'), { metaKey: true });

        expect(onSelectRoot).not.toHaveBeenCalled();
        expect(queryByTestId('notes-root-dropdown')).toBeTruthy();
        expect((await findByTestId('notes-root-option-docs')).getAttribute('data-removal-selected')).toBe('true');
        expect((await findByTestId('notes-root-option-plans')).getAttribute('data-removal-selected')).toBe('true');
        expect(queryByTestId('notes-root-selected-check-docs')).toBeTruthy();
        expect(queryByTestId('notes-root-selected-check-plans')).toBeTruthy();

        fireEvent.click(await findByTestId('notes-root-option-docs'), { ctrlKey: true });
        expect((await findByTestId('notes-root-option-docs')).getAttribute('data-removal-selected')).toBeNull();
        expect((await findByTestId('notes-root-option-plans')).getAttribute('data-removal-selected')).toBe('true');
    });

    it('shift-click selects a contiguous range of additional roots and keeps the dropdown open', async () => {
        const onSelectRoot = vi.fn();
        const { findByTestId, queryByTestId } = renderSidebar(null, vi.fn(), {
            roots: ROOTS,
            selectedRootId: 'default',
            selectedRootLabel: 'Notes',
            onSelectRoot,
        });
        await findByTestId('notes-tree');

        fireEvent.click(await findByTestId('notes-root-selector'));
        fireEvent.click(await findByTestId('notes-root-option-docs'), { ctrlKey: true });
        fireEvent.click(await findByTestId('notes-root-option-archive'), { shiftKey: true });

        expect(onSelectRoot).not.toHaveBeenCalled();
        expect(queryByTestId('notes-root-dropdown')).toBeTruthy();
        expect((await findByTestId('notes-root-option-docs')).getAttribute('data-removal-selected')).toBe('true');
        expect((await findByTestId('notes-root-option-plans')).getAttribute('data-removal-selected')).toBe('true');
        expect((await findByTestId('notes-root-option-archive')).getAttribute('data-removal-selected')).toBe('true');
    });

    it('keeps the default root protected when a shift range includes it', async () => {
        const onSelectRoot = vi.fn();
        const { findByTestId, queryByTestId } = renderSidebar(null, vi.fn(), {
            roots: ROOTS,
            selectedRootId: 'default',
            selectedRootLabel: 'Notes',
            onSelectRoot,
        });
        await findByTestId('notes-tree');

        fireEvent.click(await findByTestId('notes-root-selector'));
        fireEvent.click(await findByTestId('notes-root-option-plans'), { shiftKey: true });

        expect(onSelectRoot).not.toHaveBeenCalled();
        expect(queryByTestId('notes-root-dropdown')).toBeTruthy();
        expect((await findByTestId('notes-root-option-default')).getAttribute('data-removal-selected')).toBeNull();
        expect((await findByTestId('notes-root-option-docs')).getAttribute('data-removal-selected')).toBe('true');
        expect((await findByTestId('notes-root-option-plans')).getAttribute('data-removal-selected')).toBe('true');
        expect(queryByTestId('notes-root-protected-default')).toBeTruthy();
    });

    it('shows task-derived roots as protected and excludes them from modifier and range removal', async () => {
        const onSelectRoot = vi.fn();
        const protectedRangeRoots: NotesRootEntry[] = [
            ROOTS[0],
            ROOTS[1],
            ROOTS[4],
            ROOTS[2],
        ];
        const { findByTestId, queryByTestId } = renderSidebar(null, vi.fn(), {
            roots: protectedRangeRoots,
            selectedRootId: 'default',
            selectedRootLabel: 'Notes',
            onSelectRoot,
        });
        await findByTestId('notes-tree');

        fireEvent.click(await findByTestId('notes-root-selector'));
        const taskRoot = await findByTestId('notes-root-option-task:primary');
        expect(taskRoot.textContent).toContain('Task Plans');
        expect(taskRoot.getAttribute('title')).toContain('Task/Plans settings');
        expect(queryByTestId('notes-root-protected-task:primary')).toBeTruthy();

        fireEvent.click(taskRoot, { ctrlKey: true });
        expect(taskRoot.getAttribute('data-removal-selected')).toBeNull();
        expect(onSelectRoot).not.toHaveBeenCalled();
        expect(queryByTestId('notes-root-remove-selected')).toBeNull();

        fireEvent.click(await findByTestId('notes-root-option-docs'), { ctrlKey: true });
        fireEvent.click(await findByTestId('notes-root-option-plans'), { shiftKey: true });

        expect((await findByTestId('notes-root-option-docs')).getAttribute('data-removal-selected')).toBe('true');
        expect(taskRoot.getAttribute('data-removal-selected')).toBeNull();
        expect((await findByTestId('notes-root-option-plans')).getAttribute('data-removal-selected')).toBe('true');
        expect((await findByTestId('notes-root-remove-selected')).textContent).toContain('(2)');
    });

    it('keeps default-root-only AI creation unavailable with a clear reason in external collections', async () => {
        const { findByTestId, queryByTestId } = renderSidebar(null, vi.fn(), {
            isDefaultRoot: false,
            roots: ROOTS,
            selectedRootId: 'task:primary',
            selectedRootLabel: 'Task Plans',
            onSelectRoot: vi.fn(),
        });
        await findByTestId('notes-tree');

        fireEvent.click(await findByTestId('add-note-btn'));
        const aiCreate = await findByTestId('add-note-ai-create');
        expect(aiCreate).toBeDisabled();
        expect(aiCreate.getAttribute('title')).toContain('managed Notes collection');
        fireEvent.click(aiCreate);
        expect(queryByTestId('ai-create-note-textarea')).toBeNull();
    });

    it('bulk-removes selected additional roots, refreshes roots, and never deletes note files', async () => {
        const onRootsChanged = vi.fn().mockResolvedValue(undefined);
        const { findByTestId, queryByTestId } = renderSidebar(null, vi.fn(), {
            roots: ROOTS,
            selectedRootId: 'default',
            selectedRootLabel: 'Notes',
            onSelectRoot: vi.fn(),
            onRootsChanged,
        });
        await findByTestId('notes-tree');

        fireEvent.click(await findByTestId('notes-root-selector'));
        fireEvent.click(await findByTestId('notes-root-option-docs'), { ctrlKey: true });
        fireEvent.click(await findByTestId('notes-root-option-plans'), { ctrlKey: true });

        const removeSelected = await findByTestId('notes-root-remove-selected');
        expect(removeSelected.textContent).toContain('Remove selected (2)');

        await act(async () => {
            fireEvent.click(removeSelected);
        });

        await waitFor(() => {
            expect(mockRemoveRoot).toHaveBeenCalledWith('ws1', 'docs');
            expect(mockRemoveRoot).toHaveBeenCalledWith('ws1', 'plans');
        });
        expect(mockRemoveRoot).toHaveBeenCalledTimes(2);
        expect(mockRemoveRoot).not.toHaveBeenCalledWith('ws1', 'default');
        expect(mockDeleteNode).not.toHaveBeenCalled();
        expect(onRootsChanged).toHaveBeenCalledOnce();
        expect(mockAddToast).toHaveBeenCalledWith('Removed 2 note collections', 'success');
        await waitFor(() => expect(queryByTestId('notes-root-remove-selected')).toBeNull());
    });

    it('falls back to the default root when the active additional root is removed', async () => {
        const onSelectRoot = vi.fn();
        const onRootsChanged = vi.fn().mockResolvedValue(undefined);
        const { findByTestId } = renderSidebar(null, vi.fn(), {
            roots: ROOTS,
            selectedRootId: 'docs',
            selectedRootLabel: 'Docs',
            onSelectRoot,
            onRootsChanged,
        });
        await findByTestId('notes-tree');

        fireEvent.click(await findByTestId('notes-root-selector'));
        fireEvent.click(await findByTestId('notes-root-option-docs'), { ctrlKey: true });

        await act(async () => {
            fireEvent.click(await findByTestId('notes-root-remove-selected'));
        });

        await waitFor(() => {
            expect(mockRemoveRoot).toHaveBeenCalledWith('ws1', 'docs');
            expect(onSelectRoot).toHaveBeenCalledWith('default');
        });
        expect(onRootsChanged).toHaveBeenCalledOnce();
    });

    it('surfaces remove errors through the global toast and still refreshes successful removals', async () => {
        const onRootsChanged = vi.fn().mockResolvedValue(undefined);
        mockRemoveRoot.mockImplementation(async (_workspaceId: string, rootId: string) => {
            if (rootId === 'docs') {
                throw new Error('Cannot remove docs');
            }
            return { removed: rootId };
        });
        const { findByTestId } = renderSidebar(null, vi.fn(), {
            roots: ROOTS,
            selectedRootId: 'default',
            selectedRootLabel: 'Notes',
            onSelectRoot: vi.fn(),
            onRootsChanged,
        });
        await findByTestId('notes-tree');

        fireEvent.click(await findByTestId('notes-root-selector'));
        fireEvent.click(await findByTestId('notes-root-option-docs'), { ctrlKey: true });
        fireEvent.click(await findByTestId('notes-root-option-plans'), { ctrlKey: true });

        await act(async () => {
            fireEvent.click(await findByTestId('notes-root-remove-selected'));
        });

        await waitFor(() => {
            expect(mockAddToast).toHaveBeenCalledWith('Cannot remove docs', 'error');
            expect(mockAddToast).toHaveBeenCalledWith('Removed 1 note collection', 'success');
        });
        expect(onRootsChanged).toHaveBeenCalledOnce();
    });

    it('keeps collection removal selection separate from page multi-selection', async () => {
        const onSelectRoot = vi.fn();
        const onSelectPage = vi.fn();
        const { findByTestId } = renderSidebar(null, onSelectPage, {
            roots: ROOTS,
            selectedRootId: 'default',
            selectedRootLabel: 'Notes',
            onSelectRoot,
        });
        const notebook = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(notebook);
        const page = await findByTestId('notes-tree-item-TopPage');

        fireEvent.click(await findByTestId('notes-root-selector'));
        fireEvent.click(await findByTestId('notes-root-option-docs'), { ctrlKey: true });
        fireEvent.click(page, { ctrlKey: true });

        expect(onSelectRoot).not.toHaveBeenCalled();
        expect(onSelectPage).not.toHaveBeenCalled();
        expect((await findByTestId('notes-root-option-docs')).getAttribute('data-removal-selected')).toBe('true');
        expect(page.getAttribute('aria-selected')).toBe('true');
    });

    // ── Bulk drag-move (AC-03) ────────────────────────────────────────────

    // Minimal DataTransfer stub good enough for the notes DnD handlers:
    // setData/getData round-trip plus a live `types` getter.
    function createDataTransfer(): DataTransfer {
        const store = new Map<string, string>();
        return {
            setData: (type: string, val: string) => { store.set(type, val); },
            getData: (type: string) => store.get(type) ?? '',
            get types() { return Array.from(store.keys()); },
            effectAllowed: 'all',
            dropEffect: 'none',
        } as unknown as DataTransfer;
    }

    const BULK_TREE: NoteTreeNode[] = [
        {
            name: 'Notebook1',
            path: 'Notebook1',
            type: 'notebook',
            children: [
                { name: 'TopPage', path: 'Notebook1/TopPage', type: 'page' },
                { name: 'PageA', path: 'Notebook1/PageA', type: 'page' },
                { name: 'Section1', path: 'Notebook1/Section1', type: 'section', children: [] },
            ],
        },
        { name: 'Notebook2', path: 'Notebook2', type: 'notebook', children: [] },
        {
            name: 'Notebook3',
            path: 'Notebook3',
            type: 'notebook',
            children: [
                { name: 'PageB', path: 'Notebook3/PageB', type: 'page' },
            ],
        },
    ];

    it('bulk drag-move drops a 3-item selection onto a folder (3 move calls via renameNode)', async () => {
        mockGetTree.mockResolvedValue({ tree: BULK_TREE, notesRoot: '/mock/notes' });
        const onNoteRenamed = vi.fn();
        const { findByTestId } = renderSidebar(null, vi.fn(), { onNoteRenamed });

        // Expand both notebooks so the target pages render. (A plain folder
        // click also single-selects the folder, so reset via a plain page click
        // before building the page-only multi-selection below.)
        fireEvent.click(await findByTestId('notes-tree-item-Notebook1'));
        fireEvent.click(await findByTestId('notes-tree-item-Notebook3'));

        const topPage = await findByTestId('notes-tree-item-TopPage');
        fireEvent.click(topPage); // plain click clears the folder selection

        // Ctrl+click builds a 3-page multi-selection spanning two notebooks.
        fireEvent.click(topPage, { ctrlKey: true });
        fireEvent.click(await findByTestId('notes-tree-item-PageA'), { ctrlKey: true });
        fireEvent.click(await findByTestId('notes-tree-item-PageB'), { ctrlKey: true });

        // Selection footer confirms 3 rows are selected.
        const badge = await findByTestId('notes-selection-badge');
        expect(badge.textContent).toContain('3 selected');

        // Drag one selected row and drop it INTO the empty Notebook2 folder.
        const dt = createDataTransfer();
        fireEvent.dragStart(topPage, { dataTransfer: dt });
        const notebook2 = await findByTestId('notes-tree-item-Notebook2');
        await act(async () => {
            fireEvent.drop(notebook2, { dataTransfer: dt });
        });

        // All three selected rows move into Notebook2 (root stays undefined).
        await waitFor(() => expect(mockRenameNode).toHaveBeenCalledTimes(3));
        expect(mockRenameNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage', 'Notebook2/TopPage', undefined);
        expect(mockRenameNode).toHaveBeenCalledWith('ws1', 'Notebook1/PageA', 'Notebook2/PageA', undefined);
        expect(mockRenameNode).toHaveBeenCalledWith('ws1', 'Notebook3/PageB', 'Notebook2/PageB', undefined);
    });

    it('bulk drag-move rejects a drop into a descendant of a selected folder', async () => {
        mockGetTree.mockResolvedValue({ tree: BULK_TREE, notesRoot: '/mock/notes' });
        const { findByTestId } = renderSidebar();

        // Plain-click Notebook1: expands it AND single-selects the folder, so
        // its Section1 child becomes a visible drop target.
        const notebook1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(notebook1);

        // Ctrl+click Notebook2 to grow the selection to 2 rows (Notebook1 already
        // selected from the plain click above).
        fireEvent.click(await findByTestId('notes-tree-item-Notebook2'), { ctrlKey: true });

        // Drag the selection and try to drop it inside Notebook1/Section1 — a
        // descendant of the selected Notebook1. The whole drop must be rejected.
        const dt = createDataTransfer();
        fireEvent.dragStart(notebook1, { dataTransfer: dt });
        const section1 = await findByTestId('notes-tree-item-Section1');
        await act(async () => {
            fireEvent.drop(section1, { dataTransfer: dt });
        });

        expect(mockRenameNode).not.toHaveBeenCalled();
    });

    // ── Redesigned header / meta / search ─────────────────────────────────

    it('renders the redesigned panel header with Notes title and "New" button', async () => {
        const { findByTestId } = renderSidebar();
        await findByTestId('notes-tree');

        const sidebar = await findByTestId('notes-sidebar');
        expect(sidebar.textContent).toContain('Notes');

        const newBtn = await findByTestId('add-note-btn');
        expect(newBtn.textContent).toContain('New');
    });

    it('renders the pages count pill reflecting total pages in the tree', async () => {
        const { findByTestId } = renderSidebar();
        // SAMPLE_TREE has 2 pages: TopPage and Section1/Page1
        const pill = await findByTestId('notes-pages-pill');
        expect(pill.textContent).toBe('2 pages');
    });

    it('shows the updated pill only when at least one page is unseen', async () => {
        window.localStorage.setItem('coc-notes-seen-ws1', JSON.stringify({
            'Notebook1/TopPage': '2024-01-01T00:00:00.000Z',
        }));
        mockGetTree.mockResolvedValue({
            tree: [
                {
                    ...SAMPLE_TREE[0],
                    children: [
                        SAMPLE_TREE[0].children![0],
                        {
                            ...SAMPLE_TREE[0].children![1],
                            lastModifiedAt: '2024-01-02T00:00:00.000Z',
                        },
                    ],
                },
                SAMPLE_TREE[1],
            ],
            notesRoot: '/mock/notes',
        });

        const { findByTestId } = renderSidebar();
        const pill = await findByTestId('notes-updated-pill');
        expect(pill.textContent).toContain('1 updated');
    });

    it('hides the updated pill when nothing is new', async () => {
        const { findByTestId, queryByTestId } = renderSidebar();
        await findByTestId('notes-tree');
        expect(queryByTestId('notes-updated-pill')).toBeNull();
    });

    it('shows the tracked pill when notes git reports initialized', async () => {
        mockGetGitStatus.mockResolvedValue({ initialized: true });
        const { findByTestId } = renderSidebar();
        await findByTestId('notes-tree');

        await waitFor(() => {
            expect(document.querySelector('[data-testid="notes-tracked-pill"]')).toBeTruthy();
        });
    });

    it('omits the tracked pill when notes git is not initialized', async () => {
        const { findByTestId, queryByTestId } = renderSidebar();
        await findByTestId('notes-tree');
        // Allow the getGitStatus promise to resolve
        await waitFor(() => {
            expect(mockGetGitStatus).toHaveBeenCalled();
        });
        expect(queryByTestId('notes-tracked-pill')).toBeNull();
    });

    it('renders a search input that filters tree rows by name', async () => {
        const { findByTestId, queryByTestId } = renderSidebar();
        await findByTestId('notes-tree');

        const input = await findByTestId('notes-search-input') as HTMLInputElement;
        expect(input).toBeTruthy();

        // Type a query that matches only TopPage — Section1/Page1 should disappear
        fireEvent.change(input, { target: { value: 'TopPage' } });

        await waitFor(() => {
            expect(queryByTestId('notes-tree-item-TopPage')).toBeTruthy();
            expect(queryByTestId('notes-tree-item-Page1')).toBeNull();
        });
    });

    it('renders an empty-state message when no notes match the search query', async () => {
        const { findByTestId } = renderSidebar();
        await findByTestId('notes-tree');

        const input = await findByTestId('notes-search-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'no-such-page' } });

        await waitFor(() => {
            const empty = document.querySelector('[data-testid="notes-search-empty"]');
            expect(empty).toBeTruthy();
            expect(empty!.textContent).toContain('no-such-page');
        });
    });

    it('renders a recursive page-count badge on folder rows', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');

        // Notebook1 contains 2 descendant pages (Section1/Page1 and TopPage)
        const badge = nb1.querySelector('[data-testid="folder-page-count"]');
        expect(badge).toBeTruthy();
        expect(badge!.textContent).toBe('2');
    });

    it('does not render a page-count badge on empty folders', async () => {
        const { findByTestId } = renderSidebar();
        const nb2 = await findByTestId('notes-tree-item-Notebook2');
        expect(nb2.querySelector('[data-testid="folder-page-count"]')).toBeNull();
    });

    // ── Scroll behaviour ───────────────────────────────────────────────
    //
    // The sidebar must NEVER auto-scroll the tree on selection changes. The
    // user's scroll position should be preserved regardless of whether the
    // selected item is visible, off-screen, or partially visible. Auto-scroll
    // on click was confusing because clicking a partially-visible item caused
    // the list to jump so the item aligned to the nearest container edge.

    it('does not auto-scroll the tree when selection changes (item visible)', async () => {
        const scrollIntoViewMock = vi.fn();

        const { findByTestId, rerender } = render(
            <NotesSidebar workspaceId="ws1" selectedPath={null} onSelectPage={vi.fn()} />,
        );
        await findByTestId('notes-tree-area');
        await waitFor(() => expect(mockGetTree).toHaveBeenCalled());

        rerender(
            <NotesSidebar workspaceId="ws1" selectedPath="Notebook1/Section1/Page1" onSelectPage={vi.fn()} />,
        );

        const treeArea = await findByTestId('notes-tree-area');

        await act(async () => { await new Promise(r => setTimeout(r, 100)); });

        const selectedEl = treeArea.querySelector('[data-node-path="Notebook1/Section1/Page1"]');
        if (selectedEl) {
            (selectedEl as HTMLElement).scrollIntoView = scrollIntoViewMock;
            vi.spyOn(selectedEl, 'getBoundingClientRect').mockReturnValue({
                top: 100, bottom: 120, left: 0, right: 200, width: 200, height: 20, x: 0, y: 100, toJSON: () => ({}),
            });
        }
        vi.spyOn(treeArea, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 500, left: 0, right: 200, width: 200, height: 500, x: 0, y: 0, toJSON: () => ({}),
        });

        rerender(
            <NotesSidebar workspaceId="ws1" selectedPath={null} onSelectPage={vi.fn()} />,
        );
        rerender(
            <NotesSidebar workspaceId="ws1" selectedPath="Notebook1/Section1/Page1" onSelectPage={vi.fn()} />,
        );

        await act(async () => { await new Promise(r => setTimeout(r, 100)); });

        expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it('does not auto-scroll the tree when selection changes (item off-screen)', async () => {
        const scrollIntoViewMock = vi.fn();

        const { findByTestId, rerender } = render(
            <NotesSidebar workspaceId="ws1" selectedPath={null} onSelectPage={vi.fn()} />,
        );
        await findByTestId('notes-tree-area');
        await waitFor(() => expect(mockGetTree).toHaveBeenCalled());

        rerender(
            <NotesSidebar workspaceId="ws1" selectedPath="Notebook1/Section1/Page1" onSelectPage={vi.fn()} />,
        );

        const treeArea = await findByTestId('notes-tree-area');

        await act(async () => { await new Promise(r => setTimeout(r, 100)); });

        const selectedEl = treeArea.querySelector('[data-node-path="Notebook1/Section1/Page1"]');
        if (selectedEl) {
            (selectedEl as HTMLElement).scrollIntoView = scrollIntoViewMock;
            // Pretend the element is well below the visible area — previously
            // this would have triggered an auto-scroll, but the sidebar must
            // now leave the user's scroll position untouched.
            vi.spyOn(selectedEl, 'getBoundingClientRect').mockReturnValue({
                top: 600, bottom: 620, left: 0, right: 200, width: 200, height: 20, x: 0, y: 600, toJSON: () => ({}),
            });
        }
        vi.spyOn(treeArea, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 500, left: 0, right: 200, width: 200, height: 500, x: 0, y: 0, toJSON: () => ({}),
        });

        rerender(
            <NotesSidebar workspaceId="ws1" selectedPath={null} onSelectPage={vi.fn()} />,
        );
        rerender(
            <NotesSidebar workspaceId="ws1" selectedPath="Notebook1/Section1/Page1" onSelectPage={vi.fn()} />,
        );

        await act(async () => { await new Promise(r => setTimeout(r, 100)); });

        expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    // ── Cut / Copy / Paste (AC-04) + bulk copy-paths (AC-05) ──────────────
    describe('cut / copy / paste', () => {
        /** Open the context menu on a row and click the item with the given label. */
        async function clickMenuItem(row: HTMLElement, label: string) {
            fireEvent.contextMenu(row, { clientX: 40, clientY: 40 });
            await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());
            const menu = document.querySelector('[data-testid="context-menu"]')!;
            const item = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === label) as HTMLElement;
            expect(item).toBeTruthy();
            await act(async () => { fireEvent.click(item); });
        }

        it('cut → paste moves the row via renameNode and clears the clipboard', async () => {
            const onNoteRenamed = vi.fn();
            const { findByTestId } = renderSidebar(null, vi.fn(), { onNoteRenamed });

            // Expand Notebook1 and reset selection with a plain page click.
            fireEvent.click(await findByTestId('notes-tree-item-Notebook1'));
            const topPage = await findByTestId('notes-tree-item-TopPage');
            fireEvent.click(topPage);

            // Cut TopPage → it dims (data-cut) until pasted.
            await clickMenuItem(topPage, 'Cut');
            await waitFor(() => expect(topPage.getAttribute('data-cut')).toBe('true'));

            // Paste into Notebook2.
            const notebook2 = await findByTestId('notes-tree-item-Notebook2');
            await clickMenuItem(notebook2, 'Paste');

            await waitFor(() => expect(mockRenameNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage', 'Notebook2/TopPage', undefined));
            expect(onNoteRenamed).toHaveBeenCalled();

            // Clipboard cleared → the pending-cut affordance is gone.
            await waitFor(() => {
                const row = document.querySelector('[data-node-path="Notebook1/TopPage"]');
                expect(row?.getAttribute('data-cut')).toBeNull();
            });
        });

        it('copy → paste duplicates with a de-duped "copy" name (read + create)', async () => {
            mockGetContent.mockResolvedValue({ content: 'hello world', path: 'Notebook1/TopPage', mtime: 5 });
            const { findByTestId } = renderSidebar();

            fireEvent.click(await findByTestId('notes-tree-item-Notebook1'));
            const topPage = await findByTestId('notes-tree-item-TopPage');
            fireEvent.click(topPage);

            // Copy TopPage, then paste back into Notebook1 (which already holds it).
            await clickMenuItem(topPage, 'Copy');
            const notebook1 = await findByTestId('notes-tree-item-Notebook1');
            await clickMenuItem(notebook1, 'Paste');

            await waitFor(() => expect(mockGetContent).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage', undefined));
            expect(mockCreateNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage copy', 'page', undefined);
            expect(mockSaveContent).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage copy', 'hello world', undefined, undefined);
        });

        it('keyboard Ctrl+X then Ctrl+V moves the selection', async () => {
            const { findByTestId } = renderSidebar();
            const treeArea = await findByTestId('notes-tree-area');

            fireEvent.click(await findByTestId('notes-tree-item-Notebook1'));
            const topPage = await findByTestId('notes-tree-item-TopPage');
            // Reset the folder-select from the expand click, then Ctrl+click to
            // build a 1-row selection whose anchor drives the shortcut.
            fireEvent.click(topPage);
            fireEvent.click(topPage, { ctrlKey: true });

            // Cut via keyboard → row dims.
            fireEvent.keyDown(treeArea, { key: 'x', ctrlKey: true });
            await waitFor(() => expect(topPage.getAttribute('data-cut')).toBe('true'));

            // Plain-click Notebook2 to make it the paste target, then Ctrl+V.
            fireEvent.click(await findByTestId('notes-tree-item-Notebook2'));
            await act(async () => { fireEvent.keyDown(treeArea, { key: 'v', ctrlKey: true }); });

            await waitFor(() => expect(mockRenameNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage', 'Notebook2/TopPage', undefined));
        });

        it('keyboard Ctrl+C then Ctrl+V duplicates the row with a copy name', async () => {
            mockGetContent.mockResolvedValue({ content: 'kbd body', path: 'Notebook1/TopPage', mtime: 1 });
            const { findByTestId } = renderSidebar();
            const treeArea = await findByTestId('notes-tree-area');

            fireEvent.click(await findByTestId('notes-tree-item-Notebook1'));
            const topPage = await findByTestId('notes-tree-item-TopPage');
            // Reset the folder-select, then Ctrl+click so anchor = TopPage and
            // the selection is exactly {TopPage}; paste targets its folder.
            fireEvent.click(topPage);
            fireEvent.click(topPage, { ctrlKey: true });

            fireEvent.keyDown(treeArea, { key: 'c', ctrlKey: true });
            await act(async () => { fireEvent.keyDown(treeArea, { key: 'v', ctrlKey: true }); });

            await waitFor(() => expect(mockCreateNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage copy', 'page', undefined));
            expect(mockSaveContent).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage copy', 'kbd body', undefined, undefined);
        });

        it('multi-selection context menu copies all selected paths, newline-joined (AC-05)', async () => {
            const { findByTestId } = renderSidebar();

            fireEvent.click(await findByTestId('notes-tree-item-Notebook1'));
            // Reset the folder-select from the expand click, then build a
            // folder+page selection spanning Section1 and TopPage.
            fireEvent.click(await findByTestId('notes-tree-item-TopPage'));
            fireEvent.click(await findByTestId('notes-tree-item-Section1'), { ctrlKey: true });
            const topPage = await findByTestId('notes-tree-item-TopPage');
            fireEvent.click(topPage, { ctrlKey: true });

            const badge = await findByTestId('notes-selection-badge');
            expect(badge.textContent).toContain('2 selected');

            await clickMenuItem(topPage, 'Copy Paths');

            expect(mockClipboardWriteText).toHaveBeenCalledWith('Notebook1/Section1\nNotebook1/TopPage');
        });
    });
});
