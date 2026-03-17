import { describe, it, expect } from 'vitest';
import { parseReplicateResponse } from '../../src/templates/result-parser';

describe('parseReplicateResponse', () => {
    it('parses single new file', () => {
        const input = [
            '=== FILE: src/foo.ts (new) ===',
            'export const foo = 1;',
            '=== END FILE ===',
            '=== SUMMARY ===',
            'Added foo module.',
        ].join('\n');

        const { files, summary } = parseReplicateResponse(input);

        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('src/foo.ts');
        expect(files[0].status).toBe('new');
        expect(files[0].content).toBe('export const foo = 1;');
        expect(summary).toBe('Added foo module.');
    });

    it('parses multiple files', () => {
        const input = [
            '=== FILE: a.ts (new) ===',
            'new file',
            '=== END FILE ===',
            '=== FILE: b.ts (modified) ===',
            'modified file',
            '=== END FILE ===',
            '=== FILE: c.ts (deleted) ===',
            '=== END FILE ===',
            '=== SUMMARY ===',
            'Done.',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files).toHaveLength(3);
        expect(files[0].status).toBe('new');
        expect(files[1].status).toBe('modified');
        expect(files[2].status).toBe('deleted');
    });

    it('handles deleted file with empty content', () => {
        const input = [
            '=== FILE: old.ts (deleted) ===',
            '=== END FILE ===',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files).toHaveLength(1);
        expect(files[0].content).toBe('');
        expect(files[0].status).toBe('deleted');
    });

    it('handles missing END FILE marker gracefully', () => {
        const input = [
            '=== FILE: src/foo.ts (new) ===',
            'content line 1',
            'content line 2',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('src/foo.ts');
        expect(files[0].content).toContain('content line 1');
        expect(files[0].content).toContain('content line 2');
    });

    it('handles missing SUMMARY marker', () => {
        const input = [
            '=== FILE: a.ts (new) ===',
            'content',
            '=== END FILE ===',
        ].join('\n');

        const { summary } = parseReplicateResponse(input);

        expect(summary).toBe('');
    });

    it('normalises unknown status to modified', () => {
        const input = [
            '=== FILE: x.ts (updated) ===',
            'content',
            '=== END FILE ===',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files[0].status).toBe('modified');
    });

    it('trims path whitespace', () => {
        const input = [
            '=== FILE:   src/foo.ts   (new) ===',
            'content',
            '=== END FILE ===',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files[0].path).toBe('src/foo.ts');
    });

    it('handles completely empty input', () => {
        const { files, summary } = parseReplicateResponse('');

        expect(files).toEqual([]);
        expect(summary).toBe('');
    });

    it('handles multiline file content', () => {
        const content = 'line 1\nline 2\nline 3';
        const input = [
            '=== FILE: multi.ts (new) ===',
            content,
            '=== END FILE ===',
            '=== SUMMARY ===',
            'Multi-line file.',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files[0].content).toBe(content);
    });

    it('ignores preamble text before the first file block', () => {
        const input = [
            'Sure, here are the changes:',
            '',
            '=== FILE: src/a.ts (new) ===',
            'export const a = 1;',
            '=== END FILE ===',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('src/a.ts');
        expect(files[0].content).toBe('export const a = 1;');
    });

    it('ignores trailing text after the last END FILE marker', () => {
        const input = [
            '=== FILE: src/a.ts (new) ===',
            'content',
            '=== END FILE ===',
            '=== SUMMARY ===',
            'Done.',
            '',
            'Let me know if you need anything else!',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files).toHaveLength(1);
    });

    it('ignores text between file blocks', () => {
        const input = [
            '=== FILE: a.ts (new) ===',
            'file a',
            '=== END FILE ===',
            '',
            'Here is the second file:',
            '',
            '=== FILE: b.ts (new) ===',
            'file b',
            '=== END FILE ===',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files).toHaveLength(2);
        expect(files[0].path).toBe('a.ts');
        expect(files[1].path).toBe('b.ts');
    });

    it('returns empty array for output with no file blocks', () => {
        const input = 'Here is my analysis of the code. No changes needed.';

        const { files } = parseReplicateResponse(input);

        expect(files).toEqual([]);
    });

    it('preserves file order from AI output', () => {
        const input = [
            '=== FILE: a.ts (new) ===',
            'a',
            '=== END FILE ===',
            '=== FILE: b.ts (modified) ===',
            'b',
            '=== END FILE ===',
            '=== FILE: c.ts (deleted) ===',
            '=== END FILE ===',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(files[0].path).toBe('a.ts');
        expect(files[1].path).toBe('b.ts');
        expect(files[2].path).toBe('c.ts');
    });

    it('each FileChange has required path and action fields', () => {
        const input = [
            '=== FILE: src/x.ts (new) ===',
            'x',
            '=== END FILE ===',
            '=== FILE: src/y.ts (modified) ===',
            'y',
            '=== END FILE ===',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        for (const f of files) {
            expect(typeof f.path).toBe('string');
            expect(f.path.length).toBeGreaterThan(0);
            expect(['new', 'modified', 'deleted']).toContain(f.status);
        }
    });

    it('content is a string for new and modified files', () => {
        const input = [
            '=== FILE: src/x.ts (new) ===',
            'export const x = 1;',
            '=== END FILE ===',
        ].join('\n');

        const { files } = parseReplicateResponse(input);

        expect(typeof files[0].content).toBe('string');
        expect(files[0].content.length).toBeGreaterThan(0);
    });

    it('extracts multi-line summary', () => {
        const input = [
            '=== FILE: a.ts (new) ===',
            'a',
            '=== END FILE ===',
            '=== SUMMARY ===',
            'Created a new file.',
            'It does something interesting.',
        ].join('\n');

        const { summary } = parseReplicateResponse(input);

        expect(summary).toContain('Created a new file.');
        expect(summary).toContain('It does something interesting.');
    });
});
