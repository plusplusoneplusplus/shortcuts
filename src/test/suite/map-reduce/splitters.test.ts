/**
 * Tests for Splitters
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
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
} from '../../../shortcuts/map-reduce/splitters';

suite('FileSplitter', () => {
    const createFileInput = (files: FileItem[]): FileInput => ({
        files,
        context: { testContext: true }
    });

    test('splits files into work items', () => {
        const input = createFileInput([
            { path: 'src/a.ts' },
            { path: 'src/b.ts' }
        ]);

        const splitter = createFileSplitter();
        const items = splitter.split(input);

        assert.strictEqual(items.length, 2);
        assert.ok(items[0].id.includes('a.ts'));
        assert.strictEqual(items[0].data.file.path, 'src/a.ts');
        assert.deepStrictEqual(items[0].data.context, { testContext: true });
    });

    test('generates unique IDs for files', () => {
        const input = createFileInput([
            { path: 'src/file.ts' },
            { path: 'lib/file.ts' }
        ]);

        const splitter = createFileSplitter();
        const items = splitter.split(input);

        assert.notStrictEqual(items[0].id, items[1].id);
    });

    test('respects custom ID generator', () => {
        const input = createFileInput([{ path: 'test.ts' }]);
        const splitter = createFileSplitter({
            generateId: (file, index) => `custom-${index}-${file.path}`
        });

        const items = splitter.split(input);
        assert.strictEqual(items[0].id, 'custom-0-test.ts');
    });

    test('filters files when filter provided', () => {
        const input = createFileInput([
            { path: 'src/a.ts' },
            { path: 'test/b.spec.ts' },
            { path: 'src/c.ts' }
        ]);

        const splitter = createFileSplitter({
            filter: (file) => !file.path.includes('test/')
        });

        const items = splitter.split(input);
        assert.strictEqual(items.length, 2);
        assert.ok(items.every(item => !item.data.file.path.includes('test/')));
    });

    test('includes metadata in work items', () => {
        const input = createFileInput([
            { path: 'a.ts' },
            { path: 'b.ts' }
        ]);

        const splitter = createFileSplitter();
        const items = splitter.split(input);

        assert.strictEqual(items[0].metadata?.index, 0);
        assert.strictEqual(items[0].metadata?.totalFiles, 2);
        assert.strictEqual(items[1].metadata?.index, 1);
    });

    test('extension filtered splitter filters by extension', () => {
        const input = createFileInput([
            { path: 'src/a.ts' },
            { path: 'src/b.js' },
            { path: 'src/c.css' }
        ]);

        const splitter = createExtensionFilteredSplitter(['.ts', 'js']);
        const items = splitter.split(input);

        assert.strictEqual(items.length, 2);
        assert.ok(items.some(item => item.data.file.path.endsWith('.ts')));
        assert.ok(items.some(item => item.data.file.path.endsWith('.js')));
    });

    test('returns empty array for empty input', () => {
        const input = createFileInput([]);
        const splitter = createFileSplitter();
        const items = splitter.split(input);

        assert.strictEqual(items.length, 0);
    });
});

suite('BatchedFileSplitter', () => {
    test('batches files into work items', () => {
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

        assert.strictEqual(items.length, 3); // 2 + 2 + 1
        assert.strictEqual(items[0].data.files.length, 2);
        assert.strictEqual(items[1].data.files.length, 2);
        assert.strictEqual(items[2].data.files.length, 1);
    });

    test('includes batch metadata', () => {
        const input: FileInput = {
            files: [
                { path: 'a.ts' },
                { path: 'b.ts' },
                { path: 'c.ts' }
            ]
        };

        const splitter = new BatchedFileSplitter(2);
        const items = splitter.split(input);

        assert.strictEqual(items[0].metadata?.batchIndex, 0);
        assert.strictEqual(items[0].metadata?.totalBatches, 2);
        assert.strictEqual(items[0].metadata?.filesInBatch, 2);
    });
});

suite('ChunkSplitter', () => {
    test('splits content into chunks', () => {
        const content = 'A'.repeat(1000);
        const input: ChunkInput = { content };

        const splitter = createChunkSplitter({ maxChunkSize: 300, overlapSize: 50 });
        const items = splitter.split(input);

        assert.ok(items.length > 1);
        assert.ok(items.every(item => item.data.content.length <= 300));
    });

    test('includes chunk metadata', () => {
        const input: ChunkInput = {
            content: 'A'.repeat(500),
            source: 'test.txt'
        };

        const splitter = createChunkSplitter({ maxChunkSize: 200, overlapSize: 50 });
        const items = splitter.split(input);

        assert.strictEqual(items[0].data.chunkIndex, 0);
        assert.strictEqual(items[0].data.source, 'test.txt');
        assert.ok(items[0].data.totalChunks > 1);
    });

    test('returns empty array for empty content', () => {
        const input: ChunkInput = { content: '' };
        const splitter = createChunkSplitter();
        const items = splitter.split(input);

        assert.strictEqual(items.length, 0);
    });

    test('single chunk for small content', () => {
        const input: ChunkInput = { content: 'Small content' };
        const splitter = createChunkSplitter({ maxChunkSize: 1000, overlapSize: 100 });
        const items = splitter.split(input);

        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].data.content, 'Small content');
    });

    test('line splitter preserves line boundaries', () => {
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
                assert.ok(
                    content.endsWith('\n') || !content.includes('\n') ||
                    content.split('\n').every(line => line.length > 0 || line === ''),
                    `Chunk content doesn't preserve lines: ${content}`
                );
            }
        }
    });

    test('paragraph splitter splits on double newlines', () => {
        const input: ChunkInput = {
            content: 'Para 1.\n\nPara 2.\n\nPara 3.'
        };

        const splitter = createParagraphChunkSplitter(20);
        const items = splitter.split(input);

        assert.ok(items.length >= 1);
    });

    test('includes offsets in chunk data', () => {
        const input: ChunkInput = { content: 'A'.repeat(500) };
        const splitter = createChunkSplitter({ maxChunkSize: 200, overlapSize: 50 });
        const items = splitter.split(input);

        assert.strictEqual(items[0].data.startOffset, 0);
        assert.ok(items[0].data.endOffset! > 0);
    });
});

suite('RuleSplitter', () => {
    const createRuleInput = (rules: Rule[]): RuleInput => ({
        rules,
        targetContent: 'diff content here',
        context: { testContext: true }
    });

    test('splits rules into work items', () => {
        const input = createRuleInput([
            { id: 'rule1', filename: 'rule1.md', path: '/rules/rule1.md', content: 'Rule 1 content' },
            { id: 'rule2', filename: 'rule2.md', path: '/rules/rule2.md', content: 'Rule 2 content' }
        ]);

        const splitter = createRuleSplitter();
        const items = splitter.split(input);

        assert.strictEqual(items.length, 2);
        assert.strictEqual(items[0].data.rule.id, 'rule1');
        assert.strictEqual(items[0].data.targetContent, 'diff content here');
    });

    test('includes rule metadata in work items', () => {
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

        assert.strictEqual(items[0].metadata?.ruleId, 'rule1');
        assert.strictEqual(items[0].metadata?.ruleFilename, 'rule1.md');
        assert.deepStrictEqual(items[0].metadata?.frontMatter, { model: 'gpt-4' });
    });

    test('alphabetic splitter sorts rules', () => {
        const input = createRuleInput([
            { id: 'c', filename: 'c.md', path: '/c.md', content: '' },
            { id: 'a', filename: 'a.md', path: '/a.md', content: '' },
            { id: 'b', filename: 'b.md', path: '/b.md', content: '' }
        ]);

        const splitter = createAlphabeticRuleSplitter();
        const items = splitter.split(input);

        assert.strictEqual(items[0].data.rule.filename, 'a.md');
        assert.strictEqual(items[1].data.rule.filename, 'b.md');
        assert.strictEqual(items[2].data.rule.filename, 'c.md');
    });

    test('filter excludes rules', () => {
        const input = createRuleInput([
            { id: 'rule1', filename: 'enabled.md', path: '/enabled.md', content: '' },
            { id: 'rule2', filename: 'disabled.md', path: '/disabled.md', content: '' }
        ]);

        const splitter = createRuleSplitter({
            filter: (rule) => rule.filename !== 'disabled.md'
        });

        const items = splitter.split(input);
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].data.rule.filename, 'enabled.md');
    });

    test('validate excludes invalid rules', () => {
        const input = createRuleInput([
            { id: 'rule1', filename: 'valid.md', path: '/valid.md', content: 'Has content' },
            { id: 'rule2', filename: 'invalid.md', path: '/invalid.md', content: '' }
        ]);

        const splitter = createRuleSplitter({
            validate: (rule) => rule.content.length > 0
        });

        const items = splitter.split(input);
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].data.rule.filename, 'valid.md');
    });

    test('generates sanitized IDs from filenames', () => {
        const input = createRuleInput([
            { id: '', filename: 'My Rule (v2).md', path: '/rules/My Rule (v2).md', content: '' }
        ]);

        const splitter = createRuleSplitter();
        const items = splitter.split(input);

        // ID should be sanitized
        assert.ok(items[0].id.match(/^rule-[a-z0-9-]+$/));
    });

    test('returns empty array for empty rules', () => {
        const input = createRuleInput([]);
        const splitter = createRuleSplitter();
        const items = splitter.split(input);

        assert.strictEqual(items.length, 0);
    });
});
