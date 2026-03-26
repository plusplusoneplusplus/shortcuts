import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    getSearchPaths,
    resolvePromptPath,
    extractPromptContent,
    promptFileExists,
    validatePromptFile,
    resolvePromptFile,
    PromptResolverError,
} from '../../src/utils/prompt-resolver';

// ---------------------------------------------------------------------------
// Helpers — temporary directory management
// ---------------------------------------------------------------------------

let tmpDir: string;

function writeTmp(relativePath: string, content: string): string {
    const fullPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-resolver-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getSearchPaths
// ---------------------------------------------------------------------------

describe('getSearchPaths', () => {
    it('returns three paths in search order', () => {
        const pipelineDir = '/projects/my-pipeline';
        const paths = getSearchPaths('analyze.md', pipelineDir);
        expect(paths).toHaveLength(3);
    });

    it('first path is filename directly in pipelineDirectory', () => {
        const pipelineDir = '/projects/my-pipeline';
        const [first] = getSearchPaths('analyze.md', pipelineDir);
        expect(first).toBe(path.join(pipelineDir, 'analyze.md'));
    });

    it('second path is inside prompts/ subfolder', () => {
        const pipelineDir = '/projects/my-pipeline';
        const [, second] = getSearchPaths('analyze.md', pipelineDir);
        expect(second).toBe(path.join(pipelineDir, 'prompts', 'analyze.md'));
    });

    it('third path is in shared prompts folder sibling to pipeline dir', () => {
        const pipelineDir = '/projects/my-pipeline';
        const [, , third] = getSearchPaths('analyze.md', pipelineDir);
        expect(third).toBe(path.join('/projects', 'prompts', 'analyze.md'));
    });
});

// ---------------------------------------------------------------------------
// extractPromptContent
// ---------------------------------------------------------------------------

describe('extractPromptContent', () => {
    it('returns content unchanged when there is no frontmatter', () => {
        const { content, hadFrontmatter } = extractPromptContent('Hello world');
        expect(content).toBe('Hello world');
        expect(hadFrontmatter).toBe(false);
    });

    it('strips YAML frontmatter and returns body', () => {
        const raw = '---\nversion: 1.0\n---\nActual prompt content';
        const { content, hadFrontmatter } = extractPromptContent(raw);
        expect(content).toBe('Actual prompt content');
        expect(hadFrontmatter).toBe(true);
    });

    it('strips CRLF frontmatter', () => {
        const raw = '---\r\nkey: value\r\n---\r\nBody text';
        const { content, hadFrontmatter } = extractPromptContent(raw);
        expect(content).toBe('Body text');
        expect(hadFrontmatter).toBe(true);
    });

    it('trims surrounding whitespace from content', () => {
        const { content } = extractPromptContent('  \n  hello  \n  ');
        expect(content).toBe('hello');
    });
});

// ---------------------------------------------------------------------------
// resolvePromptPath
// ---------------------------------------------------------------------------

describe('resolvePromptPath', () => {
    it('resolves an absolute path that exists', () => {
        const file = writeTmp('direct.md', 'content');
        expect(resolvePromptPath(file, tmpDir)).toBe(file);
    });

    it('throws PromptResolverError for an absolute path that does not exist', () => {
        expect(() =>
            resolvePromptPath('/nonexistent/path/file.md', tmpDir),
        ).toThrow(PromptResolverError);
    });

    it('resolves a relative path with separators from pipelineDirectory', () => {
        const file = writeTmp('prompts/sub.md', 'content');
        const resolved = resolvePromptPath('prompts/sub.md', tmpDir);
        expect(resolved).toBe(file);
    });

    it('throws for a relative path that does not exist', () => {
        expect(() =>
            resolvePromptPath('prompts/missing.md', tmpDir),
        ).toThrow(PromptResolverError);
    });

    it('finds a bare filename in the pipeline directory', () => {
        const file = writeTmp('analyze.md', 'content');
        const resolved = resolvePromptPath('analyze.md', tmpDir);
        expect(resolved).toBe(file);
    });

    it('finds a bare filename in the prompts/ subfolder', () => {
        const file = writeTmp('prompts/analyze.md', 'content');
        const resolved = resolvePromptPath('analyze.md', tmpDir);
        expect(resolved).toBe(file);
    });

    it('throws PromptResolverError with searchedPaths when not found', () => {
        try {
            resolvePromptPath('missing.md', tmpDir);
            expect.fail('Should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(PromptResolverError);
            const e = err as PromptResolverError;
            expect(e.searchedPaths).toBeDefined();
            expect(Array.isArray(e.searchedPaths)).toBe(true);
            expect((e.searchedPaths as string[]).length).toBeGreaterThan(0);
        }
    });
});

// ---------------------------------------------------------------------------
// promptFileExists / validatePromptFile
// ---------------------------------------------------------------------------

describe('promptFileExists', () => {
    it('returns true when file exists', () => {
        writeTmp('exists.md', 'content');
        expect(promptFileExists('exists.md', tmpDir)).toBe(true);
    });

    it('returns false when file does not exist', () => {
        expect(promptFileExists('nope.md', tmpDir)).toBe(false);
    });
});

describe('validatePromptFile', () => {
    it('returns valid:true when file exists', () => {
        writeTmp('valid.md', 'content');
        const result = validatePromptFile('valid.md', tmpDir);
        expect(result.valid).toBe(true);
    });

    it('returns valid:false with error message when not found', () => {
        const result = validatePromptFile('invalid.md', tmpDir);
        expect(result.valid).toBe(false);
        expect(result.error).toBeTruthy();
        expect(Array.isArray(result.searchedPaths)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// resolvePromptFile (async)
// ---------------------------------------------------------------------------

describe('resolvePromptFile', () => {
    it('loads content and strips frontmatter', async () => {
        writeTmp('prompt.md', '---\nkey: v\n---\nHello prompt');
        const content = await resolvePromptFile('prompt.md', tmpDir);
        expect(content).toBe('Hello prompt');
    });

    it('loads plain content without frontmatter', async () => {
        writeTmp('plain.md', 'Plain content here');
        const content = await resolvePromptFile('plain.md', tmpDir);
        expect(content).toBe('Plain content here');
    });

    it('throws PromptResolverError for an empty file', async () => {
        writeTmp('empty.md', '');
        await expect(resolvePromptFile('empty.md', tmpDir)).rejects.toBeInstanceOf(PromptResolverError);
    });

    it('throws PromptResolverError for a file with only frontmatter', async () => {
        writeTmp('fm-only.md', '---\nkey: val\n---\n');
        await expect(resolvePromptFile('fm-only.md', tmpDir)).rejects.toBeInstanceOf(PromptResolverError);
    });

    it('throws PromptResolverError when file does not exist', async () => {
        await expect(resolvePromptFile('missing.md', tmpDir)).rejects.toBeInstanceOf(PromptResolverError);
    });
});
