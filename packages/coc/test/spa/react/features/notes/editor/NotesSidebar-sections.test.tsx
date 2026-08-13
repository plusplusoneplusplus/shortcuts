/**
 * NotesSidebar — stacked root sections.
 *
 * A workspace with several notes roots renders one collapsible section per root
 * inside the sidebar's single scroll container (AC-01), fetches a root's tree
 * only once its section opens (AC-03), keeps the multi-selection inside one
 * section (AC-05), filters every expanded section at once (AC-06), and falls
 * back to today's bare single-tree markup for a one-root workspace (AC-07).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { NotesRootEntry, NoteTreeNode } from '../../../../../../src/server/spa/client/react/features/notes/notesApi';

vi.mock('../../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ processes: { get: vi.fn().mockResolvedValue({}) } }),
}));

const mockGetTree = vi.fn();
const mockGetGitStatus = vi.fn().mockResolvedValue({ initialized: false });

vi.mock('../../../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getTree: (...args: any[]) => mockGetTree(...args),
        createNode: vi.fn(),
        renameNode: vi.fn(),
        deleteNode: vi.fn(),
        removeRoot: vi.fn(),
        createWithAI: vi.fn(),
        getGitStatus: (...args: any[]) => mockGetGitStatus(...args),
        getContent: vi.fn(),
        saveContent: vi.fn(),
    },
}));

vi.mock('../../../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }),
}));

import { NotesSidebar } from '../../../../../../src/server/spa/client/react/features/notes/editor/NotesSidebar';

// ── Fixtures ───────────────────────────────────────────────────────────

const DEFAULT_TREE: NoteTreeNode[] = [
    { name: 'AlphaOne', path: 'AlphaOne', type: 'page' },
    { name: 'AlphaTwo', path: 'AlphaTwo', type: 'page' },
];

const DOCS_TREE: NoteTreeNode[] = [
    { name: 'BetaOne', path: 'BetaOne', type: 'page' },
];

const ROOTS: NotesRootEntry[] = [
    { rootId: 'default', label: 'Notes', isDefault: true },
    { rootId: 'docs', label: 'Docs', isDefault: false },
];

function renderSidebar(extraProps: Partial<ComponentProps<typeof NotesSidebar>> = {}) {
    return render(
        <NotesSidebar
            workspaceId="ws1"
            selectedPath={null}
            onSelectPage={vi.fn()}
            roots={ROOTS}
            selectedRootId="default"
            selectedRootLabel="Notes"
            {...extraProps}
        />,
    );
}

/** Open the `docs` section and wait for its tree to render. */
async function expandDocs() {
    fireEvent.click(screen.getByTestId('notes-section-header-docs-toggle'));
    await screen.findByTestId('notes-tree-docs');
}

