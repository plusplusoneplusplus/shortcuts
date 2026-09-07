/**
 * UnifiedPanelOpenMenu — the unified panel's searchable "+" menu (AC-03).
 *
 * The cases here pin what the component owns on top of the pure model: search
 * that costs nothing until a key is pressed, a stale response that can never
 * open a file from the repo the user just left, keyboard-only operation, and a
 * visible state for every failure (search error with retry, unavailable repo,
 * failed canvas creation).
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const searchFiles = vi.fn();
const listCanvases = vi.fn();
const createCanvas = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: (...args: unknown[]) => searchFiles(...args),
    },
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({
        canvases: {
            list: (...args: unknown[]) => listCanvases(...args),
            create: (...args: unknown[]) => createCanvas(...args),
        },
    }),
}));

import { UnifiedPanelOpenMenu } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelOpenMenu';

const WS = 'ws-1';

function renderMenu(props: Partial<React.ComponentProps<typeof UnifiedPanelOpenMenu>> = {}) {
    const handlers = {
        onOpenResource: props.onOpenResource ?? vi.fn(),
        onOpenWorkspaceResource: props.onOpenWorkspaceResource ?? vi.fn(),
        onClose: props.onClose ?? vi.fn(),
        onSelectTarget: props.onSelectTarget ?? vi.fn(),
    };
    const view = render(
        <UnifiedPanelOpenMenu
            workspaceId={WS}
            chatId={props.chatId === undefined ? 'chat-1' : props.chatId}
            target={props.target ?? WS}
            targets={props.targets}
            {...handlers}
        />,
    );
    return { ...view, ...handlers };
}

/** Type into the search box and let the debounce fire. */
async function search(query: string) {
    fireEvent.change(screen.getByTestId('unified-panel-open-menu-search'), { target: { value: query } });
    await vi.advanceTimersByTimeAsync(60);
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchFiles.mockReset().mockResolvedValue({ results: [] });
    listCanvases.mockReset().mockResolvedValue([]);
    createCanvas.mockReset();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('opening costs nothing', () => {
    it('issues no file search until something is typed', async () => {
        renderMenu();
        await vi.advanceTimersByTimeAsync(200);
        expect(searchFiles).not.toHaveBeenCalled();
        // The actions are still there to be used without a query.
        expect(screen.getByTestId('unified-panel-open-terminal')).toBeTruthy();
    });

    it('debounces typing into a single request', async () => {
        renderMenu();
        const input = screen.getByTestId('unified-panel-open-menu-search');
        fireEvent.change(input, { target: { value: 'a' } });
        fireEvent.change(input, { target: { value: 'ap' } });
        fireEvent.change(input, { target: { value: 'app' } });
        await vi.advanceTimersByTimeAsync(60);
        expect(searchFiles).toHaveBeenCalledTimes(1);
        expect(searchFiles.mock.calls[0][1]).toBe('app');
    });
});

describe('actions', () => {
    it('opens a workspace resource through the panel callback', async () => {
        const { onOpenWorkspaceResource } = renderMenu();
        fireEvent.click(screen.getByTestId('unified-panel-open-terminal'));
        expect(onOpenWorkspaceResource).toHaveBeenCalledWith('terminal');
    });

    it('hides Explorer for a repo group root and keeps Terminal and Notes', () => {
        renderMenu({ target: 'group-acme' });
        expect(screen.queryByTestId('unified-panel-open-explorer')).toBeNull();
        expect(screen.getByTestId('unified-panel-open-terminal')).toBeTruthy();
        expect(screen.getByTestId('unified-panel-open-notes')).toBeTruthy();
    });

    it('explains that a canvas needs a chat instead of creating an unowned one', async () => {
        const { onOpenResource } = renderMenu({ chatId: null });
        const canvas = screen.getByTestId('unified-panel-open-canvas') as HTMLButtonElement;
        expect(canvas.disabled).toBe(true);
        expect(canvas.textContent).toMatch(/chat/i);
        fireEvent.click(canvas);
        expect(createCanvas).not.toHaveBeenCalled();
        expect(onOpenResource).not.toHaveBeenCalled();
    });

    it('creates a blank chat-linked canvas and opens it', async () => {
        createCanvas.mockResolvedValue({ id: 'c-new', title: 'Untitled canvas' });
        const { onOpenResource, onClose } = renderMenu();
        fireEvent.click(screen.getByTestId('unified-panel-open-canvas'));
        await waitFor(() => expect(onOpenResource).toHaveBeenCalled());
        expect(createCanvas).toHaveBeenCalledWith(WS, expect.objectContaining({ type: 'markdown', processId: 'chat-1' }));
        expect(onOpenResource.mock.calls[0][0]).toMatchObject({
            kind: 'canvas', resourceId: 'c-new', chatId: 'chat-1', ownerWorkspaceId: WS,
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('keeps the menu open with a visible error when canvas creation fails', async () => {
        createCanvas.mockRejectedValue(new Error('nope'));
        const { onClose } = renderMenu();
        fireEvent.click(screen.getByTestId('unified-panel-open-canvas'));
        await waitFor(() => expect(screen.getByTestId('unified-panel-open-menu-create-error')).toBeTruthy());
        expect(onClose).not.toHaveBeenCalled();
    });

    it('offers the canvases already linked to the chat', async () => {
        listCanvases.mockResolvedValue([{ id: 'c1', title: 'Design notes' }]);
        const { onOpenResource, onClose } = renderMenu();
        await waitFor(() => expect(screen.getByTestId('unified-panel-open-menu-canvas-c1')).toBeTruthy());
        expect(listCanvases).toHaveBeenCalledWith(WS, { processId: 'chat-1' });
        fireEvent.click(screen.getByTestId('unified-panel-open-menu-canvas-c1'));
        expect(onOpenResource).toHaveBeenCalledWith(expect.objectContaining({ kind: 'canvas', resourceId: 'c1' }));
        expect(onClose).toHaveBeenCalled();
    });
});

describe('file search', () => {
    it('opens the selected result as a tab on the searched repo', async () => {
        searchFiles.mockResolvedValue({ results: [{ path: 'src/app.ts', indices: [4, 5] }] });
        const { onOpenResource, onClose } = renderMenu();
        await search('app');
        fireEvent.click(await screen.findByTestId('unified-panel-open-menu-file-0'));
        expect(onOpenResource).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'file', resourceId: 'src/app.ts', label: 'app.ts', ownerWorkspaceId: WS,
        }));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows a no-results state for a query that matches nothing', async () => {
        renderMenu();
        await search('zzzz');
        expect(await screen.findByTestId('unified-panel-open-menu-no-results')).toBeTruthy();
    });

    it('surfaces a failed search with a retry that re-issues it', async () => {
        searchFiles.mockRejectedValueOnce(new Error('offline'));
        renderMenu();
        await search('app');
        const error = await screen.findByTestId('unified-panel-open-menu-error');
        expect(error).toBeTruthy();

        searchFiles.mockResolvedValue({ results: [{ path: 'src/app.ts' }] });
        fireEvent.click(screen.getByTestId('unified-panel-open-menu-retry'));
        expect(await screen.findByTestId('unified-panel-open-menu-file-0')).toBeTruthy();
    });

    it('drops a result that arrives after the repo picker moved on', async () => {
        // The first repo's search resolves only after the target has changed —
        // applying it would list files the user could open in the wrong repo.
        let resolveStale: ((value: unknown) => void) | null = null;
        searchFiles.mockImplementationOnce(() => new Promise(resolve => { resolveStale = resolve; }));
        const targets = [
            { workspaceId: 'ws-a', label: 'alpha' },
            { workspaceId: 'ws-b', label: 'beta' },
        ];
        const { rerender, onOpenResource } = renderMenu({ target: 'ws-a', targets });
        await search('app');

        searchFiles.mockResolvedValue({ results: [{ path: 'b/only.ts' }] });
        rerender(
            <UnifiedPanelOpenMenu
                workspaceId={WS}
                chatId="chat-1"
                target="ws-b"
                targets={targets}
                onSelectTarget={vi.fn()}
                onOpenResource={onOpenResource}
                onOpenWorkspaceResource={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        await vi.advanceTimersByTimeAsync(60);
        resolveStale?.({ results: [{ path: 'a/stale.ts' }] });
        await vi.advanceTimersByTimeAsync(10);

        const rows = screen.getAllByTestId(/unified-panel-open-menu-file-/);
        expect(rows.map(row => row.getAttribute('title'))).toEqual(['b/only.ts']);
    });

    it('routes an opened file to the picked repo, not the panel workspace', async () => {
        searchFiles.mockResolvedValue({ results: [{ path: 'src/app.ts' }] });
        const { onOpenResource } = renderMenu({
            target: 'ws-member',
            targets: [
                { workspaceId: WS, label: 'root' },
                { workspaceId: 'ws-member', label: 'member' },
            ],
        });
        await search('app');
        fireEvent.click(await screen.findByTestId('unified-panel-open-menu-file-0'));
        expect(onOpenResource).toHaveBeenCalledWith(expect.objectContaining({
            ownerWorkspaceId: 'ws-member', repoLabel: 'member',
        }));
        expect(searchFiles).toHaveBeenCalledWith('ws-member', 'app', expect.anything());
    });

    it('disables search and the repo-bound actions when the target is unavailable', async () => {
        renderMenu({
            target: 'ws-gone',
            targets: [
                { workspaceId: WS, label: 'root' },
                { workspaceId: 'ws-gone', label: 'gone', disabled: true },
            ],
        });
        expect((screen.getByTestId('unified-panel-open-menu-search') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByTestId('unified-panel-open-terminal') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('unified-panel-open-notes') as HTMLButtonElement).disabled).toBe(false);
        expect(searchFiles).not.toHaveBeenCalled();
    });
});

describe('keyboard', () => {
    it('opens a searched file with arrows and Enter alone', async () => {
        searchFiles.mockResolvedValue({ results: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] });
        const { onOpenResource } = renderMenu();
        await search('src');
        await screen.findByTestId('unified-panel-open-menu-file-1');

        const input = screen.getByTestId('unified-panel-open-menu-search');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onOpenResource).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'src/b.ts' }));
    });

    it('never parks the cursor on a disabled action', async () => {
        const { onOpenResource, onOpenWorkspaceResource } = renderMenu({ chatId: null });
        const input = screen.getByTestId('unified-panel-open-menu-search');
        // terminal, explorer, notes, [canvas disabled] — arrowing past Notes
        // must wrap to Terminal rather than land on Canvas.
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onOpenWorkspaceResource).toHaveBeenCalledWith('terminal');
        expect(onOpenResource).not.toHaveBeenCalled();
    });

    it('closes on Escape', () => {
        const { onClose } = renderMenu();
        fireEvent.keyDown(screen.getByTestId('unified-panel-open-menu-search'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('focuses the search box on open so typing works immediately', async () => {
        renderMenu();
        await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('unified-panel-open-menu-search')));
    });
});

describe('repo picker', () => {
    it('appears only for a group and reports the picked repo', () => {
        const single = renderMenu();
        expect(screen.queryByTestId('unified-panel-open-menu-repo')).toBeNull();
        single.unmount();

        const { onSelectTarget } = renderMenu({
            target: WS,
            targets: [
                { workspaceId: WS, label: 'root' },
                { workspaceId: 'ws-member', label: 'member' },
            ],
        });
        fireEvent.change(screen.getByTestId('unified-panel-open-menu-repo'), { target: { value: 'ws-member' } });
        expect(onSelectTarget).toHaveBeenCalledWith('ws-member');
    });
});
