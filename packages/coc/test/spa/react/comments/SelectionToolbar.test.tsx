/**
 * Tests for SelectionToolbar React component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionToolbar } from '../../../../src/server/spa/client/react/tasks/comments/SelectionToolbar';

describe('SelectionToolbar', () => {
    it('renders when visible is true', () => {
        render(
            <SelectionToolbar
                visible={true}
                position={{ top: 50, left: 100 }}
                onAddComment={vi.fn()}
            />
        );
        expect(screen.getByTestId('selection-toolbar')).toBeTruthy();
    });

    it('does not render when visible is false', () => {
        render(
            <SelectionToolbar
                visible={false}
                position={{ top: 50, left: 100 }}
                onAddComment={vi.fn()}
            />
        );
        expect(screen.queryByTestId('selection-toolbar')).toBeNull();
    });

    it('renders "Add comment" text', () => {
        render(
            <SelectionToolbar
                visible={true}
                position={{ top: 50, left: 100 }}
                onAddComment={vi.fn()}
            />
        );
        expect(screen.getByText('💬 Add comment')).toBeTruthy();
    });

    it('calls onAddComment when clicked', () => {
        const onAddComment = vi.fn();
        render(
            <SelectionToolbar
                visible={true}
                position={{ top: 50, left: 100 }}
                onAddComment={onAddComment}
            />
        );
        fireEvent.click(screen.getByTestId('selection-toolbar'));
        expect(onAddComment).toHaveBeenCalledOnce();
    });

    it('has correct position styles', () => {
        render(
            <SelectionToolbar
                visible={true}
                position={{ top: 42, left: 99 }}
                onAddComment={vi.fn()}
            />
        );
        const toolbar = screen.getByTestId('selection-toolbar');
        expect(toolbar.style.top).toBe('42px');
        expect(toolbar.style.left).toBe('99px');
    });
});
