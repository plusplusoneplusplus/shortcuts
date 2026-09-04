/**
 * ScopeSlideSwitcher — pinned repo / repo-group segments (`features.pinnedScopes`).
 *
 * jsdom has no layout and no ResizeObserver, so segment identity and selection
 * are asserted through data-scope / data-pin-id / aria-selected rather than
 * thumb pixels, matching `scope-slide-switcher.test.tsx`.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockSelectClone = vi.fn();
const mockSwitchSubTab = vi.fn();
const mockDispatch = vi.fn();
const getGlobal = vi.fn();
const patchGlobal = vi.fn();
let mockAppState: any = {};
let mockQueueState: any = { repoQueueMap: {} };
let mockRepos: any[] = [];
let mockRemoteGroupWorkspaces: any[] = [];
let mockUnseenCounts: Record<string, number> = {};
let mockPinnedScopesEnabled = true;

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { getGlobal, patchGlobal } }),
}));
vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockDispatch }),
}));
vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: vi.fn() }),
}));
vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({
        repos: mockRepos,
        unseenCounts: mockUnseenCounts,
        fetchRepos: vi.fn(),
        remoteGroupWorkspaces: mockRemoteGroupWorkspaces,
    }),
}));
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => true,
}));
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => true,
}));
vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/usePinnedScopesEnabled', () => ({
    usePinnedScopesEnabled: () => mockPinnedScopesEnabled,
}));
vi.mock('../../../src/server/spa/client/react/features/remote-shell/useShellNavigation', () => ({
    useShellNavigation: () => ({ selectClone: mockSelectClone, switchSubTab: mockSwitchSubTab }),
}));
vi.mock('../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({
    AddFolderDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="add-folder-dialog" /> : null),
}));
vi.mock('../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="add-repo-dialog" /> : null),
}));
vi.mock('../../../src/server/spa/client/react/repos/CloneRepoDialog', () => ({
    CloneRepoDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="clone-repo-dialog" /> : null),
}));

import { ScopeSlideSwitcher } from '../../../src/server/spa/client/react/features/remote-shell/ScopeSlideSwitcher';
import { __resetPinnedScopesStore } from '../../../src/server/spa/client/react/features/remote-shell/usePinnedScopes';
import { MY_WORK_WORKSPACE_ID } from '../../../src/server/spa/client/react/repos/MyWorkView';

const repo = (id: string, name: string, remoteUrl: string) => ({
    workspace: { id, name, color: '#0078d4', remoteUrl, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
});

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const FORGE = 'https://github.com/acme/forge.git';
const SHORTCUTS_PIN = 'repo:github.com/acme/shortcuts';
const FORGE_PIN = 'repo:github.com/acme/forge';
const AI_GROUP_PIN = 'group:group-ai-repos';

/** Render, then wait for the async preference load to land the pin segments. */
async function renderWithPins(props: { repo?: any; repos: any[] }, expectPins = true) {
    render(<ScopeSlideSwitcher {...props} />);
    if (expectPins) await waitFor(() => expect(screen.getAllByTestId('scope-segment').length).toBeGreaterThan(3));
    else await waitFor(() => expect(screen.getByTestId('scope-switcher')).toBeTruthy());
}

const segments = () => screen.getAllByTestId('scope-segment');
const segment = (scope: string) => segments().find(el => el.getAttribute('data-scope') === scope);
const pinSegments = () => segments().filter(el => el.getAttribute('data-scope') === 'pin');
const pinSegment = (id: string) => pinSegments().find(el => el.getAttribute('data-pin-id') === id);

