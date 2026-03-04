import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FloatingDialog } from '../../../src/server/spa/client/react/shared/FloatingDialog';

describe('FloatingDialog', () => {
    it('renders nothing when open={false}', () => {
        const { container } = render(
            <FloatingDialog open={false} onClose={vi.fn()}>Content</FloatingDialog>,
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders title and children when open={true}', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} title="My Panel">
                Panel Content
            </FloatingDialog>,
        );
        expect(screen.getByText('My Panel')).toBeDefined();
        expect(screen.getByText('Panel Content')).toBeDefined();
    });

    it('renders via createPortal into document.body', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} title="Portal Test">
                Content
            </FloatingDialog>,
        );
        const panel = document.querySelector('[data-testid="floating-dialog-panel"]');
        expect(panel?.parentElement).toBe(document.body);
    });

    it('does NOT render a backdrop overlay', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} title="Test">
                Content
            </FloatingDialog>,
        );
        // No inset-0 bg-black overlay should be present
        const overlay = document.querySelector('.fixed.inset-0');
        expect(overlay).toBeNull();
    });

    it('panel has fixed positioning class', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} title="Test">
                Content
            </FloatingDialog>,
        );
        const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
        expect(panel.className).toContain('fixed');
        expect(panel.className).toContain('z-[10002]');
    });

    it('panel has default CSS transform positioning when not dragged', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} title="Test">
                Content
            </FloatingDialog>,
        );
        const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
        expect(panel.style.transform).toBe('translateX(-50%)');
        expect(panel.style.left).toBe('50%');
        expect(panel.style.top).toBe('10vh');
    });

    it('renders footer slot', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} footer={<button>OK</button>}>
                Content
            </FloatingDialog>,
        );
        expect(screen.getByText('OK')).toBeDefined();
    });

    it('renders close button in header', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} title="Test">
                Content
            </FloatingDialog>,
        );
        const btn = document.querySelector('[data-testid="dialog-close-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Close');
    });

    it('clicking close button calls onClose', () => {
        const onClose = vi.fn();
        render(
            <FloatingDialog open={true} onClose={onClose} title="Test">
                Content
            </FloatingDialog>,
        );
        fireEvent.click(document.querySelector('[data-testid="dialog-close-btn"]')!);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('close button is disabled when disableClose={true}', () => {
        const onClose = vi.fn();
        render(
            <FloatingDialog open={true} onClose={onClose} title="Test" disableClose>
                Content
            </FloatingDialog>,
        );
        const btn = document.querySelector('[data-testid="dialog-close-btn"]') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        expect(btn.className).toContain('pointer-events-none');
        fireEvent.click(btn);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('pressing Escape calls onClose', () => {
        const onClose = vi.fn();
        render(
            <FloatingDialog open={true} onClose={onClose} title="Test">
                Content
            </FloatingDialog>,
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('pressing Escape calls onMinimize when provided', () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        render(
            <FloatingDialog open={true} onClose={onClose} onMinimize={onMinimize} title="Test">
                Content
            </FloatingDialog>,
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onMinimize).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('renders minimize button when onMinimize is provided', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} onMinimize={vi.fn()} title="Test">
                Content
            </FloatingDialog>,
        );
        const btn = document.querySelector('[data-testid="dialog-minimize-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Minimize');
    });

    it('clicking minimize button calls onMinimize', () => {
        const onMinimize = vi.fn();
        render(
            <FloatingDialog open={true} onClose={vi.fn()} onMinimize={onMinimize} title="Test">
                Content
            </FloatingDialog>,
        );
        fireEvent.click(document.querySelector('[data-testid="dialog-minimize-btn"]')!);
        expect(onMinimize).toHaveBeenCalledOnce();
    });

    it('renders drag handle on the title bar', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} title="Test">
                Content
            </FloatingDialog>,
        );
        const handle = document.querySelector('[data-testid="floating-dialog-drag-handle"]');
        expect(handle).not.toBeNull();
        expect((handle as HTMLElement).className).toContain('cursor-move');
    });

    it('does not respond to Escape when closed', () => {
        const onClose = vi.fn();
        render(
            <FloatingDialog open={false} onClose={onClose} title="Test">
                Content
            </FloatingDialog>,
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    describe('drag interaction', () => {
        let originalGetBoundingClientRect: () => DOMRect;

        beforeEach(() => {
            originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = () => ({
                left: 100,
                top: 50,
                right: 700,
                bottom: 650,
                width: 600,
                height: 600,
                x: 100,
                y: 50,
                toJSON: () => ({}),
            });
        });

        afterEach(() => {
            Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
        });

        it('updates position after drag', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Drag Me">
                    Content
                </FloatingDialog>,
            );
            const handle = document.querySelector('[data-testid="floating-dialog-drag-handle"]') as HTMLElement;
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;

            // Simulate mousedown on drag handle (clientX=200, clientY=80 → offset dx=100, dy=30)
            fireEvent.mouseDown(handle, { clientX: 200, clientY: 80 });

            // Simulate mousemove on window
            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 400, clientY: 200 });
            });

            // Panel should now be at left=300, top=170 (400-100, 200-30)
            expect(panel.style.left).toBe('300px');
            expect(panel.style.top).toBe('170px');
            expect(panel.style.transform).toBe('none');
        });

        it('stops updating position after mouseup', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Drag Me">
                    Content
                </FloatingDialog>,
            );
            const handle = document.querySelector('[data-testid="floating-dialog-drag-handle"]') as HTMLElement;
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;

            fireEvent.mouseDown(handle, { clientX: 200, clientY: 80 });

            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 400, clientY: 200 });
            });

            const posAfterDrag = { left: panel.style.left, top: panel.style.top };

            // Release
            fireEvent.mouseUp(window);

            // Move again — should not update
            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 800, clientY: 500 });
            });

            expect(panel.style.left).toBe(posAfterDrag.left);
            expect(panel.style.top).toBe(posAfterDrag.top);
        });

        it('resets position to default when dialog reopens', async () => {
            const { rerender } = render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test">
                    Content
                </FloatingDialog>,
            );
            const handle = document.querySelector('[data-testid="floating-dialog-drag-handle"]') as HTMLElement;

            fireEvent.mouseDown(handle, { clientX: 200, clientY: 80 });
            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 400, clientY: 200 });
            });

            // Close and reopen
            rerender(
                <FloatingDialog open={false} onClose={vi.fn()} title="Test">
                    Content
                </FloatingDialog>,
            );
            rerender(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test">
                    Content
                </FloatingDialog>,
            );

            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            expect(panel.style.transform).toBe('translateX(-50%)');
            expect(panel.style.left).toBe('50%');
        });
    });
});
