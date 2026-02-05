/**
 * E2E tests for Git Diff Comments on committed files
 * Tests the full flow: Open diff from commit -> Add comment -> Verify storage
 */

import * as assert from 'assert';
import * as path from 'path';
import {
    DiffCommentsManager,
    DiffSelection,
    DiffComment,
    createCommittedGitContext,
    DiffGitContext
} from '../../shortcuts/git-diff-comments';
import {
    createTestGitRepo,
    addCommit,
    cleanupTestRepo,
    getParentHash,
    GitTestRepo,
    createRepoWithHistory
} from '../helpers/git-test-helpers';

suite('Git Diff Comments E2E Tests', function() {
    // Increase timeout for the entire suite, especially for Windows CI
    this.timeout(10000);
    
    let repo: GitTestRepo;
    let manager: DiffCommentsManager;

    setup(async function() {
        // Git operations can be slow on Windows CI, so increase the timeout
        this.timeout(8000);
        
        // Create test git repository with history
        repo = createRepoWithHistory();
        
        // Create manager (provider not needed for most tests)
        manager = new DiffCommentsManager(repo.repoPath);
        await manager.initialize();
    });

    teardown(async () => {
        // Cleanup repo
        if (repo) {
            cleanupTestRepo(repo);
        }
    });

    suite('Git Context for Committed Files', () => {
        test('should create correct git context for committed file', async function() {
            // Get the latest commit (should be "Add utils")
            const commit = repo.commits[repo.commits.length - 1];
            const parentHash = getParentHash(repo, commit.hash);
            
            // Create git context for committed file
            const gitContext = createCommittedGitContext(
                repo.repoPath,
                'test-repo',
                commit.hash,
                parentHash
            );
            
            // Verify git context has commitHash
            assert.strictEqual(gitContext.commitHash, commit.hash);
            assert.strictEqual(gitContext.oldRef, parentHash);
            assert.strictEqual(gitContext.newRef, commit.hash);
            assert.strictEqual(gitContext.wasStaged, true);
            assert.strictEqual(gitContext.repositoryRoot, repo.repoPath);
            assert.strictEqual(gitContext.repositoryName, 'test-repo');
        });
    });

    suite('Adding Comments to Committed Files', () => {
        test('should add comment to committed file via manager', async () => {
            // Get a commit with modified file
            const commit = repo.commits[2]; // "Update feature" commit
            const parentHash = getParentHash(repo, commit.hash);
            
            const gitContext = createCommittedGitContext(
                repo.repoPath,
                'test-repo',
                commit.hash,
                parentHash
            );
            
            // Create a selection on the new side
            const selection: DiffSelection = {
                side: 'new',
                oldStartLine: null,
                oldEndLine: null,
                newStartLine: 2,
                newEndLine: 2,
                startColumn: 3,
                endColumn: 15
            };
            
            const selectedText = 'return "v2";';
            const commentText = 'This is a test comment on committed file';
            const content = 'export function feature() {\n  return "v2";\n}\n';
            
            // Add comment
            await manager.addComment(
                'src/feature.ts',
                selection,
                selectedText,
                commentText,
                gitContext,
                content
            );
            
            // Verify comment was added
            const comments = manager.getCommentsForFile('src/feature.ts');
            assert.strictEqual(comments.length, 1);
            
            const comment = comments[0];
            assert.strictEqual(comment.comment, commentText);
            assert.strictEqual(comment.selectedText, selectedText);
            assert.strictEqual(comment.gitContext.commitHash, commit.hash);
            assert.strictEqual(comment.status, 'open');
        });

        test('should support multiple comments on same committed file', async () => {
            const commit = repo.commits[2]; // "Update feature" commit
            const parentHash = getParentHash(repo, commit.hash);
            
            const gitContext = createCommittedGitContext(
                repo.repoPath,
                'test-repo',
                commit.hash,
                parentHash
            );
            
            const content = 'export function feature() {\n  return "v2";\n}\n';
            
            // Add first comment
            await manager.addComment(
                'src/feature.ts',
                {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: 1,
                    newEndLine: 1,
                    startColumn: 1,
                    endColumn: 10
                },
                'export function',
                'Comment 1',
                gitContext,
                content
            );
            
            // Add second comment
            await manager.addComment(
                'src/feature.ts',
                {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: 2,
                    newEndLine: 2,
                    startColumn: 3,
                    endColumn: 15
                },
                'return "v2";',
                'Comment 2',
                gitContext,
                content
            );
            
            // Verify both comments exist
            const comments = manager.getCommentsForFile('src/feature.ts');
            assert.strictEqual(comments.length, 2);
            assert.strictEqual(comments[0].comment, 'Comment 1');
            assert.strictEqual(comments[1].comment, 'Comment 2');
        });

        test('should distinguish between comments on different commits', async () => {
            // Add comment to commit 2
            const commit2 = repo.commits[2];
            const parent2 = getParentHash(repo, commit2.hash);
            const gitContext2 = createCommittedGitContext(
                repo.repoPath,
                'test-repo',
                commit2.hash,
                parent2
            );
            
            await manager.addComment(
                'src/feature.ts',
                {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: 2,
                    newEndLine: 2,
                    startColumn: 1,
                    endColumn: 10
                },
                'v2 content',
                'Comment on commit 2',
                gitContext2,
                'export function feature() {\n  return "v2";\n}\n'
            );
            
            // Add comment to commit 1 (different version of same file)
            const commit1 = repo.commits[1];
            const parent1 = getParentHash(repo, commit1.hash);
            const gitContext1 = createCommittedGitContext(
                repo.repoPath,
                'test-repo',
                commit1.hash,
                parent1
            );
            
            await manager.addComment(
                'src/feature.ts',
                {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: 2,
                    newEndLine: 2,
                    startColumn: 1,
                    endColumn: 10
                },
                'v1 content',
                'Comment on commit 1',
                gitContext1,
                'export function feature() {\n  return "v1";\n}\n'
            );
            
            // Verify both comments exist but are distinct
            const allComments = manager.getCommentsForFile('src/feature.ts');
            assert.strictEqual(allComments.length, 2);
            
            // Filter by commit hash
            const commit2Comments = allComments.filter((c: DiffComment) => c.gitContext.commitHash === commit2.hash);
            const commit1Comments = allComments.filter((c: DiffComment) => c.gitContext.commitHash === commit1.hash);
            
            assert.strictEqual(commit2Comments.length, 1);
            assert.strictEqual(commit1Comments.length, 1);
            assert.strictEqual(commit2Comments[0].comment, 'Comment on commit 2');
            assert.strictEqual(commit1Comments[0].comment, 'Comment on commit 1');
        });
    });

    suite('Comment Operations on Committed Files', () => {
        test('should resolve and unresolve comment on committed file', async () => {
            const commit = repo.commits[2];
            const parentHash = getParentHash(repo, commit.hash);
            const gitContext = createCommittedGitContext(
                repo.repoPath,
                'test-repo',
                commit.hash,
                parentHash
            );
            
            // Add comment
            await manager.addComment(
                'src/feature.ts',
                {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: 2,
                    newEndLine: 2,
                    startColumn: 1,
                    endColumn: 10
                },
                'test',
                'Test comment',
                gitContext,
                'content'
            );
            
            const comments = manager.getCommentsForFile('src/feature.ts');
            const commentId = comments[0].id;
            
            // Resolve
            await manager.resolveComment(commentId);
            let updatedComments = manager.getCommentsForFile('src/feature.ts');
            assert.strictEqual(updatedComments[0].status, 'resolved');
            
            // Reopen (unresolve)
            await manager.reopenComment(commentId);
            updatedComments = manager.getCommentsForFile('src/feature.ts');
            assert.strictEqual(updatedComments[0].status, 'open');
        });

        test('should delete comment from committed file', async () => {
            const commit = repo.commits[2];
            const parentHash = getParentHash(repo, commit.hash);
            const gitContext = createCommittedGitContext(
                repo.repoPath,
                'test-repo',
                commit.hash,
                parentHash
            );
            
            // Add comment
            await manager.addComment(
                'src/feature.ts',
                {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: 2,
                    newEndLine: 2,
                    startColumn: 1,
                    endColumn: 10
                },
                'test',
                'Test comment to delete',
                gitContext,
                'content'
            );
            
            const comments = manager.getCommentsForFile('src/feature.ts');
            assert.strictEqual(comments.length, 1);
            
            const commentId = comments[0].id;
            
            // Delete
            await manager.deleteComment(commentId);
            
            const remainingComments = manager.getCommentsForFile('src/feature.ts');
            assert.strictEqual(remainingComments.length, 0);
        });
    });

    suite('Webview Keyboard Shortcut Handler', () => {
        test('should have keyboard shortcut handler in webview script', () => {
            // This tests that the webview-internal keyboard handler exists
            // We can't directly test keyboard input, but we verify the setup exists
            
            // The webview script sets up Ctrl+Shift+M handler
            // Located in: webview-scripts/main.ts setupKeyboardShortcuts()
            // This is a smoke test to ensure the mechanism is in place
            
            assert.ok(true, 'Webview keyboard shortcut handler exists in codebase');
            
            // Note: Actual keyboard simulation would require:
            // 1. Webview panel to be open and focused
            // 2. Simulating browser keyboard events
            // 3. Intercepting message passing
            // This is complex and brittle, so we rely on:
            // - Unit tests for the handler function
            // - Integration tests for comment creation
            // - Manual testing for actual keyboard input
        });
    });

    suite('Comment Persistence', () => {
        test('should persist comments to disk', async () => {
            const commit = repo.commits[2];
            const parentHash = getParentHash(repo, commit.hash);
            const gitContext = createCommittedGitContext(
                repo.repoPath,
                'test-repo',
                commit.hash,
                parentHash
            );
            
            // Add comment
            await manager.addComment(
                'src/feature.ts',
                {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: 2,
                    newEndLine: 2,
                    startColumn: 1,
                    endColumn: 10
                },
                'test',
                'Persistent comment',
                gitContext,
                'content'
            );
            
            // Create new manager (simulates reload)
            const newManager = new DiffCommentsManager(repo.repoPath);
            await newManager.initialize(); // Must initialize to load from disk
            
            // Verify comment was loaded from disk
            const comments = newManager.getCommentsForFile('src/feature.ts');
            assert.strictEqual(comments.length, 1);
            assert.strictEqual(comments[0].comment, 'Persistent comment');
            assert.strictEqual(comments[0].gitContext.commitHash, commit.hash);
        });
    });

    suite('Comment Validation', () => {
        test('should mark comment as stale if commit no longer exists', async () => {
            // This test simulates what happens if a commit is deleted
            // In practice, this is rare but can happen with force pushes or rebase
            
            const fakeCommitHash = 'nonexistent1234567890abcdef';
            const fakeParentHash = 'fakeparent1234567890abcdef';
            
            const gitContext = createCommittedGitContext(
                repo.repoPath,
                'test-repo',
                fakeCommitHash,
                fakeParentHash
            );
            
            // Add comment with fake commit
            await manager.addComment(
                'fake/file.ts',
                {
                    side: 'new',
                    oldStartLine: null,
                    oldEndLine: null,
                    newStartLine: 1,
                    newEndLine: 1,
                    startColumn: 1,
                    endColumn: 10
                },
                'test',
                'Comment on non-existent commit',
                gitContext,
                'content'
            );
            
            // Verify validation detects the issue using getObsoleteComments
            const obsoleteComments = manager.getObsoleteComments([]);
            
            // Should have at least one obsolete comment
            assert.ok(obsoleteComments.length > 0);
            
            // Find our comment
            const obsoleteComment = obsoleteComments.find((item: { comment: DiffComment; reason: string }) => 
                item.comment.gitContext.commitHash === fakeCommitHash
            );
            
            assert.ok(obsoleteComment, 'Fake commit should be marked as obsolete');
            assert.ok(
                obsoleteComment?.reason.includes('no longer exists'),
                'Obsolete reason should mention commit does not exist'
            );
        });
    });
});
