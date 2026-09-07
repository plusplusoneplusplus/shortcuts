/** @vitest-environment jsdom */
/**
 * `useWorkspaceDock` — the right panel's state controller, exercised on its own.
 *
 * The interesting behavior here is TARGET resolution: a repo group hands the
 * panel a list of workspaces its terminals and file resources can point at,
 * while the panel's own state (open / width / target) stays scoped to the group.
 * Covers the `targets` option and its default/persistence/fallback rules, and
 * the unsaved-edit guard that runs before a switch.
 *
 * These cases used to run through the deleted legacy dock body; the
 * rules they pin live entirely in the controller, so they render the hook
 * directly rather than a panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import {
    useWorkspaceDock,
    type WorkspaceDockController,
} from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';
import {
    workspaceDockTargetStorageKey,
    workspaceDockWidthStorageKey,
    type DockTarget,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';
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

/**
 * Renders the hook and exposes the live controller. Kept as a component (rather
 * than `renderHook`) so a rerender with new `targets` goes through the same
 * effect path a real caller's in-flight fetch does.
 */
let dock: WorkspaceDockController;

function Harness({ workspaceId = GROUP_ID, targets }: { workspaceId?: string; targets?: DockTarget[] }) {
    dock = useWorkspaceDock(workspaceId, targets);
    return <div data-testid="target">{dock.target}</div>;
}

function target(): string {
    return screen.getByTestId('target').textContent!;
}

function pick(workspaceId: string) {
    act(() => {
        dock.setTarget(workspaceId);
    });
}

describe('useWorkspaceDock target selection', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // --- absent `targets` is a strict no-op ---------------------------------

    it('targets its own workspace and writes nothing without `targets`', () => {
        render(<Harness workspaceId="ws1" />);

        expect(target()).toBe('ws1');
        expect(dock.targets).toEqual([]);
        // Nothing is persisted under the target key for a plain repo panel.
        expect(localStorage.getItem(workspaceDockTargetStorageKey('ws1'))).toBeNull();
    });

    // --- selection, default, persistence, fallback --------------------------

    it('offers every target and defaults to the first enabled one', () => {
        render(<Harness targets={MEMBERS} />);

        expect(dock.targets).toEqual(MEMBERS);
        // D-07: the group root holds only group.json, so the default is the first
        // MEMBER, not the group itself.
        expect(target()).toBe('repo-alpha');
    });

    it('persists an explicit pick under the group-scoped target key', () => {
        render(<Harness targets={MEMBERS} />);
        pick('repo-beta');

        expect(target()).toBe('repo-beta');
        expect(localStorage.getItem(workspaceDockTargetStorageKey(GROUP_ID))).toBe('repo-beta');
    });

    it('restores a persisted target on remount', () => {
        localStorage.setItem(workspaceDockTargetStorageKey(GROUP_ID), 'repo-beta');
        render(<Harness targets={MEMBERS} />);

        expect(target()).toBe('repo-beta');
    });

    it('falls back to the first enabled target when the persisted one is gone', () => {
        localStorage.setItem(workspaceDockTargetStorageKey(GROUP_ID), 'repo-removed');
        render(<Harness targets={MEMBERS} />);

        expect(target()).toBe('repo-alpha');
    });

    it('never auto-selects a disabled target, even a persisted one', () => {
        const stale: DockTarget[] = [
            { workspaceId: GROUP_ID, label: 'Group root', deprioritized: true },
            { workspaceId: 'repo-alpha', label: 'alpha (path missing)', disabled: true },
            { workspaceId: 'repo-beta', label: 'beta' },
        ];
        localStorage.setItem(workspaceDockTargetStorageKey(GROUP_ID), 'repo-alpha');
        render(<Harness targets={stale} />);

        expect(target()).toBe('repo-beta');
    });

    it('falls back to the deprioritized group root when it is the only option left (D-07)', () => {
        render(<Harness targets={[
            { workspaceId: GROUP_ID, label: 'Group root', deprioritized: true },
            { workspaceId: 'repo-alpha', label: 'alpha (removed)', disabled: true },
        ]} />);

        expect(target()).toBe(GROUP_ID);
    });

    it('targets its own scope when every option is disabled', () => {
        render(<Harness targets={[{ workspaceId: 'repo-alpha', label: 'alpha', disabled: true }]} />);

        expect(target()).toBe(GROUP_ID);
    });

    it('re-resolves once the target list arrives (fetch in flight → members)', () => {
        const { rerender } = render(<Harness />);
        expect(target()).toBe(GROUP_ID);

        act(() => {
            rerender(<Harness targets={MEMBERS} />);
        });
        expect(target()).toBe('repo-alpha');
    });

    // --- the panel's own state is scoped, not targeted ----------------------

    it('keeps the scope-owned width across a target switch', () => {
        localStorage.setItem(workspaceDockWidthStorageKey(GROUP_ID), '520');
        render(<Harness targets={MEMBERS} />);
        expect(dock.width).toBe(520);

        pick('repo-beta');

        expect(target()).toBe('repo-beta');
        expect(dock.width).toBe(520);
        // The width stays stored against the GROUP, not the member.
        expect(localStorage.getItem(workspaceDockWidthStorageKey('repo-beta'))).toBeNull();
    });

    // --- the unsaved-edit guard --------------------------------------------

    describe('unsaved Explorer edits', () => {
        afterEach(() => {
            clearExplorerDirty('repo-alpha');
        });

        it('cancels the switch when the user declines to discard', () => {
            render(<Harness targets={MEMBERS} />);
            setExplorerInstanceDirty('repo-alpha', 'editor-1', true);
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

            pick('repo-beta');

            expect(confirmSpy).toHaveBeenCalled();
            expect(target()).toBe('repo-alpha');
            expect(localStorage.getItem(workspaceDockTargetStorageKey(GROUP_ID))).toBeNull();
        });

        it('switches when the user confirms the discard', () => {
            render(<Harness targets={MEMBERS} />);
            setExplorerInstanceDirty('repo-alpha', 'editor-1', true);
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

            pick('repo-beta');

            expect(confirmSpy).toHaveBeenCalled();
            expect(target()).toBe('repo-beta');
            expect(localStorage.getItem(workspaceDockTargetStorageKey(GROUP_ID))).toBe('repo-beta');
        });

        it('does not prompt when nothing is dirty', () => {
            render(<Harness targets={MEMBERS} />);
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

            pick('repo-beta');

            expect(confirmSpy).not.toHaveBeenCalled();
            expect(target()).toBe('repo-beta');
        });
    });
});
