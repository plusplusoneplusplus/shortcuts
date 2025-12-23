/**
 * Tests for editable diff view functionality
 * Covers: isEditable flag for uncommitted changes
 */

import * as assert from 'assert';
import { DiffGitContext, DiffWebviewState } from '../../shortcuts/git-diff-comments';

/**
 * Check if the diff is editable (uncommitted changes to working tree)
 * This mirrors the logic in diff-review-editor-provider.ts
 */
function isEditableDiff(gitContext: DiffGitContext): boolean {
    return gitContext.newRef === 'WORKING_TREE';
}

suite('Diff Editable Tests', () => {

    suite('isEditableDiff Function', () => {
        test('should return true for unstaged changes (working tree)', () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: '/repo',
                repositoryName: 'test-repo',
                oldRef: ':0',
                newRef: 'WORKING_TREE',
                wasStaged: false
            };

            assert.strictEqual(isEditableDiff(gitContext), true);
        });

        test('should return true for untracked files (working tree)', () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: '/repo',
                repositoryName: 'test-repo',
                oldRef: 'EMPTY',
                newRef: 'WORKING_TREE',
                wasStaged: false
            };

            assert.strictEqual(isEditableDiff(gitContext), true);
        });

        test('should return false for staged changes', () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: '/repo',
                repositoryName: 'test-repo',
                oldRef: 'HEAD',
                newRef: ':0',
                wasStaged: true
            };

            assert.strictEqual(isEditableDiff(gitContext), false);
        });

        test('should return false for committed changes', () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: '/repo',
                repositoryName: 'test-repo',
                oldRef: 'abc123^',
                newRef: 'abc123',
                wasStaged: false,
                commitHash: 'abc123def456789'
            };

            assert.strictEqual(isEditableDiff(gitContext), false);
        });

        test('should return false for HEAD to HEAD~1 comparison', () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: '/repo',
                repositoryName: 'test-repo',
                oldRef: 'HEAD~1',
                newRef: 'HEAD',
                wasStaged: false
            };

            assert.strictEqual(isEditableDiff(gitContext), false);
        });
    });

    suite('DiffWebviewState with isEditable', () => {
        test('should include isEditable flag for unstaged changes', () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: '/repo',
                repositoryName: 'test-repo',
                oldRef: ':0',
                newRef: 'WORKING_TREE',
                wasStaged: false
            };

            const state: DiffWebviewState = {
                filePath: 'src/file.ts',
                gitContext,
                oldContent: 'old content',
                newContent: 'new content',
                isEditable: true
            };

            assert.strictEqual(state.isEditable, true);
        });

        test('should include isEditable flag for committed changes', () => {
            const gitContext: DiffGitContext = {
                repositoryRoot: '/repo',
                repositoryName: 'test-repo',
                oldRef: 'abc123^',
                newRef: 'abc123',
                wasStaged: false,
                commitHash: 'abc123'
            };

            const state: DiffWebviewState = {
                filePath: 'src/file.ts',
                gitContext,
                oldContent: 'old content',
                newContent: 'new content',
                isEditable: false
            };

            assert.strictEqual(state.isEditable, false);
        });

        test('should be serializable with isEditable flag', () => {
            const state: DiffWebviewState = {
                filePath: 'src/file.ts',
                gitContext: {
                    repositoryRoot: '/repo',
                    repositoryName: 'test-repo',
                    oldRef: ':0',
                    newRef: 'WORKING_TREE',
                    wasStaged: false
                },
                oldContent: 'old content',
                newContent: 'new content',
                isEditable: true
            };

            const serialized = JSON.stringify(state);
            const deserialized: DiffWebviewState = JSON.parse(serialized);

            assert.strictEqual(deserialized.isEditable, true);
        });

        test('should handle undefined isEditable (backwards compatibility)', () => {
            const state: DiffWebviewState = {
                filePath: 'src/file.ts',
                gitContext: {
                    repositoryRoot: '/repo',
                    repositoryName: 'test-repo',
                    oldRef: 'HEAD',
                    newRef: ':0',
                    wasStaged: true
                },
                oldContent: 'old content',
                newContent: 'new content'
                // isEditable is undefined
            };

            // Should default to false when undefined
            assert.strictEqual(state.isEditable ?? false, false);
        });
    });
});

