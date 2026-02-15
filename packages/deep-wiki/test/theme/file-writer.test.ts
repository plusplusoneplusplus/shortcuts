import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ThemeOutline, ThemeArticle } from '../../src/types';
import { writeThemeArticles, type ThemeWriteOptions } from '../../src/theme/file-writer';

// ─── Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'theme-fw-'));
}

function makeOutline(overrides: Partial<ThemeOutline> = {}): ThemeOutline {
    return {
        themeId: 'compaction',
        title: 'Log Compaction',
        layout: 'area',
        articles: [],
        involvedComponents: [],
        ...overrides,
    };
}

function makeArticle(overrides: Partial<ThemeArticle> = {}): ThemeArticle {
    return {
        type: 'theme-article',
        slug: 'overview',
        title: 'Overview',
        content: '# Overview\n\nSome content.\n',
        themeId: 'compaction',
        coveredComponentIds: ['mod-a'],
        ...overrides,
    };
}

beforeEach(() => {
    tmpDir = makeTmpDir();
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ─────────────────────────────────────────────────────────────

describe('writeThemeArticles', () => {
    it('writes single article layout to themes/{themeId}.md', () => {
        const outline = makeOutline({ layout: 'single' });
        const articles = [makeArticle({ type: 'theme-article', slug: 'compaction' })];

        const result = writeThemeArticles({
            wikiDir: tmpDir,
            themeId: 'compaction',
            outline,
            articles,
        });

        expect(result.writtenFiles).toHaveLength(1);
        const filePath = result.writtenFiles[0];
        expect(filePath).toBe(path.join(path.resolve(tmpDir), 'themes', 'compaction.md'));
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toContain('# Overview');
    });

    it('writes area layout with index + sub-articles', () => {
        const outline = makeOutline({ layout: 'area' });
        const articles = [
            makeArticle({ type: 'theme-index', slug: 'index', title: 'Overview' }),
            makeArticle({ type: 'theme-article', slug: 'storage', title: 'Storage' }),
            makeArticle({ type: 'theme-article', slug: 'cleanup', title: 'Cleanup' }),
        ];

        const result = writeThemeArticles({
            wikiDir: tmpDir,
            themeId: 'compaction',
            outline,
            articles,
        });

        expect(result.writtenFiles).toHaveLength(3);
        const themeDir = path.join(path.resolve(tmpDir), 'themes', 'compaction');
        expect(result.themeDir).toBe(themeDir);

        // Verify each file exists
        expect(fs.existsSync(path.join(themeDir, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(themeDir, 'storage.md'))).toBe(true);
        expect(fs.existsSync(path.join(themeDir, 'cleanup.md'))).toBe(true);
    });

    it('creates themes/ directory automatically', () => {
        const themesDir = path.join(tmpDir, 'themes');
        expect(fs.existsSync(themesDir)).toBe(false);

        const outline = makeOutline({ layout: 'single' });
        const articles = [makeArticle()];

        writeThemeArticles({
            wikiDir: tmpDir,
            themeId: 'compaction',
            outline,
            articles,
        });

        expect(fs.existsSync(themesDir)).toBe(true);
    });

    it('overwrites existing files', () => {
        const outline = makeOutline({ layout: 'single' });
        const articles = [makeArticle({ content: '# First version\n' })];

        writeThemeArticles({ wikiDir: tmpDir, themeId: 'compaction', outline, articles });

        // Write again with different content
        const articles2 = [makeArticle({ content: '# Second version\n' })];
        const result = writeThemeArticles({ wikiDir: tmpDir, themeId: 'compaction', outline, articles: articles2 });

        const content = fs.readFileSync(result.writtenFiles[0], 'utf-8');
        expect(content).toContain('# Second version');
        expect(content).not.toContain('# First version');
    });

    it('normalizes CRLF line endings to LF', () => {
        const outline = makeOutline({ layout: 'single' });
        const articles = [makeArticle({ content: '# Title\r\n\r\nBody\r\n' })];

        const result = writeThemeArticles({ wikiDir: tmpDir, themeId: 'compaction', outline, articles });

        const content = fs.readFileSync(result.writtenFiles[0], 'utf-8');
        expect(content).toBe('# Title\n\nBody\n');
        expect(content).not.toContain('\r');
    });

    it('handles empty articles array gracefully for single layout', () => {
        const outline = makeOutline({ layout: 'single' });

        const result = writeThemeArticles({
            wikiDir: tmpDir,
            themeId: 'compaction',
            outline,
            articles: [],
        });

        expect(result.writtenFiles).toHaveLength(0);
    });

    it('handles empty articles array gracefully for area layout', () => {
        const outline = makeOutline({ layout: 'area' });

        const result = writeThemeArticles({
            wikiDir: tmpDir,
            themeId: 'compaction',
            outline,
            articles: [],
        });

        expect(result.writtenFiles).toHaveLength(0);
        // Theme directory is still created
        expect(fs.existsSync(path.join(path.resolve(tmpDir), 'themes', 'compaction'))).toBe(true);
    });
});
