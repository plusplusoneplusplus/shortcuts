import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from '../../../src/server/spa/client/react/shared/Dialog';
import { mockViewport } from '../helpers/viewport-mock';

describe('Dialog responsive layout', () => {
    let viewportCleanup: (() => void) | undefined;

    afterEach(() => {
        viewportCleanup?.();
        viewportCleanup = undefined;
    });

    it('renders full-screen on mobile viewport (no flex centering)', () => {
        viewportCleanup = mockViewport(375);
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test">
                <p>Content</p>
            </Dialog>
        );
        const overlay = document.querySelector('[data-testid="dialog-overlay"]') as HTMLElement;
        expect(overlay).not.toBeNull();
        expect(overlay.className).not.toContain('flex items-center justify-center');
        expect(overlay.className).toContain('bg-white');
    });

    it('mobile panel has w-full h-full', () => {
        viewportCleanup = mockViewport(375);
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test">
                <p>Content</p>
            </Dialog>
        );
        const overlay = document.querySelector('[data-testid="dialog-overlay"]') as HTMLElement;
        const panel = overlay.querySelector(':scope > div') as HTMLElement;
        expect(panel.className).toContain('w-full');
        expect(panel.className).toContain('h-full');
    });

    it('renders centered with backdrop on desktop viewport', () => {
        viewportCleanup = mockViewport(1280);
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test">
                <p>Content</p>
            </Dialog>
        );
        const overlay = document.querySelector('[data-testid="dialog-overlay"]') as HTMLElement;
        expect(overlay.className).toContain('flex');
        expect(overlay.className).toContain('items-center');
        expect(overlay.className).toContain('justify-center');
        expect(overlay.className).toContain('bg-black/40');
    });

    it('desktop panel has max-w-lg rounded-lg', () => {
        viewportCleanup = mockViewport(1280);
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test">
                <p>Content</p>
            </Dialog>
        );
        const overlay = document.querySelector('[data-testid="dialog-overlay"]') as HTMLElement;
        const panel = overlay.querySelector(':scope > div') as HTMLElement;
        expect(panel.className).toContain('max-w-lg');
        expect(panel.className).toContain('rounded-lg');
    });

    it('close button always visible on mobile even when disableClose is true', () => {
        viewportCleanup = mockViewport(375);
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test" disableClose={true}>
                Content
            </Dialog>
        );
        const btn = document.querySelector('[data-testid="dialog-close-btn"]') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        // On mobile, disableClose is overridden — close button should be enabled
        expect(btn.disabled).toBe(false);
        expect(btn.className).not.toContain('pointer-events-none');
    });

    it('close button is disabled on desktop when disableClose is true', () => {
        viewportCleanup = mockViewport(1280);
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test" disableClose={true}>
                Content
            </Dialog>
        );
        const btn = document.querySelector('[data-testid="dialog-close-btn"]') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.disabled).toBe(true);
        expect(btn.className).toContain('pointer-events-none');
    });

    it('backdrop click does not fire onClose on mobile', () => {
        viewportCleanup = mockViewport(375);
        const onClose = vi.fn();
        render(
            <Dialog open={true} onClose={onClose} title="Test">
                Content
            </Dialog>
        );
        const overlay = document.querySelector('[data-testid="dialog-overlay"]') as HTMLElement;
        fireEvent.click(overlay);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('backdrop click fires onClose on desktop', () => {
        viewportCleanup = mockViewport(1280);
        const onClose = vi.fn();
        render(
            <Dialog open={true} onClose={onClose} title="Test">
                Content
            </Dialog>
        );
        const overlay = document.querySelector('[data-testid="dialog-overlay"]') as HTMLElement;
        fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('mobile panel uses overflow-hidden (not overflow-y-auto) to enable flex fill', () => {
        viewportCleanup = mockViewport(375);
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test">
                <p>Content</p>
            </Dialog>
        );
        const overlay = document.querySelector('[data-testid="dialog-overlay"]') as HTMLElement;
        const panel = overlay.querySelector(':scope > div') as HTMLElement;
        expect(panel.className).toContain('overflow-hidden');
        expect(panel.className).not.toContain('overflow-y-auto');
    });

    it('mobile children wrapper has flex-1 min-h-0 for conversation fill', () => {
        viewportCleanup = mockViewport(375);
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test">
                <p data-testid="child-content">Content</p>
            </Dialog>
        );
        const childContent = document.querySelector('[data-testid="child-content"]') as HTMLElement;
        const wrapper = childContent.parentElement as HTMLElement;
        expect(wrapper.className).toContain('flex-1');
        expect(wrapper.className).toContain('min-h-0');
    });

    it('desktop children wrapper does not have flex-1 min-h-0', () => {
        viewportCleanup = mockViewport(1280);
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test">
                <p data-testid="child-content">Content</p>
            </Dialog>
        );
        const childContent = document.querySelector('[data-testid="child-content"]') as HTMLElement;
        const wrapper = childContent.parentElement as HTMLElement;
        expect(wrapper.className).not.toContain('flex-1');
        expect(wrapper.className).not.toContain('min-h-0');
    });
});
