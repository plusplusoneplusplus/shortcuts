/**
 * Tests for ResponsiveSidebar shared component.
 *
 * In jsdom, window.matchMedia is undefined, so useBreakpoint returns
 * its DEFAULT_STATE: { isMobile: false, isTablet: false, isDesktop: true }.
 * Therefore ResponsiveSidebar renders as an <aside> (inline, not drawer mode).
 *
 * For mobile drawer tests, we mock useBreakpoint to return isMobile=true.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResponsiveSidebar } from '../../../../src/server/spa/client/react/ui/ResponsiveSidebar';

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: vi.fn(() => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' })),
}));

import { useBreakpoint } from '../../../../src/server/spa/client/react/hooks/ui/useBreakpoint';

afterEach(() => {
    (useBreakpoint as ReturnType<typeof vi.fn>).mockReturnValue({
        isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop',
    });
});

describe('ResponsiveSidebar — desktop mode', () => {
    it('renders as aside (inline) in desktop mode', () => {
        render(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()}>
                <div>Sidebar content</div>
            </ResponsiveSidebar>
        );
        expect(screen.getByTestId('responsive-sidebar')).toBeTruthy();
        expect(screen.getByText('Sidebar content')).toBeTruthy();
    });

    it('applies the specified width in desktop mode', () => {
        render(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()} width={400}>
                <div>Content</div>
            </ResponsiveSidebar>
        );
        const aside = screen.getByTestId('responsive-sidebar') as HTMLElement;
        expect(aside.style.width).toBe('400px');
    });

    it('applies tabletWidth when isTablet', () => {
        (useBreakpoint as ReturnType<typeof vi.fn>).mockReturnValue({
            isMobile: false, isTablet: true, isDesktop: false, breakpoint: 'tablet',
        });
        render(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()} tabletWidth={200}>
                <div>Content</div>
            </ResponsiveSidebar>
        );
        const aside = screen.getByTestId('responsive-sidebar') as HTMLElement;
        expect(aside.style.width).toBe('200px');
    });
});

describe('ResponsiveSidebar — mobile drawer mode', () => {
    beforeEach(() => {
        (useBreakpoint as ReturnType<typeof vi.fn>).mockReturnValue({
            isMobile: true, isTablet: false, isDesktop: false, breakpoint: 'mobile',
        });
    });

    it('renders portal drawer in mobile mode', () => {
        render(
            <ResponsiveSidebar isOpen={true} onClose={vi.fn()}>
                <div>Mobile content</div>
            </ResponsiveSidebar>
        );
        expect(screen.getByTestId('sidebar-backdrop')).toBeTruthy();
        expect(screen.getByTestId('sidebar-drawer')).toBeTruthy();
        expect(screen.getByText('Mobile content')).toBeTruthy();
    });

    it('calls onClose when backdrop is clicked', () => {
        const onClose = vi.fn();
        render(
            <ResponsiveSidebar isOpen={true} onClose={onClose}>
                <div>Content</div>
            </ResponsiveSidebar>
        );
        fireEvent.click(screen.getByTestId('sidebar-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Escape is pressed inside drawer', () => {
        const onClose = vi.fn();
        render(
            <ResponsiveSidebar isOpen={true} onClose={onClose}>
                <div>Content</div>
            </ResponsiveSidebar>
        );
        fireEvent.keyDown(screen.getByTestId('sidebar-backdrop'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