beforeEach(() => {
    cleanup();
    __resetPinnedScopesStore();
    mockSelectClone.mockReset();
    mockDispatch.mockReset();
    getGlobal.mockReset().mockResolvedValue({ pinnedScopes: [SHORTCUTS_PIN, AI_GROUP_PIN] });
    patchGlobal.mockReset().mockResolvedValue({});
    mockAppState = {
        selectedRepoId: 'c',
        activeTab: 'repos',
        activeRepoSubTab: 'chats',
        notePathState: {},
        workspaces: [{ id: 'group-ai-repos', name: 'ai-repos' }],
    };
    mockQueueState = { repoQueueMap: {} };
    mockRepos = [repo('a', 'shortcuts', SHORTCUTS), repo('b', 'shortcuts-2', SHORTCUTS), repo('c', 'forge', FORGE)];
    mockRemoteGroupWorkspaces = [];
    mockUnseenCounts = {};
    mockPinnedScopesEnabled = true;
    location.hash = '';
});

describe('pinned segments — rendering and placement', () => {
    it('renders pins between the virtual scopes and the workspace chip, in stored order', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        expect(segments().map(el => el.getAttribute('data-scope'))).toEqual(['work', 'life', 'pin', 'pin', 'workspace']);
        expect(pinSegments().map(el => el.getAttribute('data-pin-id'))).toEqual([SHORTCUTS_PIN, AI_GROUP_PIN]);
        expect(pinSegment(SHORTCUTS_PIN)!.textContent).toContain('shortcuts');
        expect(pinSegment(AI_GROUP_PIN)!.textContent).toContain('ai-repos');
    });

    it('brackets the pins with a divider on each side', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        expect(screen.getAllByTestId('scope-pin-divider').map(el => el.getAttribute('data-side'))).toEqual(['left', 'right']);
    });

    it('renders no pins, dividers or strip when the feature flag is off', async () => {
        mockPinnedScopesEnabled = false;
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos }, false);

        expect(pinSegments()).toHaveLength(0);
        expect(screen.queryByTestId('scope-pin-divider')).toBeNull();
        expect(screen.queryByTestId('scope-pin-strip')).toBeNull();
    });

    it('drops stale pins from the rendered set but keeps them stored', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: ['repo:github.com/acme/deleted', SHORTCUTS_PIN, 'group:group-gone'] });
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        expect(pinSegments().map(el => el.getAttribute('data-pin-id'))).toEqual([SHORTCUTS_PIN]);
        // Nothing was rewritten — the stale pins come back with their targets.
        expect(patchGlobal).not.toHaveBeenCalled();
    });

    it('drops the label (not the pin) at narrow widths, and the strip below that', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        const label = pinSegment(SHORTCUTS_PIN)!.querySelector('span.truncate') as HTMLElement;
        expect(label.className).toContain('hidden');
        expect(label.className).toContain('xl:inline');
        expect(screen.getByTestId('scope-pin-strip').className).toContain('hidden');
        expect(screen.getByTestId('scope-pin-strip').className).toContain('lg:flex');
    });

    it('shows an unread badge summed across every clone of a pinned remote', async () => {
        mockUnseenCounts = { a: 2, b: 3, 'group-ai-repos': 7 };
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        const badges = screen.getAllByTestId('scope-pin-unseen-badge');
        expect(badges.find(b => b.getAttribute('data-pin-id') === SHORTCUTS_PIN)!.textContent).toBe('5');
        expect(badges.find(b => b.getAttribute('data-pin-id') === AI_GROUP_PIN)!.textContent).toBe('7');
    });
});

