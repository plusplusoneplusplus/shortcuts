/**
 * Output File Manager Tests
 *
 * Tests for OutputFileManager static methods:
 * - saveOutput: writes file to per-repo path, creates directory, handles empty content, _shared fallback
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
        it('should write file to per-repo path when workspaceId is provided', async () => {
            const filePath = await OutputFileManager.saveOutput('proc-1', 'hello world', tmpDir, 'ws-abc');

            expect(filePath).toBe(path.join(tmpDir, 'repos', 'ws-abc', 'outputs', 'proc-1.md'));
            const content = await fs.readFile(filePath!, 'utf-8');
            expect(content).toBe('hello world');
        });

        it('should fall back to _shared workspace when no workspaceId', async () => {
            const filePath = await OutputFileManager.saveOutput('proc-1', 'hello world', tmpDir);

            expect(filePath).toBe(path.join(tmpDir, 'repos', '_shared', 'outputs', 'proc-1.md'));
            const content = await fs.readFile(filePath!, 'utf-8');
            expect(content).toBe('hello world');
        });

        it('should create outputs/ directory on first write', async () => {
            const outputsDir = path.join(tmpDir, 'repos', 'ws-new', 'outputs');

            // Directory should not exist yet
            await expect(fs.access(outputsDir)).rejects.toThrow();

            await OutputFileManager.saveOutput('proc-2', 'content', tmpDir, 'ws-new');

            // Directory should now exist
            const stat = await fs.stat(outputsDir);
            expect(stat.isDirectory()).toBe(true);
        });

        it('should return undefined for empty content', async () => {
            const result = await OutputFileManager.saveOutput('proc-3', '', tmpDir, 'ws-abc');

            expect(result).toBeUndefined();

            // No file or directory should be created
            const outputsDir = path.join(tmpDir, 'repos', 'ws-abc', 'outputs');
            await expect(fs.access(outputsDir)).rejects.toThrow();
        });

        it('should handle multiline markdown content', async () => {
            const markdown = '# Title\n\nSome **bold** text.\n\n```js\nconsole.log("hi");\n```\n';
            const filePath = await OutputFileManager.saveOutput('proc-md', markdown, tmpDir, 'ws-abc');

            const content = await fs.readFile(filePath!, 'utf-8');
            expect(content).toBe(markdown);
        });

        it('should overwrite existing file for same processId', async () => {
            await OutputFileManager.saveOutput('proc-dup', 'first', tmpDir, 'ws-abc');
            const filePath = await OutputFileManager.saveOutput('proc-dup', 'second', tmpDir, 'ws-abc');

            const content = await fs.readFile(filePath!, 'utf-8');
            expect(content).toBe('second');
        });
    });

    // ========================================================================
    // loadOutput
    // ========================================================================

    describe('loadOutput', () => {
        it('should read a previously saved file', async () => {
            const filePath = await OutputFileManager.saveOutput('proc-load', 'saved content', tmpDir, 'ws-abc');
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
            const filePath = await OutputFileManager.saveOutput('proc-del', 'to delete', tmpDir, 'ws-abc');
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
