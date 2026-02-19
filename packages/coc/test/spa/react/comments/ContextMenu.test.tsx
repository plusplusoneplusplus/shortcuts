/**
 * Tests for ContextMenu React component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ContextMenu } from '../../../../src/server/spa/client/react/tasks/comments/ContextMenu';

afterEach(cleanup);

describe('ContextMenu', () => {
    it('renders at the specified position', () => {
        render(
            <ContextMenu
                position={{ x: 120, y: 80 }}
                items={[{ label: 'Test', onClick: vi.fn() }]}
                onClose={vi.fn()}
            />
        );
        const menu = screen.getByTestId('context-menu');
        expect(menu).toBeTruthy();
        expect(menu.style.top).toBe('80px');
        expect(menu.style.left).toBe('120px');
    });

    it('renders all menu items', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    { label: 'Add comment', icon: '💬', onClick: vi.fn() },
                    { label: 'Copy', onClick: vi.fn() },
                ]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText(/Add comment/)).toBeTruthy();
        expect(screen.getByText('Copy')).toBeTruthy();
    });

    it('calls onClick and onClose when an enabled item is clicked', () => {
        const onClick = vi.fn();
        const onClose = vi.fn();
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Action', onClick }]}
                onClose={onClose}
            />
        );
        fireEvent.click(screen.getByTestId('context-menu-item-0'));
        expect(onClick).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not call onClick when a disabled item is clicked', () => {
        const onClick = vi.fn();
        const onClose = vi.fn();
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Disabled', disabled: true, onClick }]}
                onClose={onClose}
            />
        );
        fireEvent.click(screen.getByTestId('context-menu-item-0'));
        expect(onClick).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('renders icon when provided', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Comment', icon: '💬', onClick: vi.fn() }]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText('💬')).toBeTruthy();
    });

    it('closes on Escape key', () => {
        const onClose = vi.fn();
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Item', onClick: vi.fn() }]}
                onClose={onClose}
            />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('has menu role', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Item', onClick: vi.fn() }]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByRole('menu')).toBeTruthy();
    });

    it('renders menuitem role on items', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Item', onClick: vi.fn() }]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    });
});
