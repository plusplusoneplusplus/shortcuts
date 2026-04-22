/**
 * Tests for TaskTreeItem — Ctrl/Shift click passes MouseEvent to onFileClick.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskTreeItem, type TaskTreeItemProps } from '../../../src/server/spa/client/react/tasks/TaskTreeItem';
import type { TaskFolder, TaskDocument } from '../../../src/server/spa/client/react/tasks/hooks/useTaskTree';

vi.mock('../../../src/server/spa/client/react/shared/AIActionsDropdown', () => ({
    AIActionsDropdown: ({ wsId, taskPath }: { wsId: string; taskPath: string }) => (
        <span data-testid="ai-actions" data-ws={wsId} data-path={taskPath} />
    ),
}));

function makeDocument(overrides?: Partial<TaskDocument>): TaskDocument {
    return {
        baseName: 'task',
        fileName: 'task.md',
        relativePath: 'sub',
        isArchived: false,
        ...overrides,
    };
}

function makeFolder(overrides?: Partial<TaskFolder>): TaskFolder {
    return {
        name: 'feature1',
        relativePath: 'feature1',
        children: [],
        documentGroups: [],
        singleDocuments: [],
        ...overrides,
    };
}

function renderItem(overrides: Partial<TaskTreeItemProps> = {}) {
    const defaults: TaskTreeItemProps = {
        item: makeDocument(),
        wsId: 'ws1',
        isSelected: false,
        isOpen: false,
        commentCount: 0,
        queueRunning: 0,
        folderMdCount: 0,
        showContextFiles: true,
        onFolderClick: vi.fn(),
        onFileClick: vi.fn(),
        onCheckboxChange: vi.fn(),
    };
    const props = { ...defaults, ...overrides };
    return { ...render(<TaskTreeItem {...props} />), props };
}

describe('TaskTreeItem — onFileClick receives MouseEvent', () => {
    afterEach(() => cleanup());

    it('passes MouseEvent on plain click', () => {
        const onFileClick = vi.fn();
        renderItem({ item: makeDocument(), onFileClick });
        fireEvent.click(screen.getByTestId('task-tree-item-task'));
        expect(onFileClick).toHaveBeenCalledTimes(1);
        expect(onFileClick).toHaveBeenCalledWith('sub/task.md', expect.objectContaining({ ctrlKey: false }));
    });

    it('passes MouseEvent with ctrlKey on Ctrl+click', () => {
        const onFileClick = vi.fn();
        renderItem({ item: makeDocument(), onFileClick });
        fireEvent.click(screen.getByTestId('task-tree-item-task'), { ctrlKey: true });
        expect(onFileClick).toHaveBeenCalledTimes(1);
        const event = onFileClick.mock.calls[0][1];
        expect(event.ctrlKey).toBe(true);
    });

    it('passes MouseEvent with shiftKey on Shift+click', () => {
        const onFileClick = vi.fn();
        renderItem({ item: makeDocument(), onFileClick });
        fireEvent.click(screen.getByTestId('task-tree-item-task'), { shiftKey: true });
        expect(onFileClick).toHaveBeenCalledTimes(1);
        const event = onFileClick.mock.calls[0][1];
        expect(event.shiftKey).toBe(true);
    });

    it('does not call onFileClick for folder clicks', () => {
        const onFileClick = vi.fn();
        const onFolderClick = vi.fn();
        renderItem({ item: makeFolder(), onFileClick, onFolderClick });
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        expect(onFileClick).not.toHaveBeenCalled();
        expect(onFolderClick).toHaveBeenCalled();
    });
});
