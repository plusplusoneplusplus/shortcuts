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
});
