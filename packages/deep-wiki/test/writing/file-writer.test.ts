/**
 * File Writer Tests
 *
 * Tests for writing wiki articles to disk: directory creation,
 * slug generation, file paths, UTF-8 encoding, and line ending normalization.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    writeWikiOutput,
    getArticleFilePath,
    slugify,
    normalizeLineEndings,
} from '../../src/writing/file-writer';
import type { WikiOutput, GeneratedArticle } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-test-'));
});

afterEach(() => {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// slugify
// ============================================================================

describe('slugify', () => {
    it('should convert to lowercase', () => {
        expect(slugify('MyModule')).toBe('mymodule');
    });

    it('should replace spaces with hyphens', () => {
        expect(slugify('my module')).toBe('my-module');
    });

    it('should replace special characters with hyphens', () => {
        expect(slugify('my_module.v2')).toBe('my-module-v2');
    });

    it('should trim leading/trailing hyphens', () => {
        expect(slugify('-my-module-')).toBe('my-module');
    });

    it('should collapse multiple hyphens', () => {
        expect(slugify('my---module')).toBe('my-module');
    });

    it('should handle empty string', () => {
        expect(slugify('')).toBe('untitled');
    });

    it('should handle kebab-case input unchanged', () => {
        expect(slugify('already-kebab')).toBe('already-kebab');
    });
});

// ============================================================================
// normalizeLineEndings
// ============================================================================

describe('normalizeLineEndings', () => {
    it('should convert CRLF to LF', () => {
        expect(normalizeLineEndings('line1\r\nline2\r\n')).toBe('line1\nline2\n');
    });

    it('should convert CR to LF', () => {
        expect(normalizeLineEndings('line1\rline2\r')).toBe('line1\nline2\n');
    });

    it('should leave LF unchanged', () => {
        expect(normalizeLineEndings('line1\nline2\n')).toBe('line1\nline2\n');
    });

    it('should handle mixed line endings', () => {
        expect(normalizeLineEndings('a\r\nb\rc\n')).toBe('a\nb\nc\n');
    });
});

// ============================================================================
// getArticleFilePath
// ============================================================================

describe('getArticleFilePath', () => {
    it('should place module articles in modules/ subdirectory', () => {
        const article: GeneratedArticle = {
            type: 'module',
            slug: 'auth',
            title: 'Auth',
            content: '',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'modules', 'auth.md'));
    });

    it('should place index at root', () => {
        const article: GeneratedArticle = {
            type: 'index',
            slug: 'index',
            title: 'Index',
            content: '',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'index.md'));
    });

    it('should place architecture at root', () => {
        const article: GeneratedArticle = {
            type: 'architecture',
            slug: 'architecture',
            title: 'Architecture',
            content: '',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'architecture.md'));
    });

    it('should place getting-started at root', () => {
        const article: GeneratedArticle = {
            type: 'getting-started',
            slug: 'getting-started',
            title: 'Getting Started',
            content: '',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'getting-started.md'));
    });

    it('should slugify the filename', () => {
        const article: GeneratedArticle = {
            type: 'module',
            slug: 'My Module',
            title: 'My Module',
            content: '',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'modules', 'my-module.md'));
    });
});

// ============================================================================
// writeWikiOutput
// ============================================================================

describe('writeWikiOutput', () => {
    it('should create output directory and modules subdirectory', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        expect(fs.existsSync(outputDir)).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'modules'))).toBe(true);
    });

    it('should write module articles to modules/', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'auth',
                    title: 'Auth',
                    content: '# Auth Module\n\nContent.',
                },
            ],
            duration: 100,
        };

        const written = writeWikiOutput(output, outputDir);

        expect(written).toHaveLength(1);
        const filePath = path.join(outputDir, 'modules', 'auth.md');
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toContain('# Auth Module');
    });

    it('should write index at root', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'index',
                    slug: 'index',
                    title: 'Wiki',
                    content: '# Project Wiki\n\nWelcome.',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        const filePath = path.join(outputDir, 'index.md');
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toContain('# Project Wiki');
    });

    it('should use UTF-8 encoding', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'unicode',
                    title: 'Unicode Test',
                    content: '# Unicode: café 日本語 🚀',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        const content = fs.readFileSync(
            path.join(outputDir, 'modules', 'unicode.md'),
            'utf-8'
        );
        expect(content).toContain('café');
        expect(content).toContain('日本語');
        expect(content).toContain('🚀');
    });

    it('should normalize CRLF to LF', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'crlf',
                    title: 'CRLF Test',
                    content: 'line1\r\nline2\r\n',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        const content = fs.readFileSync(
            path.join(outputDir, 'modules', 'crlf.md'),
            'utf-8'
        );
        expect(content).toBe('line1\nline2\n');
    });

    it('should overwrite existing files', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const modulesDir = path.join(outputDir, 'modules');
        fs.mkdirSync(modulesDir, { recursive: true });
        fs.writeFileSync(path.join(modulesDir, 'auth.md'), 'old content', 'utf-8');

        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'auth',
                    title: 'Auth',
                    content: 'new content',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        const content = fs.readFileSync(path.join(modulesDir, 'auth.md'), 'utf-8');
        expect(content).toBe('new content');
    });

    it('should return array of written file paths', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                { type: 'index', slug: 'index', title: 'Wiki', content: '# Wiki' },
                { type: 'module', slug: 'auth', title: 'Auth', content: '# Auth' },
                { type: 'architecture', slug: 'architecture', title: 'Arch', content: '# Arch' },
            ],
            duration: 100,
        };

        const written = writeWikiOutput(output, outputDir);

        expect(written).toHaveLength(3);
        for (const p of written) {
            expect(fs.existsSync(p)).toBe(true);
        }
    });

    it('should write complete directory structure', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                { type: 'index', slug: 'index', title: 'Index', content: '# Index' },
                { type: 'architecture', slug: 'architecture', title: 'Arch', content: '# Arch' },
                { type: 'getting-started', slug: 'getting-started', title: 'GS', content: '# GS' },
                { type: 'module', slug: 'auth', title: 'Auth', content: '# Auth' },
                { type: 'module', slug: 'database', title: 'DB', content: '# DB' },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        expect(fs.existsSync(path.join(outputDir, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'getting-started.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'modules', 'auth.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'modules', 'database.md'))).toBe(true);
    });
});
