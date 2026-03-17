/**
 * Tests for prompt file discovery.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findPromptFiles } from '../../src/discovery';

describe('findPromptFiles', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prompt-files-test-'));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    async function createPromptFile(relativePath: string, content = '# Prompt'): Promise<void> {
        const fullPath = path.join(tempDir, relativePath);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, content);
    }

    it('returns empty for non-existent rootDir', async () => {
        const result = await findPromptFiles('/no/such/path');
        expect(result).toEqual([]);
    });

    it('returns empty when default location missing', async () => {
        const result = await findPromptFiles(tempDir);
        expect(result).toEqual([]);
    });

    it('discovers single prompt file', async () => {
        await createPromptFile('.github/prompts/fix.prompt.md');

        const result = await findPromptFiles(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('fix');
        expect(result[0].relativePath).toBe(path.join('.github', 'prompts', 'fix.prompt.md'));
        expect(result[0].sourceFolder).toBe('.github/prompts');
        expect(result[0].absolutePath).toBe(path.join(tempDir, '.github', 'prompts', 'fix.prompt.md'));
    });

    it('strips .prompt.md suffix for name', async () => {
        await createPromptFile('.github/prompts/my-complex.name.prompt.md');

        const result = await findPromptFiles(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('my-complex.name');
    });

    it('discovers nested prompt files recursively', async () => {
        await createPromptFile('.github/prompts/sub/deep.prompt.md');

        const result = await findPromptFiles(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].relativePath).toBe(path.join('.github', 'prompts', 'sub', 'deep.prompt.md'));
    });

    it('ignores non-.prompt.md files', async () => {
        await createPromptFile('.github/prompts/fix.prompt.md');
        await createPromptFile('.github/prompts/README.md');
        await createPromptFile('.github/prompts/notes.md');

        const result = await findPromptFiles(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('fix');
    });

    it('scans multiple locations', async () => {
        await createPromptFile('.github/prompts/a.prompt.md');
        await createPromptFile('custom/prompts/b.prompt.md');

        const result = await findPromptFiles(tempDir, ['.github/prompts', 'custom/prompts']);

        expect(result).toHaveLength(2);
        const names = result.map(r => r.name).sort();
        expect(names).toEqual(['a', 'b']);
        expect(result.find(r => r.name === 'a')!.sourceFolder).toBe('.github/prompts');
        expect(result.find(r => r.name === 'b')!.sourceFolder).toBe('custom/prompts');
    });

    it('handles absolute location path', async () => {
        const absDir = path.join(tempDir, 'abs-prompts');
        await fs.promises.mkdir(absDir, { recursive: true });
        await fs.promises.writeFile(path.join(absDir, 'test.prompt.md'), '# Test');

        const result = await findPromptFiles(tempDir, [absDir]);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('test');
        expect(result[0].sourceFolder).toBe(absDir);
    });

    it('uses default location when locations omitted', async () => {
        await createPromptFile('.github/prompts/default.prompt.md');

        const result = await findPromptFiles(tempDir);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('default');
    });

    it('uses default location when empty array', async () => {
        await createPromptFile('.github/prompts/default.prompt.md');

        const result = await findPromptFiles(tempDir, []);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('default');
    });

    it('handles unreadable directory gracefully', async () => {
        // Skip on Windows — chmod doesn't restrict reads the same way
        if (process.platform === 'win32') {
            return;
        }

        const noReadDir = path.join(tempDir, '.github', 'prompts');
        await fs.promises.mkdir(noReadDir, { recursive: true });
        await fs.promises.writeFile(path.join(noReadDir, 'test.prompt.md'), '# Test');
        await fs.promises.chmod(noReadDir, 0o000);

        const result = await findPromptFiles(tempDir);
        expect(result).toEqual([]);

        // Restore permissions for cleanup
        await fs.promises.chmod(noReadDir, 0o755);
    });
});
