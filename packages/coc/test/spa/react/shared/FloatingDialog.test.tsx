/**
 * Tests for FloatingDialog shared component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingDialog } from '../../../../src/server/spa/client/react/ui/FloatingDialog';

describe('FloatingDialog', () => {
    it('renders nothing when open is false', () => {
        const { container } = render(
            <FloatingDialog open={false} onClose={vi.fn()}>Content</FloatingDialog>
        );
        expect(container.innerHTML).toBe('');
        expect(screen.queryByTestId('floating-dialog-panel')).toBeNull();
    });

    it('renders panel when open is true', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()}>
                <span data-testid="fd-child">Hello</span>
            </FloatingDialog>
        );
        expect(screen.getByTestId('floating-dialog-panel')).toBeTruthy();
        expect(screen.getByTestId('fd-child')).toBeTruthy();
    });

    it('renders title when provided', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} title="Floating">
                Content
            </FloatingDialog>
        );
        expect(screen.getByText('Floating')).toBeTruthy();
    });

    it('calls onClose when Escape key is pressed', () => {
        const onClose = vi.fn();
        render(<FloatingDialog open={true} onClose={onClose}>Content</FloatingDialog>);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(<FloatingDialog open={true} onClose={onClose} title="T">Content</FloatingDialog>);
        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call Escape handler when closed', () => {
        const onClose = vi.fn();
        render(<FloatingDialog open={false} onClose={onClose}>Content</FloatingDialog>);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('renders resize handles when resizable=true', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} resizable>
                Content
            </FloatingDialog>
        );
        expect(screen.getByTestId('resize-handle-n')).toBeTruthy();
        expect(screen.getByTestId('resize-handle-se')).toBeTruthy();
    });

    it('does not render resize handles when resizable is not set', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()}>
                Content
            </FloatingDialog>
        );
        expect(screen.queryByTestId('resize-handle-n')).toBeNull();
    });

    it('close button is disabled when disableClose=true', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} disableClose>
                Content
            </FloatingDialog>
        );
        expect(screen.getByTestId('dialog-close-btn')).toBeDisabled();
    });

    it('calls onMinimize when minimize button is clicked', () => {
        const onMinimize = vi.fn();
        render(
            <FloatingDialog open={true} onClose={vi.fn()} onMinimize={onMinimize} title="T">
                Content
            </FloatingDialog>
        );
        fireEvent.click(screen.getByTestId('dialog-minimize-btn'));
        expect(onMinimize).toHaveBeenCalledTimes(1);
    });

    it('renders footer when provided', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} footer={<button>OK</button>}>
                Body
            </FloatingDialog>
        );
        expect(screen.getByText('OK')).toBeTruthy();
    });

    it('renderHeader replaces built-in header', () => {
        render(
            <FloatingDialog open={true} onClose={vi.fn()} title="Ignored"
                renderHeader={({ onMouseDown }) => (
                    <div data-testid="custom-header" onMouseDown={onMouseDown}>Custom</div>
                )}
            >
                Body
            </FloatingDialog>
        );
        expect(screen.getByTestId('custom-header')).toBeTruthy();
        // Built-in title and header must not appear
        expect(screen.queryByText('Ignored')).toBeNull();
        expect(screen.queryByTestId('dialog-close-btn')).toBeNull();
        expect(screen.queryByTestId('floating-dialog-drag-handle')).toBeNull();
    });

    it('renderHeader suppresses built-in minimize and close buttons', () => {
        const onMinimize = vi.fn();
        render(
            <FloatingDialog open={true} onClose={vi.fn()} onMinimize={onMinimize}
                renderHeader={({ onMouseDown }) => (
                    <div data-testid="custom-header" onMouseDown={onMouseDown}>
                        <button data-testid="custom-minimize" onClick={onMinimize}>−</button>
                        <button data-testid="custom-close">✕</button>
                    </div>
                )}
            >
                Body
            </FloatingDialog>
        );
        // Only custom buttons — no built-in ones
        expect(document.querySelectorAll('[data-testid="dialog-minimize-btn"]').length).toBe(0);
        expect(document.querySelectorAll('[data-testid="dialog-close-btn"]').length).toBe(0);
        expect(document.querySelectorAll('[data-testid="custom-minimize"]').length).toBe(1);
        expect(document.querySelectorAll('[data-testid="custom-close"]').length).toBe(1);
    });

    it('renderHeader receives drag onMouseDown handler', () => {
        const dragHandlerCalled: boolean[] = [];
        render(
            <FloatingDialog open={true} onClose={vi.fn()}
                renderHeader={({ onMouseDown }) => (
                    <div data-testid="custom-drag-header" onMouseDown={(e) => { dragHandlerCalled.push(true); onMouseDown(e); }}>
                        Header
                    </div>
                )}
            >
                Body
            </FloatingDialog>
        );
        fireEvent.mouseDown(screen.getByTestId('custom-drag-header'), { clientX: 100, clientY: 50 });
        expect(dragHandlerCalled).toHaveLength(1);
    });

    describe('selectable title text', () => {
        it('title element has select-text and cursor-text classes', () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="My Title">
                    Content
                </FloatingDialog>
            );
            const titleEl = screen.getByText('My Title');
            expect(titleEl.className).toContain('select-text');
            expect(titleEl.className).toContain('cursor-text');
        });

        it('mouseDown on title calls stopPropagation to prevent drag', () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="My Title">
                    Content
                </FloatingDialog>
            );
            const titleEl = screen.getByText('My Title');
            const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            const stopSpy = vi.spyOn(event, 'stopPropagation');
            titleEl.dispatchEvent(event);
            expect(stopSpy).toHaveBeenCalled();
        });
    });

    describe('panel border contrast', () => {
        it('uses #c8c8c8 light border and #555555 dark border for clarity', () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} title="T">
                    Content
                </FloatingDialog>
            );
            const panel = screen.getByTestId('floating-dialog-panel');
            expect(panel.className).toContain('border-[#c8c8c8]');
            expect(panel.className).toContain('dark:border-[#555555]');
        });

        it('uses stronger border in hasMaxWOverride path', () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} className="max-w-[800px]">
                    Content
                </FloatingDialog>
            );
            const panel = screen.getByTestId('floating-dialog-panel');
            expect(panel.className).toContain('border-[#c8c8c8]');
            expect(panel.className).toContain('dark:border-[#555555]');
        });
    });

    describe('maximize prop', () => {
        it('renders resize handles hidden when isMaximized=true', () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} resizable isMaximized={true}>
                    Content
                </FloatingDialog>
            );
            expect(screen.queryByTestId('resize-handle-n')).toBeNull();
            expect(screen.queryByTestId('resize-grip')).toBeNull();
        });

        it('applies full-viewport style when isMaximized=true', () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} resizable isMaximized={true}>
                    Content
                </FloatingDialog>
            );
            const panel = screen.getByTestId('floating-dialog-panel') as HTMLElement;
            expect(panel.style.width).toBe('100vw');
            expect(panel.style.height).toBe('100vh');
            expect(panel.style.top).toBe('0px');
            expect(panel.style.left).toBe('0px');
        });

        it('overrides class-based size constraints when isMaximized=true (regression)', () => {
            // MarkdownReviewDialog passes className="max-w-[900px] w-[900px] h-[700px]"; without
            // explicit style overrides the Tailwind classes would cap the maximized size at 900px.
            render(
                <FloatingDialog
                    open={true}
                    onClose={vi.fn()}
                    resizable
                    isMaximized={true}
                    className="max-w-[900px] w-[900px] h-[700px]"
                >
                    Content
                </FloatingDialog>
            );
            const panel = screen.getByTestId('floating-dialog-panel') as HTMLElement;
            expect(panel.style.maxWidth).toBe('none');
            expect(panel.style.minWidth).toBe('unset');
            expect(panel.style.maxHeight).toBe('none');
            expect(panel.style.minHeight).toBe('unset');
            expect(panel.style.width).toBe('100vw');
            expect(panel.style.height).toBe('100vh');
        });

        it('restores resize handles when isMaximized=false', () => {
            render(
                <FloatingDialog open={true} onClose={vi.fn()} resizable isMaximized={false}>
                    Content
                </FloatingDialog>
            );
            expect(screen.getByTestId('resize-handle-n')).toBeTruthy();
            expect(screen.getByTestId('resize-grip')).toBeTruthy();
        });
    });
});
