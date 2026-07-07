/**
 * GlobalStatusDock — the app-wide bottom status bar for the remote-first shell.
 *
 * It renders the shared `StatusActions` sidebar variant across every tab, but
 * only in the remote-first shell on desktop. Off (classic mode) or on mobile it
 * renders nothing, so the topbar keeps hosting the cluster.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockRemoteShell = true;
let mockIsMobile = false;
let lastStatusActionsProps: Record<string, unknown> | null = null;

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShell,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: mockIsMobile ? 'mobile' : 'desktop', isMobile: mockIsMobile, isTablet: false, isDesktop: !mockIsMobile }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/StatusActions', () => ({
    StatusActions: (props: Record<string, unknown>) => {
        lastStatusActionsProps = props;
        return <div data-testid="status-actions" data-variant={String(props.variant)} />;
    },
}));

import { GlobalStatusDock } from '../../../../src/server/spa/client/react/layout/GlobalStatusDock';

beforeEach(() => {
    mockRemoteShell = true;
    mockIsMobile = false;
    lastStatusActionsProps = null;
});

describe('GlobalStatusDock', () => {
    it('renders the sidebar StatusActions variant when the remote shell is on (desktop)', () => {
        render(<GlobalStatusDock />);
        const dock = screen.getByTestId('status-actions');
        expect(dock).toBeTruthy();
        expect(dock.getAttribute('data-variant')).toBe('sidebar');
    });

    it('constrains its width to the left sidebar column (not full width)', () => {
        render(<GlobalStatusDock />);
        const wrapper = screen.getByTestId('global-status-dock');
        // Tracks the live left-column width, falling back to the panel default.
        expect(wrapper.style.width).toContain('--workspace-left-col-width');
        expect(wrapper.style.width).toContain('360px');
        expect(wrapper.className).toContain('flex-shrink-0');
    });

    it('forwards onAdminOpen to StatusActions', () => {
        const onAdminOpen = vi.fn();
        render(<GlobalStatusDock onAdminOpen={onAdminOpen} />);
        expect(lastStatusActionsProps?.onAdminOpen).toBe(onAdminOpen);
    });

    it('renders nothing when the remote shell is off (classic mode keeps the topbar cluster)', () => {
        mockRemoteShell = false;
        const { container } = render(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on mobile (no room for a bottom status bar)', () => {
        mockIsMobile = true;
        const { container } = render(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });
});
