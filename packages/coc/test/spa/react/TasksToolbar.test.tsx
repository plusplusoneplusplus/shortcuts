/**
 * Tests for TasksToolbar status-filter pills.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TasksToolbar } from '../../../src/server/spa/client/react/tasks/TasksToolbar';
import { STATUS_PILLS, type TaskStatusValue } from '../../../src/server/spa/client/react/hooks/useTaskTree';
import { createRef } from 'react';

afterEach(cleanup);

function renderToolbar(overrides?: {
    statusFilter?: TaskStatusValue[];
    onStatusFilterChange?: (statuses: TaskStatusValue[]) => void;
    isMobile?: boolean;
}) {
    const props = {
        isMobile: overrides?.isMobile ?? false,
        onNewTask: vi.fn(),
        onNewFolder: vi.fn(),
        undoAvailable: false,
        undoInFlight: false,
        onUndoArchive: vi.fn(),
        onUndoError: vi.fn(),
        searchInput: '',
        searchInputRef: createRef<HTMLInputElement>(),
        onSearchChange: vi.fn(),
        onSearchClear: vi.fn(),
        taskActions: <div />,
        selectedFolderPath: null,
        onQueueFolder: vi.fn(),
        toolbarOverflowOpen: false,
        setToolbarOverflowOpen: vi.fn(),
        statusFilter: overrides?.statusFilter ?? [],
        onStatusFilterChange: overrides?.onStatusFilterChange ?? vi.fn(),
    };

    return render(<TasksToolbar {...props} />);
}

describe('TasksToolbar — status filter pills', () => {
    it('renders All pill and four status pills on desktop', () => {
        renderToolbar();
        expect(screen.getByTestId('task-filter-all')).toBeTruthy();
        for (const pill of STATUS_PILLS) {
            expect(screen.getByTestId(`task-filter-${pill.status}`)).toBeTruthy();
        }
    });

    it('All pill has active style when no filter is active', () => {
        renderToolbar({ statusFilter: [] });
        const allBtn = screen.getByTestId('task-filter-all');
        expect(allBtn.className).toContain('font-medium');
        expect(allBtn.className).toContain('bg-[#0078d4]');
    });

    it('All pill has inactive style when a filter is active', () => {
        renderToolbar({ statusFilter: ['pending'] });
        const allBtn = screen.getByTestId('task-filter-all');
        expect(allBtn.className).not.toContain('font-medium');
    });

    it('clicking a status pill calls onStatusFilterChange with that status', () => {
        const onChange = vi.fn();
        renderToolbar({ statusFilter: [], onStatusFilterChange: onChange });
        fireEvent.click(screen.getByTestId('task-filter-pending'));
        expect(onChange).toHaveBeenCalledWith(['pending']);
    });

    it('clicking an active status pill removes it from the filter', () => {
        const onChange = vi.fn();
        renderToolbar({ statusFilter: ['pending', 'done'], onStatusFilterChange: onChange });
        fireEvent.click(screen.getByTestId('task-filter-pending'));
        expect(onChange).toHaveBeenCalledWith(['done']);
    });

    it('clicking All pill calls onStatusFilterChange with empty array', () => {
        const onChange = vi.fn();
        renderToolbar({ statusFilter: ['done'], onStatusFilterChange: onChange });
        fireEvent.click(screen.getByTestId('task-filter-all'));
        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('active status pill has active styling', () => {
        renderToolbar({ statusFilter: ['done'] });
        const doneBtn = screen.getByTestId('task-filter-done');
        expect(doneBtn.className).toContain('font-medium');
        expect(doneBtn.className).toContain('bg-[#0078d4]');
    });

    it('inactive status pill has inactive styling', () => {
        renderToolbar({ statusFilter: ['done'] });
        const pendingBtn = screen.getByTestId('task-filter-pending');
        expect(pendingBtn.className).not.toContain('font-medium');
    });

    it('does not render desktop filter pills on mobile', () => {
        renderToolbar({ isMobile: true });
        expect(screen.queryByTestId('task-status-filter')).toBeNull();
    });

    it('renders mobile filter checkboxes in overflow menu', () => {
        const props = {
            isMobile: true,
            onNewTask: vi.fn(),
            onNewFolder: vi.fn(),
            undoAvailable: false,
            undoInFlight: false,
            onUndoArchive: vi.fn(),
            onUndoError: vi.fn(),
            searchInput: '',
            searchInputRef: createRef<HTMLInputElement>(),
            onSearchChange: vi.fn(),
            onSearchClear: vi.fn(),
            taskActions: <div />,
            selectedFolderPath: null,
            onQueueFolder: vi.fn(),
            toolbarOverflowOpen: true,
            setToolbarOverflowOpen: vi.fn(),
            statusFilter: ['pending'] as TaskStatusValue[],
            onStatusFilterChange: vi.fn(),
        };

        render(<TasksToolbar {...props} />);

        for (const pill of STATUS_PILLS) {
            expect(screen.getByTestId(`task-filter-mobile-${pill.status}`)).toBeTruthy();
        }

        // pending checkbox should be checked
        const pendingLabel = screen.getByTestId('task-filter-mobile-pending');
        const checkbox = pendingLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });

    it('each status pill has the correct title tooltip', () => {
        renderToolbar();
        expect(screen.getByTestId('task-filter-all').getAttribute('title')).toBe('Show all');
        expect(screen.getByTestId('task-filter-pending').getAttribute('title')).toBe('Pending');
        expect(screen.getByTestId('task-filter-in-progress').getAttribute('title')).toBe('In-Progress');
        expect(screen.getByTestId('task-filter-done').getAttribute('title')).toBe('Done');
        expect(screen.getByTestId('task-filter-future').getAttribute('title')).toBe('Future');
    });
});
