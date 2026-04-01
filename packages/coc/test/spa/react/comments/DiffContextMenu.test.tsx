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

    it('does not render "Ask AI" item when onAskAI is not provided', () => {
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
            />
        );
        expect(screen.queryByText(/Ask AI/)).toBeNull();
    });

    it('renders "Ask AI" item when onAskAI is provided', () => {
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
                onAskAI={vi.fn()}
            />
        );
        expect(screen.getByText(/Ask AI/)).toBeTruthy();
    });

    it('calls onAskAI when Ask AI menu item is clicked', async () => {
        const onAskAI = vi.fn();
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
                onAskAI={onAskAI}
            />
        );
        await act(async () => {
            fireEvent.click(screen.getByTestId('context-menu-item-1'));
        });
        expect(onAskAI).toHaveBeenCalledOnce();
    });

    it('does not render "Copy as context" item when onCopyAsContext is not provided', () => {
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
            />
        );
        expect(screen.queryByText(/Copy as context/)).toBeNull();
    });

    it('renders "Copy as context" item when onCopyAsContext is provided', () => {
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
                onCopyAsContext={vi.fn()}
            />
        );
        expect(screen.getByText(/Copy as context/)).toBeTruthy();
    });

    it('calls onCopyAsContext when Copy as context menu item is clicked', async () => {
        const onCopyAsContext = vi.fn();
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
                onCopyAsContext={onCopyAsContext}
            />
        );
        await act(async () => {
            // "Copy as context" is index 1 when onAskAI is absent
            fireEvent.click(screen.getByTestId('context-menu-item-1'));
        });
        expect(onCopyAsContext).toHaveBeenCalledOnce();
    });

    it('renders all three items when both onAskAI and onCopyAsContext are provided', () => {
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
                onAskAI={vi.fn()}
                onCopyAsContext={vi.fn()}
            />
        );
        expect(screen.getByText(/Add comment/)).toBeTruthy();
        expect(screen.getByText(/Ask AI/)).toBeTruthy();
        expect(screen.getByText(/Copy as context/)).toBeTruthy();
    });

    it('calls onCopyAsContext from correct index when all items present', async () => {
        const onCopyAsContext = vi.fn();
        render(
            <DiffContextMenu
                visible={true}
                position={{ x: 100, y: 50 }}
                onAddComment={vi.fn()}
                onClose={vi.fn()}
                onAskAI={vi.fn()}
                onCopyAsContext={onCopyAsContext}
            />
        );
        await act(async () => {
            // index 2: Add comment(0), Ask AI(1), Copy as context(2)
            fireEvent.click(screen.getByTestId('context-menu-item-2'));
        });
        expect(onCopyAsContext).toHaveBeenCalledOnce();
    });
});
