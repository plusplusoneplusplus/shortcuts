/**
 * @vitest-environment jsdom
 *
 * Verifies the "Copy" context-menu entry in the hierarchy tree copies the right text
 * to the clipboard, reports via a toast, and closes the menu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    tree: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            treeForOrigin: mocks.tree,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isSessionContextAttachmentsEnabled: () => false,
    isWorkItemsSyncEnabled: () => false,
}));

import { WorkItemProvider, type WorkItemSummary } from '../../../../../src/server/spa/client/react/contexts/WorkItemContext';
import { ToastContext } from '../../../../../src/server/spa/client/react/contexts/ToastContext';
import { WorkItemHierarchyTree } from '../../../../../src/server/spa/client/react/features/work-items/WorkItemHierarchyTree';

const ITEM_ID = 'uuid-wi-23';

function makeWorkItem(): WorkItemSummary {
    return {
        id: ITEM_ID,
        workItemNumber: 23,
        title: 'Copy me',
        status: 'planning',
        type: 'work-item',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
    };
}

const addToast = vi.fn();
const writeText = vi.fn().mockResolvedValue(undefined);

function renderTree() {
    return render(
        <ToastContext.Provider value={{ addToast, removeToast: vi.fn(), toasts: [] }}>
            <WorkItemProvider>
                <WorkItemHierarchyTree
                    workspaceId="ws-1"
                    selectedWorkItemId={null}
                    onSelectWorkItem={vi.fn()}
                    onCreated={vi.fn()}
                    onCreateItem={vi.fn()}
                    onImportFromGitHub={vi.fn()}
                />
            </WorkItemProvider>
        </ToastContext.Provider>,
    );
}

/** Open the Copy submenu (the only submenu in this menu) and return nothing. */
function openCopySubmenu() {
    const haspopup = document.querySelector('[aria-haspopup="true"]') as HTMLElement | null;
    expect(haspopup).toBeTruthy();
    const wrapper = haspopup!.closest('[data-testid^="context-menu-item-"]') as HTMLElement;
    fireEvent.mouseEnter(wrapper);
}

describe('WorkItemHierarchyTree Copy context menu', () => {
    beforeEach(() => {
        addToast.mockReset();
        writeText.mockReset().mockResolvedValue(undefined);
        mocks.tree.mockReset();
        mocks.tree.mockResolvedValue({ roots: [{ item: makeWorkItem(), children: [] }], total: 1 });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('shows a Copy entry whose submenu copies the identifier, title, and info block', async () => {
        renderTree();
        await screen.findByText('Copy me');

        fireEvent.contextMenu(screen.getByTestId(`hierarchy-node-row-${ITEM_ID}`));
        expect(screen.getByTestId('context-menu')).toBeInTheDocument();
        expect(screen.getByText('Copy')).toBeInTheDocument();

        // Copy ID → identifier
        openCopySubmenu();
        fireEvent.click(screen.getByText('Copy ID'));
        expect(writeText).toHaveBeenCalledWith('WI-23');
        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Copied ID', 'success'));
        // Menu auto-closes after a submenu click
        await waitFor(() => expect(screen.queryByTestId('context-menu')).toBeNull());

        // Copy title → title text
        fireEvent.contextMenu(screen.getByTestId(`hierarchy-node-row-${ITEM_ID}`));
        openCopySubmenu();
        fireEvent.click(screen.getByText('Copy title'));
        expect(writeText).toHaveBeenLastCalledWith('Copy me');
        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Copied title', 'success'));

        // Copy info → multi-line block
        fireEvent.contextMenu(screen.getByTestId(`hierarchy-node-row-${ITEM_ID}`));
        openCopySubmenu();
        fireEvent.click(screen.getByText('Copy info'));
        const infoText = writeText.mock.calls.at(-1)![0] as string;
        expect(infoText).toContain('WI-23');
        expect(infoText).toContain('Copy me');
        expect(infoText).toContain('Type: Work Item · Status: Planning');
        expect(infoText).toContain(`ID: ${ITEM_ID}`);
        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Copied info', 'success'));
    });

    it('reports a failure toast when the clipboard write rejects', async () => {
        writeText.mockRejectedValueOnce(new Error('denied'));
        renderTree();
        await screen.findByText('Copy me');

        fireEvent.contextMenu(screen.getByTestId(`hierarchy-node-row-${ITEM_ID}`));
        openCopySubmenu();
        fireEvent.click(screen.getByText('Copy ID'));

        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Failed to copy to clipboard', 'error'));
    });
});