describe('pinned segments — navigation', () => {
    it('clicking a repo pin selects a clone of that remote', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.click(pinSegment(SHORTCUTS_PIN)!);

        expect(mockSelectClone).toHaveBeenCalledWith('a');
    });

    // Regression: pin resolution hard-coded `group.repos[0]`, so clicking a
    // pinned repo tab always landed on the cluster's primary clone instead of
    // the machine you were last on.
    it('clicking a repo pin returns to the clone last used for that remote', async () => {
        mockAppState.lastCloneByRemote = { 'github.com/acme/shortcuts': 'b' };
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.click(pinSegment(SHORTCUTS_PIN)!);

        expect(mockSelectClone).toHaveBeenCalledWith('b');
    });

    it('falls back to the primary clone when the remembered one is gone', async () => {
        mockAppState.lastCloneByRemote = { 'github.com/acme/shortcuts': 'vanished' };
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.click(pinSegment(SHORTCUTS_PIN)!);

        expect(mockSelectClone).toHaveBeenCalledWith('a');
    });

    // `workspaceId` and `targetId` are the same value, so the pop-out follows
    // the remembered clone too — otherwise "Open in new window" on a pin would
    // land on a different machine than clicking it.
    it('pops a repo pin out onto the remembered clone', async () => {
        const openSpy = vi.fn().mockReturnValue({ focus: vi.fn() });
        vi.stubGlobal('open', openSpy);
        mockAppState.lastCloneByRemote = { 'github.com/acme/shortcuts': 'b' };
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.contextMenu(pinSegment(SHORTCUTS_PIN)!);
        fireEvent.click(screen.getByTestId('scope-switcher-context-open-window'));

        expect(String(openSpy.mock.calls[0][0])).toContain('window=b');
    });

    it('records the active repo as the last clone of its remote cluster', async () => {
        await renderWithPins({ repo: mockRepos[1], repos: mockRepos });

        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'RECORD_REMOTE_CLONE',
            groupKey: 'github.com/acme/shortcuts',
            cloneId: 'b',
        });
    });

    it('clicking a group pin selects the repo-group virtual workspace', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.click(pinSegment(AI_GROUP_PIN)!);

        expect(mockSelectClone).toHaveBeenCalledWith('group-ai-repos');
    });

    it('pops a group pin out from its context menu', async () => {
        const openSpy = vi.fn().mockReturnValue({ focus: vi.fn() });
        vi.stubGlobal('open', openSpy);
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.contextMenu(pinSegment(AI_GROUP_PIN)!);
        fireEvent.click(screen.getByTestId('scope-switcher-context-open-window'));

        expect(String(openSpy.mock.calls[0][0])).toContain('window=group-ai-repos');
        expect(mockSelectClone).not.toHaveBeenCalled();
    });

    it('inherits the right-click "Open in new window" menu', async () => {
        const openSpy = vi.fn().mockReturnValue({ focus: vi.fn() });
        vi.stubGlobal('open', openSpy);
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.contextMenu(pinSegment(SHORTCUTS_PIN)!);
        fireEvent.click(screen.getByTestId('scope-switcher-context-open-window'));

        expect(String(openSpy.mock.calls[0][0])).toContain('window=a');
    });
});

