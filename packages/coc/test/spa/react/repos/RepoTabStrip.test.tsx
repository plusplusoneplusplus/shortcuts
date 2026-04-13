/**
 * RepoTabStrip — unit tests.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { RepoTabStrip } from '../../../../src/server/spa/client/react/repos/RepoTabStrip';

const mockDispatch = vi.fn();
const mockQueueDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ state: {}, dispatch: mockDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
}));

const mockFetchApi = vi.fn().mockResolvedValue({ gitGroupOrder: [] });
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: ({ open, editId }: { open: boolean; editId?: string | null }) =>
        open ? <div data-testid="add-repo-dialog" data-edit-id={editId ?? ''} /> : null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({
    AddFolderDialog: ({ open }: { open: boolean }) =>
        open ? <div data-testid="add-folder-dialog" /> : null,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/GenerateTaskDialog', () => ({
    GenerateTaskDialog: ({ wsId, initialFolder, onClose }: { wsId: string; initialFolder?: string; onClose: () => void }) => (
        <div data-testid="generate-task-dialog" data-ws-id={wsId} data-folder={initialFolder ?? ''}>
            <button data-testid="generate-task-dialog-close" onClick={onClose} />
        </div>
    ),
}));

const makeRepo = (id: string, name: string, color = '#ff0000', remoteUrl?: string) => ({
    workspace: { id, name, rootPath: `/repos/${id}`, color, remoteUrl },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
});

describe('RepoTabStrip', () => {
    beforeEach(() => {
        cleanup();
        mockFetchApi.mockReset().mockResolvedValue({ gitGroupOrder: [] });
    });

    it('renders a tab for each repo', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const tabs = screen.getAllByTestId('repo-tab');
        expect(tabs).toHaveLength(2);
        expect(tabs[0].textContent).toContain('Alpha');
        expect(tabs[1].textContent).toContain('Beta');
    });

    it('marks selected repo tab as aria-pressed=true', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                selectedRepoId="r1"
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const tabs = screen.getAllByTestId('repo-tab');
        expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
        expect(tabs[1].getAttribute('aria-pressed')).toBe('false');
    });

    it('calls onSelect with the correct repo id when tab is clicked', () => {
        const onSelect = vi.fn();
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                selectedRepoId={null}
                onSelect={onSelect}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const tabs = screen.getAllByTestId('repo-tab');
        fireEvent.click(tabs[1]);
        expect(onSelect).toHaveBeenCalledWith('r2');
    });

    it('shows unseen badge when unseenCount > 0', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{ r1: 5 }}
                onRefresh={vi.fn()}
            />
        );
        const badge = screen.getByTestId('repo-tab-unseen-badge');
        expect(badge.textContent).toBe('5');
        expect(badge.getAttribute('aria-label')).toBe('5 unread');
    });

    it('caps badge at 99+ for large unseen counts', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{ r1: 150 }}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.getByTestId('repo-tab-unseen-badge').textContent).toBe('99+');
    });

    it('does not show unseen badge when count is 0', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{ r1: 0 }}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryByTestId('repo-tab-unseen-badge')).toBeNull();
    });

    it('clicking "+" shows add dropdown menu', () => {
        render(
            <RepoTabStrip
                repos={[]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryByTestId('repo-tab-add-dropdown')).toBeNull();
        fireEvent.click(screen.getByTestId('repo-tab-add-btn'));
        expect(screen.getByTestId('repo-tab-add-dropdown')).toBeDefined();
    });

    it('dropdown contains "Add workspace folder" and "Add specific repository" options', () => {
        render(
            <RepoTabStrip
                repos={[]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        fireEvent.click(screen.getByTestId('repo-tab-add-btn'));
        expect(screen.getByTestId('repo-tab-add-folder-option')).toBeDefined();
        expect(screen.getByTestId('repo-tab-add-repo-option')).toBeDefined();
    });

    it('opens AddFolderDialog when "Add workspace folder" option is clicked', () => {
        render(
            <RepoTabStrip
                repos={[]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        fireEvent.click(screen.getByTestId('repo-tab-add-btn'));
        expect(screen.queryByTestId('add-folder-dialog')).toBeNull();
        fireEvent.click(screen.getByTestId('repo-tab-add-folder-option'));
        expect(screen.getByTestId('add-folder-dialog')).toBeDefined();
        expect(screen.queryByTestId('repo-tab-add-dropdown')).toBeNull();
    });

    it('opens AddRepoDialog when "Add specific repository" option is clicked', () => {
        render(
            <RepoTabStrip
                repos={[]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        fireEvent.click(screen.getByTestId('repo-tab-add-btn'));
        expect(screen.queryByTestId('add-repo-dialog')).toBeNull();
        fireEvent.click(screen.getByTestId('repo-tab-add-repo-option'));
        expect(screen.getByTestId('add-repo-dialog')).toBeDefined();
        expect(screen.queryByTestId('repo-tab-add-dropdown')).toBeNull();
    });

    it('closes dropdown on outside click', () => {
        render(
            <div>
                <RepoTabStrip
                    repos={[]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
                <div data-testid="outside" />
            </div>
        );
        fireEvent.click(screen.getByTestId('repo-tab-add-btn'));
        expect(screen.getByTestId('repo-tab-add-dropdown')).toBeDefined();
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(screen.queryByTestId('repo-tab-add-dropdown')).toBeNull();
    });

    it('closes dropdown on Escape key', () => {
        render(
            <RepoTabStrip
                repos={[]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        fireEvent.click(screen.getByTestId('repo-tab-add-btn'));
        expect(screen.getByTestId('repo-tab-add-dropdown')).toBeDefined();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('repo-tab-add-dropdown')).toBeNull();
    });

    it('opens AddRepoDialog when "+" button is clicked (regression: via dropdown)', () => {
        render(
            <RepoTabStrip
                repos={[]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryByTestId('add-repo-dialog')).toBeNull();
        fireEvent.click(screen.getByTestId('repo-tab-add-btn'));
        fireEvent.click(screen.getByTestId('repo-tab-add-repo-option'));
        expect(screen.getByTestId('add-repo-dialog')).toBeDefined();
    });

    it('renders empty strip with just the add button when repos=[]', () => {
        render(
            <RepoTabStrip
                repos={[]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryAllByTestId('repo-tab')).toHaveLength(0);
        expect(screen.getByTestId('repo-tab-add-btn')).toBeDefined();
    });

    it('renders no separators when all repos have the same remote URL', () => {
        const remote = 'https://github.com/org/repo.git';
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha', '#f00', remote), makeRepo('r2', 'Beta', '#0f0', remote)]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryAllByTestId('repo-group-separator')).toHaveLength(0);
        expect(screen.getAllByTestId('repo-tab')).toHaveLength(2);
    });

    it('renders a separator between repos from different remote URLs', () => {
        render(
            <RepoTabStrip
                repos={[
                    makeRepo('r1', 'Alpha', '#f00', 'https://github.com/org/repo-a.git'),
                    makeRepo('r2', 'Beta', '#0f0', 'https://github.com/org/repo-b.git'),
                ]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.getAllByTestId('repo-group-separator')).toHaveLength(1);
    });

    it('renders a separator before ungrouped repos (no remote URL)', () => {
        render(
            <RepoTabStrip
                repos={[
                    makeRepo('r1', 'Alpha', '#f00', 'https://github.com/org/repo.git'),
                    makeRepo('r2', 'Beta'),
                ]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.getAllByTestId('repo-group-separator')).toHaveLength(1);
    });

    it('renders no separator when all repos are ungrouped (no remote URLs)', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        // Each ungrouped repo is its own group — two repos = two groups = one separator between them
        expect(screen.getAllByTestId('repo-group-separator')).toHaveLength(1);
    });

    it('+ button is outside the overflow-x-auto scroll container (regression: dropdown must not be clipped)', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const tabs = screen.getAllByTestId('repo-tab');
        const addBtn = screen.getByTestId('repo-tab-add-btn');
        const lastTab = tabs[tabs.length - 1];
        // The scrollable container holds the tabs but NOT the + button,
        // so the dropdown is never clipped by overflow-x-auto.
        const scrollContainer = lastTab.closest('[data-testid="repo-tab-strip"] > div');
        expect(scrollContainer).not.toBeNull();
        expect(scrollContainer!.contains(addBtn)).toBe(false);
        // The + button must still be inside the tab-strip wrapper
        const stripWrapper = screen.getByTestId('repo-tab-strip');
        expect(stripWrapper.contains(addBtn)).toBe(true);
    });

    it('renders no separator for a single repo', () => {
        render(
            <RepoTabStrip
                repos={[makeRepo('r1', 'Alpha')]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        expect(screen.queryAllByTestId('repo-group-separator')).toHaveLength(0);
    });

    it('separator tooltip shows the group remote URL label', () => {
        render(
            <RepoTabStrip
                repos={[
                    makeRepo('r1', 'Alpha', '#f00', 'https://github.com/org/repo-a.git'),
                    makeRepo('r2', 'Beta', '#0f0', 'https://github.com/org/repo-b.git'),
                ]}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );
        const separator = screen.getByTestId('repo-group-separator');
        // The second group's label should appear as the separator title
        expect(separator.getAttribute('title')).toBeTruthy();
    });

    describe('context menu', () => {
        beforeEach(() => {
            Object.assign(navigator, {
                clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
            });
        });

        it('right-clicking a repo tab opens the context menu', () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            expect(screen.getByTestId('repo-tab-context-menu')).toBeDefined();
        });

        it('context menu contains a "Copy Repo Info" item', () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            expect(screen.getByTestId('repo-tab-context-copy-info')).toBeDefined();
        });

        it('clicking Copy Repo Info writes "<name>: <path>" to clipboard and closes menu', async () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            fireEvent.click(screen.getByTestId('repo-tab-context-copy-info'));
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Alpha: /repos/r1');
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
        });

        it('"Copy Repo Info" is the last menu item (after Remove)', () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            const menu = screen.getByTestId('repo-tab-context-menu');
            const menuItems = Array.from(menu.querySelectorAll('[role="menuitem"]'));
            const itemTestIds = menuItems.map(el => el.getAttribute('data-testid'));
            expect(itemTestIds[itemTestIds.length - 1]).toBe('repo-tab-context-copy-info');
            const removeIdx = itemTestIds.indexOf('repo-tab-context-remove');
            const copyIdx = itemTestIds.indexOf('repo-tab-context-copy-info');
            expect(removeIdx).toBeGreaterThanOrEqual(0);
            expect(copyIdx).toBeGreaterThan(removeIdx);
        });

        it('pressing Escape closes the context menu', () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            expect(screen.getByTestId('repo-tab-context-menu')).toBeDefined();
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
        });

        it('clicking outside closes the context menu', () => {
            render(
                <div>
                    <RepoTabStrip
                        repos={[makeRepo('r1', 'Alpha')]}
                        selectedRepoId={null}
                        onSelect={vi.fn()}
                        unseenCounts={{}}
                        onRefresh={vi.fn()}
                    />
                    <div data-testid="outside" />
                </div>
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            expect(screen.getByTestId('repo-tab-context-menu')).toBeDefined();
            fireEvent.mouseDown(screen.getByTestId('outside'));
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
        });

        it('only one context menu open at a time: opening a new one closes the previous', () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            const tabs = screen.getAllByTestId('repo-tab');
            fireEvent.contextMenu(tabs[0]);
            expect(screen.getAllByTestId('repo-tab-context-menu')).toHaveLength(1);
            fireEvent.contextMenu(tabs[1]);
            expect(screen.getAllByTestId('repo-tab-context-menu')).toHaveLength(1);
        });

        it('left-click on repo tab still calls onSelect (unchanged behavior)', () => {
            const onSelect = vi.fn();
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={onSelect}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.click(screen.getByTestId('repo-tab'));
            expect(onSelect).toHaveBeenCalledWith('r1');
        });

        it('context menu contains "Edit" and "Remove" items', () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            expect(screen.getByTestId('repo-tab-context-edit')).toBeDefined();
            expect(screen.getByTestId('repo-tab-context-remove')).toBeDefined();
        });

        it('clicking Edit opens AddRepoDialog in edit mode and closes the context menu', () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            fireEvent.click(screen.getByTestId('repo-tab-context-edit'));
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
            const dialog = screen.getByTestId('add-repo-dialog');
            expect(dialog).toBeDefined();
            expect(dialog.getAttribute('data-edit-id')).toBe('r1');
        });

        it('clicking Remove calls DELETE /workspaces/:id after confirmation, dispatches SET_SELECTED_REPO, and calls onRefresh', async () => {
            const onRefresh = vi.fn();
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
            mockDispatch.mockClear();

            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={onRefresh}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            fireEvent.click(screen.getByTestId('repo-tab-context-remove'));
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
            // Wait for all async effects: fetch → dispatch → onRefresh
            await vi.waitFor(() => {
                expect(fetchSpy).toHaveBeenCalledWith(
                    'http://localhost:4000/api/workspaces/r1',
                    { method: 'DELETE' }
                );
                expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: null });
                expect(onRefresh).toHaveBeenCalled();
            });

            fetchSpy.mockRestore();
            vi.restoreAllMocks();
        });

        it('clicking Remove does nothing when user cancels confirmation', () => {
            const onRefresh = vi.fn();
            vi.spyOn(window, 'confirm').mockReturnValue(false);
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
            mockDispatch.mockClear();

            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={onRefresh}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            fireEvent.click(screen.getByTestId('repo-tab-context-remove'));
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(mockDispatch).not.toHaveBeenCalled();
            expect(onRefresh).not.toHaveBeenCalled();

            fetchSpy.mockRestore();
            vi.restoreAllMocks();
        });

        it('context menu contains Queue Task, Ask, and Generate Plan items', () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            expect(screen.getByTestId('repo-tab-context-queue-task')).toBeDefined();
            expect(screen.getByTestId('repo-tab-context-ask')).toBeDefined();
            expect(screen.getByTestId('repo-tab-context-run-script')).toBeDefined();
            expect(screen.getByTestId('repo-tab-context-generate-plan')).toBeDefined();
        });

        it('clicking Queue Task dispatches OPEN_DIALOG with workspaceId and closes menu', () => {
            mockQueueDispatch.mockClear();
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            fireEvent.click(screen.getByTestId('repo-tab-context-queue-task'));
            expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'OPEN_DIALOG', workspaceId: 'r1' });
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
        });

        it('clicking Ask dispatches OPEN_DIALOG with workspaceId and mode=ask and closes menu', () => {
            mockQueueDispatch.mockClear();
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            fireEvent.click(screen.getByTestId('repo-tab-context-ask'));
            expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'OPEN_DIALOG', workspaceId: 'r1', mode: 'ask' });
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
        });

        it('clicking Run Script dispatches OPEN_SCRIPT_DIALOG with workspaceId and closes menu', () => {
            mockQueueDispatch.mockClear();
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            fireEvent.click(screen.getByTestId('repo-tab-context-run-script'));
            expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'OPEN_SCRIPT_DIALOG', workspaceId: 'r1' });
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
        });

        it('clicking Generate Plan opens GenerateTaskDialog for the right-clicked repo and closes menu', () => {
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha')]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            expect(screen.queryByTestId('generate-task-dialog')).toBeNull();
            fireEvent.contextMenu(screen.getByTestId('repo-tab'));
            fireEvent.click(screen.getByTestId('repo-tab-context-generate-plan'));
            expect(screen.queryByTestId('repo-tab-context-menu')).toBeNull();
            const dialog = screen.getByTestId('generate-task-dialog');
            expect(dialog).toBeDefined();
            expect(dialog.getAttribute('data-ws-id')).toBe('r1');
            // targetFolder must be undefined so the dialog defaults to AUTO_FOLDER_SENTINEL
            expect(dialog.getAttribute('data-folder')).toBe('');
        });

        it('actions target the right-clicked repo, not the selected one', () => {
            mockQueueDispatch.mockClear();
            render(
                <RepoTabStrip
                    repos={[makeRepo('r1', 'Alpha'), makeRepo('r2', 'Beta')]}
                    selectedRepoId="r1"
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
            const tabs = screen.getAllByTestId('repo-tab');
            // Right-click on the second tab (Beta, r2) while r1 is selected
            fireEvent.contextMenu(tabs[1]);
            fireEvent.click(screen.getByTestId('repo-tab-context-queue-task'));
            expect(mockQueueDispatch).toHaveBeenCalledWith({ type: 'OPEN_DIALOG', workspaceId: 'r2' });
        });
    });

    it('non-git repo tab renders a square dot (rounded-sm)', () => {
        const repo = { ...makeRepo('r1', 'LocalDir'), gitInfo: { branch: '', isGitRepo: false, dirty: false, ahead: 0, behind: 0 } };
        render(
            <RepoTabStrip repos={[repo]} selectedRepoId={null} onSelect={vi.fn()} unseenCounts={{}} onRefresh={vi.fn()} />
        );
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('rounded-sm');
        expect(dot.className).not.toContain('rounded-full');
    });

    it('git repo tab renders a circle dot (rounded-full)', () => {
        const repo = { ...makeRepo('r1', 'GitProject'), gitInfo: { branch: 'main', isGitRepo: true, dirty: false, ahead: 0, behind: 0 } };
        render(
            <RepoTabStrip repos={[repo]} selectedRepoId={null} onSelect={vi.fn()} unseenCounts={{}} onRefresh={vi.fn()} />
        );
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('rounded-full');
        expect(dot.className).not.toContain('rounded-sm');
    });

    it('while gitInfoLoading is true, dot defaults to circle', () => {
        const repo = { ...makeRepo('r1', 'Loading'), gitInfoLoading: true };
        render(
            <RepoTabStrip repos={[repo]} selectedRepoId={null} onSelect={vi.fn()} unseenCounts={{}} onRefresh={vi.fn()} />
        );
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('rounded-full');
        expect(dot.className).not.toContain('rounded-sm');
    });

    it('repo with no gitInfo defaults to circle dot', () => {
        const repo = makeRepo('r1', 'Unknown');
        render(
            <RepoTabStrip repos={[repo]} selectedRepoId={null} onSelect={vi.fn()} unseenCounts={{}} onRefresh={vi.fn()} />
        );
        const dot = screen.getByTestId('repo-tab-dot');
        expect(dot.className).toContain('rounded-full');
    });

    it('applies saved gitGroupOrder from preferences to tab order', async () => {
        // Two repos with different remoteUrls → two groups: "github.com/org/bravo" and "github.com/org/alpha"
        const repoA = makeRepo('a1', 'Alpha', '#ff0000', 'https://github.com/org/alpha');
        const repoB = makeRepo('b1', 'Bravo', '#00ff00', 'https://github.com/org/bravo');

        // Mock fetchApi to return a specific group order (Bravo group before Alpha group)
        const bravoGroupKey = 'github.com/org/bravo';
        const alphaGroupKey = 'github.com/org/alpha';
        mockFetchApi.mockResolvedValueOnce({ gitGroupOrder: [bravoGroupKey, alphaGroupKey] });

        await act(async () => {
            render(
                <RepoTabStrip
                    repos={[repoA, repoB]}
                    selectedRepoId={null}
                    onSelect={vi.fn()}
                    unseenCounts={{}}
                    onRefresh={vi.fn()}
                />
            );
        });

        expect(mockFetchApi).toHaveBeenCalledWith('/preferences');

        const tabs = screen.getAllByTestId('repo-tab');
        expect(tabs).toHaveLength(2);
        // Bravo should come first per the saved order
        expect(tabs[0].textContent).toContain('Bravo');
        expect(tabs[1].textContent).toContain('Alpha');
    });
});
