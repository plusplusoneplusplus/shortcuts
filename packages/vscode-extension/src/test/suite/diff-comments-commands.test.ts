/**
 * Tests for Git Diff Comments Commands
 * Tests context menu commands for category, file, and comment levels
 */

import * as assert from 'assert';
import * as path from 'path';
import { DiffPromptGenerator } from '../../shortcuts/git-diff-comments/diff-prompt-generator';
import { DiffComment, DiffGitContext, DiffSelection } from '../../shortcuts/git-diff-comments/types';

// Mock DiffCommentsManager for testing
class MockDiffCommentsManager {
    private comments: DiffComment[] = [];

    constructor(initialComments: DiffComment[] = []) {
        this.comments = initialComments;
    }

    getAllComments(): DiffComment[] {
        return this.comments;
    }

    getOpenComments(): DiffComment[] {
        return this.comments.filter(c => c.status === 'open');
    }

    getCommentsForFile(filePath: string): DiffComment[] {
        return this.comments.filter(c => c.filePath === filePath || c.filePath === path.basename(filePath));
    }

    getComment(id: string): DiffComment | undefined {
        return this.comments.find(c => c.id === id);
    }

    getOpenCommentCount(): number {
        return this.getOpenComments().length;
    }

    getResolvedCommentCount(): number {
        return this.comments.filter(c => c.status === 'resolved').length;
    }

    async resolveComment(id: string): Promise<void> {
        const comment = this.comments.find(c => c.id === id);
        if (comment) {
            comment.status = 'resolved';
        }
    }

    async reopenComment(id: string): Promise<void> {
        const comment = this.comments.find(c => c.id === id);
        if (comment) {
            comment.status = 'open';
        }
    }

    async deleteComment(id: string): Promise<void> {
        const index = this.comments.findIndex(c => c.id === id);
        if (index >= 0) {
            this.comments.splice(index, 1);
        }
    }

    async updateComment(id: string, updates: Partial<DiffComment>): Promise<void> {
        const comment = this.comments.find(c => c.id === id);
        if (comment) {
            Object.assign(comment, updates);
        }
    }
}

// Helper to create test comments
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

