/** @vitest-environment jsdom */
/**
 * Regression: clicking a file in a repo group's dock Explorer used to jump the
 * app out of the group. The dock points Explorer at a MEMBER repo, and the
 * panel's `#repos/:id/explorer/:path` write reads as "select that member repo",
 * so the router swapped the whole workspace out from under the group view. The
 * dock therefore only lets the panel own the route when it targets its own
 * scope.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="mock-terminal" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId, deepLink }: { workspaceId: string; deepLink?: boolean }) => (
        <div data-testid="mock-explorer" data-workspace={workspaceId} data-deeplink={String(deepLink)} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <div data-testid="mock-notes" />,
}));

import {
    WorkspaceRightDock,
    useWorkspaceDock,
    type DockTarget,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

const GROUP_ID = 'group-ai-repos';
const MEMBERS: DockTarget[] = [
    { workspaceId: GROUP_ID, label: 'Group root', deprioritized: true },
    { workspaceId: 'repo-alpha', label: 'alpha' },
    { workspaceId: 'repo-beta', label: 'beta' },
];

function Harness({ workspaceId, targets }: { workspaceId: string; targets?: DockTarget[] }) {
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

function explorer(): HTMLElement {
    return screen.getByTestId('mock-explorer');
}

describe('WorkspaceRightDock Explorer deep-linking', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('lets a plain repo dock own the explorer route', () => {
        render(<Harness workspaceId="repo-alpha" />);
        openDock();

        expect(explorer().dataset.workspace).toBe('repo-alpha');
        expect(explorer().dataset.deeplink).toBe('true');
    });

    it('withholds the route from a repo group dock aimed at a member repo', () => {
        render(<Harness workspaceId={GROUP_ID} targets={MEMBERS} />);
        openDock();

        // The group root has no file tree, so the dock defaults to the first member.
        expect(explorer().dataset.workspace).toBe('repo-alpha');
        expect(explorer().dataset.deeplink).toBe('false');
    });

    it('keeps withholding it after switching to another member', () => {
        render(<Harness workspaceId={GROUP_ID} targets={MEMBERS} />);
        openDock();

        act(() => {
            fireEvent.change(screen.getByTestId('workspace-dock-target-picker'), {
                target: { value: 'repo-beta' },
            });
        });

        expect(explorer().dataset.workspace).toBe('repo-beta');
        expect(explorer().dataset.deeplink).toBe('false');
    });
});
