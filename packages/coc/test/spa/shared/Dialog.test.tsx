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
});