describe('pinned segments — active scope and the chip identity clash', () => {
    it('gives the thumb to a pinned repo whose remote is selected, not to the chip', async () => {
        mockAppState = { ...mockAppState, selectedRepoId: 'a' };
        await renderWithPins({ repo: mockRepos[0], repos: mockRepos });

        expect(pinSegment(SHORTCUTS_PIN)!.getAttribute('aria-selected')).toBe('true');
        expect(segment('workspace')!.getAttribute('aria-selected')).toBe('false');
        expect(screen.getByTestId('scope-switcher').getAttribute('data-active-pin')).toBe(SHORTCUTS_PIN);
    });

    it('collapses the chip to a bare picker trigger when a pinned repo already shows that identity', async () => {
        mockAppState = { ...mockAppState, selectedRepoId: 'a' };
        await renderWithPins({ repo: mockRepos[0], repos: mockRepos });

        const chip = screen.getByTestId('remote-chip');
        expect(chip.getAttribute('data-identity-suppressed')).toBe('true');
        // The name renders exactly once in the bar — on the pin.
        expect(chip.textContent).not.toContain('shortcuts');
        fireEvent.click(chip);
        expect(screen.getByTestId('remote-dropdown')).toBeTruthy();
        expect(mockSelectClone).not.toHaveBeenCalled();
    });

    it('gives the thumb to a pinned group and stops the chip claiming ANY identity', async () => {
        mockAppState = { ...mockAppState, selectedRepoId: 'group-ai-repos' };
        await renderWithPins({ repo: mockRepos[0], repos: mockRepos });

        expect(pinSegment(AI_GROUP_PIN)!.getAttribute('aria-selected')).toBe('true');
        expect(segment('workspace')!.getAttribute('aria-selected')).toBe('false');
        // The group name appears once, on the pin. The chip does not fall back to
        // the remembered repo either — a second name in the bar was the bug.
        const chip = screen.getByTestId('remote-chip');
        expect(chip.getAttribute('data-identity-suppressed')).toBe('true');
        expect(chip.textContent).not.toContain('shortcuts');
        expect(chip.textContent).not.toContain('ai-repos');
        expect(screen.queryByTestId('remote-chip-group-icon')).toBeNull();
    });

    it('keeps the picker reachable from the bare chevron while a pinned group is active', async () => {
        mockAppState = { ...mockAppState, selectedRepoId: 'group-ai-repos' };
        await renderWithPins({ repo: mockRepos[0], repos: mockRepos });

        // No split button any more — the single trigger opens the picker.
        expect(screen.queryByTestId('remote-chip-chevron')).toBeNull();
        fireEvent.click(screen.getByTestId('remote-chip'));

        expect(screen.getByTestId('remote-dropdown')).toBeTruthy();
        expect(mockSelectClone).not.toHaveBeenCalled();
    });

    it('drops the workspace segment pop-out and context menu while a pinned group is active', async () => {
        mockAppState = { ...mockAppState, selectedRepoId: 'group-ai-repos' };
        await renderWithPins({ repo: mockRepos[0], repos: mockRepos });

        // Scoped to the workspace segment: the `shortcuts` repo pin carries its
        // own pop-out for the same workspace id, and that one stays.
        expect(segment('workspace')!.querySelector('[data-testid="scope-segment-popout"]')).toBeNull();
        fireEvent.contextMenu(segment('workspace')!);
        expect(screen.queryByTestId('scope-switcher-context-menu')).toBeNull();
    });

    it('keeps the chip owning an UNPINNED group exactly as before', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: [SHORTCUTS_PIN] });
        mockAppState = {
            ...mockAppState,
            selectedRepoId: 'group-other',
            workspaces: [{ id: 'group-other', name: 'other-group' }],
        };
        render(<ScopeSlideSwitcher repo={mockRepos[0]} repos={mockRepos} />);
        await waitFor(() => expect(pinSegments()).toHaveLength(1));

        expect(screen.getByTestId('scope-switcher').getAttribute('data-active-scope')).toBe('group');
        expect(screen.getByTestId('scope-switcher').getAttribute('data-active-pin')).toBeNull();
        expect(segment('workspace')!.getAttribute('aria-selected')).toBe('true');
        const chip = screen.getByTestId('remote-chip');
        expect(chip.getAttribute('data-identity-suppressed')).toBeNull();
        expect(chip.textContent).toContain('other-group');
        expect(screen.getByTestId('remote-chip-group-icon').textContent).toBe('🗂️');
    });

    it('leaves a pin unselected while a virtual scope owns the thumb', async () => {
        mockAppState = { ...mockAppState, selectedRepoId: MY_WORK_WORKSPACE_ID };
        await renderWithPins({ repo: mockRepos[0], repos: mockRepos });

        expect(segment('work')!.getAttribute('aria-selected')).toBe('true');
        expect(pinSegments().every(el => el.getAttribute('aria-selected') === 'false')).toBe(true);
        // The chip is suppressed here too — My Work owns the scope.
        const chip = screen.getByTestId('remote-chip');
        expect(chip.getAttribute('data-identity-suppressed')).toBe('true');
        expect(chip.textContent).not.toContain('shortcuts');
    });

    it('leaves pins unselected off the repos tab', async () => {
        mockAppState = { ...mockAppState, selectedRepoId: 'a', activeTab: 'admin' };
        await renderWithPins({ repo: mockRepos[0], repos: mockRepos });

        expect(pinSegments().every(el => el.getAttribute('aria-selected') === 'false')).toBe(true);
    });
});