suite('DiffPromptGenerator', () => {
    suite('generatePrompt', () => {
        test('should return message when no open comments', () => {
            const manager = new MockDiffCommentsManager([]);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt();

            assert.strictEqual(result, 'No open comments to process.');
        });

        test('should generate markdown prompt for single comment', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Handle null case')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt();

            assert.ok(result.includes('# Code Review: Comments to Address'));
            assert.ok(result.includes('src/parser.ts'));
            assert.ok(result.includes('Handle null case'));
            assert.ok(result.includes('const x = 1;'));
        });

        test('should group comments by file', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Fix null check'),
                createTestComment('2', 'src/parser.ts', 'Add error handling'),
                createTestComment('3', 'src/utils.ts', 'Add type annotation')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt({ groupByFile: true });

            // Should have both files as sections
            assert.ok(result.includes('## src/parser.ts'));
            assert.ok(result.includes('## src/utils.ts'));
            // Should include all comments
            assert.ok(result.includes('Fix null check'));
            assert.ok(result.includes('Add error handling'));
            assert.ok(result.includes('Add type annotation'));
        });

        test('should include git context when requested', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Fix issue', { wasStaged: true })
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt({ includeGitContext: true });

            assert.ok(result.includes('**Repository:** test-repo'));
            assert.ok(result.includes('**Changes:** Staged changes'));
        });

        test('should show commit hash for committed changes', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Fix issue', { commitHash: 'abc123def' })
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt({ includeGitContext: true });

            assert.ok(result.includes('**Commit:** abc123d'));
        });

        test('should include line numbers and side in comment header', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Fix issue', {
                    startLine: 42,
                    endLine: 45,
                    side: 'new'
                })
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt();

            assert.ok(result.includes('Lines 42-45'));
            assert.ok(result.includes('added'));
        });

        test('should exclude resolved comments', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Open comment'),
                createTestComment('2', 'src/parser.ts', 'Resolved comment', { status: 'resolved' })
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt();

            assert.ok(result.includes('Open comment'));
            assert.ok(!result.includes('Resolved comment'));
        });
    });

    suite('generatePromptForCategory', () => {
        test('should filter pending changes comments', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Pending comment'),
                createTestComment('2', 'src/utils.ts', 'Committed comment', { commitHash: 'abc123' })
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePromptForCategory('pending');

            assert.ok(result.includes('Pending comment'));
            assert.ok(!result.includes('Committed comment'));
        });

        test('should filter committed comments by commit hash', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Pending comment'),
                createTestComment('2', 'src/utils.ts', 'Commit abc comment', { commitHash: 'abc123' }),
                createTestComment('3', 'src/api.ts', 'Commit def comment', { commitHash: 'def456' })
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePromptForCategory('committed', 'abc123');

            assert.ok(!result.includes('Pending comment'));
            assert.ok(result.includes('Commit abc comment'));
            assert.ok(!result.includes('Commit def comment'));
        });

        test('should return message when no comments in category', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Committed comment', { commitHash: 'abc123' })
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePromptForCategory('pending');

            assert.strictEqual(result, 'No open comments in this category.');
        });
    });

    suite('generatePromptForFile', () => {
        test('should generate prompt for specific file', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Parser comment'),
                createTestComment('2', 'src/utils.ts', 'Utils comment')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePromptForFile('src/parser.ts');

            assert.ok(result.includes('Parser comment'));
            assert.ok(!result.includes('Utils comment'));
        });

        test('should filter by category within file', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Pending comment'),
                createTestComment('2', 'src/parser.ts', 'Committed comment', { commitHash: 'abc123' })
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePromptForFile('src/parser.ts', 'pending');

            assert.ok(result.includes('Pending comment'));
            assert.ok(!result.includes('Committed comment'));
        });

        test('should return message when no comments for file', () => {
            const comments = [
                createTestComment('1', 'src/utils.ts', 'Utils comment')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePromptForFile('src/parser.ts');

            assert.strictEqual(result, 'No open comments for this file.');
        });
    });

    suite('generatePromptForComment', () => {
        test('should generate prompt for single comment', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Single comment')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePromptForComment('1');

            assert.ok(result.includes('Single comment'));
            assert.ok(result.includes('src/parser.ts'));
        });

        test('should return message when comment not found', () => {
            const manager = new MockDiffCommentsManager([]);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePromptForComment('nonexistent');

            assert.strictEqual(result, 'Comment not found.');
        });
    });

    suite('JSON output format', () => {
        test('should generate JSON prompt when requested', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Fix issue')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt({ outputFormat: 'json' });
            const parsed = JSON.parse(result);

            assert.strictEqual(parsed.task, 'Code Review');
            assert.ok(parsed.files);
            assert.strictEqual(parsed.files.length, 1);
            assert.strictEqual(parsed.files[0].filePath, 'src/parser.ts');
            assert.strictEqual(parsed.files[0].comments.length, 1);
            assert.strictEqual(parsed.files[0].comments[0].comment, 'Fix issue');
        });

        test('should include git context in JSON when requested', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Fix issue', { wasStaged: true })
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt({ outputFormat: 'json', includeGitContext: true });
            const parsed = JSON.parse(result);

            assert.ok(parsed.gitContext);
            assert.strictEqual(parsed.gitContext.repository, 'test-repo');
            assert.strictEqual(parsed.gitContext.changeType, 'staged');
        });

        test('should include code in JSON when requested', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Fix issue')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt({ outputFormat: 'json', includeCodeContext: true });
            const parsed = JSON.parse(result);

            assert.ok(parsed.files[0].comments[0].code);
            assert.ok(parsed.files[0].comments[0].code.includes('const x'));
        });
    });

    suite('getCommentsSummary', () => {
        test('should return file names summary', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Comment 1'),
                createTestComment('2', 'src/utils.ts', 'Comment 2')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.getCommentsSummary(comments);

            assert.ok(result.includes('parser.ts'));
            assert.ok(result.includes('utils.ts'));
        });
    });

    suite('Language detection', () => {
        test('should detect TypeScript files', () => {
            const comments = [
                createTestComment('1', 'src/parser.ts', 'Fix issue')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt({ includeCodeContext: true });

            assert.ok(result.includes('```typescript'));
        });

        test('should detect JavaScript files', () => {
            const comments = [
                createTestComment('1', 'src/parser.js', 'Fix issue')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt({ includeCodeContext: true });

            assert.ok(result.includes('```javascript'));
        });

        test('should detect Python files', () => {
            const comments = [
                createTestComment('1', 'src/parser.py', 'Fix issue')
            ];
            const manager = new MockDiffCommentsManager(comments);
            const generator = new DiffPromptGenerator(manager as any);

            const result = generator.generatePrompt({ includeCodeContext: true });

            assert.ok(result.includes('```python'));
        });
    });
});

