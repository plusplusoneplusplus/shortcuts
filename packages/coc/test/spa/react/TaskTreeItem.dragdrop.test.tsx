/**
 * Tests for TaskTreeItem drag-and-drop behavior.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskTreeItem, type TaskTreeItemProps } from '../../../src/server/spa/client/react/tasks/TaskTreeItem';
import type { TaskFolder, TaskDocument } from '../../../src/server/spa/client/react/hooks/useTaskTree';

// ── Mock AIActionsDropdown ─────────────────────────────────────────────
vi.mock('../../../src/server/spa/client/react/shared/AIActionsDropdown', () => ({
    AIActionsDropdown: ({ wsId, taskPath }: { wsId: string; taskPath: string }) => (
        <span data-testid="ai-actions" data-ws={wsId} data-path={taskPath} />
    ),
}));

// ── Fixtures ───────────────────────────────────────────────────────────

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

function makeDocument(overrides?: Partial<TaskDocument>): TaskDocument {
    return {
        baseName: 'task',
        fileName: 'task.md',
        relativePath: 'sub',
        isArchived: false,
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

// ── Tests ──────────────────────────────────────────────────────────────

describe('TaskTreeItem — drag source', () => {
    afterEach(() => cleanup());

    it('has draggable=true on non-context items', () => {
        renderItem({ item: makeDocument() });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.getAttribute('draggable')).toBe('true');
    });

    it('has draggable=true on folders', () => {
        renderItem({ item: makeFolder() });
        const li = screen.getByTestId('task-tree-item-feature1');
        expect(li.getAttribute('draggable')).toBe('true');
    });

    it('fires onDragStart when dragging starts', () => {
        const onDragStart = vi.fn();
        renderItem({ item: makeDocument(), onDragStart });
        const li = screen.getByTestId('task-tree-item-task');
        fireEvent.dragStart(li);
        expect(onDragStart).toHaveBeenCalledTimes(1);
    });

    it('fires onDragEnd when dragging ends', () => {
        const onDragEnd = vi.fn();
        renderItem({ item: makeDocument(), onDragEnd });
        const li = screen.getByTestId('task-tree-item-task');
        fireEvent.dragEnd(li);
        expect(onDragEnd).toHaveBeenCalledTimes(1);
    });

    it('applies isDragSource opacity class when dragging', () => {
        renderItem({ item: makeDocument(), isDragSource: true });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.className).toContain('opacity-40');
    });

    it('does not apply isDragSource class when not dragging', () => {
        renderItem({ item: makeDocument(), isDragSource: false });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.className).not.toContain('opacity-40');
    });
});

describe('TaskTreeItem — drop target (folders)', () => {
    afterEach(() => cleanup());

    it('fires onDragOver on folder items', () => {
        const onDragOver = vi.fn();
        renderItem({ item: makeFolder(), onDragOver });
        const li = screen.getByTestId('task-tree-item-feature1');
        fireEvent.dragOver(li);
        expect(onDragOver).toHaveBeenCalledTimes(1);
    });

    it('fires onDrop on folder items', () => {
        const onDrop = vi.fn();
        renderItem({ item: makeFolder(), onDrop });
        const li = screen.getByTestId('task-tree-item-feature1');
        fireEvent.drop(li);
        expect(onDrop).toHaveBeenCalledTimes(1);
    });

    it('fires onDragEnter on folder items', () => {
        const onDragEnter = vi.fn();
        renderItem({ item: makeFolder(), onDragEnter });
        const li = screen.getByTestId('task-tree-item-feature1');
        fireEvent.dragEnter(li);
        expect(onDragEnter).toHaveBeenCalledTimes(1);
    });

    it('fires onDragLeave on folder items', () => {
        const onDragLeave = vi.fn();
        renderItem({ item: makeFolder(), onDragLeave });
        const li = screen.getByTestId('task-tree-item-feature1');
        fireEvent.dragLeave(li);
        expect(onDragLeave).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onDragOver on file items', () => {
        const onDragOver = vi.fn();
        renderItem({ item: makeDocument(), onDragOver });
        const li = screen.getByTestId('task-tree-item-task');
        fireEvent.dragOver(li);
        // The handler is not wired for files, so it should not be called
        expect(onDragOver).not.toHaveBeenCalled();
    });

    it('does NOT fire onDrop on file items', () => {
        const onDrop = vi.fn();
        renderItem({ item: makeDocument(), onDrop });
        const li = screen.getByTestId('task-tree-item-task');
        fireEvent.drop(li);
        expect(onDrop).not.toHaveBeenCalled();
    });

    it('applies isDropTarget highlight class on folder', () => {
        renderItem({ item: makeFolder(), isDropTarget: true });
        const li = screen.getByTestId('task-tree-item-feature1');
        expect(li.className).toContain('ring-2');
    });

    it('does not apply isDropTarget class when not targeted', () => {
        renderItem({ item: makeFolder(), isDropTarget: false });
        const li = screen.getByTestId('task-tree-item-feature1');
        expect(li.className).not.toContain('ring-2');
    });
});

describe('TaskTreeItem — drag does not interfere with other interactions', () => {
    afterEach(() => cleanup());

    it('click still works on folder with drag enabled', () => {
        const onFolderClick = vi.fn();
        renderItem({ item: makeFolder(), onFolderClick });
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        expect(onFolderClick).toHaveBeenCalled();
    });

    it('click still works on file with drag enabled', () => {
        const onFileClick = vi.fn();
        renderItem({ item: makeDocument(), onFileClick });
        fireEvent.click(screen.getByTestId('task-tree-item-task'));
        expect(onFileClick).toHaveBeenCalled();
    });

    it('context menu still works on folder with drag enabled', () => {
        const onFolderContextMenu = vi.fn();
        renderItem({ item: makeFolder(), onFolderContextMenu });
        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'), {
            clientX: 100,
            clientY: 200,
        });
        expect(onFolderContextMenu).toHaveBeenCalled();
    });
});
