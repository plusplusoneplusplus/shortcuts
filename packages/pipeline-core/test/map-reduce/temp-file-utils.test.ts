/**
 * Tests for Temp File Utilities
 *
 * Comprehensive tests for temp file management used by {{RESULTS_FILE}}.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, afterEach } from 'vitest';
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
} from '../../src/map-reduce/temp-file-utils';

describe('Temp File Utilities', () => {
    // Track files created during tests for cleanup
    const createdFiles: string[] = [];

    afterEach(() => {
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

    describe('ensureTempDir', () => {
        it('creates temp directory if it does not exist', () => {
            const tempDir = ensureTempDir();
            expect(tempDir).toBeTruthy();
            expect(fs.existsSync(tempDir)).toBe(true);
        });

        it('returns existing temp directory', () => {
            const tempDir1 = ensureTempDir();
            const tempDir2 = ensureTempDir();
            expect(tempDir1).toBe(tempDir2);
        });

        it('temp directory is under os.tmpdir()', () => {
            const tempDir = ensureTempDir();
            expect(tempDir).toBeTruthy();
            expect(tempDir!.startsWith(os.tmpdir())).toBe(true);
        });
    });

    describe('generateTempFileName', () => {
        it('generates unique filenames', () => {
            const name1 = generateTempFileName();
            const name2 = generateTempFileName();
            expect(name1).not.toBe(name2);
        });

        it('uses provided prefix', () => {
            const name = generateTempFileName('myprefix');
            expect(name.startsWith('myprefix_')).toBe(true);
        });

        it('uses provided extension', () => {
            const name = generateTempFileName('test', '.txt');
            expect(name.endsWith('.txt')).toBe(true);
        });

        it('default extension is .json', () => {
            const name = generateTempFileName();
            expect(name.endsWith('.json')).toBe(true);
        });

        it('filename contains timestamp for ordering', () => {
            const before = Date.now();
            const name = generateTempFileName();
            const after = Date.now();

            // Extract timestamp from filename (format: prefix_timestamp_random.ext)
            const match = name.match(/_(\d+)_/);
            expect(match).toBeTruthy();
            const timestamp = parseInt(match![1], 10);
            expect(timestamp).toBeGreaterThanOrEqual(before);
            expect(timestamp).toBeLessThanOrEqual(after);
        });
    });

    describe('writeTempFile', () => {
        it('writes content to temp file', () => {
            const content = 'Hello, World!';
            const result = writeTempFile(content);

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            expect(fs.existsSync(result!.filePath)).toBe(true);
            const readContent = fs.readFileSync(result!.filePath, 'utf8');
            expect(readContent).toBe(content);
        });

        it('writes JSON content correctly', () => {
            const data = { key: 'value', nested: { array: [1, 2, 3] } };
            const content = JSON.stringify(data, null, 2);
            const result = writeTempFile(content);

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = fs.readFileSync(result!.filePath, 'utf8');
            const parsed = JSON.parse(readContent);
            expect(parsed).toEqual(data);
        });

        it('handles content with newlines', () => {
            const content = 'line1\nline2\nline3';
            const result = writeTempFile(content);

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = fs.readFileSync(result!.filePath, 'utf8');
            expect(readContent).toBe(content);
        });

        it('handles content with Windows line endings', () => {
            const content = 'line1\r\nline2\r\nline3';
            const result = writeTempFile(content);

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = fs.readFileSync(result!.filePath, 'utf8');
            expect(readContent).toBe(content);
        });

        it('handles content with special characters', () => {
            const content = 'Special: "quotes", \'apostrophes\', `backticks`, $dollars, %percent, !exclaim';
            const result = writeTempFile(content);

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = fs.readFileSync(result!.filePath, 'utf8');
            expect(readContent).toBe(content);
        });

        it('handles Unicode content', () => {
            const content = 'Unicode: 你好世界 🌍 émoji café naïve';
            const result = writeTempFile(content);

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = fs.readFileSync(result!.filePath, 'utf8');
            expect(readContent).toBe(content);
        });

        it('handles empty content', () => {
            const result = writeTempFile('');

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = fs.readFileSync(result!.filePath, 'utf8');
            expect(readContent).toBe('');
        });

        it('handles very large content', () => {
            // Create 1MB of content
            const content = 'x'.repeat(1024 * 1024);
            const result = writeTempFile(content);

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = fs.readFileSync(result!.filePath, 'utf8');
            expect(readContent.length).toBe(content.length);
        });

        it('uses custom prefix', () => {
            const result = writeTempFile('content', 'custom-prefix');

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const filename = path.basename(result!.filePath);
            expect(filename.startsWith('custom-prefix_')).toBe(true);
        });

        it('uses custom extension', () => {
            const result = writeTempFile('content', 'test', '.txt');

            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            expect(result!.filePath.endsWith('.txt')).toBe(true);
        });

        it('cleanup function removes file', () => {
            const result = writeTempFile('content');

            expect(result).toBeTruthy();
            expect(fs.existsSync(result!.filePath)).toBe(true);

            result!.cleanup();

            expect(fs.existsSync(result!.filePath)).toBe(false);
        });

        it('cleanup function is idempotent', () => {
            const result = writeTempFile('content');

            expect(result).toBeTruthy();
            result!.cleanup();
            // Should not throw when called again
            result!.cleanup();
            result!.cleanup();
        });
    });

    describe('readTempFile', () => {
        it('reads content from temp file', () => {
            const content = 'Test content';
            const result = writeTempFile(content);
            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = readTempFile(result!.filePath);
            expect(readContent).toBe(content);
        });

        it('returns undefined for non-existent file', () => {
            const result = readTempFile('/non/existent/path/file.txt');
            expect(result).toBeUndefined();
        });

        it('reads JSON content correctly', () => {
            const data = [
                { text: 'line1\nline2', score: 95 },
                { text: 'hello world', score: 80 }
            ];
            const content = JSON.stringify(data, null, 2);
            const result = writeTempFile(content);
            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = readTempFile(result!.filePath);
            expect(readContent).toBeTruthy();
            const parsed = JSON.parse(readContent!);
            expect(parsed).toEqual(data);
        });
    });

    describe('cleanupTempFile', () => {
        it('deletes existing file', () => {
            const result = writeTempFile('content');
            expect(result).toBeTruthy();

            const success = cleanupTempFile(result!.filePath);
            expect(success).toBe(true);
            expect(fs.existsSync(result!.filePath)).toBe(false);
        });

        it('returns true for non-existent file', () => {
            const success = cleanupTempFile('/non/existent/path/file.txt');
            expect(success).toBe(true);
        });
    });

    describe('cleanupAllTempFiles', () => {
        it('cleans up all temp files', () => {
            // Create multiple temp files
            const results: TempFileResult[] = [];
            for (let i = 0; i < 5; i++) {
                const result = writeTempFile(`content ${i}`);
                expect(result).toBeTruthy();
                results.push(result!);
            }

            // Verify files exist
            for (const result of results) {
                expect(fs.existsSync(result.filePath)).toBe(true);
            }

            // Clean up all
            const count = cleanupAllTempFiles();
            expect(count).toBeGreaterThanOrEqual(5);

            // Verify files are deleted
            for (const result of results) {
                expect(fs.existsSync(result.filePath)).toBe(false);
            }
        });
    });

    describe('isTempFilePath', () => {
        it('returns true for temp file paths', () => {
            const result = writeTempFile('content');
            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            expect(isTempFilePath(result!.filePath)).toBe(true);
        });

        it('returns false for non-temp paths', () => {
            expect(isTempFilePath('/some/other/path/file.txt')).toBe(false);
            expect(isTempFilePath('relative/path/file.txt')).toBe(false);
            expect(isTempFilePath(os.tmpdir())).toBe(false); // Parent dir, not our subdir
        });
    });

    describe('getTempDirPath', () => {
        it('returns consistent path', () => {
            const path1 = getTempDirPath();
            const path2 = getTempDirPath();
            expect(path1).toBe(path2);
        });

        it('path is under os.tmpdir()', () => {
            const tempDirPath = getTempDirPath();
            expect(tempDirPath.startsWith(os.tmpdir())).toBe(true);
        });
    });

    describe('Cross-platform JSON handling', () => {
        it('preserves JSON with embedded newlines in string values', () => {
            // This is the key test case - JSON with \n inside string values
            const data = [
                { text: 'line1\nline2', code: 'function() {\n  return true;\n}' }
            ];
            const jsonContent = JSON.stringify(data, null, 2);

            const result = writeTempFile(jsonContent);
            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            // Read back and verify JSON is valid
            const readContent = readTempFile(result!.filePath);
            expect(readContent).toBeTruthy();

            // This should NOT throw - the JSON should be valid
            const parsed = JSON.parse(readContent!);
            expect(parsed).toEqual(data);

            // Verify the embedded newlines are preserved
            expect(parsed[0].text).toBe('line1\nline2');
            expect(parsed[0].code).toContain('\n');
        });

        it('preserves pretty-printed JSON structure', () => {
            const data = {
                results: [
                    { id: 1, name: 'Item 1' },
                    { id: 2, name: 'Item 2' }
                ],
                summary: 'Test summary'
            };
            const jsonContent = JSON.stringify(data, null, 2);

            const result = writeTempFile(jsonContent);
            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = readTempFile(result!.filePath);
            expect(readContent).toBeTruthy();

            // Verify JSON is valid and matches
            const parsed = JSON.parse(readContent!);
            expect(parsed).toEqual(data);

            // Verify formatting is preserved (has actual newlines)
            expect(readContent).toContain('\n');
            expect(readContent).toContain('  ');
        });

        it('handles JSON with all problematic characters', () => {
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
            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            const readContent = readTempFile(result!.filePath);
            expect(readContent).toBeTruthy();

            const parsed = JSON.parse(readContent!);
            expect(parsed).toEqual(data);
        });
    });

    describe('File path handling', () => {
        it('file path is absolute', () => {
            const result = writeTempFile('content');
            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            expect(path.isAbsolute(result!.filePath)).toBe(true);
        });

        it('file path uses correct separator for platform', () => {
            const result = writeTempFile('content');
            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            // On Windows, path should use backslashes
            // On Unix, path should use forward slashes
            if (process.platform === 'win32') {
                expect(result!.filePath).toContain('\\');
            } else {
                expect(result!.filePath).toContain('/');
            }
        });

        it('file path can be used directly in prompts', () => {
            const result = writeTempFile('{"test": "data"}');
            expect(result).toBeTruthy();
            createdFiles.push(result!.filePath);

            // Simulate using the path in a prompt
            const prompt = `Read the results from: ${result!.filePath}`;
            expect(prompt).toContain(result!.filePath);

            // The path should not need any escaping for the AI to read it
            // (AI tools like copilot with --allow-all-paths can read any path)
        });
    });

    describe('Error handling', () => {
        it('readTempFile handles read errors gracefully', () => {
            const result = readTempFile('/definitely/not/a/real/path/file.json');
            expect(result).toBeUndefined();
        });

        it('cleanupTempFile handles errors gracefully', () => {
            // Should not throw even for invalid paths
            const result = cleanupTempFile('/definitely/not/a/real/path/file.json');
            expect(result).toBe(true);
        });
    });
});
