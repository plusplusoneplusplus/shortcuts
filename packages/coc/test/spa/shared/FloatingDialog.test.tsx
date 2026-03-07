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

    it('pressing Escape calls onClose even when onMinimize is provided', () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        render(
            <FloatingDialog open={true} onClose={onClose} onMinimize={onMinimize} title="Test">
                Content
            </FloatingDialog>,
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        expect(onMinimize).not.toHaveBeenCalled();
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

    describe('resize interaction', () => {
        let originalGetBoundingClientRect: () => DOMRect;

        beforeEach(() => {
            originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = () => ({
                left: 200,
                top: 100,
                right: 800,
                bottom: 700,
                width: 600,
                height: 600,
                x: 200,
                y: 100,
                toJSON: () => ({}),
            });
        });

        afterEach(() => {
            Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
        });

        it('does not render resize handles when resizable is false (default)', () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test">
                    Content
                </FloatingDialog>,
            );
            expect(document.querySelector('[data-resize]')).toBeNull();
            expect(document.querySelector('[data-testid="resize-grip"]')).toBeNull();
        });

        it('renders 8 resize handles and grip when resizable=true', () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
            for (const dir of dirs) {
                expect(document.querySelector(`[data-resize="${dir}"]`)).not.toBeNull();
            }
            expect(document.querySelector('[data-testid="resize-grip"]')).not.toBeNull();
        });

        it('resizing east handle increases width', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            const handle = document.querySelector('[data-resize="e"]') as HTMLElement;

            fireEvent.mouseDown(handle, { clientX: 800, clientY: 400 });
            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 900, clientY: 400 });
            });

            // width should be 600 + 100 = 700
            expect(panel.style.width).toBe('700px');
        });

        it('resizing south handle increases height', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            const handle = document.querySelector('[data-resize="s"]') as HTMLElement;

            fireEvent.mouseDown(handle, { clientX: 500, clientY: 700 });
            await act(async () => {
                // dy=50 → height = 600 + 50 = 650; top(100) + 650 = 750 < innerHeight(768), no clamping
                fireEvent.mouseMove(window, { clientX: 500, clientY: 750 });
            });

            expect(panel.style.height).toBe('650px');
        });

        it('resizing west handle adjusts width and left', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            const handle = document.querySelector('[data-resize="w"]') as HTMLElement;

            fireEvent.mouseDown(handle, { clientX: 200, clientY: 400 });
            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 150, clientY: 400 });
            });

            // dx = -50: width = 600 - (-50) = 650, left = 200 + (-50) = 150
            expect(panel.style.width).toBe('650px');
            expect(panel.style.left).toBe('150px');
        });

        it('resizing north handle adjusts height and top', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            const handle = document.querySelector('[data-resize="n"]') as HTMLElement;

            fireEvent.mouseDown(handle, { clientX: 500, clientY: 100 });
            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 500, clientY: 50 });
            });

            // dy = -50: height = 600 - (-50) = 650, top = 100 + (-50) = 50
            expect(panel.style.height).toBe('650px');
            expect(panel.style.top).toBe('50px');
        });

        it('enforces minWidth constraint (default 480px)', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            const handle = document.querySelector('[data-resize="e"]') as HTMLElement;

            fireEvent.mouseDown(handle, { clientX: 800, clientY: 400 });
            await act(async () => {
                // Try to shrink to 100px (dx = -700)
                fireEvent.mouseMove(window, { clientX: 100, clientY: 400 });
            });

            // Should be clamped at minWidth = 480
            expect(parseInt(panel.style.width)).toBeGreaterThanOrEqual(480);
        });

        it('enforces minHeight constraint (default 200px)', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            const handle = document.querySelector('[data-resize="s"]') as HTMLElement;

            fireEvent.mouseDown(handle, { clientX: 500, clientY: 700 });
            await act(async () => {
                // Try to shrink to 10px (dy = -690)
                fireEvent.mouseMove(window, { clientX: 500, clientY: 10 });
            });

            expect(parseInt(panel.style.height)).toBeGreaterThanOrEqual(200);
        });

        it('stops resizing after mouseup', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            const handle = document.querySelector('[data-resize="e"]') as HTMLElement;

            fireEvent.mouseDown(handle, { clientX: 800, clientY: 400 });
            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 900, clientY: 400 });
            });
            const widthAfterResize = panel.style.width;

            fireEvent.mouseUp(window);
            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 1100, clientY: 400 });
            });

            // Width should not have changed after mouseup
            expect(panel.style.width).toBe(widthAfterResize);
        });

        it('resets size to null when dialog reopens', async () => {
            const { rerender } = render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const handle = document.querySelector('[data-resize="e"]') as HTMLElement;
            fireEvent.mouseDown(handle, { clientX: 800, clientY: 400 });
            await act(async () => {
                fireEvent.mouseMove(window, { clientX: 900, clientY: 400 });
            });

            // Close and reopen
            rerender(<FloatingDialog open={false} onClose={vi.fn()} title="Test" resizable>Content</FloatingDialog>);
            rerender(<FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>Content</FloatingDialog>);

            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            // size should be reset — no inline width/height
            expect(panel.style.width).toBe('');
            expect(panel.style.height).toBe('');
            // position also resets to default transform
            expect(panel.style.transform).toBe('translateX(-50%)');
        });

        it('drag and resize do not interfere (title bar drag does not change size)', async () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="Test" resizable>
                    Content
                </FloatingDialog>,
            );
            const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
            const dragHandle = document.querySelector('[data-testid="floating-dialog-drag-handle"]') as HTMLElement;

            // Drag via title bar (getBoundingClientRect returns left=200, top=100)
            // offset: dx=500-200=300, dy=200-100=100
            fireEvent.mouseDown(dragHandle, { clientX: 500, clientY: 200 });
            await act(async () => {
                // move to 600,300 → new pos: left=600-300=300, top=300-100=200
                fireEvent.mouseMove(window, { clientX: 600, clientY: 300 });
            });

            // Position updates, but size remains unset (no inline width/height)
            expect(panel.style.left).toBe('300px');
            expect(panel.style.width).toBe('');
            expect(panel.style.height).toBe('');
        });
    });
});
