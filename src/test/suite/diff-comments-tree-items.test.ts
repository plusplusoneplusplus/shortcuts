/**
 * Tests for Git Diff Comments Tree Items
 * Tests tree item creation and context values for context menus
 */

import * as assert from 'assert';
import {
    DiffCommentCategoryItem,
    DiffCommentFileItem,
    DiffCommentItem
} from '../../shortcuts/git-diff-comments/diff-comments-tree-provider';
import { DiffComment, DiffGitContext, DiffSelection } from '../../shortcuts/git-diff-comments/types';

// Helper to create test comment
function createTestComment(
    id: string,
    filePath: string,
    comment: string,
    options: {
        status?: 'open' | 'resolved';
        side?: 'old' | 'new';
        startLine?: number;
        endLine?: number;
        commitHash?: string;
        wasStaged?: boolean;
    } = {}
): DiffComment {
    const {
        status = 'open',
        side = 'new',
        startLine = 10,
        endLine = 10,
        commitHash,
        wasStaged = false
    } = options;

    const selection: DiffSelection = {
        side,
        oldStartLine: side === 'old' ? startLine : null,
        oldEndLine: side === 'old' ? endLine : null,
        newStartLine: side === 'new' ? startLine : null,
        newEndLine: side === 'new' ? endLine : null,
        startColumn: 1,
        endColumn: 20
    };

    const gitContext: DiffGitContext = {
        repositoryRoot: '/test/repo',
        repositoryName: 'test-repo',
        oldRef: commitHash ? `${commitHash}^` : 'HEAD',
        newRef: commitHash || 'WORKING',
        wasStaged,
        commitHash
    };

    return {
        id,
        filePath,
        selection,
        selectedText: `const x = ${id};`,
        comment,
        status,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        gitContext
    };
}

suite('DiffCommentCategoryItem', () => {
    test('should have contextValue with hasOpen when open comments exist', () => {
        const item = new DiffCommentCategoryItem('pending', 3, 1);
        assert.strictEqual(item.contextValue, 'diffCommentCategory_hasOpen');
    });

    test('should have contextValue with noOpen when no open comments', () => {
        const item = new DiffCommentCategoryItem('pending', 0, 4);
        assert.strictEqual(item.contextValue, 'diffCommentCategory_noOpen');
    });

    test('should display pending changes label', () => {
        const item = new DiffCommentCategoryItem('pending', 3, 1);
        assert.strictEqual(item.label, 'Pending Changes');
    });

    test('should display commit hash label for committed', () => {
        const item = new DiffCommentCategoryItem('committed', 2, 0, 'abc123def');
        assert.strictEqual(item.label, 'Commit abc123d');
    });

    test('should show open count in description', () => {
        const item = new DiffCommentCategoryItem('pending', 3, 0);
        assert.strictEqual(item.description, '3 open');
    });

    test('should show open and resolved counts in description', () => {
        const item = new DiffCommentCategoryItem('pending', 3, 2);
        assert.strictEqual(item.description, '3 open, 2 resolved');
    });

    test('should show all resolved state', () => {
        const item = new DiffCommentCategoryItem('pending', 0, 4);
        assert.strictEqual(item.description, '0 open, 4 resolved');
    });

    test('should store category type', () => {
        const pendingItem = new DiffCommentCategoryItem('pending', 1, 0);
        const committedItem = new DiffCommentCategoryItem('committed', 1, 0, 'abc123');

        assert.strictEqual(pendingItem.category, 'pending');
        assert.strictEqual(committedItem.category, 'committed');
    });

    test('should store commit hash for committed category', () => {
        const item = new DiffCommentCategoryItem('committed', 1, 0, 'abc123def');
        assert.strictEqual(item.commitHash, 'abc123def');
    });

    test('should have expanded collapsible state', () => {
        const item = new DiffCommentCategoryItem('pending', 1, 0);
        // TreeItemCollapsibleState.Expanded = 2
        assert.strictEqual(item.collapsibleState, 2);
    });
});

