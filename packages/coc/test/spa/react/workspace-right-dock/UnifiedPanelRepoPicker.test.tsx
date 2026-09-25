/**
 * UnifiedPanelRepoPicker — the repo scope parked on the tab strip beside "+".
 *
 * The cases here pin what the component decides on its own: it disappears for a
 * single-repo panel, it never reports a scope the dock did not accept, an
 * unavailable repo cannot be picked, and the list is fully operable from the
 * keyboard.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { UnifiedPanelRepoPicker } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelRepoPicker';
import type { DockTarget } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

const ROOT: DockTarget = { workspaceId: 'ws-root', label: 'group root' };
const A: DockTarget = { workspaceId: 'ws-a', label: 'repo-a' };
const B: DockTarget = { workspaceId: 'ws-b', label: 'repo-b' };

function renderPicker(options: {
    target?: string;
    targets?: readonly DockTarget[];
    onSelectTarget?: (id: string) => boolean;
} = {}) {
    const onSelectTarget = options.onSelectTarget ?? vi.fn(() => true);
    const view = render(
        <UnifiedPanelRepoPicker
            target={options.target ?? A.workspaceId}
            targets={options.targets ?? [ROOT, A, B]}
            onSelectTarget={onSelectTarget}
        />,
    );
    return { ...view, onSelectTarget };
}

const trigger = () => screen.getByTestId('unified-panel-repo-picker');
const openList = () => {
    fireEvent.click(trigger());
    return screen.getByTestId('unified-panel-repo-picker-list');
};

afterEach(() => cleanup());

describe('UnifiedPanelRepoPicker', () => {
    it('renders nothing when the panel has a single repo', () => {
        renderPicker({ targets: [A], target: A.workspaceId });
        expect(screen.queryByTestId('unified-panel-repo-picker')).toBeNull();
    });

    it('shows the current repo on the trigger and marks it in the list', () => {
        renderPicker({ target: B.workspaceId });
        expect(trigger().textContent).toContain('repo-b');
        expect(trigger().getAttribute('aria-expanded')).toBe('false');

        openList();
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        const current = screen.getByTestId(`unified-panel-repo-picker-option-${B.workspaceId}`);
        expect(current.getAttribute('aria-selected')).toBe('true');
        expect(current.textContent).toContain('✓');
        expect(
            screen.getByTestId(`unified-panel-repo-picker-option-${A.workspaceId}`).getAttribute('aria-selected'),
        ).toBe('false');
    });

    it('lists every target, including a group root and a disabled clone', () => {
        renderPicker({ targets: [ROOT, A, { ...B, disabled: true }] });
        openList();
        for (const id of [ROOT.workspaceId, A.workspaceId, B.workspaceId]) {
            expect(screen.getByTestId(`unified-panel-repo-picker-option-${id}`)).toBeTruthy();
        }
        expect(screen.getByTestId(`unified-panel-repo-picker-option-${B.workspaceId}`).textContent)
            .toContain('(unavailable)');
    });

    it('refuses to select an unavailable repo', () => {
        const { onSelectTarget } = renderPicker({ targets: [A, { ...B, disabled: true }] });
        openList();
        const option = screen.getByTestId(`unified-panel-repo-picker-option-${B.workspaceId}`);
        expect((option as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(option);
        expect(onSelectTarget).not.toHaveBeenCalled();
    });

    it('selects a repo, closes the list and returns focus to the trigger', () => {
        const { onSelectTarget } = renderPicker({ target: A.workspaceId });
        openList();
        fireEvent.click(screen.getByTestId(`unified-panel-repo-picker-option-${B.workspaceId}`));
        expect(onSelectTarget).toHaveBeenCalledWith(B.workspaceId);
        expect(screen.queryByTestId('unified-panel-repo-picker-list')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('keeps the label unchanged and the list open when the dock refuses the switch', () => {
        const onSelectTarget = vi.fn(() => false);
        renderPicker({ target: A.workspaceId, onSelectTarget });
        openList();
        fireEvent.click(screen.getByTestId(`unified-panel-repo-picker-option-${B.workspaceId}`));
        expect(onSelectTarget).toHaveBeenCalledWith(B.workspaceId);
        // The label is derived from `target`, never from the click, so a refused
        // switch cannot leave the trigger lying about the panel's scope.
        expect(trigger().textContent).toContain('repo-a');
        expect(screen.getByTestId('unified-panel-repo-picker-list')).toBeTruthy();
        expect(
            screen.getByTestId(`unified-panel-repo-picker-option-${A.workspaceId}`).getAttribute('aria-selected'),
        ).toBe('true');
    });

    it('closes on Escape and hands focus back to the trigger', () => {
        renderPicker();
        openList();
        fireEvent.keyDown(screen.getByTestId('unified-panel-repo-picker-list'), { key: 'Escape' });
        expect(screen.queryByTestId('unified-panel-repo-picker-list')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('closes on an outside mousedown without switching', () => {
        const { onSelectTarget } = renderPicker();
        openList();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('unified-panel-repo-picker-list')).toBeNull();
        expect(onSelectTarget).not.toHaveBeenCalled();
    });

    it('moves the cursor with the arrow keys and picks with Enter', () => {
        const { onSelectTarget } = renderPicker({ target: A.workspaceId });
        const list = openList();
        // Opens seated on the current repo (repo-a, index 1 of root/a/b).
        fireEvent.keyDown(list, { key: 'ArrowDown' });
        fireEvent.keyDown(list, { key: 'Enter' });
        expect(onSelectTarget).toHaveBeenCalledWith(B.workspaceId);
    });

    it('skips disabled repos while arrowing', () => {
        const { onSelectTarget } = renderPicker({
            target: A.workspaceId,
            targets: [A, { ...B, disabled: true }, ROOT],
        });
        const list = openList();
        fireEvent.keyDown(list, { key: 'ArrowDown' });
        fireEvent.keyDown(list, { key: 'Enter' });
        expect(onSelectTarget).toHaveBeenCalledWith(ROOT.workspaceId);
    });

    it('opens the list from the keyboard with ArrowDown on the trigger', () => {
        renderPicker();
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
        expect(screen.getByTestId('unified-panel-repo-picker-list')).toBeTruthy();
    });
});