describe('pinned segments — reorder and unpin', () => {
    /** Right-click a pin and return its context menu. */
    const openPinMenu = (pinId: string) => {
        fireEvent.contextMenu(pinSegment(pinId)!);
        return screen.getByTestId('scope-switcher-context-menu');
    };

    it('moves a pin right from the context menu and persists the new order', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        openPinMenu(SHORTCUTS_PIN);
        fireEvent.click(screen.getByTestId('scope-pin-move-right'));

        expect(pinSegments().map(el => el.getAttribute('data-pin-id'))).toEqual([AI_GROUP_PIN, SHORTCUTS_PIN]);
        expect(patchGlobal).toHaveBeenCalledWith({ pinnedScopes: [AI_GROUP_PIN, SHORTCUTS_PIN] });
        // Reordering must not navigate, and it closes the menu.
        expect(mockSelectClone).not.toHaveBeenCalled();
        expect(screen.queryByTestId('scope-switcher-context-menu')).toBeNull();
    });

    it('moves a pin left from the context menu', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        openPinMenu(AI_GROUP_PIN);
        fireEvent.click(screen.getByTestId('scope-pin-move-left'));

        expect(pinSegments().map(el => el.getAttribute('data-pin-id'))).toEqual([AI_GROUP_PIN, SHORTCUTS_PIN]);
    });

    it('omits the unavailable direction on the first and last pin', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        // First pin: right only.
        openPinMenu(SHORTCUTS_PIN);
        expect(screen.queryByTestId('scope-pin-move-left')).toBeNull();
        expect(screen.getByTestId('scope-pin-move-right').getAttribute('data-pin-id')).toBe(SHORTCUTS_PIN);
        fireEvent.keyDown(document, { key: 'Escape' });

        // Last pin: left only.
        openPinMenu(AI_GROUP_PIN);
        expect(screen.queryByTestId('scope-pin-move-right')).toBeNull();
        expect(screen.getByTestId('scope-pin-move-left').getAttribute('data-pin-id')).toBe(AI_GROUP_PIN);
    });

    it('offers no reorder items when there is only one pin', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: [SHORTCUTS_PIN] });
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        openPinMenu(SHORTCUTS_PIN);

        expect(screen.queryByTestId('scope-pin-move-left')).toBeNull();
        expect(screen.queryByTestId('scope-pin-move-right')).toBeNull();
        expect(screen.getByTestId('scope-switcher-context-open-window')).toBeTruthy();
    });

    it('offers no reorder items on the non-pin segments', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.contextMenu(segment('workspace')!);

        expect(screen.getByTestId('scope-switcher-context-open-window')).toBeTruthy();
        expect(screen.queryByTestId('scope-pin-move-left')).toBeNull();
        expect(screen.queryByTestId('scope-pin-move-right')).toBeNull();
    });

    it('keeps no reorder controls inside the pin segment itself', async () => {
        // Regression: `‹`/`›` rendered as opacity-0 hover controls reserved ~40px
        // of invisible width on every pin, even when both were permanently dead.
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        for (const seg of pinSegments()) {
            expect(seg.querySelector('[data-testid="scope-pin-move-left"]')).toBeNull();
            expect(seg.querySelector('[data-testid="scope-pin-move-right"]')).toBeNull();
        }
    });

    it('keeps no inline pop-out or unpin control inside the pin segment', async () => {
        // Both moved into the context menu: a pill already carries a dot/glyph,
        // a label and an unseen badge, and two more hover icons crowded it.
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        for (const seg of pinSegments()) {
            expect(seg.querySelector('[data-testid="scope-segment-popout"]')).toBeNull();
            expect(seg.querySelector('[data-testid="scope-pin-unpin"]')).toBeNull();
        }
        // The pill itself is unchanged otherwise, and hints at the menu.
        const seg = pinSegment(SHORTCUTS_PIN)!;
        expect(seg.querySelector('span.truncate')!.textContent).toBe('shortcuts');
        expect(seg.getAttribute('title')).toContain('right-click');
    });

    // Regression guard for the pins-only scope of the move: the virtual segments
    // and the workspace identity chip keep their inline pop-out icons.
    it('leaves the pop-out icon on the virtual segments and the workspace chip', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        expect(segment('work')!.querySelector('[data-testid="scope-segment-popout"]')).toBeTruthy();
        expect(segment('life')!.querySelector('[data-testid="scope-segment-popout"]')).toBeTruthy();
        expect(segment('workspace')!.querySelector('[data-testid="scope-segment-popout"]')).toBeTruthy();
    });

    it('lists the pin menu items in order, with Unpin last behind a separator', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        const menu = openPinMenu(SHORTCUTS_PIN);
        expect([...menu.querySelectorAll('[role="menuitem"]')].map(el => el.getAttribute('data-testid')))
            .toEqual([
                'scope-switcher-context-open-window',
                'scope-pin-move-right',
                'scope-pin-context-unpin',
            ]);
        // Unpin sits behind its own separator, after the move items.
        const kids = [...menu.children];
        const unpinIdx = kids.findIndex(el => el.getAttribute('data-testid') === 'scope-pin-context-unpin');
        expect(kids[unpinIdx - 1].getAttribute('aria-hidden')).toBe('true');
        expect(kids[unpinIdx - 2].getAttribute('data-testid')).toBe('scope-pin-move-right');
    });

    it('unpins a repo pin from the context menu without navigating', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        openPinMenu(SHORTCUTS_PIN);
        fireEvent.click(screen.getByTestId('scope-pin-context-unpin'));

        expect(pinSegments().map(el => el.getAttribute('data-pin-id'))).toEqual([AI_GROUP_PIN]);
        expect(patchGlobal).toHaveBeenCalledWith({ pinnedScopes: [AI_GROUP_PIN] });
        expect(mockSelectClone).not.toHaveBeenCalled();
        expect(screen.queryByTestId('scope-switcher-context-menu')).toBeNull();
    });

    it('unpins a group pin from the context menu', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        openPinMenu(AI_GROUP_PIN);
        fireEvent.click(screen.getByTestId('scope-pin-context-unpin'));

        expect(pinSegments().map(el => el.getAttribute('data-pin-id'))).toEqual([SHORTCUTS_PIN]);
        expect(patchGlobal).toHaveBeenCalledWith({ pinnedScopes: [SHORTCUTS_PIN] });
    });

    it('offers no Unpin item on the non-pin segments', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.contextMenu(segment('workspace')!);

        expect(screen.getByTestId('scope-switcher-context-open-window')).toBeTruthy();
        expect(screen.queryByTestId('scope-pin-context-unpin')).toBeNull();
    });

    // Keyboard parity: with both icons gone the menu is the only pill-level route
    // to pop-out and unpin, so it has to be openable without a mouse.
    it('opens the pin menu with Shift+F10 and the ContextMenu key', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.keyDown(pinSegment(SHORTCUTS_PIN)!, { key: 'F10', shiftKey: true });
        expect(screen.getByTestId('scope-pin-context-unpin').getAttribute('data-pin-id')).toBe(SHORTCUTS_PIN);
        fireEvent.keyDown(document, { key: 'Escape' });

        fireEvent.keyDown(pinSegment(AI_GROUP_PIN)!, { key: 'ContextMenu' });
        expect(screen.getByTestId('scope-pin-context-unpin').getAttribute('data-pin-id')).toBe(AI_GROUP_PIN);
    });

    it('ignores a bare F10 on a pin pill', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.keyDown(pinSegment(SHORTCUTS_PIN)!, { key: 'F10' });

        expect(screen.queryByTestId('scope-switcher-context-menu')).toBeNull();
    });
});

