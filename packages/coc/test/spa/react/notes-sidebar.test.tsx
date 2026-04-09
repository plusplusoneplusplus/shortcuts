/**
 * NotesSidebar — integration tests for the sidebar tree component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, screen } from '@testing-library/react';
import type { NoteTreeNode } from '../../../src/server/spa/client/react/repos/notesApi';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

const mockGetTree = vi.fn<[], Promise<NoteTreeNode[]>>();
const mockCreateNode = vi.fn();
const mockRenameNode = vi.fn();
const mockDeleteNode = vi.fn();

vi.mock('../../../src/server/spa/client/react/repos/notesApi', () => ({
    notesApi: {
        getTree: (...args: any[]) => mockGetTree(...args),
        createNode: (...args: any[]) => mockCreateNode(...args),
        renameNode: (...args: any[]) => mockRenameNode(...args),
        deleteNode: (...args: any[]) => mockDeleteNode(...args),
    },
}));

// Import component after mocks
import { NotesSidebar } from '../../../src/server/spa/client/react/repos/notes/NotesSidebar';

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

// ── Helpers ────────────────────────────────────────────────────────────

function renderSidebar(selectedPath: string | null = null, onSelectPage = vi.fn()) {
    return render(
        <NotesSidebar workspaceId="ws1" selectedPath={selectedPath} onSelectPage={onSelectPage} />,
    );
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('NotesSidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetTree.mockResolvedValue(SAMPLE_TREE);
        mockCreateNode.mockResolvedValue({ path: 'new', type: 'page' });
        mockRenameNode.mockResolvedValue({ oldPath: 'x', newPath: 'y' });
        mockDeleteNode.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders loading state while fetching tree', async () => {
        let resolve!: (v: NoteTreeNode[]) => void;
        mockGetTree.mockReturnValue(new Promise(r => { resolve = r; }));

        const { getByTestId } = renderSidebar();
        expect(getByTestId('notes-loading')).toBeTruthy();

        await act(async () => resolve([]));
    });

    it('renders empty state when tree has no nodes', async () => {
        mockGetTree.mockResolvedValue([]);
        const { findByTestId } = renderSidebar();
        const empty = await findByTestId('notes-empty');
        expect(empty.textContent).toContain('No notebooks yet');
        expect(empty.className).toContain('italic');
    });

    it('renders notebooks, sections, and pages with correct icons', async () => {
        const { findByTestId } = renderSidebar();
        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        expect(nb1).toBeTruthy();

        // Expand notebook to see children
        fireEvent.click(nb1);

        const section = await findByTestId('notes-tree-item-Section1');
        expect(section).toBeTruthy();

        // Check icon texts — notebook has 📓, section has 📁, page has 📄
        const allIcons = document.querySelectorAll('[data-testid="node-icon"]');
        const iconTexts = Array.from(allIcons).map(el => el.textContent);
        expect(iconTexts).toContain('📓');
        expect(iconTexts).toContain('📁');
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

        // Depth 0 — notebook
        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        expect(nb1.style.paddingLeft).toBe('0px');

        // Expand to depth 1
        fireEvent.click(nb1);
        const section = await findByTestId('notes-tree-item-Section1');
        expect(section.style.paddingLeft).toBe('16px');

        // Expand section to depth 2
        fireEvent.click(section);
        const page = await findByTestId('notes-tree-item-Page1');
        expect(page.style.paddingLeft).toBe('32px');
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

    it('creates a page via dialog and refreshes tree', async () => {
        const { findByTestId } = renderSidebar();
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
            expect(mockCreateNode).toHaveBeenCalledWith('ws1', 'Notebook1/NewPage', 'page');
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
            expect(mockDeleteNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage');
        });
    });

    it('opens rename dialog pre-filled with current name', async () => {
        const { findByTestId } = renderSidebar();

        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        const page = await findByTestId('notes-tree-item-TopPage');
        fireEvent.contextMenu(page, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const renameBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Rename') as HTMLElement;
        fireEvent.click(renameBtn);

        await waitFor(() => {
            const input = document.querySelector('[data-testid="notes-dialog-input"]') as HTMLInputElement;
            expect(input).toBeTruthy();
            expect(input.value).toBe('TopPage');
        });
    });

    it('renames a node and refreshes tree', async () => {
        const { findByTestId } = renderSidebar();

        const nb1 = await findByTestId('notes-tree-item-Notebook1');
        fireEvent.click(nb1);

        const page = await findByTestId('notes-tree-item-TopPage');
        fireEvent.contextMenu(page, { clientX: 50, clientY: 50 });
        await waitFor(() => expect(document.querySelector('[data-testid="context-menu"]')).toBeTruthy());

        const menu = document.querySelector('[data-testid="context-menu"]')!;
        const renameBtn = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(i => i.textContent === 'Rename') as HTMLElement;
        fireEvent.click(renameBtn);

        await waitFor(() => expect(document.querySelector('[data-testid="notes-dialog-input"]')).toBeTruthy());

        const input = document.querySelector('[data-testid="notes-dialog-input"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'RenamedPage' } });

        const confirmBtn = document.querySelector('[data-testid="notes-dialog-confirm"]') as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(confirmBtn);
        });

        await waitFor(() => {
            expect(mockRenameNode).toHaveBeenCalledWith('ws1', 'Notebook1/TopPage', 'Notebook1/RenamedPage');
        });
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

    it('New Notebook button opens create-notebook dialog', async () => {
        const { findByTestId } = renderSidebar();
        await findByTestId('notes-tree');

        const btn = await findByTestId('new-notebook-btn');
        fireEvent.click(btn);

        await waitFor(() => {
            const dialog = document.querySelector('[data-testid="dialog-overlay"]');
            expect(dialog).toBeTruthy();
            expect(dialog!.textContent).toContain('Create Notebook');
        });
    });
});
