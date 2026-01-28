/**
 * Tests for diff-content-provider.ts
 * Covers line ending normalization and content retrieval
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import the functions we want to test
// Note: getFileAtRef is exported, normalizeLineEndings is internal
import { getFileAtRef } from '../../shortcuts/git-diff-comments/diff-content-provider';

suite('Diff Content Provider Tests', () => {

    suite('Line Ending Normalization', () => {
        let tempDir: string;
        let testFilePath: string;

        setup(() => {
            // Create a temp directory for test files
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-content-test-'));
            testFilePath = path.join(tempDir, 'test-file.txt');
        });

        teardown(() => {
            // Clean up temp files
            try {
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
                if (fs.existsSync(tempDir)) {
                    fs.rmdirSync(tempDir);
                }
            } catch {
                // Ignore cleanup errors
            }
        });

        test('should normalize CRLF to LF in working tree files', () => {
            // Create a file with CRLF line endings
            const contentWithCRLF = 'line1\r\nline2\r\nline3\r\n';
            fs.writeFileSync(testFilePath, contentWithCRLF, 'utf8');

            // Read using getFileAtRef with WORKING_TREE ref
            const result = getFileAtRef(testFilePath, 'WORKING_TREE', tempDir);

            // Verify CRLF was converted to LF
            assert.strictEqual(result, 'line1\nline2\nline3\n');
            assert.ok(!result.includes('\r'), 'Result should not contain CR characters');
        });

        test('should preserve LF line endings', () => {
            // Create a file with LF line endings
            const contentWithLF = 'line1\nline2\nline3\n';
            fs.writeFileSync(testFilePath, contentWithLF, 'utf8');

            // Read using getFileAtRef
            const result = getFileAtRef(testFilePath, 'WORKING_TREE', tempDir);

            // Verify content is unchanged
            assert.strictEqual(result, 'line1\nline2\nline3\n');
        });

        test('should normalize mixed line endings (CR, LF, CRLF)', () => {
            // Create a file with mixed line endings
            const contentMixed = 'line1\r\nline2\rline3\nline4\r\n';
            fs.writeFileSync(testFilePath, contentMixed, 'utf8');

            // Read using getFileAtRef
            const result = getFileAtRef(testFilePath, 'WORKING_TREE', tempDir);

            // Verify all line endings are LF
            assert.strictEqual(result, 'line1\nline2\nline3\nline4\n');
            assert.ok(!result.includes('\r'), 'Result should not contain CR characters');
        });

        test('should handle file with no line endings', () => {
            const contentNoNewline = 'single line no newline';
            fs.writeFileSync(testFilePath, contentNoNewline, 'utf8');

            const result = getFileAtRef(testFilePath, 'WORKING_TREE', tempDir);

            assert.strictEqual(result, 'single line no newline');
        });

        test('should handle empty file', () => {
            fs.writeFileSync(testFilePath, '', 'utf8');

            const result = getFileAtRef(testFilePath, 'WORKING_TREE', tempDir);

            assert.strictEqual(result, '');
        });

        test('should return empty string for non-existent file', () => {
            const nonExistentPath = path.join(tempDir, 'does-not-exist.txt');

            const result = getFileAtRef(nonExistentPath, 'WORKING_TREE', tempDir);

            assert.strictEqual(result, '');
        });
    });

    suite('Diff Comparison with Normalized Line Endings', () => {
        let tempDir: string;
        let oldFilePath: string;
        let newFilePath: string;

        setup(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-content-test-'));
            oldFilePath = path.join(tempDir, 'old-file.txt');
            newFilePath = path.join(tempDir, 'new-file.txt');
        });

        teardown(() => {
            try {
                if (fs.existsSync(oldFilePath)) {
                    fs.unlinkSync(oldFilePath);
                }
                if (fs.existsSync(newFilePath)) {
                    fs.unlinkSync(newFilePath);
                }
                if (fs.existsSync(tempDir)) {
                    fs.rmdirSync(tempDir);
                }
            } catch {
                // Ignore cleanup errors
            }
        });

        test('should produce identical content when only line endings differ', () => {
            // Create two files with identical content but different line endings
            const contentLF = 'line1\nline2\nline3\n';
            const contentCRLF = 'line1\r\nline2\r\nline3\r\n';

            fs.writeFileSync(oldFilePath, contentLF, 'utf8');
            fs.writeFileSync(newFilePath, contentCRLF, 'utf8');

            const oldResult = getFileAtRef(oldFilePath, 'WORKING_TREE', tempDir);
            const newResult = getFileAtRef(newFilePath, 'WORKING_TREE', tempDir);

            // After normalization, both should be identical
            assert.strictEqual(oldResult, newResult);
        });

        test('should correctly show actual content differences', () => {
            // Create two files with different content (not just line endings)
            const oldContent = 'line1\nline2\nline3\n';
            const newContent = 'line1\nmodified line2\nline3\nnew line4\n';

            fs.writeFileSync(oldFilePath, oldContent, 'utf8');
            fs.writeFileSync(newFilePath, newContent, 'utf8');

            const oldResult = getFileAtRef(oldFilePath, 'WORKING_TREE', tempDir);
            const newResult = getFileAtRef(newFilePath, 'WORKING_TREE', tempDir);

            // Content should differ
            assert.notStrictEqual(oldResult, newResult);
            assert.ok(newResult.includes('modified line2'));
            assert.ok(newResult.includes('new line4'));
        });
    });

    suite('Range Diff Content - Merge Base Handling', () => {
        // These tests verify that getRangeDiffContent correctly handles
        // the merge-base output which includes a trailing newline
        // Bug: Without trimming, git show interprets "commit\n:file" as
        // showing the commit (not the file), leaking commit info into content
        
        let tempRepoDir: string;
        let mainCommitHash: string;
        let featureCommitHash: string;

        setup(function() {
            // Skip if git is not available
            try {
                const { execSync } = require('child_process');
                execSync('git --version', { stdio: 'pipe' });
            } catch {
                this.skip();
                return;
            }

            // Create a test git repository
            tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-range-test-'));
            const { execSync } = require('child_process');
            
            // Initialize git repo
            execSync('git init', { cwd: tempRepoDir, stdio: 'pipe' });
            execSync('git config user.email "test@example.com"', { cwd: tempRepoDir, stdio: 'pipe' });
            execSync('git config user.name "Test User"', { cwd: tempRepoDir, stdio: 'pipe' });
            
            // Create initial commit on main branch
            const existingFile = path.join(tempRepoDir, 'existing.txt');
            fs.writeFileSync(existingFile, 'existing content\n');
            execSync('git add .', { cwd: tempRepoDir, stdio: 'pipe' });
            execSync('git commit -m "Initial commit"', { cwd: tempRepoDir, stdio: 'pipe' });
            mainCommitHash = execSync('git rev-parse HEAD', { cwd: tempRepoDir, encoding: 'utf8' }).trim();
            
            // Create a feature branch with a new file
            execSync('git checkout -b feature-branch', { cwd: tempRepoDir, stdio: 'pipe' });
            const newFile = path.join(tempRepoDir, 'new-file.txt');
            fs.writeFileSync(newFile, 'This is a brand new file\nwith multiple lines\nof content\n');
            execSync('git add .', { cwd: tempRepoDir, stdio: 'pipe' });
            execSync('git commit -m "Add new file"', { cwd: tempRepoDir, stdio: 'pipe' });
            featureCommitHash = execSync('git rev-parse HEAD', { cwd: tempRepoDir, encoding: 'utf8' }).trim();
        });

        teardown(() => {
            // Clean up temp repo
            if (tempRepoDir && fs.existsSync(tempRepoDir)) {
                try {
                    fs.rmSync(tempRepoDir, { recursive: true, force: true });
                } catch {
                    // Ignore cleanup errors
                }
            }
        });

        test('should return file content for new files, not commit info', function() {
            // Import the function we're testing
            const { getRangeDiffContent } = require('../../shortcuts/git-diff-comments/diff-content-provider');
            
            // Get range diff for a new file (doesn't exist at baseRef)
            const result = getRangeDiffContent(
                'new-file.txt',
                mainCommitHash,  // base: before new file was added
                featureCommitHash,  // head: after new file was added
                tempRepoDir
            );

            // oldContent should be empty (file didn't exist at base)
            assert.strictEqual(result.oldContent, '', 'Old content should be empty for new file');
            
            // newContent should contain the actual file content
            assert.ok(result.newContent.includes('This is a brand new file'), 
                'New content should contain actual file content');
            assert.ok(result.newContent.includes('with multiple lines'), 
                'New content should contain file content, not commit info');
            
            // Most importantly: should NOT contain commit metadata
            assert.ok(!result.newContent.includes('commit '), 
                'Content should not contain commit metadata');
            assert.ok(!result.newContent.includes('Author:'), 
                'Content should not contain Author info');
            assert.ok(!result.newContent.includes('Date:'), 
                'Content should not contain Date info');
            assert.ok(!result.newContent.includes('diff --git'), 
                'Content should not contain diff output');
        });

        test('should return correct content for existing files', function() {
            const { getRangeDiffContent } = require('../../shortcuts/git-diff-comments/diff-content-provider');
            
            // Get range diff for an existing file
            const result = getRangeDiffContent(
                'existing.txt',
                mainCommitHash,
                featureCommitHash,
                tempRepoDir
            );

            // Both old and new content should have the same content
            // (file wasn't changed between commits)
            assert.strictEqual(result.oldContent, 'existing content\n');
            assert.strictEqual(result.newContent, 'existing content\n');
            
            // Should NOT contain commit metadata
            assert.ok(!result.oldContent.includes('commit '));
            assert.ok(!result.newContent.includes('Author:'));
        });

        test('should handle modified files correctly in range diff', function() {
            const { execSync } = require('child_process');
            const { getRangeDiffContent } = require('../../shortcuts/git-diff-comments/diff-content-provider');
            
            // Modify the existing file and commit
            const existingFile = path.join(tempRepoDir, 'existing.txt');
            fs.writeFileSync(existingFile, 'modified content\nwith new lines\n');
            execSync('git add .', { cwd: tempRepoDir, stdio: 'pipe' });
            execSync('git commit -m "Modify existing file"', { cwd: tempRepoDir, stdio: 'pipe' });
            const modifiedCommitHash = execSync('git rev-parse HEAD', { cwd: tempRepoDir, encoding: 'utf8' }).trim();
            
            // Get range diff
            const result = getRangeDiffContent(
                'existing.txt',
                mainCommitHash,
                modifiedCommitHash,
                tempRepoDir
            );

            // Old content should be original
            assert.strictEqual(result.oldContent, 'existing content\n');
            
            // New content should be modified
            assert.strictEqual(result.newContent, 'modified content\nwith new lines\n');
            
            // Should NOT contain commit metadata
            assert.ok(!result.oldContent.includes('commit '));
            assert.ok(!result.newContent.includes('commit '));
        });
    });
});
