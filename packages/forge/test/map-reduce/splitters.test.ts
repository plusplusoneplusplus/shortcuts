import { describe, it, expect } from 'vitest';
import { ChunkSplitter, createChunkSplitter } from '../../src/map-reduce/splitters/chunk-splitter';
import {
    FileSplitter,
    BatchedFileSplitter,
    createFileSplitter,
    createBatchedFileSplitter,
    createExtensionFilteredSplitter,
} from '../../src/map-reduce/splitters/file-splitter';

// ---------------------------------------------------------------------------
// ChunkSplitter
// ---------------------------------------------------------------------------

describe('ChunkSplitter', () => {
    it('returns empty array for empty content', () => {
        const splitter = new ChunkSplitter({ maxChunkSize: 100, overlapSize: 0 });
        expect(splitter.split({ content: '' })).toEqual([]);
    });

    it('returns a single chunk when content fits in one chunk', () => {
        const splitter = new ChunkSplitter({
            maxChunkSize: 1000,
            overlapSize: 0,
            strategy: 'character',
            preserveBoundaries: false,
        });
        const items = splitter.split({ content: 'hello world' });
        expect(items).toHaveLength(1);
        expect(items[0].data.content).toBe('hello world');
    });

    it('splits content into multiple chunks when content exceeds maxChunkSize', () => {
        const content = 'a'.repeat(200);
        const splitter = new ChunkSplitter({
            maxChunkSize: 50,
            overlapSize: 0,
            strategy: 'character',
            preserveBoundaries: false,
        });
        const items = splitter.split({ content });
        expect(items.length).toBeGreaterThan(1);
    });

    it('records chunkIndex and totalChunks on each work item', () => {
        const content = 'a'.repeat(200);
        const splitter = new ChunkSplitter({
            maxChunkSize: 50,
            overlapSize: 0,
            strategy: 'character',
            preserveBoundaries: false,
        });
        const items = splitter.split({ content });
        const total = items.length;
        items.forEach((item, i) => {
            expect(item.data.chunkIndex).toBe(i);
            expect(item.data.totalChunks).toBe(total);
        });
    });

    it('includes source in work item data when provided', () => {
        const splitter = createChunkSplitter({ maxChunkSize: 1000, overlapSize: 0 });
        const items = splitter.split({ content: 'hello', source: 'test.ts' });
        expect(items[0].data.source).toBe('test.ts');
    });

    it('line strategy splits by lines', () => {
        const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
        const splitter = new ChunkSplitter({
            maxChunkSize: 30,
            overlapSize: 0,
            strategy: 'line',
            preserveBoundaries: true,
        });
        const items = splitter.split({ content: lines });
        expect(items.length).toBeGreaterThanOrEqual(1);
        // All lines are accounted for across chunks
        const combined = items.map(i => i.data.content).join('\n');
        for (let i = 0; i < 10; i++) {
            expect(combined).toContain(`line${i}`);
        }
    });

    it('paragraph strategy groups paragraphs', () => {
        const content = 'Para one.\n\nPara two.\n\nPara three.';
        const splitter = new ChunkSplitter({
            maxChunkSize: 15,
            overlapSize: 0,
            strategy: 'paragraph',
            preserveBoundaries: true,
        });
        const items = splitter.split({ content });
        expect(items.length).toBeGreaterThan(1);
    });
});

// ---------------------------------------------------------------------------
// FileSplitter
// ---------------------------------------------------------------------------

describe('FileSplitter', () => {
    it('creates one work item per file by default', () => {
        const splitter = createFileSplitter();
        const items = splitter.split({
            files: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }],
        });
        expect(items).toHaveLength(3);
    });

    it('applies filter function to exclude files', () => {
        const splitter = createFileSplitter({ filter: f => f.path.endsWith('.ts') });
        const items = splitter.split({
            files: [{ path: 'a.ts' }, { path: 'b.md' }, { path: 'c.ts' }],
        });
        expect(items).toHaveLength(2);
        expect(items.every(i => i.data.file.path.endsWith('.ts'))).toBe(true);
    });

    it('uses custom generateId function', () => {
        const splitter = createFileSplitter({ generateId: (f, i) => `custom-${i}-${f.path}` });
        const items = splitter.split({ files: [{ path: 'foo.ts' }] });
        expect(items[0].id).toBe('custom-0-foo.ts');
    });

    it('returns empty array for empty file list', () => {
        const splitter = createFileSplitter();
        expect(splitter.split({ files: [] })).toEqual([]);
    });

    it('includes context in each work item', () => {
        const splitter = createFileSplitter();
        const ctx = { revision: '123' };
        const items = splitter.split({ files: [{ path: 'x.ts' }], context: ctx });
        expect(items[0].data.context).toEqual(ctx);
    });
});

describe('BatchedFileSplitter', () => {
    it('groups files into batches of specified size', () => {
        const splitter = createBatchedFileSplitter(3);
        const files = Array.from({ length: 7 }, (_, i) => ({ path: `file${i}.ts` }));
        const items = splitter.split({ files });
        expect(items).toHaveLength(3); // ceil(7/3) = 3 batches
        expect(items[0].data.files).toHaveLength(3);
        expect(items[1].data.files).toHaveLength(3);
        expect(items[2].data.files).toHaveLength(1);
    });

    it('returns empty array for empty input', () => {
        const splitter = createBatchedFileSplitter(5);
        expect(splitter.split({ files: [] })).toEqual([]);
    });
});

describe('createExtensionFilteredSplitter', () => {
    it('only includes files with the specified extensions', () => {
        const splitter = createExtensionFilteredSplitter(['.ts', '.tsx']);
        const files = [{ path: 'a.ts' }, { path: 'b.md' }, { path: 'c.tsx' }, { path: 'd.js' }];
        const items = splitter.split({ files });
        expect(items).toHaveLength(2);
        const paths = items.map(i => i.data.file.path);
        expect(paths).toContain('a.ts');
        expect(paths).toContain('c.tsx');
    });
});

