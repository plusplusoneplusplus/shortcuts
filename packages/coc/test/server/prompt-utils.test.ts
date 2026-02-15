/**
 * Prompt Utils Tests
 *
 * Tests for prompt file discovery and reading.
 * Uses temp directories for isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverPromptFiles, readPromptFileContent } from '../../src/server/prompt-utils';

// ============================================================================
// Setup
// ============================================================================

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-utils-test-'));

    // Create .github/prompts with some files
    const promptsDir = path.join(tmpDir, '.github', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'clarify.prompt.md'), '---\ntitle: Clarify\n---\n# Clarification Prompt\n\nPlease clarify the following.\n');
    fs.writeFileSync(path.join(promptsDir, 'review.prompt.md'), '# Review Prompt\n\nReview the code.\n');

    // Create nested prompt
    const nestedDir = path.join(promptsDir, 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'deep.prompt.md'), '# Deep\n\nDeep analysis.\n');

    // Create a hidden directory with prompt files (should be found since pipeline-core doesn't skip hidden)
    const hiddenDir = path.join(tmpDir, '.hidden');
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(path.join(hiddenDir, 'secret.prompt.md'), '# Secret\n');

    // Create a non-prompt file (should be ignored)
    fs.writeFileSync(path.join(promptsDir, 'readme.md'), '# Not a prompt\n');
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// discoverPromptFiles Tests
// ============================================================================

describe('discoverPromptFiles', () => {
    it('finds .prompt.md files in default location', async () => {
        const files = await discoverPromptFiles(tmpDir);
        const names = files.map(f => f.name).sort();
        expect(names).toContain('clarify');
        expect(names).toContain('review');
    });

    it('finds nested .prompt.md files', async () => {
        const files = await discoverPromptFiles(tmpDir);
        const names = files.map(f => f.name);
        expect(names).toContain('deep');
    });

    it('returns relative paths', async () => {
        const files = await discoverPromptFiles(tmpDir);
        for (const f of files) {
            expect(path.isAbsolute(f.relativePath)).toBe(false);
        }
    });

    it('returns absolute paths', async () => {
        const files = await discoverPromptFiles(tmpDir);
        for (const f of files) {
            expect(path.isAbsolute(f.absolutePath)).toBe(true);
        }
    });

    it('includes source folder', async () => {
        const files = await discoverPromptFiles(tmpDir);
        for (const f of files) {
            expect(f.sourceFolder).toBe('.github/prompts');
        }
    });

    it('ignores non-prompt.md files', async () => {
        const files = await discoverPromptFiles(tmpDir);
        const names = files.map(f => f.name);
        expect(names).not.toContain('readme');
    });

    it('returns empty for non-existent location', async () => {
        const files = await discoverPromptFiles(tmpDir, ['non/existent']);
        expect(files).toEqual([]);
    });

    it('supports custom locations', async () => {
        const files = await discoverPromptFiles(tmpDir, ['.hidden']);
        const names = files.map(f => f.name);
        expect(names).toContain('secret');
    });
});

// ============================================================================
// readPromptFileContent Tests
// ============================================================================

describe('readPromptFileContent', () => {
    it('strips YAML frontmatter', async () => {
        const filePath = path.join(tmpDir, '.github', 'prompts', 'clarify.prompt.md');
        const content = await readPromptFileContent(filePath);
        expect(content).not.toContain('---');
        expect(content).not.toContain('title: Clarify');
        expect(content).toContain('# Clarification Prompt');
        expect(content).toContain('Please clarify the following.');
    });

    it('returns content as-is when no frontmatter', async () => {
        const filePath = path.join(tmpDir, '.github', 'prompts', 'review.prompt.md');
        const content = await readPromptFileContent(filePath);
        expect(content).toBe('# Review Prompt\n\nReview the code.\n');
    });

    it('throws for non-existent file', async () => {
        await expect(readPromptFileContent('/nonexistent/file.prompt.md'))
            .rejects.toThrow();
    });
});
