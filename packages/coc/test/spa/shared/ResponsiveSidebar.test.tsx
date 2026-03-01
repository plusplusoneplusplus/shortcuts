import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResponsiveSidebar } from '../../../src/server/spa/client/react/shared/ResponsiveSidebar';
import { mockViewport } from '../helpers/viewport-mock';

describe('ResponsiveSidebar', () => {
    let cleanup: (() => void) | undefined;

    beforeEach(() => {
        document.body.style.overflow = '';
    });

    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
    });

    // ── Desktop tests ────────────────────────────────────────────────────

    it('Desktop: renders children in inline panel', () => {
        cleanup = mockViewport(1280);
        render(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()}>
                <span>Sidebar Content</span>
            </ResponsiveSidebar>
        );
        const aside = screen.getByTestId('responsive-sidebar');
        expect(aside.tagName).toBe('ASIDE');
        expect(aside.style.width).toBe('320px');
        expect(screen.getByText('Sidebar Content')).toBeDefined();
        // No portal overlay
        expect(document.querySelector('[data-testid="sidebar-backdrop"]')).toBeNull();
    });

    it('Desktop: respects custom width prop', () => {
        cleanup = mockViewport(1280);
        render(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()} width={400}>
                Content
            </ResponsiveSidebar>
        );
        const aside = screen.getByTestId('responsive-sidebar');
        expect(aside.style.width).toBe('400px');
    });

    // ── Mobile hidden tests ──────────────────────────────────────────────

    it('Mobile: hidden when isOpen=false', () => {
        cleanup = mockViewport(375);
        render(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()}>
                Content
            </ResponsiveSidebar>
        );
        const backdrop = document.querySelector('[data-testid="sidebar-backdrop"]') as HTMLElement;
        expect(backdrop).not.toBeNull();
        expect(backdrop.classList.contains('pointer-events-none')).toBe(true);
        const drawer = document.querySelector('[data-testid="sidebar-drawer"]') as HTMLElement;
        expect(drawer.classList.contains('-translate-x-full')).toBe(true);
    });

    // ── Mobile visible tests ─────────────────────────────────────────────

    it('Mobile: visible as overlay when isOpen=true', () => {
        cleanup = mockViewport(375);
        render(
            <ResponsiveSidebar isOpen={true} onClose={vi.fn()}>
                Content
            </ResponsiveSidebar>
        );
        const backdrop = document.querySelector('[data-testid="sidebar-backdrop"]') as HTMLElement;
        expect(backdrop).not.toBeNull();
        expect(backdrop.classList.contains('bg-black/50')).toBe(true);
        const drawer = document.querySelector('[data-testid="sidebar-drawer"]') as HTMLElement;
        expect(drawer.style.zIndex).toBe('9001');
    });

    it('Mobile: children rendered inside drawer', () => {
        cleanup = mockViewport(375);
        render(
            <ResponsiveSidebar isOpen={true} onClose={vi.fn()}>
                <span>child content</span>
            </ResponsiveSidebar>
        );
        const drawer = document.querySelector('[data-testid="sidebar-drawer"]') as HTMLElement;
        expect(drawer).not.toBeNull();
        expect(screen.getByText('child content')).toBeDefined();
        // Child is inside the drawer
        expect(drawer.contains(screen.getByText('child content'))).toBe(true);
    });

    it('Mobile: backdrop click calls onClose', () => {
        cleanup = mockViewport(375);
        const onClose = vi.fn();
        render(
            <ResponsiveSidebar isOpen={true} onClose={onClose}>
                Content
            </ResponsiveSidebar>
        );
        const backdrop = document.querySelector('[data-testid="sidebar-backdrop"]') as HTMLElement;
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('Mobile: drawer width is 85vw / max 360px', () => {
        cleanup = mockViewport(375);
        render(
            <ResponsiveSidebar isOpen={true} onClose={vi.fn()}>
                Content
            </ResponsiveSidebar>
        );
        const drawer = document.querySelector('[data-testid="sidebar-drawer"]') as HTMLElement;
        expect(drawer.classList.contains('w-[85vw]')).toBe(true);
        expect(drawer.classList.contains('max-w-[360px]')).toBe(true);
    });

    it('Mobile: slide-in animation class present when open', () => {
        cleanup = mockViewport(375);
        render(
            <ResponsiveSidebar isOpen={true} onClose={vi.fn()}>
                Content
            </ResponsiveSidebar>
        );
        const drawer = document.querySelector('[data-testid="sidebar-drawer"]') as HTMLElement;
        expect(drawer.classList.contains('translate-x-0')).toBe(true);
        expect(drawer.classList.contains('-translate-x-full')).toBe(false);
    });

    // ── Tablet tests ─────────────────────────────────────────────────────

    it('Tablet: renders at tabletWidth', () => {
        cleanup = mockViewport(900);
        render(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()} tabletWidth={260}>
                Content
            </ResponsiveSidebar>
        );
        const aside = screen.getByTestId('responsive-sidebar');
        expect(aside.style.width).toBe('260px');
    });

    it('Tablet: renders at default 260px without prop', () => {
        cleanup = mockViewport(900);
        render(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()}>
                Content
            </ResponsiveSidebar>
        );
        const aside = screen.getByTestId('responsive-sidebar');
        expect(aside.style.width).toBe('260px');
    });

    // ── Swipe tests ──────────────────────────────────────────────────────

    it('Swipe dismiss: calls onClose on left swipe', () => {
        cleanup = mockViewport(375);
        const onClose = vi.fn();
        render(
            <ResponsiveSidebar isOpen={true} onClose={onClose}>
                Content
            </ResponsiveSidebar>
        );
        const drawer = document.querySelector('[data-testid="sidebar-drawer"]') as HTMLElement;

        fireEvent.touchStart(drawer, { touches: [{ clientX: 200, clientY: 300 }] });
        fireEvent.touchMove(drawer, { touches: [{ clientX: 130, clientY: 300 }] });
        fireEvent.touchEnd(drawer, { changedTouches: [{ clientX: 130, clientY: 300 }] });

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('Swipe dismiss: no dismiss on short swipe', () => {
        cleanup = mockViewport(375);
        const onClose = vi.fn();
        render(
            <ResponsiveSidebar isOpen={true} onClose={onClose}>
                Content
            </ResponsiveSidebar>
        );
        const drawer = document.querySelector('[data-testid="sidebar-drawer"]') as HTMLElement;

        fireEvent.touchStart(drawer, { touches: [{ clientX: 200, clientY: 300 }] });
        fireEvent.touchMove(drawer, { touches: [{ clientX: 180, clientY: 300 }] });
        fireEvent.touchEnd(drawer, { changedTouches: [{ clientX: 180, clientY: 300 }] });

        expect(onClose).not.toHaveBeenCalled();
    });

    it('Swipe dismiss: no dismiss on vertical swipe', () => {
        cleanup = mockViewport(375);
        const onClose = vi.fn();
        render(
            <ResponsiveSidebar isOpen={true} onClose={onClose}>
                Content
            </ResponsiveSidebar>
        );
        const drawer = document.querySelector('[data-testid="sidebar-drawer"]') as HTMLElement;

        fireEvent.touchStart(drawer, { touches: [{ clientX: 200, clientY: 300 }] });
        fireEvent.touchMove(drawer, { touches: [{ clientX: 140, clientY: 350 }] });
        fireEvent.touchEnd(drawer, { changedTouches: [{ clientX: 140, clientY: 350 }] });

        expect(onClose).not.toHaveBeenCalled();
    });

    // ── Body scroll lock tests ───────────────────────────────────────────

    it('Body scroll lock on mobile open', () => {
        cleanup = mockViewport(375);
        render(
            <ResponsiveSidebar isOpen={true} onClose={vi.fn()}>
                Content
            </ResponsiveSidebar>
        );
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('Body scroll restored on close', () => {
        cleanup = mockViewport(375);
        const { rerender } = render(
            <ResponsiveSidebar isOpen={true} onClose={vi.fn()}>
                Content
            </ResponsiveSidebar>
        );
        expect(document.body.style.overflow).toBe('hidden');

        rerender(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()}>
                Content
            </ResponsiveSidebar>
        );
        expect(document.body.style.overflow).toBe('');
    });

    // ── Z-index tests ────────────────────────────────────────────────────

    it('Z-index below Dialog', () => {
        cleanup = mockViewport(375);
        render(
            <ResponsiveSidebar isOpen={true} onClose={vi.fn()}>
                Content
            </ResponsiveSidebar>
        );
        const backdrop = document.querySelector('[data-testid="sidebar-backdrop"]') as HTMLElement;
        const drawer = document.querySelector('[data-testid="sidebar-drawer"]') as HTMLElement;
        expect(backdrop.style.zIndex).toBe('9000');
        expect(drawer.style.zIndex).toBe('9001');
        // Both below Dialog's 10002
        expect(parseInt(backdrop.style.zIndex)).toBeLessThan(10002);
        expect(parseInt(drawer.style.zIndex)).toBeLessThan(10002);
    });

    // ── className forwarding ─────────────────────────────────────────────

    it('Extra className forwarded on desktop', () => {
        cleanup = mockViewport(1280);
        render(
            <ResponsiveSidebar isOpen={false} onClose={vi.fn()} className="my-extra">
                Content
            </ResponsiveSidebar>
        );
        const aside = screen.getByTestId('responsive-sidebar');
        expect(aside.classList.contains('my-extra')).toBe(true);
    });
});
