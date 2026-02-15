/**
 * Output File Manager Tests
 *
 * Tests for OutputFileManager static methods:
 * - saveOutput: writes file to correct path, creates directory, handles empty content
 * - loadOutput: reads saved file, returns undefined for missing file
 * - deleteOutput: removes file, no-op for missing file
 *
 * Uses OS temp directories for cross-platform compatibility.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { OutputFileManager } from '../../src/server/output-file-manager';

describe('OutputFileManager', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-output-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // ========================================================================
    // saveOutput
    // ========================================================================

    describe('saveOutput', () => {
        it('should write file to correct path', async () => {
            const filePath = await OutputFileManager.saveOutput('proc-1', 'hello world', tmpDir);

            expect(filePath).toBe(path.join(tmpDir, 'outputs', 'proc-1.md'));
            const content = await fs.readFile(filePath!, 'utf-8');
            expect(content).toBe('hello world');
        });

        it('should create outputs/ directory on first write', async () => {
            const outputsDir = path.join(tmpDir, 'outputs');

            // Directory should not exist yet
            await expect(fs.access(outputsDir)).rejects.toThrow();

            await OutputFileManager.saveOutput('proc-2', 'content', tmpDir);

            // Directory should now exist
            const stat = await fs.stat(outputsDir);
            expect(stat.isDirectory()).toBe(true);
        });

        it('should return undefined for empty content', async () => {
            const result = await OutputFileManager.saveOutput('proc-3', '', tmpDir);

            expect(result).toBeUndefined();

            // No file or directory should be created
            const outputsDir = path.join(tmpDir, 'outputs');
            await expect(fs.access(outputsDir)).rejects.toThrow();
        });

        it('should handle multiline markdown content', async () => {
            const markdown = '# Title\n\nSome **bold** text.\n\n```js\nconsole.log("hi");\n```\n';
            const filePath = await OutputFileManager.saveOutput('proc-md', markdown, tmpDir);

            const content = await fs.readFile(filePath!, 'utf-8');
            expect(content).toBe(markdown);
        });

        it('should overwrite existing file for same processId', async () => {
            await OutputFileManager.saveOutput('proc-dup', 'first', tmpDir);
            const filePath = await OutputFileManager.saveOutput('proc-dup', 'second', tmpDir);

            const content = await fs.readFile(filePath!, 'utf-8');
            expect(content).toBe('second');
        });
    });

    // ========================================================================
    // loadOutput
    // ========================================================================

    describe('loadOutput', () => {
        it('should read a previously saved file', async () => {
            const filePath = await OutputFileManager.saveOutput('proc-load', 'saved content', tmpDir);
            const content = await OutputFileManager.loadOutput(filePath!);

            expect(content).toBe('saved content');
        });

        it('should return undefined for missing file', async () => {
            const result = await OutputFileManager.loadOutput(path.join(tmpDir, 'nonexistent.md'));

            expect(result).toBeUndefined();
        });
    });

    // ========================================================================
    // deleteOutput
    // ========================================================================

    describe('deleteOutput', () => {
        it('should remove an existing file', async () => {
            const filePath = await OutputFileManager.saveOutput('proc-del', 'to delete', tmpDir);
            expect(filePath).toBeDefined();

            await OutputFileManager.deleteOutput(filePath!);

            // File should be gone
            await expect(fs.access(filePath!)).rejects.toThrow();
        });

        it('should be a no-op for missing file', async () => {
            // Should not throw
            await expect(
                OutputFileManager.deleteOutput(path.join(tmpDir, 'no-such-file.md'))
            ).resolves.toBeUndefined();
        });
    });
});
