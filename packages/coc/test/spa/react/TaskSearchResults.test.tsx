/**
 * Tests for TaskSearchResults component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskSearchResults } from '../../../src/server/spa/client/react/tasks/TaskSearchResults';
import type { TaskDocument, TaskDocumentGroup } from '../../../src/server/spa/client/react/hooks/useTaskTree';

afterEach(cleanup);

// ── Fixtures ───────────────────────────────────────────────────────────

function makeDocument(overrides?: Partial<TaskDocument>): TaskDocument {
    return {
        baseName: 'task',
        fileName: 'task.md',
        relativePath: 'feature1',
        isArchived: false,
        ...overrides,
    };
}

function makeDocumentGroup(overrides?: Partial<TaskDocumentGroup>): TaskDocumentGroup {
    return {
        baseName: 'design',
        documents: [
            { baseName: 'design', docType: 'spec', fileName: 'design.spec.md', relativePath: 'feature1', isArchived: false },
        ],
        isArchived: false,
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('TaskSearchResults', () => {
    it('renders results with correct display names and icons', () => {
        const doc = makeDocument({ baseName: 'my-task', fileName: 'my-task.md', relativePath: 'sub' });
        const group = makeDocumentGroup({ baseName: 'my-design' });

        render(
            <TaskSearchResults
                results={[doc, group]}
                query="my"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        // 2 <li> elements
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(2);

        // Display names
        expect(screen.getByTestId('search-result-my-task')).toBeTruthy();
        expect(screen.getByTestId('search-result-my-design')).toBeTruthy();

        // Icons: TaskDocument -> 📝, TaskDocumentGroup -> 📄
        expect(screen.getByTestId('search-result-my-task').textContent).toContain('📝');
        expect(screen.getByTestId('search-result-my-design').textContent).toContain('📄');
    });

    it('shows empty state when no results match', () => {
        render(
            <TaskSearchResults
                results={[]}
                query="xyz"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        const emptyState = screen.getByTestId('search-empty-state');
        expect(emptyState).toBeTruthy();
        expect(emptyState.textContent).toContain('xyz');
        expect(emptyState.textContent).toContain('No tasks match');
    });

    it('calls onFileClick with the correct path when a result is clicked', () => {
        const onClick = vi.fn();
        const doc = makeDocument({ baseName: 'fix-bug', fileName: 'fix-bug.md', relativePath: 'bugs' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="fix"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={onClick}
            />,
        );

        fireEvent.click(screen.getByTestId('search-result-fix-bug'));
        expect(onClick).toHaveBeenCalledWith('bugs/fix-bug.md');
    });

    it('calls onFileClick with first doc path for a document group', () => {
        const onClick = vi.fn();
        const group = makeDocumentGroup({
            baseName: 'auth',
            documents: [
                { baseName: 'auth', docType: 'plan', fileName: 'auth.plan.md', relativePath: 'features', isArchived: false },
                { baseName: 'auth', docType: 'spec', fileName: 'auth.spec.md', relativePath: 'features', isArchived: false },
            ],
        });

        render(
            <TaskSearchResults
                results={[group]}
                query="auth"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={onClick}
            />,
        );

        fireEvent.click(screen.getByTestId('search-result-auth'));
        expect(onClick).toHaveBeenCalledWith('features/auth.plan.md');
    });

    it('shows comment count badge when count > 0', () => {
        const doc = makeDocument({ baseName: 'review', fileName: 'review.md', relativePath: 'pr' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="review"
                commentCounts={{ 'pr/review.md': 5 }}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        const row = screen.getByTestId('search-result-review');
        expect(row.textContent).toContain('5');
    });

    it('does not show comment count badge when count is 0', () => {
        const doc = makeDocument({ baseName: 'clean', fileName: 'clean.md', relativePath: '' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="clean"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        const row = screen.getByTestId('search-result-clean');
        // No badge content — only icon + name
        expect(row.querySelector('.bg-\\[\\#0078d4\\]')).toBeNull();
    });

    it('shows status icon for a document with status', () => {
        const doc = makeDocument({ baseName: 'done-task', fileName: 'done-task.md', status: 'done' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="done"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        const row = screen.getByTestId('search-result-done-task');
        expect(row.textContent).toContain('✅');
        // data-status attribute
        const statusSpan = row.querySelector('[data-status="done"]');
        expect(statusSpan).toBeTruthy();
    });

    it('shows correct status icons for each status type', () => {
        const items = [
            makeDocument({ baseName: 's-done', fileName: 's-done.md', status: 'done' }),
            makeDocument({ baseName: 's-progress', fileName: 's-progress.md', status: 'in-progress' }),
            makeDocument({ baseName: 's-pending', fileName: 's-pending.md', status: 'pending' }),
            makeDocument({ baseName: 's-future', fileName: 's-future.md', status: 'future' }),
        ];

        render(
            <TaskSearchResults
                results={items}
                query="s-"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        expect(screen.getByTestId('search-result-s-done').textContent).toContain('✅');
        expect(screen.getByTestId('search-result-s-progress').textContent).toContain('🔄');
        expect(screen.getByTestId('search-result-s-pending').textContent).toContain('⏳');
        expect(screen.getByTestId('search-result-s-future').textContent).toContain('📋');
    });

    it('does not show status icon when status is undefined', () => {
        const doc = makeDocument({ baseName: 'no-status', fileName: 'no-status.md' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="no"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        const row = screen.getByTestId('search-result-no-status');
        expect(row.querySelector('[data-status]')).toBeNull();
    });

    it('shows breadcrumb path when relativePath is present', () => {
        const doc = makeDocument({ baseName: 'deep', fileName: 'deep.md', relativePath: 'a/b/c' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="deep"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        const row = screen.getByTestId('search-result-deep');
        expect(row.textContent).toContain('a/b/c');
    });

    it('handles document with empty relativePath correctly', () => {
        const onClick = vi.fn();
        const doc = makeDocument({ baseName: 'root', fileName: 'root.md', relativePath: '' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="root"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={onClick}
            />,
        );

        fireEvent.click(screen.getByTestId('search-result-root'));
        expect(onClick).toHaveBeenCalledWith('root.md');
    });

    it('uses baseName for display when baseName is set on a document', () => {
        const doc = makeDocument({ baseName: 'my-alias', fileName: 'actual-file.md' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="alias"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        expect(screen.getByTestId('search-result-my-alias')).toBeTruthy();
    });

    it('falls back to fileName when baseName is empty', () => {
        const doc = makeDocument({ baseName: '', fileName: 'fallback.md' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="fall"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        expect(screen.getByTestId('search-result-fallback.md')).toBeTruthy();
    });

    it('calls onContextMenu with item and coordinates on right-click', () => {
        const onCtx = vi.fn();
        const doc = makeDocument({ baseName: 'ctx-test', fileName: 'ctx-test.md', relativePath: 'folder' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="ctx"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
                onContextMenu={onCtx}
            />,
        );

        const row = screen.getByTestId('search-result-ctx-test');
        fireEvent.contextMenu(row, { clientX: 100, clientY: 200 });

        expect(onCtx).toHaveBeenCalledTimes(1);
        expect(onCtx).toHaveBeenCalledWith(doc, 100, 200);
    });

    it('does not throw when onContextMenu is not provided and right-click occurs', () => {
        const doc = makeDocument({ baseName: 'no-ctx', fileName: 'no-ctx.md', relativePath: '' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="no"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        // Should not throw
        fireEvent.contextMenu(screen.getByTestId('search-result-no-ctx'));
    });

    it('renders future status search result with opacity-60 and italic', () => {
        const doc = makeDocument({ baseName: 'future-item', fileName: 'future-item.md', status: 'future' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="future"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        const row = screen.getByTestId('search-result-future-item');
        expect(row.className).toContain('opacity-60');
        expect(row.className).toContain('italic');
    });

    it('does not render opacity-60 for pending status in search results', () => {
        const doc = makeDocument({ baseName: 'pending-item', fileName: 'pending-item.md', status: 'pending' });

        render(
            <TaskSearchResults
                results={[doc]}
                query="pending"
                commentCounts={{}}
                wsId="ws1"
                onFileClick={vi.fn()}
            />,
        );

        const row = screen.getByTestId('search-result-pending-item');
        expect(row.className).not.toContain('opacity-60');
    });
});
