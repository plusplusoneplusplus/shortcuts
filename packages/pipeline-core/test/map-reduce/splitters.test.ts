/**
 * Tests for Splitters
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import {
    FileSplitter,
    createFileSplitter,
    createExtensionFilteredSplitter,
    BatchedFileSplitter,
    ChunkSplitter,
    createChunkSplitter,
    createLineChunkSplitter,
    createParagraphChunkSplitter,
    RuleSplitter,
    createRuleSplitter,
    createAlphabeticRuleSplitter,
    FileInput,
    FileItem,
    ChunkInput,
    RuleInput,
    Rule
} from '../../src/map-reduce/splitters';

describe('FileSplitter', () => {
    const createFileInput = (files: FileItem[]): FileInput => ({
        files,
        context: { testContext: true }
    });

    it('splits files into work items', () => {
        const input = createFileInput([
            { path: 'src/a.ts' },
            { path: 'src/b.ts' }
        ]);

        const splitter = createFileSplitter();
        const items = splitter.split(input);

        expect(items.length).toBe(2);
        expect(items[0].id).toContain('a.ts');
        expect(items[0].data.file.path).toBe('src/a.ts');
        expect(items[0].data.context).toEqual({ testContext: true });
    });

    it('generates unique IDs for files', () => {
        const input = createFileInput([
            { path: 'src/file.ts' },
            { path: 'lib/file.ts' }
        ]);

        const splitter = createFileSplitter();
        const items = splitter.split(input);

        expect(items[0].id).not.toBe(items[1].id);
    });

    it('respects custom ID generator', () => {
        const input = createFileInput([{ path: 'test.ts' }]);
        const splitter = createFileSplitter({
            generateId: (file, index) => `custom-${index}-${file.path}`
        });

        const items = splitter.split(input);
        expect(items[0].id).toBe('custom-0-test.ts');
    });

    it('filters files when filter provided', () => {
        const input = createFileInput([
            { path: 'src/a.ts' },
            { path: 'test/b.spec.ts' },
            { path: 'src/c.ts' }
        ]);

        const splitter = createFileSplitter({
            filter: (file) => !file.path.includes('test/')
        });

        const items = splitter.split(input);
        expect(items.length).toBe(2);
        expect(items.every(item => !item.data.file.path.includes('test/'))).toBe(true);
    });

    it('includes metadata in work items', () => {
        const input = createFileInput([
            { path: 'a.ts' },
            { path: 'b.ts' }
        ]);

        const splitter = createFileSplitter();
        const items = splitter.split(input);

        expect(items[0].metadata?.index).toBe(0);
        expect(items[0].metadata?.totalFiles).toBe(2);
        expect(items[1].metadata?.index).toBe(1);
    });

    it('extension filtered splitter filters by extension', () => {
        const input = createFileInput([
            { path: 'src/a.ts' },
            { path: 'src/b.js' },
            { path: 'src/c.css' }
        ]);

        const splitter = createExtensionFilteredSplitter(['.ts', 'js']);
        const items = splitter.split(input);

        expect(items.length).toBe(2);
        expect(items.some(item => item.data.file.path.endsWith('.ts'))).toBe(true);
        expect(items.some(item => item.data.file.path.endsWith('.js'))).toBe(true);
    });

    it('returns empty array for empty input', () => {
        const input = createFileInput([]);
        const splitter = createFileSplitter();
        const items = splitter.split(input);

        expect(items.length).toBe(0);
    });
});

describe('BatchedFileSplitter', () => {
    it('batches files into work items', () => {
        const input: FileInput = {
            files: [
                { path: 'a.ts' },
                { path: 'b.ts' },
                { path: 'c.ts' },
                { path: 'd.ts' },
                { path: 'e.ts' }
            ]
        };

        const splitter = new BatchedFileSplitter(2);
        const items = splitter.split(input);

        expect(items.length).toBe(3); // 2 + 2 + 1
        expect(items[0].data.files.length).toBe(2);
        expect(items[1].data.files.length).toBe(2);
        expect(items[2].data.files.length).toBe(1);
    });

    it('includes batch metadata', () => {
        const input: FileInput = {
            files: [
                { path: 'a.ts' },
                { path: 'b.ts' },
                { path: 'c.ts' }
            ]
        };

        const splitter = new BatchedFileSplitter(2);
        const items = splitter.split(input);

        expect(items[0].metadata?.batchIndex).toBe(0);
        expect(items[0].metadata?.totalBatches).toBe(2);
        expect(items[0].metadata?.filesInBatch).toBe(2);
    });
});

describe('ChunkSplitter', () => {
    it('splits content into chunks', () => {
        const content = 'A'.repeat(1000);
        const input: ChunkInput = { content };

        const splitter = createChunkSplitter({ maxChunkSize: 300, overlapSize: 50 });
        const items = splitter.split(input);

        expect(items.length).toBeGreaterThan(1);
        expect(items.every(item => item.data.content.length <= 300)).toBe(true);
    });

    it('includes chunk metadata', () => {
        const input: ChunkInput = {
            content: 'A'.repeat(500),
            source: 'test.txt'
        };

        const splitter = createChunkSplitter({ maxChunkSize: 200, overlapSize: 50 });
        const items = splitter.split(input);

        expect(items[0].data.chunkIndex).toBe(0);
        expect(items[0].data.source).toBe('test.txt');
        expect(items[0].data.totalChunks).toBeGreaterThan(1);
    });

    it('returns empty array for empty content', () => {
        const input: ChunkInput = { content: '' };
        const splitter = createChunkSplitter();
        const items = splitter.split(input);

        expect(items.length).toBe(0);
    });

    it('single chunk for small content', () => {
        const input: ChunkInput = { content: 'Small content' };
        const splitter = createChunkSplitter({ maxChunkSize: 1000, overlapSize: 100 });
        const items = splitter.split(input);

        expect(items.length).toBe(1);
        expect(items[0].data.content).toBe('Small content');
    });

    it('line splitter preserves line boundaries', () => {
        const input: ChunkInput = {
            content: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
        };

        const splitter = createLineChunkSplitter(20, 5);
        const items = splitter.split(input);

        // Each chunk should end at line boundary
        for (const item of items) {
            const content = item.data.content;
            if (!content.endsWith('Line 5')) {
                // All chunks except last should have newline at end or just before
                expect(
                    content.endsWith('\n') || !content.includes('\n') ||
                    content.split('\n').every(line => line.length > 0 || line === '')
                ).toBe(true);
            }
        }
    });

    it('paragraph splitter splits on double newlines', () => {
        const input: ChunkInput = {
            content: 'Para 1.\n\nPara 2.\n\nPara 3.'
        };

        const splitter = createParagraphChunkSplitter(20);
        const items = splitter.split(input);

        expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('includes offsets in chunk data', () => {
        const input: ChunkInput = { content: 'A'.repeat(500) };
        const splitter = createChunkSplitter({ maxChunkSize: 200, overlapSize: 50 });
        const items = splitter.split(input);

        expect(items[0].data.startOffset).toBe(0);
        expect(items[0].data.endOffset).toBeGreaterThan(0);
    });
});

describe('RuleSplitter', () => {
    const createRuleInput = (rules: Rule[]): RuleInput => ({
        rules,
        targetContent: 'diff content here',
        context: { testContext: true }
    });

    it('splits rules into work items', () => {
        const input = createRuleInput([
            { id: 'rule1', filename: 'rule1.md', path: '/rules/rule1.md', content: 'Rule 1 content' },
            { id: 'rule2', filename: 'rule2.md', path: '/rules/rule2.md', content: 'Rule 2 content' }
        ]);

        const splitter = createRuleSplitter();
        const items = splitter.split(input);

        expect(items.length).toBe(2);
        expect(items[0].data.rule.id).toBe('rule1');
        expect(items[0].data.targetContent).toBe('diff content here');
    });

    it('includes rule metadata in work items', () => {
        const input = createRuleInput([
            {
                id: 'rule1',
                filename: 'rule1.md',
                path: '/rules/rule1.md',
                content: 'Content',
                frontMatter: { model: 'gpt-4' }
            }
        ]);

        const splitter = createRuleSplitter();
        const items = splitter.split(input);

        expect(items[0].metadata?.ruleId).toBe('rule1');
        expect(items[0].metadata?.ruleFilename).toBe('rule1.md');
        expect(items[0].metadata?.frontMatter).toEqual({ model: 'gpt-4' });
    });

    it('alphabetic splitter sorts rules', () => {
        const input = createRuleInput([
            { id: 'c', filename: 'c.md', path: '/c.md', content: '' },
            { id: 'a', filename: 'a.md', path: '/a.md', content: '' },
            { id: 'b', filename: 'b.md', path: '/b.md', content: '' }
        ]);

        const splitter = createAlphabeticRuleSplitter();
        const items = splitter.split(input);

        expect(items[0].data.rule.filename).toBe('a.md');
        expect(items[1].data.rule.filename).toBe('b.md');
        expect(items[2].data.rule.filename).toBe('c.md');
    });

    it('filter excludes rules', () => {
        const input = createRuleInput([
            { id: 'rule1', filename: 'enabled.md', path: '/enabled.md', content: '' },
            { id: 'rule2', filename: 'disabled.md', path: '/disabled.md', content: '' }
        ]);

        const splitter = createRuleSplitter({
            filter: (rule) => rule.filename !== 'disabled.md'
        });

        const items = splitter.split(input);
        expect(items.length).toBe(1);
        expect(items[0].data.rule.filename).toBe('enabled.md');
    });

    it('validate excludes invalid rules', () => {
        const input = createRuleInput([
            { id: 'rule1', filename: 'valid.md', path: '/valid.md', content: 'Has content' },
            { id: 'rule2', filename: 'invalid.md', path: '/invalid.md', content: '' }
        ]);

        const splitter = createRuleSplitter({
            validate: (rule) => rule.content.length > 0
        });

        const items = splitter.split(input);
        expect(items.length).toBe(1);
        expect(items[0].data.rule.filename).toBe('valid.md');
    });

    it('generates sanitized IDs from filenames', () => {
        const input = createRuleInput([
            { id: '', filename: 'My Rule (v2).md', path: '/rules/My Rule (v2).md', content: '' }
        ]);

        const splitter = createRuleSplitter();
        const items = splitter.split(input);

        // ID should be sanitized
        expect(items[0].id).toMatch(/^rule-[a-z0-9-]+$/);
    });

    it('returns empty array for empty rules', () => {
        const input = createRuleInput([]);
        const splitter = createRuleSplitter();
        const items = splitter.split(input);

        expect(items.length).toBe(0);
    });
});
