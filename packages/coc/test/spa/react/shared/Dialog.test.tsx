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

    describe('dense spacing', () => {
        it('uses roomy padding/gap by default', () => {
            render(<Dialog open={true} onClose={vi.fn()} title="T">Content</Dialog>);
            const panel = screen.getByTestId('dialog-overlay').firstElementChild!;
            expect(panel.className).toContain('p-6');
            expect(panel.className).toContain('gap-4');
            expect(panel.className).not.toContain('p-3');
        });

        it('tightens padding/gap when dense is set', () => {
            render(<Dialog open={true} onClose={vi.fn()} title="T" dense>Content</Dialog>);
            const panel = screen.getByTestId('dialog-overlay').firstElementChild!;
            expect(panel.className).toContain('p-3');
            expect(panel.className).toContain('gap-2');
            expect(panel.className).not.toContain('p-6');
            expect(panel.className).not.toContain('gap-4');
        });

        it('keeps the width-override branch intact when dense', () => {
            render(<Dialog open={true} onClose={vi.fn()} className="max-w-[800px]" dense>Content</Dialog>);
            const panel = screen.getByTestId('dialog-overlay').firstElementChild!;
            expect(panel.className).toContain('max-w-[800px]');
            expect(panel.className).not.toContain('max-w-lg');
            expect(panel.className).toContain('p-3');
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

    // Regression: the admin dialog needs an edge-to-edge panel, but the frame
    // must stay opt-in so every other dialog keeps its border + padding.
    describe('borderless (opt-in edge-to-edge panel)', () => {
        function panelOf(): HTMLElement {
            const overlay = screen.getByTestId('dialog-overlay');
            return overlay.querySelector(':scope > div') as HTMLElement;
        }

        it('default desktop panel keeps its border and padding', () => {
            render(<Dialog open={true} onClose={vi.fn()}>Body</Dialog>);
            const cls = panelOf().className;
            expect(cls).toContain('border');
            expect(cls).toContain('p-6');
        });

        it('dense default panel keeps its border and tight padding', () => {
            render(<Dialog open={true} onClose={vi.fn()} dense>Body</Dialog>);
            const cls = panelOf().className;
            expect(cls).toContain('border');
            expect(cls).toContain('p-3');
        });

        it('borderless drops the border and all inner padding/gap', () => {
            render(<Dialog open={true} onClose={vi.fn()} borderless>Body</Dialog>);
            const cls = panelOf().className;
            expect(cls).not.toMatch(/\bborder\b/);
            expect(cls).not.toMatch(/\bp-3\b|\bp-6\b/);
            expect(cls).not.toMatch(/\bgap-2\b|\bgap-4\b/);
        });

        it('borderless keeps the rounded corners, shadow and clipping', () => {
            render(<Dialog open={true} onClose={vi.fn()} borderless>Body</Dialog>);
            const cls = panelOf().className;
            expect(cls).toContain('rounded-lg');
            expect(cls).toContain('shadow-xl');
            expect(cls).toContain('overflow-hidden');
        });

        it('borderless keeps the dimmed overlay backdrop', () => {
            render(<Dialog open={true} onClose={vi.fn()} borderless>Body</Dialog>);
            expect(screen.getByTestId('dialog-overlay').className).toContain('bg-black/40');
        });

        it('borderless still closes on Escape', () => {
            const onClose = vi.fn();
            render(<Dialog open={true} onClose={onClose} borderless>Body</Dialog>);
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(onClose).toHaveBeenCalled();
        });
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
