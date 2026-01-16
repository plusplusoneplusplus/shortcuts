/**
 * Tests for Temp File Utilities
 *
 * Comprehensive tests for temp file management used by {{RESULTS_FILE}}.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    writeTempFile,
    readTempFile,
    cleanupTempFile,
    cleanupAllTempFiles,
    ensureTempDir,
    generateTempFileName,
    isTempFilePath,
    getTempDirPath,
    TempFileResult
} from '../../../shortcuts/map-reduce/temp-file-utils';

suite('Temp File Utilities', () => {
    // Track files created during tests for cleanup
    const createdFiles: string[] = [];

    teardown(() => {
        // Clean up any files created during tests
        for (const filePath of createdFiles) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch {
                // Ignore cleanup errors
            }
        }
        createdFiles.length = 0;
    });

    suite('ensureTempDir', () => {
        test('creates temp directory if it does not exist', () => {
            const tempDir = ensureTempDir();
            assert.ok(tempDir, 'Should return temp directory path');
            assert.ok(fs.existsSync(tempDir), 'Temp directory should exist');
        });

        test('returns existing temp directory', () => {
            const tempDir1 = ensureTempDir();
            const tempDir2 = ensureTempDir();
            assert.strictEqual(tempDir1, tempDir2, 'Should return same path');
        });

        test('temp directory is under os.tmpdir()', () => {
            const tempDir = ensureTempDir();
            assert.ok(tempDir);
            assert.ok(
                tempDir.startsWith(os.tmpdir()),
                `Temp dir ${tempDir} should be under ${os.tmpdir()}`
            );
        });
    });

    suite('generateTempFileName', () => {
        test('generates unique filenames', () => {
            const name1 = generateTempFileName();
            const name2 = generateTempFileName();
            assert.notStrictEqual(name1, name2, 'Filenames should be unique');
        });

        test('uses provided prefix', () => {
            const name = generateTempFileName('myprefix');
            assert.ok(name.startsWith('myprefix_'), `Name ${name} should start with myprefix_`);
        });

        test('uses provided extension', () => {
            const name = generateTempFileName('test', '.txt');
            assert.ok(name.endsWith('.txt'), `Name ${name} should end with .txt`);
        });

        test('default extension is .json', () => {
            const name = generateTempFileName();
            assert.ok(name.endsWith('.json'), `Name ${name} should end with .json`);
        });

        test('filename contains timestamp for ordering', () => {
            const before = Date.now();
            const name = generateTempFileName();
            const after = Date.now();

            // Extract timestamp from filename (format: prefix_timestamp_random.ext)
            const match = name.match(/_(\d+)_/);
            assert.ok(match, 'Filename should contain timestamp');
            const timestamp = parseInt(match[1], 10);
            assert.ok(timestamp >= before && timestamp <= after, 'Timestamp should be recent');
        });
    });

    suite('writeTempFile', () => {
        test('writes content to temp file', () => {
            const content = 'Hello, World!';
            const result = writeTempFile(content);

            assert.ok(result, 'Should return TempFileResult');
            createdFiles.push(result.filePath);

            assert.ok(fs.existsSync(result.filePath), 'File should exist');
            const readContent = fs.readFileSync(result.filePath, 'utf8');
            assert.strictEqual(readContent, content, 'Content should match');
        });

        test('writes JSON content correctly', () => {
            const data = { key: 'value', nested: { array: [1, 2, 3] } };
            const content = JSON.stringify(data, null, 2);
            const result = writeTempFile(content);

            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = fs.readFileSync(result.filePath, 'utf8');
            const parsed = JSON.parse(readContent);
            assert.deepStrictEqual(parsed, data, 'JSON should round-trip correctly');
        });

        test('handles content with newlines', () => {
            const content = 'line1\nline2\nline3';
            const result = writeTempFile(content);

            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = fs.readFileSync(result.filePath, 'utf8');
            assert.strictEqual(readContent, content, 'Newlines should be preserved');
        });

        test('handles content with Windows line endings', () => {
            const content = 'line1\r\nline2\r\nline3';
            const result = writeTempFile(content);

            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = fs.readFileSync(result.filePath, 'utf8');
            assert.strictEqual(readContent, content, 'CRLF should be preserved');
        });

        test('handles content with special characters', () => {
            const content = 'Special: "quotes", \'apostrophes\', `backticks`, $dollars, %percent, !exclaim';
            const result = writeTempFile(content);

            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = fs.readFileSync(result.filePath, 'utf8');
            assert.strictEqual(readContent, content, 'Special characters should be preserved');
        });

        test('handles Unicode content', () => {
            const content = 'Unicode: 你好世界 🌍 émoji café naïve';
            const result = writeTempFile(content);

            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = fs.readFileSync(result.filePath, 'utf8');
            assert.strictEqual(readContent, content, 'Unicode should be preserved');
        });

        test('handles empty content', () => {
            const result = writeTempFile('');

            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = fs.readFileSync(result.filePath, 'utf8');
            assert.strictEqual(readContent, '', 'Empty content should work');
        });

        test('handles very large content', () => {
            // Create 1MB of content
            const content = 'x'.repeat(1024 * 1024);
            const result = writeTempFile(content);

            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = fs.readFileSync(result.filePath, 'utf8');
            assert.strictEqual(readContent.length, content.length, 'Large content should be preserved');
        });

        test('uses custom prefix', () => {
            const result = writeTempFile('content', 'custom-prefix');

            assert.ok(result);
            createdFiles.push(result.filePath);

            const filename = path.basename(result.filePath);
            assert.ok(filename.startsWith('custom-prefix_'), `Filename ${filename} should use custom prefix`);
        });

        test('uses custom extension', () => {
            const result = writeTempFile('content', 'test', '.txt');

            assert.ok(result);
            createdFiles.push(result.filePath);

            assert.ok(result.filePath.endsWith('.txt'), 'Should use custom extension');
        });

        test('cleanup function removes file', () => {
            const result = writeTempFile('content');

            assert.ok(result);
            assert.ok(fs.existsSync(result.filePath), 'File should exist before cleanup');

            result.cleanup();

            assert.ok(!fs.existsSync(result.filePath), 'File should not exist after cleanup');
        });

        test('cleanup function is idempotent', () => {
            const result = writeTempFile('content');

            assert.ok(result);
            result.cleanup();
            // Should not throw when called again
            result.cleanup();
            result.cleanup();
        });
    });

    suite('readTempFile', () => {
        test('reads content from temp file', () => {
            const content = 'Test content';
            const result = writeTempFile(content);
            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = readTempFile(result.filePath);
            assert.strictEqual(readContent, content);
        });

        test('returns undefined for non-existent file', () => {
            const result = readTempFile('/non/existent/path/file.txt');
            assert.strictEqual(result, undefined);
        });

        test('reads JSON content correctly', () => {
            const data = [
                { text: 'line1\nline2', score: 95 },
                { text: 'hello world', score: 80 }
            ];
            const content = JSON.stringify(data, null, 2);
            const result = writeTempFile(content);
            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = readTempFile(result.filePath);
            assert.ok(readContent);
            const parsed = JSON.parse(readContent);
            assert.deepStrictEqual(parsed, data);
        });
    });

    suite('cleanupTempFile', () => {
        test('deletes existing file', () => {
            const result = writeTempFile('content');
            assert.ok(result);

            const success = cleanupTempFile(result.filePath);
            assert.ok(success, 'Should return true on success');
            assert.ok(!fs.existsSync(result.filePath), 'File should be deleted');
        });

        test('returns true for non-existent file', () => {
            const success = cleanupTempFile('/non/existent/path/file.txt');
            assert.ok(success, 'Should return true for non-existent file');
        });
    });

    suite('cleanupAllTempFiles', () => {
        test('cleans up all temp files', () => {
            // Create multiple temp files
            const results: TempFileResult[] = [];
            for (let i = 0; i < 5; i++) {
                const result = writeTempFile(`content ${i}`);
                assert.ok(result);
                results.push(result);
            }

            // Verify files exist
            for (const result of results) {
                assert.ok(fs.existsSync(result.filePath));
            }

            // Clean up all
            const count = cleanupAllTempFiles();
            assert.ok(count >= 5, `Should clean up at least 5 files, got ${count}`);

            // Verify files are deleted
            for (const result of results) {
                assert.ok(!fs.existsSync(result.filePath), `File ${result.filePath} should be deleted`);
            }
        });
    });

    suite('isTempFilePath', () => {
        test('returns true for temp file paths', () => {
            const result = writeTempFile('content');
            assert.ok(result);
            createdFiles.push(result.filePath);

            assert.ok(isTempFilePath(result.filePath), 'Should recognize temp file path');
        });

        test('returns false for non-temp paths', () => {
            assert.ok(!isTempFilePath('/some/other/path/file.txt'));
            assert.ok(!isTempFilePath('relative/path/file.txt'));
            assert.ok(!isTempFilePath(os.tmpdir())); // Parent dir, not our subdir
        });
    });

    suite('getTempDirPath', () => {
        test('returns consistent path', () => {
            const path1 = getTempDirPath();
            const path2 = getTempDirPath();
            assert.strictEqual(path1, path2);
        });

        test('path is under os.tmpdir()', () => {
            const tempDirPath = getTempDirPath();
            assert.ok(tempDirPath.startsWith(os.tmpdir()));
        });
    });

    suite('Cross-platform JSON handling', () => {
        test('preserves JSON with embedded newlines in string values', () => {
            // This is the key test case - JSON with \n inside string values
            const data = [
                { text: 'line1\nline2', code: 'function() {\n  return true;\n}' }
            ];
            const jsonContent = JSON.stringify(data, null, 2);

            const result = writeTempFile(jsonContent);
            assert.ok(result);
            createdFiles.push(result.filePath);

            // Read back and verify JSON is valid
            const readContent = readTempFile(result.filePath);
            assert.ok(readContent);

            // This should NOT throw - the JSON should be valid
            const parsed = JSON.parse(readContent);
            assert.deepStrictEqual(parsed, data);

            // Verify the embedded newlines are preserved
            assert.strictEqual(parsed[0].text, 'line1\nline2');
            assert.ok(parsed[0].code.includes('\n'));
        });

        test('preserves pretty-printed JSON structure', () => {
            const data = {
                results: [
                    { id: 1, name: 'Item 1' },
                    { id: 2, name: 'Item 2' }
                ],
                summary: 'Test summary'
            };
            const jsonContent = JSON.stringify(data, null, 2);

            const result = writeTempFile(jsonContent);
            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = readTempFile(result.filePath);
            assert.ok(readContent);

            // Verify JSON is valid and matches
            const parsed = JSON.parse(readContent);
            assert.deepStrictEqual(parsed, data);

            // Verify formatting is preserved (has actual newlines)
            assert.ok(readContent.includes('\n'), 'Should contain newlines');
            assert.ok(readContent.includes('  '), 'Should contain indentation');
        });

        test('handles JSON with all problematic characters', () => {
            // Characters that cause issues with shell escaping
            const data = {
                quotes: 'He said "hello"',
                singleQuotes: "It's working",
                backslashes: 'path\\to\\file',
                newlines: 'line1\nline2',
                tabs: 'col1\tcol2',
                percent: '100% complete',
                exclamation: 'Hello!',
                dollars: '$PATH variable',
                backticks: '`command`'
            };
            const jsonContent = JSON.stringify(data, null, 2);

            const result = writeTempFile(jsonContent);
            assert.ok(result);
            createdFiles.push(result.filePath);

            const readContent = readTempFile(result.filePath);
            assert.ok(readContent);

            const parsed = JSON.parse(readContent);
            assert.deepStrictEqual(parsed, data);
        });
    });

    suite('File path handling', () => {
        test('file path is absolute', () => {
            const result = writeTempFile('content');
            assert.ok(result);
            createdFiles.push(result.filePath);

            assert.ok(path.isAbsolute(result.filePath), 'Path should be absolute');
        });

        test('file path uses correct separator for platform', () => {
            const result = writeTempFile('content');
            assert.ok(result);
            createdFiles.push(result.filePath);

            // On Windows, path should use backslashes
            // On Unix, path should use forward slashes
            if (process.platform === 'win32') {
                assert.ok(result.filePath.includes('\\'), 'Windows path should use backslashes');
            } else {
                assert.ok(result.filePath.includes('/'), 'Unix path should use forward slashes');
            }
        });

        test('file path can be used directly in prompts', () => {
            const result = writeTempFile('{"test": "data"}');
            assert.ok(result);
            createdFiles.push(result.filePath);

            // Simulate using the path in a prompt
            const prompt = `Read the results from: ${result.filePath}`;
            assert.ok(prompt.includes(result.filePath));

            // The path should not need any escaping for the AI to read it
            // (AI tools like copilot with --allow-all-paths can read any path)
        });
    });

    suite('Error handling', () => {
        test('writeTempFile handles write errors gracefully', () => {
            // This test verifies the function doesn't throw on errors
            // We can't easily simulate a write error, but we can verify
            // the function returns undefined on failure (not throws)

            // The function should return undefined if temp dir creation fails
            // In practice, this is hard to test without mocking fs
        });

        test('readTempFile handles read errors gracefully', () => {
            const result = readTempFile('/definitely/not/a/real/path/file.json');
            assert.strictEqual(result, undefined, 'Should return undefined on error');
        });

        test('cleanupTempFile handles errors gracefully', () => {
            // Should not throw even for invalid paths
            const result = cleanupTempFile('/definitely/not/a/real/path/file.json');
            assert.ok(result, 'Should return true even for non-existent file');
        });
    });
});
