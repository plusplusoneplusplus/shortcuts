/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContainerCompact } from '../../../../src/server/spa/client/react/hooks/ui/useContainerCompact';
import { WorkspaceDockToggle, workspaceDockOpenStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: true }) }));
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

describe('responsive resource panel access', () => {
    it('shows a mobile panel control and closes the full-width presentation with one tap', () => {
        render(<WorkspaceDockToggle workspaceId="repo-a" />);
        const button = screen.getByRole('button', { name: 'Show right panel' });
        expect(button.className.split(' ')).not.toContain('hidden');
        fireEvent.click(button);
        expect(localStorage.getItem(workspaceDockOpenStorageKey('repo-a'))).toBe('1');
        fireEvent.click(screen.getByRole('button', { name: 'Hide right panel' }));
        expect(localStorage.getItem(workspaceDockOpenStorageKey('repo-a'))).toBe('0');
    });
    it('uses panel width to select compact list/detail on desktop and restores the split when widened', async () => {
        let resized = () => {};
        vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
        function View() {
            const { ref, compact } = useContainerCompact(false);
            return <div ref={ref} data-testid="surface" data-compact={String(compact)} />;
        }
        render(<View />);
        const surface = screen.getByTestId('surface');
        Object.defineProperty(surface, 'clientWidth', { configurable: true, value: 420 });
        act(() => resized());
        await waitFor(() => expect(surface).toHaveAttribute('data-compact', 'true'));
        Object.defineProperty(surface, 'clientWidth', { configurable: true, value: 1000 });
        act(() => resized());
        await waitFor(() => expect(surface).toHaveAttribute('data-compact', 'false'));
    });
});
