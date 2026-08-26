/** @vitest-environment jsdom */
/**
 * The dock's target picker: a repo group gives the dock a list of workspaces its
 * Terminal and Explorer can point at, while the dock's own state (open / active
 * view / width) stays scoped to the group. Covers AC-01 (the optional `targets`
 * prop and its persistence/fallback rules), AC-03 (the unsaved-edit guard on a
 * switch) and AC-04 (only Terminal + Explorer follow the picker; Notes does not).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-terminal">terminal:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-explorer">explorer:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-notes">notes:{workspaceId}</div>
    ),
}));

import {
    WorkspaceRightDock,
    useWorkspaceDock,
    workspaceDockTargetStorageKey,
    workspaceDockViewStorageKey,
    workspaceDockWidthStorageKey,
    type DockTarget,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';
import {
    setExplorerInstanceDirty,
    clearExplorerDirty,
} from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';

const GROUP_ID = 'group-ai-repos';
const MEMBERS: DockTarget[] = [
    { workspaceId: GROUP_ID, label: 'Group root', deprioritized: true },
    { workspaceId: 'repo-alpha', label: 'alpha' },
    { workspaceId: 'repo-beta', label: 'beta' },
];

function Harness({ workspaceId = GROUP_ID, targets }: { workspaceId?: string; targets?: DockTarget[] }) {
    const dock = useWorkspaceDock(workspaceId, targets);
    return (
        <div>
            <button data-testid="ext-toggle" onClick={dock.toggleOpen}>toggle</button>
            <WorkspaceRightDock workspaceId={workspaceId} dock={dock} targets={targets} />
        </div>
    );
}

function openDock() {
    act(() => {
        fireEvent.click(screen.getByTestId('ext-toggle'));
    });
}

function picker(): HTMLSelectElement {
    return screen.getByTestId('workspace-dock-target-picker') as HTMLSelectElement;
}

function pick(workspaceId: string) {
    act(() => {
        fireEvent.change(picker(), { target: { value: workspaceId } });
    });
}

describe('WorkspaceRightDock target picker', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // --- AC-01: absent `targets` is a strict no-op --------------------------

    it('renders no picker and targets its own workspace without `targets` (AC-01)', () => {
        render(<Harness workspaceId="ws1" />);
        openDock();

        expect(screen.queryByTestId('workspace-dock-target-picker')).toBeNull();
        expect(screen.getByTestId('mock-terminal').textContent).toBe('terminal:ws1');
        expect(screen.getByTestId('mock-explorer').textContent).toBe('explorer:ws1');
        expect(screen.getByTestId('mock-notes').textContent).toBe('notes:ws1');
        // Nothing is persisted under the target key for a plain repo dock.
        expect(localStorage.getItem(workspaceDockTargetStorageKey('ws1'))).toBeNull();
    });

    // --- AC-01: selection, default, persistence, fallback -------------------

    it('lists every target and defaults to the first enabled one (AC-01)', () => {
        render(<Harness targets={MEMBERS} />);
        openDock();

        const options = Array.from(picker().options).map(o => [o.value, o.text, o.disabled]);
        expect(options).toEqual([
            [GROUP_ID, 'Group root', false],
            ['repo-alpha', 'alpha', false],
            ['repo-beta', 'beta', false],
        ]);
        // D-07: the group root holds only group.json, so the default is the first
        // MEMBER, not the group itself.
        expect(picker().value).toBe('repo-alpha');
    });

    it('persists an explicit pick under the group-scoped target key (AC-01)', () => {
        render(<Harness targets={MEMBERS} />);
        openDock();
        pick('repo-beta');

        expect(picker().value).toBe('repo-beta');
        expect(localStorage.getItem(workspaceDockTargetStorageKey(GROUP_ID))).toBe('repo-beta');
    });

    it('restores a persisted target on remount (AC-01)', () => {
        localStorage.setItem(workspaceDockTargetStorageKey(GROUP_ID), 'repo-beta');
        render(<Harness targets={MEMBERS} />);
        openDock();

        expect(picker().value).toBe('repo-beta');
        expect(screen.getByTestId('mock-terminal').textContent).toBe('terminal:repo-beta');
    });

    it('falls back to the first enabled target when the persisted one is gone (AC-01)', () => {
        localStorage.setItem(workspaceDockTargetStorageKey(GROUP_ID), 'repo-removed');
        render(<Harness targets={MEMBERS} />);
        openDock();

        expect(picker().value).toBe('repo-alpha');
    });

    it('never auto-selects a disabled target and marks it unselectable (AC-01)', () => {
        const stale: DockTarget[] = [
            { workspaceId: GROUP_ID, label: 'Group root', deprioritized: true },
            { workspaceId: 'repo-alpha', label: 'alpha (path missing)', disabled: true },
            { workspaceId: 'repo-beta', label: 'beta' },
        ];
        // Even persisted, a disabled target is skipped.
        localStorage.setItem(workspaceDockTargetStorageKey(GROUP_ID), 'repo-alpha');
        render(<Harness targets={stale} />);
        openDock();

        expect(picker().value).toBe('repo-beta');
        const staleOption = Array.from(picker().options).find(o => o.value === 'repo-alpha')!;
        expect(staleOption.disabled).toBe(true);
    });

    it('falls back to the deprioritized group root when it is the only option left (D-07)', () => {
        render(<Harness targets={[
            { workspaceId: GROUP_ID, label: 'Group root', deprioritized: true },
            { workspaceId: 'repo-alpha', label: 'alpha (removed)', disabled: true },
        ]} />);
        openDock();

        expect(picker().value).toBe(GROUP_ID);
    });

    it('targets its own scope when every option is disabled (AC-01)', () => {
        render(<Harness targets={[{ workspaceId: 'repo-alpha', label: 'alpha', disabled: true }]} />);
        openDock();

        expect(screen.getByTestId('mock-terminal').textContent).toBe(`terminal:${GROUP_ID}`);
    });

    it('re-resolves once the target list arrives (fetch in flight → members) (AC-01)', () => {
        const { rerender } = render(<Harness />);
        openDock();
        // No picker while the group detail request is in flight.
        expect(screen.queryByTestId('workspace-dock-target-picker')).toBeNull();
        expect(screen.getByTestId('mock-terminal').textContent).toBe(`terminal:${GROUP_ID}`);

        act(() => {
            rerender(<Harness targets={MEMBERS} />);
        });
        expect(picker().value).toBe('repo-alpha');
        expect(screen.getByTestId('mock-terminal').textContent).toBe('terminal:repo-alpha');
    });

    // --- AC-05/D-05: available views follow the target ----------------------

    it('offers Explorer for a member target and drops it for the group root (D-05)', () => {
        render(<Harness targets={MEMBERS} />);
        openDock();

        expect(screen.getByTestId('workspace-dock-view-explorer')).toBeTruthy();

        pick(GROUP_ID);
        // Group root has no repository root → Explorer tab and mount both go away.
        expect(screen.queryByTestId('workspace-dock-view-explorer')).toBeNull();
        expect(screen.queryByTestId('mock-explorer')).toBeNull();
        expect(screen.getByTestId('workspace-dock-view-terminal')).toBeTruthy();
        expect(screen.getByTestId('workspace-dock-view-notes')).toBeTruthy();
    });

    it('clamps an active Explorer view back to Terminal on switching to the group root (D-05)', () => {
        render(<Harness targets={MEMBERS} />);
        openDock();
        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-view-explorer'));
        });
        expect(screen.getByTestId('workspace-dock-explorer').style.display).toBe('');

        pick(GROUP_ID);
        expect(screen.getByTestId('workspace-dock-terminal').style.display).toBe('');
    });

    // --- AC-04: what follows the picker, and what does not ------------------

    it('re-points Terminal and Explorer but not Notes (AC-04)', () => {
        render(<Harness targets={MEMBERS} />);
        openDock();

        expect(screen.getByTestId('mock-terminal').textContent).toBe('terminal:repo-alpha');
        expect(screen.getByTestId('mock-explorer').textContent).toBe('explorer:repo-alpha');
        // D-04: notes belong to the GROUP, so they stay on the scope.
        expect(screen.getByTestId('mock-notes').textContent).toBe(`notes:${GROUP_ID}`);

        pick('repo-beta');

        expect(screen.getByTestId('mock-terminal').textContent).toBe('terminal:repo-beta');
        expect(screen.getByTestId('mock-explorer').textContent).toBe('explorer:repo-beta');
        expect(screen.getByTestId('mock-notes').textContent).toBe(`notes:${GROUP_ID}`);
    });

    it('keeps the dock open, sized and on its view across a target switch (D-01)', () => {
        localStorage.setItem(workspaceDockWidthStorageKey(GROUP_ID), '520');
        render(<Harness targets={MEMBERS} />);
        openDock();
        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-view-notes'));
        });

        pick('repo-beta');

        const dockEl = screen.getByTestId('workspace-right-dock');
        expect(dockEl.getAttribute('data-open')).toBe('true');
        expect(screen.getByTestId('workspace-dock-body').style.width).toBe('520px');
        expect(screen.getByTestId('workspace-dock-notes').style.display).toBe('');
        // The view preference is still stored against the GROUP, not the member.
        expect(localStorage.getItem(workspaceDockViewStorageKey(GROUP_ID))).toBe('notes');
    });

    // --- AC-02: the picker lives in the single-row header -------------------

    it('renders the picker inside the dock header row (AC-02)', () => {
        render(<Harness targets={MEMBERS} />);
        openDock();

        const header = screen.getByTestId('workspace-dock-header');
        expect(within(header).getByTestId('workspace-dock-target-picker')).toBeTruthy();
        expect(within(header).getByTestId('workspace-dock-view-switcher')).toBeTruthy();
        // The row keeps its single-row height.
        expect(header.className).toContain('h-[35px]');
    });

    // --- AC-03: the unsaved-edit guard -------------------------------------

    describe('unsaved Explorer edits (AC-03)', () => {
        afterEach(() => {
            clearExplorerDirty('repo-alpha');
        });

        it('cancels the switch when the user declines to discard', () => {
            render(<Harness targets={MEMBERS} />);
            openDock();
            setExplorerInstanceDirty('repo-alpha', 'editor-1', true);
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

            pick('repo-beta');

            expect(confirmSpy).toHaveBeenCalled();
            expect(picker().value).toBe('repo-alpha');
            expect(screen.getByTestId('mock-terminal').textContent).toBe('terminal:repo-alpha');
            expect(localStorage.getItem(workspaceDockTargetStorageKey(GROUP_ID))).toBeNull();
        });

        it('switches when the user confirms the discard', () => {
            render(<Harness targets={MEMBERS} />);
            openDock();
            setExplorerInstanceDirty('repo-alpha', 'editor-1', true);
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

            pick('repo-beta');

            expect(confirmSpy).toHaveBeenCalled();
            expect(picker().value).toBe('repo-beta');
            expect(localStorage.getItem(workspaceDockTargetStorageKey(GROUP_ID))).toBe('repo-beta');
        });

        it('does not prompt when nothing is dirty', () => {
            render(<Harness targets={MEMBERS} />);
            openDock();
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

            pick('repo-beta');

            expect(confirmSpy).not.toHaveBeenCalled();
            expect(picker().value).toBe('repo-beta');
        });
    });
});
