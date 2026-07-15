/**
 * Tests for Dialog shared component.
 *
 * Dialog uses useBreakpoint internally. In jsdom, matchMedia is not available,
 * so useBreakpoint falls back to desktop mode (isMobile=false). This means the
 * portal overlay is rendered with a backdrop.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from '../../../../src/server/spa/client/react/ui/Dialog';

describe('Dialog', () => {
    it('renders nothing when open is false', () => {
        const { container } = render(
            <Dialog open={false} onClose={vi.fn()}>Content</Dialog>
        );
        expect(container.innerHTML).toBe('');
        expect(screen.queryByTestId('dialog-overlay')).toBeNull();
    });

    it('renders content when open is true', () => {
        render(
            <Dialog open={true} onClose={vi.fn()}>
                <span data-testid="child">Hello</span>
            </Dialog>
        );
        expect(screen.getByTestId('dialog-overlay')).toBeTruthy();
        expect(screen.getByTestId('child')).toBeTruthy();
    });

    it('renders the title when provided', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} title="My Dialog">
                Content
            </Dialog>
        );
        expect(screen.getByText('My Dialog')).toBeTruthy();
    });

    it('calls onClose when Escape key is pressed', () => {
        const onClose = vi.fn();
        render(<Dialog open={true} onClose={onClose}>Content</Dialog>);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(<Dialog open={true} onClose={onClose} title="Test">Content</Dialog>);
        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call Escape handler when closed', () => {
        const onClose = vi.fn();
        render(<Dialog open={false} onClose={onClose}>Content</Dialog>);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('renders footer when provided', () => {
        render(
            <Dialog
                open={true}
                onClose={vi.fn()}
                title="T"
                footer={<button>Save</button>}
            >
                Body
            </Dialog>
        );
        expect(screen.getByText('Save')).toBeTruthy();
    });

    it('calls onMinimize when minimize button is clicked', () => {
        const onMinimize = vi.fn();
        render(
            <Dialog open={true} onClose={vi.fn()} onMinimize={onMinimize} title="T">
                Content
            </Dialog>
        );
        fireEvent.click(screen.getByTestId('dialog-minimize-btn'));
        expect(onMinimize).toHaveBeenCalledTimes(1);
    });

    it('close button is disabled when disableClose=true', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} title="T" disableClose>
                Content
            </Dialog>
        );
        const closeBtn = screen.getByTestId('dialog-close-btn');
        expect(closeBtn).toBeDisabled();
    });

    describe('panel border contrast', () => {
        it('uses #c8c8c8 light border and #555555 dark border for clarity', () => {
            render(
                <Dialog open={true} onClose={vi.fn()} title="T">Content</Dialog>
            );
            const overlay = screen.getByTestId('dialog-overlay');
            const panel = overlay.firstElementChild!;
            expect(panel.className).toContain('border-[#c8c8c8]');
            expect(panel.className).toContain('dark:border-[#555555]');
        });

        it('uses stronger border in hasMaxWOverride path', () => {
            render(
                <Dialog open={true} onClose={vi.fn()} className="max-w-[800px]">Content</Dialog>
            );
            const overlay = screen.getByTestId('dialog-overlay');
            const panel = overlay.firstElementChild!;
            expect(panel.className).toContain('border-[#c8c8c8]');
            expect(panel.className).toContain('dark:border-[#555555]');
        });
    });

    it('renderHeader replaces built-in header', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} title="Ignored" renderHeader={() => (
                <div data-testid="custom-header">Custom</div>
            )}>
                Body
            </Dialog>
        );
        expect(screen.getByTestId('custom-header')).toBeTruthy();
        // Built-in title must not appear
        expect(screen.queryByText('Ignored')).toBeNull();
        // Built-in close button must not appear
        expect(screen.queryByTestId('dialog-close-btn')).toBeNull();
    });

    it('renderHeader suppresses built-in minimize button', () => {
        const onMinimize = vi.fn();
        render(
            <Dialog open={true} onClose={vi.fn()} onMinimize={onMinimize}
                renderHeader={() => (
                    <button data-testid="custom-minimize" onClick={onMinimize}>−</button>
                )}
            >
                Body
            </Dialog>
        );
        // Only the custom minimize button, not the built-in one
        expect(document.querySelectorAll('[data-testid="dialog-minimize-btn"]').length).toBe(0);
        expect(document.querySelectorAll('[data-testid="custom-minimize"]').length).toBe(1);
    });
});
