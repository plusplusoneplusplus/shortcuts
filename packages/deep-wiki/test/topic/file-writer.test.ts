import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TopicOutline, TopicArticle } from '../../src/types';
import { writeTopicArticles, type TopicWriteOptions } from '../../src/topic/file-writer';

// ─── Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'topic-fw-'));
}

function makeOutline(overrides: Partial<TopicOutline> = {}): TopicOutline {
    return {
        topicId: 'compaction',
        title: 'Log Compaction',
        layout: 'area',
        articles: [],
        involvedModules: [],
        ...overrides,
    };
}

function makeArticle(overrides: Partial<TopicArticle> = {}): TopicArticle {
    return {
        type: 'topic-article',
        slug: 'overview',
        title: 'Overview',
        content: '# Overview\n\nSome content.\n',
        topicId: 'compaction',
        coveredModuleIds: ['mod-a'],
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

describe('writeTopicArticles', () => {
    it('writes single article layout to topics/{topicId}.md', () => {
        const outline = makeOutline({ layout: 'single' });
        const articles = [makeArticle({ type: 'topic-article', slug: 'compaction' })];

        const result = writeTopicArticles({
            wikiDir: tmpDir,
            topicId: 'compaction',
            outline,
            articles,
        });

        expect(result.writtenFiles).toHaveLength(1);
        const filePath = result.writtenFiles[0];
        expect(filePath).toBe(path.join(path.resolve(tmpDir), 'topics', 'compaction.md'));
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toContain('# Overview');
    });

    it('writes area layout with index + sub-articles', () => {
        const outline = makeOutline({ layout: 'area' });
        const articles = [
            makeArticle({ type: 'topic-index', slug: 'index', title: 'Overview' }),
            makeArticle({ type: 'topic-article', slug: 'storage', title: 'Storage' }),
            makeArticle({ type: 'topic-article', slug: 'cleanup', title: 'Cleanup' }),
        ];

        const result = writeTopicArticles({
            wikiDir: tmpDir,
            topicId: 'compaction',
            outline,
            articles,
        });

        expect(result.writtenFiles).toHaveLength(3);
        const topicDir = path.join(path.resolve(tmpDir), 'topics', 'compaction');
        expect(result.topicDir).toBe(topicDir);

        // Verify each file exists
        expect(fs.existsSync(path.join(topicDir, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(topicDir, 'storage.md'))).toBe(true);
        expect(fs.existsSync(path.join(topicDir, 'cleanup.md'))).toBe(true);
    });

    it('creates topics/ directory automatically', () => {
        const topicsDir = path.join(tmpDir, 'topics');
        expect(fs.existsSync(topicsDir)).toBe(false);

        const outline = makeOutline({ layout: 'single' });
        const articles = [makeArticle()];

        writeTopicArticles({
            wikiDir: tmpDir,
            topicId: 'compaction',
            outline,
            articles,
        });

        expect(fs.existsSync(topicsDir)).toBe(true);
    });

    it('overwrites existing files', () => {
        const outline = makeOutline({ layout: 'single' });
        const articles = [makeArticle({ content: '# First version\n' })];

        writeTopicArticles({ wikiDir: tmpDir, topicId: 'compaction', outline, articles });

        // Write again with different content
        const articles2 = [makeArticle({ content: '# Second version\n' })];
        const result = writeTopicArticles({ wikiDir: tmpDir, topicId: 'compaction', outline, articles: articles2 });

        const content = fs.readFileSync(result.writtenFiles[0], 'utf-8');
        expect(content).toContain('# Second version');
        expect(content).not.toContain('# First version');
    });

    it('normalizes CRLF line endings to LF', () => {
        const outline = makeOutline({ layout: 'single' });
        const articles = [makeArticle({ content: '# Title\r\n\r\nBody\r\n' })];

        const result = writeTopicArticles({ wikiDir: tmpDir, topicId: 'compaction', outline, articles });

        const content = fs.readFileSync(result.writtenFiles[0], 'utf-8');
        expect(content).toBe('# Title\n\nBody\n');
        expect(content).not.toContain('\r');
    });

    it('handles empty articles array gracefully for single layout', () => {
        const outline = makeOutline({ layout: 'single' });

        const result = writeTopicArticles({
            wikiDir: tmpDir,
            topicId: 'compaction',
            outline,
            articles: [],
        });

        expect(result.writtenFiles).toHaveLength(0);
    });

    it('handles empty articles array gracefully for area layout', () => {
        const outline = makeOutline({ layout: 'area' });

        const result = writeTopicArticles({
            wikiDir: tmpDir,
            topicId: 'compaction',
            outline,
            articles: [],
        });

        expect(result.writtenFiles).toHaveLength(0);
        // Topic directory is still created
        expect(fs.existsSync(path.join(path.resolve(tmpDir), 'topics', 'compaction'))).toBe(true);
    });
});
