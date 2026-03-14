/**
 * Tests for DiffContextMenu React component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { DiffContextMenu } from '../../../../src/server/spa/client/react/tasks/comments/DiffContextMenu';

afterEach(cleanup);

describe('DiffContextMenu', () => {
    it('renders context menu when visible is true', () => {
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByTestId('context-menu')).toBeTruthy();
    });

    it('does not render when visible is false', () => {
        render(
            <DiffContextMenu
                visible={false}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
            />
        );
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('renders "Add comment" item with emoji', () => {
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText(/Add comment/)).toBeTruthy();
    });

    it('calls onAddComment when menu item is clicked', async () => {
        const onAddComment = vi.fn();
        const onClose = vi.fn();
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={onAddComment}
                onClose={onClose}
            />
        );
        await act(async () => {
            fireEvent.click(screen.getByTestId('context-menu-item-0'));
        });
        expect(onAddComment).toHaveBeenCalledOnce();
    });

    it('calls onClose when Escape is pressed', async () => {
        const onClose = vi.fn();
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={onClose}
            />
        );
        await act(async () => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });
        expect(onClose).toHaveBeenCalledOnce();
    });
});
