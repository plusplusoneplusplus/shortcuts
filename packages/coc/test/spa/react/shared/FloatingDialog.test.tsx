/**
 * Tests for FloatingDialog shared component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingDialog } from '../../../../src/server/spa/client/react/shared/FloatingDialog';

afterEach(() => {
    document.querySelectorAll('[data-testid="floating-dialog-panel"]').forEach(el => el.remove());
});

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