suite('DiffCommentFileItem', () => {
    test('should have contextValue with hasOpen when open comments exist', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 2, 1);
        assert.strictEqual(item.contextValue, 'diffCommentFile_hasOpen');
    });

    test('should have contextValue with noOpen when no open comments', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 0, 5);
        assert.strictEqual(item.contextValue, 'diffCommentFile_noOpen');
    });

    test('should display file name as label', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 2, 1);
        assert.strictEqual(item.label, 'parser.ts');
    });

    test('should store full file path', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 2, 1);
        assert.strictEqual(item.filePath, '/test/repo/src/parser.ts');
    });

    test('should show open count in description', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 2, 0);
        assert.strictEqual(item.description, '2 open');
    });

    test('should show open and resolved counts in description', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 2, 3);
        assert.strictEqual(item.description, '2 open, 3 resolved');
    });

    test('should show all resolved state', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 0, 5);
        assert.strictEqual(item.description, '0 open, 5 resolved');
    });

    test('should store category and commit hash', () => {
        const gitContext: DiffGitContext = {
            repositoryRoot: '/test/repo',
            repositoryName: 'test-repo',
            oldRef: 'abc123^',
            newRef: 'abc123',
            wasStaged: false,
            commitHash: 'abc123'
        };

        const item = new DiffCommentFileItem(
            '/test/repo/src/parser.ts',
            2,
            1,
            gitContext,
            'committed',
            'abc123'
        );

        assert.strictEqual(item.category, 'committed');
        assert.strictEqual(item.commitHash, 'abc123');
        assert.strictEqual(item.gitContext?.commitHash, 'abc123');
    });

    test('should have command to open diff review', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 2, 1);
        assert.ok(item.command);
        assert.strictEqual(item.command.command, 'gitDiffComments.openFileWithReview');
    });

    test('should have expanded collapsible state', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 2, 1);
        // TreeItemCollapsibleState.Expanded = 2
        assert.strictEqual(item.collapsibleState, 2);
    });
});

suite('DiffCommentItem', () => {
    test('should have correct contextValue for open comment', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue', { status: 'open' });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.strictEqual(item.contextValue, 'diffComment_open');
    });

    test('should have correct contextValue for resolved comment', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue', { status: 'resolved' });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.strictEqual(item.contextValue, 'diffComment_resolved');
    });

    test('should store comment object', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue');
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.strictEqual(item.comment.id, '1');
        assert.strictEqual(item.comment.comment, 'Fix issue');
    });

    test('should store absolute file path', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue');
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.strictEqual(item.absoluteFilePath, '/test/repo/src/parser.ts');
    });

    test('should show line number in label for single line', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue', {
            startLine: 42,
            endLine: 42
        });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.ok(item.label?.toString().includes('Line 42'));
    });

    test('should show line range in label for multi-line', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue', {
            startLine: 42,
            endLine: 50
        });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.ok(item.label?.toString().includes('Lines 42-50'));
    });

    test('should show side indicator for new side', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue', { side: 'new' });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.ok(item.label?.toString().includes('(+)'));
    });

    test('should show side indicator for old side', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue', { side: 'old' });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.ok(item.label?.toString().includes('(-)'));
    });

    test('should show comment text in description', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix the null check issue');
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        const desc = item.description as string;
        assert.ok(desc.includes('Fix the null check issue'));
    });

    test('should truncate long comment in description', () => {
        const longComment = 'This is a very long comment that should be truncated because it exceeds the maximum length allowed for display';
        const comment = createTestComment('1', 'src/parser.ts', longComment);
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        const desc = item.description as string;
        assert.ok(desc.includes('...'));
        assert.ok(desc.length < longComment.length);
    });

    test('should have command to go to comment', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue');
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.ok(item.command);
        assert.strictEqual(item.command.command, 'gitDiffComments.goToComment');
    });

    test('should not be collapsible', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue');
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        // TreeItemCollapsibleState.None = 0
        assert.strictEqual(item.collapsibleState, 0);
    });
});

suite('Tree Item Tooltip', () => {
    test('should create markdown tooltip for comment item', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix the issue here', {
            status: 'open',
            side: 'new',
            startLine: 42
        });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');

        // Tooltip should be a MarkdownString
        assert.ok(item.tooltip);
        const tooltipString = item.tooltip.toString();
        assert.ok(tooltipString.includes('Open'));
        assert.ok(tooltipString.includes('New version'));
    });

    test('should show resolved status in tooltip', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fixed', {
            status: 'resolved'
        });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');

        const tooltipString = item.tooltip?.toString();
        assert.ok(tooltipString?.includes('Resolved'));
    });

    test('should include selected text in tooltip', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix issue');
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');

        const tooltipString = item.tooltip?.toString();
        assert.ok(tooltipString?.includes('const x = 1'));
    });
});

suite('Tree Item Icons', () => {
    test('should have yellow icon for pending category', () => {
        const item = new DiffCommentCategoryItem('pending', 1, 0);
        assert.ok(item.iconPath);
    });

    test('should have purple icon for committed category', () => {
        const item = new DiffCommentCategoryItem('committed', 1, 0, 'abc123');
        assert.ok(item.iconPath);
    });

    test('should have file icon for file item', () => {
        const item = new DiffCommentFileItem('/test/repo/src/parser.ts', 1, 0);
        assert.ok(item.iconPath);
    });

    test('should have comment icon for open comment', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fix', { status: 'open' });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.ok(item.iconPath);
    });

    test('should have check icon for resolved comment', () => {
        const comment = createTestComment('1', 'src/parser.ts', 'Fixed', { status: 'resolved' });
        const item = new DiffCommentItem(comment, '/test/repo/src/parser.ts');
        assert.ok(item.iconPath);
    });
});