suite('MockDiffCommentsManager Operations', () => {
    test('should resolve comment', async () => {
        const comments = [
            createTestComment('1', 'src/parser.ts', 'Comment', { status: 'open' })
        ];
        const manager = new MockDiffCommentsManager(comments);

        await manager.resolveComment('1');

        assert.strictEqual(manager.getComment('1')?.status, 'resolved');
    });

    test('should reopen comment', async () => {
        const comments = [
            createTestComment('1', 'src/parser.ts', 'Comment', { status: 'resolved' })
        ];
        const manager = new MockDiffCommentsManager(comments);

        await manager.reopenComment('1');

        assert.strictEqual(manager.getComment('1')?.status, 'open');
    });

    test('should delete comment', async () => {
        const comments = [
            createTestComment('1', 'src/parser.ts', 'Comment 1'),
            createTestComment('2', 'src/parser.ts', 'Comment 2')
        ];
        const manager = new MockDiffCommentsManager(comments);

        await manager.deleteComment('1');

        assert.strictEqual(manager.getAllComments().length, 1);
        assert.strictEqual(manager.getComment('1'), undefined);
        assert.ok(manager.getComment('2'));
    });

    test('should update comment', async () => {
        const comments = [
            createTestComment('1', 'src/parser.ts', 'Original comment')
        ];
        const manager = new MockDiffCommentsManager(comments);

        await manager.updateComment('1', { comment: 'Updated comment' });

        assert.strictEqual(manager.getComment('1')?.comment, 'Updated comment');
    });

    test('should count open and resolved comments', () => {
        const comments = [
            createTestComment('1', 'src/parser.ts', 'Open 1', { status: 'open' }),
            createTestComment('2', 'src/parser.ts', 'Open 2', { status: 'open' }),
            createTestComment('3', 'src/parser.ts', 'Resolved', { status: 'resolved' })
        ];
        const manager = new MockDiffCommentsManager(comments);

        assert.strictEqual(manager.getOpenCommentCount(), 2);
        assert.strictEqual(manager.getResolvedCommentCount(), 1);
    });

    test('should resolve all open comments', async () => {
        const comments = [
            createTestComment('1', 'src/parser.ts', 'Open 1', { status: 'open' }),
            createTestComment('2', 'src/parser.ts', 'Open 2', { status: 'open' }),
            createTestComment('3', 'src/parser.ts', 'Already resolved', { status: 'resolved' })
        ];
        const manager = new MockDiffCommentsManager(comments);

        // Resolve all open comments
        const openComments = manager.getOpenComments();
        for (const comment of openComments) {
            await manager.resolveComment(comment.id);
        }

        assert.strictEqual(manager.getOpenCommentCount(), 0);
        assert.strictEqual(manager.getResolvedCommentCount(), 3);
        assert.strictEqual(manager.getComment('1')?.status, 'resolved');
        assert.strictEqual(manager.getComment('2')?.status, 'resolved');
        assert.strictEqual(manager.getComment('3')?.status, 'resolved');
    });

    test('should delete all comments regardless of status', async () => {
        const comments = [
            createTestComment('1', 'src/parser.ts', 'Open 1', { status: 'open' }),
            createTestComment('2', 'src/parser.ts', 'Open 2', { status: 'open' }),
            createTestComment('3', 'src/parser.ts', 'Resolved', { status: 'resolved' })
        ];
        const manager = new MockDiffCommentsManager(comments);

        // Delete all comments
        const allComments = [...manager.getAllComments()];
        for (const comment of allComments) {
            await manager.deleteComment(comment.id);
        }

        assert.strictEqual(manager.getAllComments().length, 0);
        assert.strictEqual(manager.getOpenCommentCount(), 0);
        assert.strictEqual(manager.getResolvedCommentCount(), 0);
    });

    test('should delete all comments from multiple categories', async () => {
        const comments = [
            createTestComment('1', 'src/parser.ts', 'Pending open', { status: 'open' }),
            createTestComment('2', 'src/utils.ts', 'Pending resolved', { status: 'resolved' }),
            createTestComment('3', 'src/api.ts', 'Committed open', { status: 'open', commitHash: 'abc123' }),
            createTestComment('4', 'src/api.ts', 'Committed resolved', { status: 'resolved', commitHash: 'abc123' })
        ];
        const manager = new MockDiffCommentsManager(comments);

        assert.strictEqual(manager.getAllComments().length, 4);

        // Delete all comments
        const allComments = [...manager.getAllComments()];
        for (const comment of allComments) {
            await manager.deleteComment(comment.id);
        }

        assert.strictEqual(manager.getAllComments().length, 0);
    });
});

