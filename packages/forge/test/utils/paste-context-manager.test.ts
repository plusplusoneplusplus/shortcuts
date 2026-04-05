import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    sniffContentExtension,
    separateQuestionFromPaste,
    savePasteContent,
    buildPasteFileReference,
    rewriteLargePrompt,
    cleanupStalePasteFiles,
    cleanupAllStalePasteFiles,
    PASTE_THRESHOLD,
} from '../../src/utils/paste-context-manager';

// ============================================================================
// Test Helpers
// ============================================================================

function makeTempDataDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'paste-ctx-test-'));
}

function makeRepoDir(dataDir: string, workspaceId: string): string {
    const repoDir = path.join(dataDir, 'repos', workspaceId);
    fs.mkdirSync(repoDir, { recursive: true });
    return repoDir;
}

function largeText(size: number, char = 'x'): string {
    return char.repeat(size);
}

// ============================================================================
// Tests
// ============================================================================

describe('paste-context-manager', () => {
    let dataDir: string;
    const workspaceId = 'test-ws-001';

    beforeEach(() => {
        dataDir = makeTempDataDir();
        makeRepoDir(dataDir, workspaceId);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ========================================================================
    // sniffContentExtension
    // ========================================================================

    describe('sniffContentExtension', () => {
        it('returns .json for content starting with {', () => {
            expect(sniffContentExtension('{"key": "value"}')).toBe('.json');
        });

        it('returns .json for content starting with [', () => {
            expect(sniffContentExtension('[1, 2, 3]')).toBe('.json');
        });

        it('returns .json for JSON-ish content that fails to parse', () => {
            expect(sniffContentExtension('{broken json here...')).toBe('.json');
        });

        it('returns .json for content with leading whitespace', () => {
            expect(sniffContentExtension('  \n  {"key": "value"}')).toBe('.json');
        });

        it('returns .md for content with markdown headers', () => {
            expect(sniffContentExtension('# Title\n\nSome content')).toBe('.md');
        });

        it('returns .md for content with h2 headers', () => {
            expect(sniffContentExtension('## Section\n\nDetails')).toBe('.md');
        });

        it('returns .md for content with fenced code blocks', () => {
            const md = 'Some text\n' + '```' + '\ncode\n' + '```';
            expect(sniffContentExtension(md)).toBe('.md');
        });

        it('returns .txt for plain text', () => {
            expect(sniffContentExtension('Just some plain text content')).toBe('.txt');
        });

        it('returns .txt for empty content', () => {
            expect(sniffContentExtension('')).toBe('.txt');
        });

        it('returns .txt for log-like content', () => {
            const logs = '[2024-01-01] ERROR: Something failed\n[2024-01-01] WARN: Retry attempt';
            expect(sniffContentExtension(logs)).toBe('.txt');
        });
    });

    // ========================================================================
    // separateQuestionFromPaste
    // ========================================================================

    describe('separateQuestionFromPaste', () => {
        it('returns full text as paste when no blank line separator exists', () => {
            const text = 'single block of text without blank lines';
            const result = separateQuestionFromPaste(text);
            expect(result.question).toBeUndefined();
            expect(result.pastedContent).toBe(text);
        });

        it('separates short question from large paste block', () => {
            const question = 'What is wrong with this output?';
            const paste = largeText(PASTE_THRESHOLD + 100);
            const text = `${question}\n\n${paste}`;
            const result = separateQuestionFromPaste(text);
            expect(result.question).toBe(question);
            expect(result.pastedContent).toBe(paste);
        });

        it('does not separate when question exceeds max prefix length', () => {
            const longQuestion = 'a'.repeat(501);
            const paste = largeText(PASTE_THRESHOLD + 100);
            const text = `${longQuestion}\n\n${paste}`;
            const result = separateQuestionFromPaste(text);
            expect(result.question).toBeUndefined();
            expect(result.pastedContent).toBe(text);
        });

        it('does not separate when rest is smaller than threshold', () => {
            const question = 'Short question';
            const smallPaste = 'small content';
            const text = `${question}\n\n${smallPaste}`;
            const result = separateQuestionFromPaste(text);
            expect(result.question).toBeUndefined();
            expect(result.pastedContent).toBe(text);
        });

        it('handles multiple blank lines as separator', () => {
            const question = 'Check this log';
            const paste = largeText(PASTE_THRESHOLD + 100);
            const text = `${question}\n\n\n${paste}`;
            const result = separateQuestionFromPaste(text);
            expect(result.question).toBe(question);
            expect(result.pastedContent).toBe(paste);
        });

        it('handles blank line with spaces as separator', () => {
            const question = 'Analyze this';
            const paste = largeText(PASTE_THRESHOLD + 100);
            const text = `${question}\n   \n${paste}`;
            const result = separateQuestionFromPaste(text);
            expect(result.question).toBe(question);
            expect(result.pastedContent).toBe(paste);
        });
    });

    // ========================================================================
    // savePasteContent
    // ========================================================================

    describe('savePasteContent', () => {
        it('saves content to paste-context directory', async () => {
            const content = '{"data": "test"}';
            const result = await savePasteContent(dataDir, workspaceId, content);

            expect(result.filePath).toContain('paste-context');
            expect(fs.existsSync(result.filePath)).toBe(true);
            expect(fs.readFileSync(result.filePath, 'utf-8')).toBe(content);
            result.cleanup();
        });

        it('uses .json extension for JSON content', async () => {
            const result = await savePasteContent(dataDir, workspaceId, '{"key": "val"}');
            expect(result.filePath).toMatch(/\.json$/);
            result.cleanup();
        });

        it('uses .md extension for markdown content', async () => {
            const result = await savePasteContent(dataDir, workspaceId, '# Title\n\nBody');
            expect(result.filePath).toMatch(/\.md$/);
            result.cleanup();
        });

        it('uses .txt extension for plain text', async () => {
            const result = await savePasteContent(dataDir, workspaceId, 'plain text content');
            expect(result.filePath).toMatch(/\.txt$/);
            result.cleanup();
        });

        it('cleanup removes the file', async () => {
            const result = await savePasteContent(dataDir, workspaceId, 'to be deleted');
            expect(fs.existsSync(result.filePath)).toBe(true);
            result.cleanup();
            expect(fs.existsSync(result.filePath)).toBe(false);
        });

        it('cleanup is safe to call multiple times', async () => {
            const result = await savePasteContent(dataDir, workspaceId, 'content');
            result.cleanup();
            result.cleanup(); // Should not throw
        });

        it('creates paste-context directory if it does not exist', async () => {
            const newWs = 'brand-new-ws';
            makeRepoDir(dataDir, newWs);
            const result = await savePasteContent(dataDir, newWs, 'content');
            expect(fs.existsSync(result.filePath)).toBe(true);
            result.cleanup();
        });
    });

    // ========================================================================
    // buildPasteFileReference
    // ========================================================================

    describe('buildPasteFileReference', () => {
        it('builds reference with character count and file path', () => {
            const ref = buildPasteFileReference('/tmp/abc.txt', 20000);
            expect(ref).toContain('approximately 20000 characters');
            expect(ref).toContain('/tmp/abc.txt');
            expect(ref).toContain('Read the file');
        });

        it('prepends question prefix when provided', () => {
            const ref = buildPasteFileReference('/tmp/abc.txt', 20000, 'What went wrong?');
            expect(ref).toMatch(/^What went wrong\?/);
            expect(ref).toContain('/tmp/abc.txt');
        });

        it('does not prepend anything when question is undefined', () => {
            const ref = buildPasteFileReference('/tmp/abc.txt', 20000, undefined);
            expect(ref).toMatch(/^The user provided/);
        });
    });

    // ========================================================================
    // rewriteLargePrompt
    // ========================================================================

    describe('rewriteLargePrompt', () => {
        it('returns undefined for prompts under threshold', async () => {
            const result = await rewriteLargePrompt('short prompt', dataDir, workspaceId);
            expect(result).toBeUndefined();
        });

        it('returns undefined for prompts exactly at threshold', async () => {
            const prompt = largeText(PASTE_THRESHOLD);
            const result = await rewriteLargePrompt(prompt, dataDir, workspaceId);
            expect(result).toBeUndefined();
        });

        it('rewrites prompts exceeding threshold', async () => {
            const prompt = largeText(PASTE_THRESHOLD + 1);
            const result = await rewriteLargePrompt(prompt, dataDir, workspaceId);

            expect(result).toBeDefined();
            expect(result!.rewrittenPrompt).toContain('saved to:');
            expect(result!.rewrittenPrompt).toContain('paste-context');
            expect(result!.rewrittenPrompt.length).toBeLessThan(prompt.length);
            result!.cleanup();
        });

        it('separates question from large paste in rewritten prompt', async () => {
            const question = 'What is wrong here?';
            const largePaste = largeText(PASTE_THRESHOLD + 100);
            const prompt = `${question}\n\n${largePaste}`;

            const result = await rewriteLargePrompt(prompt, dataDir, workspaceId);
            expect(result).toBeDefined();
            expect(result!.rewrittenPrompt).toContain(question);
            expect(result!.rewrittenPrompt).toContain('saved to:');
            result!.cleanup();
        });

        it('cleanup removes the temp file', async () => {
            const prompt = largeText(PASTE_THRESHOLD + 1);
            const result = await rewriteLargePrompt(prompt, dataDir, workspaceId);
            expect(result).toBeDefined();

            // Extract file path from the rewritten prompt
            const match = result!.rewrittenPrompt.match(/saved to: (.+)/);
            expect(match).toBeTruthy();
            const filePath = match![1];
            expect(fs.existsSync(filePath)).toBe(true);

            result!.cleanup();
            expect(fs.existsSync(filePath)).toBe(false);
        });
    });

    // ========================================================================
    // cleanupStalePasteFiles
    // ========================================================================

    describe('cleanupStalePasteFiles', () => {
        it('deletes files older than maxAgeMs', async () => {
            const result = await savePasteContent(dataDir, workspaceId, 'old content');
            // Set mtime to 2 hours ago
            const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
            fs.utimesSync(result.filePath, twoHoursAgo, twoHoursAgo);

            const cleaned = await cleanupStalePasteFiles(dataDir, workspaceId);
            expect(cleaned).toBe(1);
            expect(fs.existsSync(result.filePath)).toBe(false);
        });

        it('preserves recent files', async () => {
            const result = await savePasteContent(dataDir, workspaceId, 'fresh content');

            const cleaned = await cleanupStalePasteFiles(dataDir, workspaceId);
            expect(cleaned).toBe(0);
            expect(fs.existsSync(result.filePath)).toBe(true);
            result.cleanup();
        });

        it('returns 0 when directory does not exist', async () => {
            const cleaned = await cleanupStalePasteFiles(dataDir, 'nonexistent-ws');
            expect(cleaned).toBe(0);
        });

        it('respects custom maxAgeMs', async () => {
            const result = await savePasteContent(dataDir, workspaceId, 'content');
            // Set mtime to 5 seconds ago
            const fiveSecondsAgo = new Date(Date.now() - 5000);
            fs.utimesSync(result.filePath, fiveSecondsAgo, fiveSecondsAgo);

            // Should not be cleaned with 1 hour max age
            expect(await cleanupStalePasteFiles(dataDir, workspaceId, 3_600_000)).toBe(0);

            // Should be cleaned with 1 second max age
            expect(await cleanupStalePasteFiles(dataDir, workspaceId, 1000)).toBe(1);
        });
    });

    // ========================================================================
    // cleanupAllStalePasteFiles
    // ========================================================================

    describe('cleanupAllStalePasteFiles', () => {
        it('cleans stale files across multiple workspaces', async () => {
            const ws2 = 'test-ws-002';
            makeRepoDir(dataDir, ws2);

            const r1 = await savePasteContent(dataDir, workspaceId, 'old 1');
            const r2 = await savePasteContent(dataDir, ws2, 'old 2');

            // Age both files
            const old = new Date(Date.now() - 2 * 3_600_000);
            fs.utimesSync(r1.filePath, old, old);
            fs.utimesSync(r2.filePath, old, old);

            const cleaned = await cleanupAllStalePasteFiles(dataDir);
            expect(cleaned).toBe(2);
        });

        it('returns 0 when repos dir does not exist', async () => {
            const emptyDir = makeTempDataDir();
            try {
                const cleaned = await cleanupAllStalePasteFiles(emptyDir);
                expect(cleaned).toBe(0);
            } finally {
                fs.rmSync(emptyDir, { recursive: true, force: true });
            }
        });

        it('skips non-directory entries in repos dir', async () => {
            // Create a file (not directory) in repos/
            fs.writeFileSync(path.join(dataDir, 'repos', 'not-a-dir.txt'), 'junk');

            const cleaned = await cleanupAllStalePasteFiles(dataDir);
            expect(cleaned).toBe(0);
        });
    });

    // ========================================================================
    // PASTE_THRESHOLD constant
    // ========================================================================

    describe('PASTE_THRESHOLD', () => {
        it('is 16384', () => {
            expect(PASTE_THRESHOLD).toBe(16_384);
        });
    });
});