describe('NotesSidebar stacked root sections', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        mockGetTree.mockImplementation((_ws: string, root?: string) =>
            Promise.resolve({
                tree: root === 'docs' ? DOCS_TREE : DEFAULT_TREE,
                notesRoot: root === 'docs' ? '/mock/docs' : '/mock/notes',
                systemFolders: [],
            }),
        );
        mockGetGitStatus.mockResolvedValue({ initialized: false });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders one section per root, in roots-API order, inside the shared scroll area (AC-01)', async () => {
        const { container } = renderSidebar();

        const first = await screen.findByTestId('notes-root-section-default');
        const second = screen.getByTestId('notes-root-section-docs');
        expect(screen.getByTestId('notes-section-header-default-toggle').textContent).toContain('Notes');
        expect(screen.getByTestId('notes-section-header-docs-toggle').textContent).toContain('Docs');

        // Section order follows the roots array.
        expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // One shared scroll container wraps every section.
        const treeArea = screen.getByTestId('notes-tree-area');
        expect(treeArea.contains(first)).toBe(true);
        expect(treeArea.contains(second)).toBe(true);
        expect(container.querySelectorAll('[data-testid="notes-tree-area"]').length).toBe(1);
    });

    it('opens the selected root on first load and leaves the others closed (AC-02)', async () => {
        renderSidebar();

        const defaultSection = await screen.findByTestId('notes-root-section-default');
        expect(defaultSection.getAttribute('data-expanded')).toBe('true');
        expect(screen.getByTestId('notes-root-section-docs').getAttribute('data-expanded')).toBe('false');
    });

    it('restores a persisted section state and persists a toggle (AC-02)', async () => {
        window.localStorage.setItem('coc-notes-section-expanded-ws1-docs', 'true');
        renderSidebar();

        await screen.findByTestId('notes-tree-docs');
        expect(screen.getByTestId('notes-root-section-docs').getAttribute('data-expanded')).toBe('true');

        fireEvent.click(screen.getByTestId('notes-section-header-docs-toggle'));
        await waitFor(() => {
            expect(window.localStorage.getItem('coc-notes-section-expanded-ws1-docs')).toBe('false');
        });
        expect(screen.queryByTestId('notes-tree-docs')).toBeNull();
    });

    it('fetches a root only when its section first opens, then serves it from cache (AC-03)', async () => {
        renderSidebar();

        await screen.findByTestId('notes-tree-default');
        expect(mockGetTree).toHaveBeenCalledTimes(1);
        expect(mockGetTree).toHaveBeenCalledWith('ws1', undefined);
        expect(mockGetTree).not.toHaveBeenCalledWith('ws1', 'docs');

        await expandDocs();
        expect(mockGetTree).toHaveBeenCalledWith('ws1', 'docs');
        expect(mockGetTree).toHaveBeenCalledTimes(2);

        // Collapse + re-expand is free: the tree is cached for the session.
        fireEvent.click(screen.getByTestId('notes-section-header-docs-toggle'));
        await waitFor(() => expect(screen.queryByTestId('notes-tree-docs')).toBeNull());
        await expandDocs();
        expect(mockGetTree).toHaveBeenCalledTimes(2);
    });

    it('keeps every section addressable through per-section testids (AC-04)', async () => {
        renderSidebar();

        await expandDocs();
        expect(screen.getByTestId('notes-tree-default')).toBeTruthy();
        expect(screen.getByTestId('notes-tree-docs')).toBeTruthy();
        expect(screen.getByTestId('notes-section-header-default-count').textContent).toBe('2');
        expect(screen.getByTestId('notes-section-header-docs-count').textContent).toBe('1');
        // Meta pills count the whole column, not just the selected root.
        expect(screen.getByTestId('notes-pages-pill').textContent).toContain('3 pages');
    });

    it('drops a multi-selection when the user selects in another section (AC-05)', async () => {
        renderSidebar();

        await expandDocs();
        fireEvent.click(await screen.findByTestId('notes-tree-item-AlphaOne'), { ctrlKey: true });
        fireEvent.click(screen.getByTestId('notes-tree-item-AlphaTwo'), { ctrlKey: true });
        expect((await screen.findByTestId('notes-selection-badge')).textContent).toContain('2 selected');

        fireEvent.click(screen.getByTestId('notes-tree-item-BetaOne'));
        await waitFor(() => expect(screen.queryByTestId('notes-selection-badge')).toBeNull());
    });

    it('filters every expanded section and keeps a zero-match section visible (AC-06)', async () => {
        renderSidebar();

        await expandDocs();
        fireEvent.change(screen.getByTestId('notes-search-input'), { target: { value: 'Beta' } });

        // The non-matching section keeps its header and shows an empty state.
        expect(screen.getByTestId('notes-root-section-default')).toBeTruthy();
        expect(screen.getByTestId('notes-section-header-default-toggle')).toBeTruthy();
        expect(await screen.findByTestId('notes-search-empty-default')).toBeTruthy();
        expect(screen.queryByTestId('notes-search-empty-docs')).toBeNull();
        expect(screen.getByTestId('notes-tree-item-BetaOne')).toBeTruthy();
        expect(screen.queryByTestId('notes-tree-item-AlphaOne')).toBeNull();
    });

    it('renders a bare tree with no section chrome for a single-root workspace (AC-07)', async () => {
        renderSidebar({ roots: [ROOTS[0]] });

        expect(await screen.findByTestId('notes-tree')).toBeTruthy();
        expect(screen.queryByTestId('notes-root-section-default')).toBeNull();
        expect(screen.queryByTestId('notes-section-header-default')).toBeNull();
        expect(screen.getByTestId('notes-tree-item-AlphaOne')).toBeTruthy();
    });
});