suite('Prompt Output Format Validation', () => {
    test('should match expected category-level prompt structure', () => {
        const comments = [
            createTestComment('1', 'src/utils/parser.ts', 'Handle null case', {
                startLine: 42,
                endLine: 45, // Multi-line so it shows "Lines 42-45"
                side: 'new'
            }),
            createTestComment('2', 'src/utils/parser.ts', 'Add error handling', {
                startLine: 58,
                side: 'new'
            }),
            createTestComment('3', 'src/services/utils.ts', 'Add input type annotation', {
                startLine: 15,
                side: 'new'
            })
        ];
        const manager = new MockDiffCommentsManager(comments);
        const generator = new DiffPromptGenerator(manager as any);

        const result = generator.generatePrompt({
            includeGitContext: true,
            groupByFile: true,
            includeCodeContext: true
        });

        // Verify structure
        assert.ok(result.includes('# Code Review: Comments to Address'));
        assert.ok(result.includes('**Repository:**'));
        assert.ok(result.includes('**Total Comments:** 3 open'));

        // Verify file grouping
        assert.ok(result.includes('## src/utils/parser.ts'));
        assert.ok(result.includes('## src/services/utils.ts'));

        // Verify comment format
        assert.ok(result.includes('### Comment 1'));
        assert.ok(result.includes('Lines 42-45'));  // Multi-line format
        assert.ok(result.includes('**Code:**'));
        assert.ok(result.includes('**Comment:**'));

        // Verify instructions
        assert.ok(result.includes('## Instructions'));
        assert.ok(result.includes('Address each comment'));
    });

    test('should match expected single comment prompt structure', () => {
        const comments = [
            createTestComment('1', 'src/utils/parser.ts', 'Handle null case', {
                startLine: 42,
                endLine: 42,  // Must match startLine for single-line format
                side: 'new',
                wasStaged: false
            })
        ];
        const manager = new MockDiffCommentsManager(comments);
        const generator = new DiffPromptGenerator(manager as any);

        // Use groupByFile: false to get the **File:** format
        const result = generator.generatePromptForComment('1', {
            includeGitContext: true,
            includeCodeContext: true,
            groupByFile: false
        });

        // Verify single comment structure
        assert.ok(result.includes('# Code Review: Comments to Address'));
        assert.ok(result.includes('**File:** `src/utils/parser.ts`'));
        // Single line shows as "Line 42" in the comment header, format is "(Line 42, added)"
        assert.ok(result.includes('Line 42, added'));
        assert.ok(result.includes('Handle null case'));
    });
});

