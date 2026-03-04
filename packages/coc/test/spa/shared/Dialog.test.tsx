import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from '../../../src/server/spa/client/react/shared/Dialog';

describe('Dialog', () => {
    it('when open={false}: renders nothing', () => {
        const { container } = render(
            <Dialog open={false} onClose={vi.fn()}>Content</Dialog>
        );
        expect(container.innerHTML).toBe('');
    });

    it('when open={true}: renders title and children', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test Title">
                Dialog Content
            </Dialog>
        );
        expect(screen.getByText('Test Title')).toBeDefined();
        expect(screen.getByText('Dialog Content')).toBeDefined();
    });

    it('pressing Escape calls onClose', () => {
        const onClose = vi.fn();
        render(
            <Dialog open={true} onClose={onClose} title="Test">
                Content
            </Dialog>
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('clicking backdrop calls onClose', () => {
        const onClose = vi.fn();
        render(
            <Dialog open={true} onClose={onClose} title="Test">
                Content
            </Dialog>
        );
        const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('clicking inside the modal does not call onClose', () => {
        const onClose = vi.fn();
        render(
            <Dialog open={true} onClose={onClose} title="Test">
                <span>Inner Content</span>
            </Dialog>
        );
        fireEvent.click(screen.getByText('Inner Content'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('footer slot renders inside the dialog', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} footer={<button>OK</button>}>
                Content
            </Dialog>
        );
        expect(screen.getByText('OK')).toBeDefined();
    });

    it('renders via createPortal into document.body', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} title="Portal Test">
                Content
            </Dialog>
        );
        const backdrop = document.querySelector('.fixed.inset-0');
        expect(backdrop?.parentElement).toBe(document.body);
    });

    it('forwards className to the inner dialog panel', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} className="custom-dialog">
                Content
            </Dialog>
        );
        const panel = document.querySelector('.custom-dialog');
        expect(panel).toBeDefined();
    });

    // ── onMinimize prop tests ───────────────────────────────────────────────

    it('does not render minimize button when onMinimize is not provided', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test">
                Content
            </Dialog>
        );
        expect(document.querySelector('[data-testid="dialog-minimize-btn"]')).toBeNull();
    });

    it('renders minimize button when onMinimize is provided', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} onMinimize={vi.fn()} title="Test">
                Content
            </Dialog>
        );
        const btn = document.querySelector('[data-testid="dialog-minimize-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Minimize');
        expect(btn!.getAttribute('title')).toBe('Minimize (Esc)');
        expect(btn!.textContent).toBe('−');
    });

    it('clicking minimize button calls onMinimize', () => {
        const onMinimize = vi.fn();
        render(
            <Dialog open={true} onClose={vi.fn()} onMinimize={onMinimize} title="Test">
                Content
            </Dialog>
        );
        fireEvent.click(document.querySelector('[data-testid="dialog-minimize-btn"]')!);
        expect(onMinimize).toHaveBeenCalledOnce();
    });

    it('clicking backdrop calls onMinimize instead of onClose when onMinimize is provided', () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        render(
            <Dialog open={true} onClose={onClose} onMinimize={onMinimize} title="Test">
                Content
            </Dialog>
        );
        const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
        fireEvent.click(backdrop);
        expect(onMinimize).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('Escape calls onMinimize instead of onClose when onMinimize is provided', () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        render(
            <Dialog open={true} onClose={onClose} onMinimize={onMinimize} title="Test">
                Content
            </Dialog>
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onMinimize).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });

    // ── close button in header ──────────────────────────────────────────────

    it('renders close button in header when title is provided', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} title="Test">
                Content
            </Dialog>
        );
        const btn = document.querySelector('[data-testid="dialog-close-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Close');
    });

    it('clicking header close button calls onClose', () => {
        const onClose = vi.fn();
        render(
            <Dialog open={true} onClose={onClose} title="Test">
                Content
            </Dialog>
        );
        fireEvent.click(document.querySelector('[data-testid="dialog-close-btn"]')!);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('header close button does not call onClose when disableClose is true', () => {
        const onClose = vi.fn();
        render(
            <Dialog open={true} onClose={onClose} title="Test" disableClose>
                Content
            </Dialog>
        );
        const btn = document.querySelector('[data-testid="dialog-close-btn"]') as HTMLButtonElement;
        fireEvent.click(btn);
        expect(onClose).not.toHaveBeenCalled();
        expect(btn.disabled).toBe(true);
    });

    it('minimize and close buttons are both rendered when onMinimize is provided', () => {
        render(
            <Dialog open={true} onClose={vi.fn()} onMinimize={vi.fn()} title="Test">
                Content
            </Dialog>
        );
        expect(document.querySelector('[data-testid="dialog-minimize-btn"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="dialog-close-btn"]')).not.toBeNull();
    });
});
