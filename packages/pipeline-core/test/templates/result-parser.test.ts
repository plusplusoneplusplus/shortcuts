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
});
