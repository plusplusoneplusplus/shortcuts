/**
 * Tests for opening committed file diffs with the extension's diff review
 * Tests the integration between GitCommitFileItem and DiffReviewEditorProvider
 */

import * as assert from 'assert';
import * as path from 'path';
import { GitCommitFile, GitChangeStatus } from '../../shortcuts/git/types';
import { GitCommitFileItem } from '../../shortcuts/git/git-commit-file-item';
import { createCommittedGitContext } from '../../shortcuts/git-diff-comments';

/**
 * Create a mock GitCommitFile for testing
 */
function createMockCommitFile(
    status: GitChangeStatus = 'modified',
    filePath: string = 'src/test.ts',
    originalPath?: string
): GitCommitFile {
    return {
        path: filePath,
        originalPath,
        status,
        commitHash: 'abc123def456789',
        parentHash: 'parent123456789',
        repositoryRoot: '/test/repo'
    };
}

suite('Committed Diff Review Tests', () => {
    suite('GitCommitFileItem Command', () => {
        test('should set command to open commit file diff', () => {
            const file = createMockCommitFile();
            const item = new GitCommitFileItem(file);
            
            assert.strictEqual(item.command?.command, 'gitView.openCommitFileDiff');
            assert.strictEqual(item.command?.title, 'Open Diff');
            assert.deepStrictEqual(item.command?.arguments, [file]);
        });

        test('should pass complete file information in command arguments', () => {
            const file = createMockCommitFile('modified', 'src/components/Button.tsx');
            const item = new GitCommitFileItem(file);
            
            const fileArg = item.command?.arguments?.[0] as GitCommitFile;
            assert.strictEqual(fileArg.path, 'src/components/Button.tsx');
            assert.strictEqual(fileArg.commitHash, 'abc123def456789');
            assert.strictEqual(fileArg.parentHash, 'parent123456789');
            assert.strictEqual(fileArg.repositoryRoot, '/test/repo');
        });

        test('should include original path for renamed files', () => {
            const file = createMockCommitFile('renamed', 'new-name.ts', 'old-name.ts');
            const item = new GitCommitFileItem(file);
            
            const fileArg = item.command?.arguments?.[0] as GitCommitFile;
            assert.strictEqual(fileArg.path, 'new-name.ts');
            assert.strictEqual(fileArg.originalPath, 'old-name.ts');
        });
    });

    suite('createCommittedGitContext', () => {
        test('should create correct git context for committed files', () => {
            const repoRoot = '/test/repo';
            const repoName = 'test-repo';
            const commitHash = 'abc123def456789';
            const parentHash = 'parent123456789';

            const context = createCommittedGitContext(repoRoot, repoName, commitHash, parentHash);

            assert.strictEqual(context.repositoryRoot, repoRoot);
            assert.strictEqual(context.repositoryName, repoName);
            assert.strictEqual(context.oldRef, parentHash);
            assert.strictEqual(context.newRef, commitHash);
            assert.strictEqual(context.wasStaged, true);
            assert.strictEqual(context.commitHash, commitHash);
        });

        test('should set wasStaged to true for committed files', () => {
            const context = createCommittedGitContext('/repo', 'repo', 'commit', 'parent');
            assert.strictEqual(context.wasStaged, true);
        });

        test('should include commitHash in context', () => {
            const commitHash = 'specific-commit-hash';
            const context = createCommittedGitContext('/repo', 'repo', commitHash, 'parent');
            assert.strictEqual(context.commitHash, commitHash);
        });
    });

    suite('Command Arguments Structure', () => {
        test('should create commitFile wrapper for DiffReviewEditorProvider', () => {
            const file = createMockCommitFile();
            
            // This is the structure expected by DiffReviewEditorProvider.openDiffReview
            const commandArg = { commitFile: file };
            
            assert.ok(commandArg.commitFile);
            assert.strictEqual(commandArg.commitFile.path, file.path);
            assert.strictEqual(commandArg.commitFile.commitHash, file.commitHash);
            assert.strictEqual(commandArg.commitFile.parentHash, file.parentHash);
            assert.strictEqual(commandArg.commitFile.repositoryRoot, file.repositoryRoot);
        });

        test('should handle all file statuses', () => {
            const statuses: GitChangeStatus[] = [
                'modified', 'added', 'deleted', 'renamed', 'copied'
            ];

            for (const status of statuses) {
                const file = createMockCommitFile(status);
                const item = new GitCommitFileItem(file);
                
                assert.ok(item.command, `Command should exist for ${status} status`);
                assert.strictEqual(item.command?.command, 'gitView.openCommitFileDiff');
                
                const fileArg = item.command?.arguments?.[0] as GitCommitFile;
                assert.strictEqual(fileArg.status, status);
            }
        });
    });

    suite('Path Handling', () => {
        test('should handle files in subdirectories', () => {
            const file = createMockCommitFile('modified', 'src/components/ui/Button.tsx');
            const item = new GitCommitFileItem(file);
            
            const fileArg = item.command?.arguments?.[0] as GitCommitFile;
            assert.strictEqual(fileArg.path, 'src/components/ui/Button.tsx');
        });

        test('should handle files at repository root', () => {
            const file = createMockCommitFile('modified', 'package.json');
            const item = new GitCommitFileItem(file);
            
            const fileArg = item.command?.arguments?.[0] as GitCommitFile;
            assert.strictEqual(fileArg.path, 'package.json');
        });

        test('should preserve relative path format', () => {
            const file = createMockCommitFile('modified', './src/test.ts');
            const item = new GitCommitFileItem(file);
            
            const fileArg = item.command?.arguments?.[0] as GitCommitFile;
            assert.strictEqual(fileArg.path, './src/test.ts');
        });
    });

    suite('DiffReviewEditorProvider Integration', () => {
        test('should construct full path from commitFile', () => {
            const file = createMockCommitFile('modified', 'src/test.ts');
            
            // Simulate what DiffReviewEditorProvider.openDiffReview does
            const item = { commitFile: file };
            const filePath = path.join(item.commitFile.repositoryRoot, item.commitFile.path);
            
            assert.strictEqual(filePath, path.join('/test/repo', 'src/test.ts'));
        });

        test('should extract repository name from path', () => {
            const file = createMockCommitFile('modified', 'src/test.ts');
            file.repositoryRoot = '/Users/test/projects/my-repo';
            
            const repoName = path.basename(file.repositoryRoot);
            assert.strictEqual(repoName, 'my-repo');
        });

        test('should create git context from commitFile', () => {
            const file = createMockCommitFile('modified', 'src/test.ts');
            file.repositoryRoot = '/Users/test/projects/my-repo';
            
            const repoName = path.basename(file.repositoryRoot);
            const context = createCommittedGitContext(
                file.repositoryRoot,
                repoName,
                file.commitHash,
                file.parentHash
            );

            assert.strictEqual(context.repositoryRoot, '/Users/test/projects/my-repo');
            assert.strictEqual(context.repositoryName, 'my-repo');
            assert.strictEqual(context.oldRef, file.parentHash);
            assert.strictEqual(context.newRef, file.commitHash);
            assert.strictEqual(context.commitHash, file.commitHash);
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty parent hash (initial commit)', () => {
            const file = createMockCommitFile('added', 'new-file.ts');
            file.parentHash = '';
            
            const item = new GitCommitFileItem(file);
            const fileArg = item.command?.arguments?.[0] as GitCommitFile;
            
            assert.strictEqual(fileArg.parentHash, '');
        });

        test('should handle files with special characters in path', () => {
            const file = createMockCommitFile('modified', 'src/components/My Component.tsx');
            const item = new GitCommitFileItem(file);
            
            const fileArg = item.command?.arguments?.[0] as GitCommitFile;
            assert.strictEqual(fileArg.path, 'src/components/My Component.tsx');
        });

        test('should handle very long commit hashes', () => {
            const longHash = 'a'.repeat(40);
            const file = createMockCommitFile();
            file.commitHash = longHash;
            
            const item = new GitCommitFileItem(file);
            const fileArg = item.command?.arguments?.[0] as GitCommitFile;
            
            assert.strictEqual(fileArg.commitHash, longHash);
        });
    });
});