describe('pinned segments — pinning from the picker', () => {
    it('pinning a remote row adds its segment immediately', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: [] });
        render(<ScopeSlideSwitcher repo={mockRepos[2]} repos={mockRepos} />);
        await waitFor(() => expect(screen.getByTestId('remote-chip')).toBeTruthy());

        fireEvent.click(screen.getByTestId('remote-chip'));
        const toggle = screen.getAllByTestId('scope-pin-toggle')
            .find(el => el.getAttribute('data-pin-key') === 'github.com/acme/shortcuts')!;
        expect(toggle.getAttribute('data-pin-kind')).toBe('repo');
        fireEvent.click(toggle);

        expect(patchGlobal).toHaveBeenCalledWith({ pinnedScopes: [SHORTCUTS_PIN] });
        await waitFor(() => expect(pinSegment(SHORTCUTS_PIN)).toBeTruthy());
        // Pinning must not switch scope.
        expect(mockSelectClone).not.toHaveBeenCalled();
    });

    it('pinning a repo-group row stores the workspace-id key space, not the remote one', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: [] });
        render(<ScopeSlideSwitcher repo={mockRepos[2]} repos={mockRepos} />);
        await waitFor(() => expect(screen.getByTestId('remote-chip')).toBeTruthy());

        fireEvent.click(screen.getByTestId('remote-chip'));
        const toggle = screen.getAllByTestId('scope-pin-toggle')
            .find(el => el.getAttribute('data-pin-key') === 'group-ai-repos')!;
        expect(toggle.getAttribute('data-pin-kind')).toBe('group');
        fireEvent.click(toggle);

        expect(patchGlobal).toHaveBeenCalledWith({ pinnedScopes: [AI_GROUP_PIN] });
    });

    it('marks already-pinned rows as pressed and unpins on a second click', async () => {
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        fireEvent.click(screen.getByTestId('remote-chip'));
        const toggle = screen.getAllByTestId('scope-pin-toggle')
            .find(el => el.getAttribute('data-pin-key') === 'github.com/acme/shortcuts')!;
        expect(toggle.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(toggle);

        expect(patchGlobal).toHaveBeenCalledWith({ pinnedScopes: [AI_GROUP_PIN] });
        expect(pinSegment(SHORTCUTS_PIN)).toBeUndefined();
    });

    it('shows no pin toggles at all when the feature flag is off', async () => {
        mockPinnedScopesEnabled = false;
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos }, false);

        fireEvent.click(screen.getByTestId('remote-chip'));

        expect(screen.queryAllByTestId('scope-pin-toggle')).toHaveLength(0);
        expect(screen.getAllByTestId('remote-dropdown-item').length).toBeGreaterThan(0);
    });

    it('refuses to pin past the cap, disabling the toggle on unpinned rows', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: Array.from({ length: 8 }, (_, i) => `repo:filler-${i}`) });
        render(<ScopeSlideSwitcher repo={mockRepos[2]} repos={mockRepos} />);
        await waitFor(() => expect(screen.getByTestId('remote-chip')).toBeTruthy());

        fireEvent.click(screen.getByTestId('remote-chip'));
        const toggle = screen.getAllByTestId('scope-pin-toggle')
            .find(el => el.getAttribute('data-pin-key') === 'github.com/acme/shortcuts') as HTMLButtonElement;
        expect(toggle.disabled).toBe(true);
        expect(toggle.title).toBe('Pin limit reached');
        // All eight stored pins are stale here, so nothing renders — the cap is
        // on the stored list, not on what happens to resolve.
        expect(pinSegments()).toHaveLength(0);
    });

    it('keeps the FORGE remote pinnable alongside a repo-group of a similar name', async () => {
        getGlobal.mockResolvedValue({ pinnedScopes: [FORGE_PIN, AI_GROUP_PIN] });
        await renderWithPins({ repo: mockRepos[2], repos: mockRepos });

        expect(pinSegment(FORGE_PIN)!.getAttribute('data-pin-kind')).toBe('repo');
        expect(pinSegment(AI_GROUP_PIN)!.getAttribute('data-pin-kind')).toBe('group');
    });
});
