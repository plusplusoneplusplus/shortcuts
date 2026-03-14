/**
 * Tests for TaskTreeItem — props-only component, no context providers needed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskTreeItem, buildFileTooltip, type TaskTreeItemProps } from '../../../src/server/spa/client/react/tasks/TaskTreeItem';
import type { TaskFolder, TaskDocument, TaskDocumentGroup, TaskNode } from '../../../src/server/spa/client/react/hooks/useTaskTree';

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

function makeDocumentGroup(overrides?: Partial<TaskDocumentGroup>): TaskDocumentGroup {
    return {
        baseName: 'design',
        documents: [
            { baseName: 'design', docType: 'spec', fileName: 'design.spec.md', relativePath: '', isArchived: false },
        ],
        isArchived: false,
        ...overrides,
    };
}

function makeContextFile(overrides?: Partial<TaskDocument>): TaskDocument {
    return {
        baseName: 'README',
        fileName: 'README.md',
        relativePath: '',
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

describe('TaskTreeItem — folder rendering', () => {
    afterEach(() => cleanup());

    it('renders folder with name, arrow indicator (▶), and md count badge', () => {
        renderItem({ item: makeFolder({ name: 'feature1' }), folderMdCount: 5 });
        const li = screen.getByTestId('task-tree-item-feature1');
        expect(li.textContent).toContain('feature1');
        expect(li.textContent).toContain('▶');
        expect(li.textContent).toContain('5');
    });

    it('renders folder icon 📁', () => {
        renderItem({ item: makeFolder() });
        const li = screen.getByTestId('task-tree-item-feature1');
        expect(li.textContent).toContain('📁');
    });

    it('does not render checkbox for folders', () => {
        renderItem({ item: makeFolder() });
        expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('does not render AI actions dropdown for folders', () => {
        renderItem({ item: makeFolder() });
        // AIActionsDropdown was removed; file-level AI actions are now in the context menu
        const li = screen.getByTestId('task-tree-item-feature1');
        expect(li.textContent).not.toContain('✨');
    });

    it('folder click calls onFolderClick with the folder item', () => {
        const folder = makeFolder({ name: 'myfolder' });
        const onFolderClick = vi.fn();
        renderItem({ item: folder, onFolderClick });
        fireEvent.click(screen.getByTestId('task-tree-item-myfolder'));
        expect(onFolderClick).toHaveBeenCalledWith(folder);
    });

    it('folder right-click calls onFolderContextMenu with coordinates', () => {
        const folder = makeFolder({ name: 'ctx' });
        const onFolderContextMenu = vi.fn();
        renderItem({ item: folder, onFolderContextMenu });
        fireEvent.contextMenu(screen.getByTestId('task-tree-item-ctx'), {
            clientX: 100,
            clientY: 200,
        });
        expect(onFolderContextMenu).toHaveBeenCalledWith(folder, 100, 200);
    });

    it('folder renders folderQueueCount badge when > 0', () => {
        renderItem({ item: makeFolder(), folderQueueCount: 3 });
        const li = screen.getByTestId('task-tree-item-feature1');
        expect(li.textContent).toContain('3 in progress');
    });

    it('folder does not render folderQueueCount badge when 0 or undefined', () => {
        renderItem({ item: makeFolder(), folderQueueCount: 0 });
        const li = screen.getByTestId('task-tree-item-feature1');
        expect(li.textContent).not.toContain('in progress');
    });
});

describe('TaskTreeItem — file (TaskDocument) rendering', () => {
    afterEach(() => cleanup());

    it('renders file with name and checkbox', () => {
        renderItem({ item: makeDocument({ baseName: 'task' }) });
        expect(screen.getByTestId('task-tree-item-task')).toBeTruthy();
        expect(screen.getByRole('checkbox')).toBeTruthy();
    });

    it('renders file icon 📝 for single documents', () => {
        renderItem({ item: makeDocument() });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.textContent).toContain('📝');
    });

    it('renders checkbox for non-context file items', () => {
        renderItem({ item: makeDocument() });
        expect(screen.getByRole('checkbox')).toBeTruthy();
    });

    it('checkbox checked state matches isSelected prop', () => {
        renderItem({ item: makeDocument(), isSelected: true });
        const cb = screen.getByRole('checkbox') as HTMLInputElement;
        expect(cb.checked).toBe(true);
    });

    it('checkbox change calls onCheckboxChange with path and checked', () => {
        const onCheckboxChange = vi.fn();
        renderItem({ item: makeDocument({ relativePath: 'sub', fileName: 'task.md' }), onCheckboxChange });
        fireEvent.click(screen.getByRole('checkbox'));
        expect(onCheckboxChange).toHaveBeenCalledWith('sub/task.md', true);
    });

    it('file click calls onFileClick with constructed path', () => {
        const onFileClick = vi.fn();
        renderItem({ item: makeDocument({ relativePath: 'sub', fileName: 'task.md' }), onFileClick });
        fireEvent.click(screen.getByTestId('task-tree-item-task'));
        expect(onFileClick).toHaveBeenCalledWith('sub/task.md');
    });

    it('file right-click calls onFileContextMenu', () => {
        const doc = makeDocument();
        const onFileContextMenu = vi.fn();
        renderItem({ item: doc, onFileContextMenu });
        fireEvent.contextMenu(screen.getByTestId('task-tree-item-task'), {
            clientX: 50,
            clientY: 60,
        });
        expect(onFileContextMenu).toHaveBeenCalledWith(doc, 50, 60);
    });
});

describe('TaskTreeItem — document group rendering', () => {
    afterEach(() => cleanup());

    it('renders document group with baseName and 📄 icon', () => {
        renderItem({ item: makeDocumentGroup({ baseName: 'design' }) });
        const li = screen.getByTestId('task-tree-item-design');
        expect(li.textContent).toContain('design');
        expect(li.textContent).toContain('📄');
    });

    it('group click calls onFileClick using first document path', () => {
        const onFileClick = vi.fn();
        const group = makeDocumentGroup({
            baseName: 'design',
            documents: [
                { baseName: 'design', docType: 'spec', fileName: 'design.spec.md', relativePath: 'feat', isArchived: false },
            ],
        });
        renderItem({ item: group, onFileClick });
        fireEvent.click(screen.getByTestId('task-tree-item-design'));
        expect(onFileClick).toHaveBeenCalledWith('feat/design.spec.md');
    });
});

describe('TaskTreeItem — comment count badge', () => {
    afterEach(() => cleanup());

    it('renders comment count badge when commentCount > 0', () => {
        renderItem({ item: makeDocument(), commentCount: 4 });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.textContent).toContain('4');
    });

    it('does not render comment count badge when commentCount is 0', () => {
        renderItem({ item: makeDocument(), commentCount: 0 });
        const li = screen.getByTestId('task-tree-item-task');
        // The only text should be icon + name, no extra badge numbers
        expect(li.querySelectorAll('.bg-\\[\\#0078d4\\].text-white.rounded-full')).toHaveLength(0);
    });
});

describe('TaskTreeItem — context file behaviour', () => {
    afterEach(() => cleanup());

    it('returns null for context files when showContextFiles is false', () => {
        const { container } = renderItem({
            item: makeContextFile(),
            showContextFiles: false,
        });
        expect(container.innerHTML).toBe('');
    });

    it('renders context file with opacity-50 when showContextFiles is true', () => {
        renderItem({ item: makeContextFile(), showContextFiles: true });
        const li = screen.getByTestId('task-tree-item-README');
        expect(li.className).toContain('opacity-50');
    });

    it('does not render checkbox for context files', () => {
        renderItem({ item: makeContextFile(), showContextFiles: true });
        expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('renders ℹ️ icon for context files', () => {
        renderItem({ item: makeContextFile(), showContextFiles: true });
        const li = screen.getByTestId('task-tree-item-README');
        expect(li.textContent).toContain('ℹ️');
    });

    it('does not fire onFileContextMenu for root-level context files', () => {
        const onFileContextMenu = vi.fn();
        renderItem({
            item: makeContextFile({ fileName: 'README.md', relativePath: '' }),
            showContextFiles: true,
            onFileContextMenu,
        });
        fireEvent.contextMenu(screen.getByTestId('task-tree-item-README'));
        expect(onFileContextMenu).not.toHaveBeenCalled();
    });

    it('fires onFileContextMenu for nested context.md (isNestedContextDoc)', () => {
        const onFileContextMenu = vi.fn();
        const nestedContext = makeDocument({
            baseName: 'context',
            fileName: 'context.md',
            relativePath: 'feature1',
        });
        renderItem({
            item: nestedContext,
            showContextFiles: true,
            onFileContextMenu,
        });
        fireEvent.contextMenu(screen.getByTestId('task-tree-item-context'), {
            clientX: 10,
            clientY: 20,
        });
        expect(onFileContextMenu).toHaveBeenCalledWith(nestedContext, 10, 20);
    });
});

describe('TaskTreeItem — queue running indicator', () => {
    afterEach(() => cleanup());

    it('renders "in progress" badge when queueRunning > 0', () => {
        renderItem({ item: makeDocument(), queueRunning: 2 });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.textContent).toContain('in progress');
    });

    it('does not render queue indicator when queueRunning is 0', () => {
        renderItem({ item: makeDocument(), queueRunning: 0 });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.textContent).not.toContain('in progress');
    });

    it('queue indicator has animate-pulse class', () => {
        renderItem({ item: makeDocument(), queueRunning: 1 });
        const li = screen.getByTestId('task-tree-item-task');
        const badge = li.querySelector('.animate-pulse');
        expect(badge).toBeTruthy();
        expect(badge!.textContent).toContain('in progress');
    });
});

describe('TaskTreeItem — status icons', () => {
    afterEach(() => cleanup());

    it('renders ✅ icon for done status', () => {
        renderItem({ item: makeDocument({ status: 'done' }) });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.textContent).toContain('✅');
    });

    it('renders 🔄 icon for in-progress status', () => {
        renderItem({ item: makeDocument({ status: 'in-progress' }) });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.textContent).toContain('🔄');
    });

    it('renders ⏳ icon for pending status', () => {
        renderItem({ item: makeDocument({ status: 'pending' }) });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.textContent).toContain('⏳');
    });

    it('renders 📋 icon for future status', () => {
        renderItem({ item: makeDocument({ status: 'future' }) });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.textContent).toContain('📋');
    });

    it('renders no status icon when status is undefined', () => {
        renderItem({ item: makeDocument({ status: undefined }) });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.querySelector('[data-status]')).toBeNull();
    });
});

describe('TaskTreeItem — archived styling', () => {
    afterEach(() => cleanup());

    it('renders archived file with opacity-60 and italic', () => {
        renderItem({ item: makeDocument({ isArchived: true }) });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.className).toContain('opacity-60');
        expect(li.className).toContain('italic');
    });

    it('renders archive folder with opacity-60 and italic', () => {
        renderItem({ item: makeFolder({ name: 'archive', relativePath: 'archive' }) });
        const li = screen.getByTestId('task-tree-item-archive');
        expect(li.className).toContain('opacity-60');
        expect(li.className).toContain('italic');
    });

    it('renders future status file with opacity-60 and italic', () => {
        renderItem({ item: makeDocument({ status: 'future' }) });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.className).toContain('opacity-60');
        expect(li.className).toContain('italic');
    });

    it('renders future status document group with opacity-60 and italic', () => {
        renderItem({ item: makeDocumentGroup({ documents: [{ baseName: 'design', docType: 'spec', fileName: 'design.spec.md', relativePath: '', isArchived: false, status: 'future' }] }) });
        const li = screen.getByTestId('task-tree-item-design');
        expect(li.className).toContain('opacity-60');
        expect(li.className).toContain('italic');
    });

    it('does not render opacity-60 for pending status', () => {
        renderItem({ item: makeDocument({ status: 'pending' }) });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.className).not.toContain('opacity-60');
    });
});

describe('TaskTreeItem — tooltip', () => {
    afterEach(() => cleanup());

    it('sets title attribute with path, status, and comment count', () => {
        renderItem({
            item: makeDocument({ relativePath: 'sub', fileName: 'task.md', status: 'pending' }),
            commentCount: 3,
        });
        const li = screen.getByTestId('task-tree-item-task');
        expect(li.getAttribute('title')).toContain('sub/task.md');
        expect(li.getAttribute('title')).toContain('Status: pending');
        expect(li.getAttribute('title')).toContain('Comments: 3');
    });

    it('title omits status line when status is undefined', () => {
        renderItem({
            item: makeDocument({ relativePath: '', fileName: 'task.md', status: undefined }),
            commentCount: 0,
        });
        const li = screen.getByTestId('task-tree-item-task');
        const title = li.getAttribute('title') || '';
        expect(title).toContain('task.md');
        expect(title).not.toContain('Status:');
        expect(title).not.toContain('Comments:');
    });
});

describe('TaskTreeItem — Shift+right-click', () => {
    afterEach(() => cleanup());

    it('does not prevent default for Shift+contextmenu (native browser menu)', () => {
        const onFolderContextMenu = vi.fn();
        renderItem({ item: makeFolder(), onFolderContextMenu });
        const event = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            shiftKey: true,
            clientX: 10,
            clientY: 20,
        });
        const li = screen.getByTestId('task-tree-item-feature1');
        const prevented = !li.dispatchEvent(event);
        // Shift+contextmenu should NOT call onFolderContextMenu
        expect(onFolderContextMenu).not.toHaveBeenCalled();
        // Default should not be prevented (native menu should appear)
        expect(prevented).toBe(false);
    });
});

// ── buildFileTooltip unit tests ────────────────────────────────────────

describe('buildFileTooltip', () => {
    it('includes path, status, and comment count', () => {
        const result = buildFileTooltip('sub/task.md', 5, 'done');
        expect(result).toBe('sub/task.md\nStatus: done\nComments: 5');
    });

    it('omits status when undefined', () => {
        const result = buildFileTooltip('task.md', 2);
        expect(result).toBe('task.md\nComments: 2');
    });

    it('omits comment line when commentCount is 0', () => {
        const result = buildFileTooltip('task.md', 0, 'pending');
        expect(result).toBe('task.md\nStatus: pending');
    });

    it('returns empty string when path is null and no other data', () => {
        const result = buildFileTooltip(null, 0);
        expect(result).toBe('');
    });
});

describe('TaskTreeItem — backslash normalization in paths', () => {    afterEach(() => cleanup());

    it('normalizes backslashes in relativePath for single document click', () => {
        const onFileClick = vi.fn();
        renderItem({
            item: makeDocument({ relativePath: 'coc\\chat', fileName: 'render.md' }),
            onFileClick,
        });
        fireEvent.click(screen.getByTestId('task-tree-item-task'));
        expect(onFileClick).toHaveBeenCalledWith('coc/chat/render.md');
    });

    it('normalizes backslashes in relativePath for document group click', () => {
        const onFileClick = vi.fn();
        const group = makeDocumentGroup({
            baseName: 'design',
            documents: [
                { baseName: 'design', docType: 'spec', fileName: 'design.spec.md', relativePath: 'feat\\sub', isArchived: false },
            ],
        });
        renderItem({ item: group, onFileClick });
        fireEvent.click(screen.getByTestId('task-tree-item-design'));
        expect(onFileClick).toHaveBeenCalledWith('feat/sub/design.spec.md');
    });

    it('sets data-file-path with normalized forward slashes', () => {
        renderItem({
            item: makeDocument({ relativePath: 'coc\\chat', fileName: 'render.md', baseName: 'render' }),
        });
        const li = screen.getByTestId('task-tree-item-render');
        expect(li.getAttribute('data-file-path')).toBe('coc/chat/render.md');
    });

    it('tooltip shows normalized path', () => {
        renderItem({
            item: makeDocument({ relativePath: 'coc\\chat', fileName: 'render.md', baseName: 'render', status: 'pending' }),
            commentCount: 1,
        });
        const li = screen.getByTestId('task-tree-item-render');
        expect(li.getAttribute('title')).toContain('coc/chat/render.md');
    });
});

describe('TaskTreeItem — double-click behaviour', () => {
    afterEach(() => cleanup());

    it('double-clicking a file item calls onDoubleClick with the file path', () => {
        const onDoubleClick = vi.fn();
        renderItem({
            item: makeDocument({ relativePath: 'sub', fileName: 'task.md' }),
            onDoubleClick,
        });
        fireEvent.dblClick(screen.getByTestId('task-tree-item-task'));
        expect(onDoubleClick).toHaveBeenCalledWith('sub/task.md');
    });

    it('double-clicking a folder does NOT call onDoubleClick', () => {
        const onDoubleClick = vi.fn();
        renderItem({ item: makeFolder({ name: 'myfolder' }), onDoubleClick });
        fireEvent.dblClick(screen.getByTestId('task-tree-item-myfolder'));
        expect(onDoubleClick).not.toHaveBeenCalled();
    });

    it('double-clicking a document group calls onDoubleClick with first document path', () => {
        const onDoubleClick = vi.fn();
        const group = makeDocumentGroup({
            baseName: 'design',
            documents: [
                { baseName: 'design', docType: 'spec', fileName: 'design.spec.md', relativePath: 'feat', isArchived: false },
            ],
        });
        renderItem({ item: group, onDoubleClick });
        fireEvent.dblClick(screen.getByTestId('task-tree-item-design'));
        expect(onDoubleClick).toHaveBeenCalledWith('feat/design.spec.md');
    });

    it('does not throw if onDoubleClick prop is omitted', () => {
        renderItem({ item: makeDocument() });
        expect(() => fireEvent.dblClick(screen.getByTestId('task-tree-item-task'))).not.toThrow();
    });
});

describe('TaskTreeItem — long-press context menu (touch)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        cleanup();
    });

    it('fires onFolderContextMenu after 500ms touch hold on a folder', () => {
        const folder = makeFolder({ name: 'touchfolder' });
        const onFolderContextMenu = vi.fn();
        renderItem({ item: folder, onFolderContextMenu });
        const li = screen.getByTestId('task-tree-item-touchfolder');
        fireEvent.touchStart(li, {
            touches: [{ clientX: 120, clientY: 240 }],
        });
        expect(onFolderContextMenu).not.toHaveBeenCalled();
        vi.advanceTimersByTime(500);
        expect(onFolderContextMenu).toHaveBeenCalledWith(folder, 120, 240);
    });

    it('does not fire onFolderContextMenu when touch is released before 500ms', () => {
        const folder = makeFolder({ name: 'touchfolder2' });
        const onFolderContextMenu = vi.fn();
        renderItem({ item: folder, onFolderContextMenu });
        const li = screen.getByTestId('task-tree-item-touchfolder2');
        fireEvent.touchStart(li, { touches: [{ clientX: 10, clientY: 20 }] });
        fireEvent.touchEnd(li);
        vi.advanceTimersByTime(600);
        expect(onFolderContextMenu).not.toHaveBeenCalled();
    });

    it('cancels long-press timer on touch move (scroll guard)', () => {
        const folder = makeFolder({ name: 'scrollfolder' });
        const onFolderContextMenu = vi.fn();
        renderItem({ item: folder, onFolderContextMenu });
        const li = screen.getByTestId('task-tree-item-scrollfolder');
        fireEvent.touchStart(li, { touches: [{ clientX: 10, clientY: 20 }] });
        fireEvent.touchMove(li);
        vi.advanceTimersByTime(600);
        expect(onFolderContextMenu).not.toHaveBeenCalled();
    });

    it('fires onFileContextMenu after 500ms touch hold on a file', () => {
        const doc = makeDocument({ relativePath: 'feat', fileName: 'task.md' });
        const onFileContextMenu = vi.fn();
        renderItem({ item: doc, onFileContextMenu });
        const li = screen.getByTestId('task-tree-item-task');
        fireEvent.touchStart(li, { touches: [{ clientX: 50, clientY: 60 }] });
        vi.advanceTimersByTime(500);
        expect(onFileContextMenu).toHaveBeenCalledWith(doc, 50, 60);
    });

    it('suppresses click when long-press fires to prevent navigation', () => {
        const folder = makeFolder({ name: 'noclickfolder' });
        const onFolderClick = vi.fn();
        const onFolderContextMenu = vi.fn();
        renderItem({ item: folder, onFolderClick, onFolderContextMenu });
        const li = screen.getByTestId('task-tree-item-noclickfolder');
        fireEvent.touchStart(li, { touches: [{ clientX: 10, clientY: 20 }] });
        vi.advanceTimersByTime(500);
        // Simulate the click that fires after touchend on mobile browsers
        fireEvent.click(li);
        expect(onFolderClick).not.toHaveBeenCalled();
    });
});
