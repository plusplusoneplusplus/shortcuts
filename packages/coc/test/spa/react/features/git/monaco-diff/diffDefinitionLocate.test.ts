import { describe, expect, it } from 'vitest';
import type { GitFileDiffContentResponse } from '@plusplusoneplusplus/coc-client';
import { locateDefinitionInSnapshot, snapshotText } from '../../../../../../src/server/spa/client/react/features/git/diff/diffDefinitionLocate';

const CURRENT = 'import x\n\nexport function parse() {\n  return x;\n}\n';

describe('locateDefinitionInSnapshot', () => {
    it('keeps the coordinate when the snapshot is the current code', () => {
        expect(locateDefinitionInSnapshot(CURRENT, CURRENT, 3, 17)).toEqual({ line: 3, column: 17 });
    });

    it('treats CRLF and LF lines alike', () => {
        expect(locateDefinitionInSnapshot('a\r\nexport function parse() {\r\n', CURRENT, 3, 17)).toEqual({ line: 2, column: 17 });
    });

    it('follows a definition whose line moved in the snapshot', () => {
        const historical = '// header\n// more\nimport x\n\nexport function parse() {\n  return 1;\n}\n';
        expect(locateDefinitionInSnapshot(historical, CURRENT, 3, 17)).toEqual({ line: 5, column: 17 });
    });

    it.each([
        ['missing', 'import x\nexport function parseAll() {\n}\n'],
        ['edited', 'export function parse(input) {\n'],
        ['ambiguous', 'export function parse() {\n}\nexport function parse() {\n'],
    ])('refuses a %s definition line', (_case, historical) => {
        expect(locateDefinitionInSnapshot(historical, CURRENT, 3, 17)).toBeNull();
    });

    it('never trusts an in-range line number alone', () => {
        // Same length, line 3 exists, but holds something else.
        expect(locateDefinitionInSnapshot('a\nb\nc\nd\ne\n', CURRENT, 3, 1)).toBeNull();
    });

    it.each([0, 7, 99])('refuses line %i outside the current code', line => {
        expect(locateDefinitionInSnapshot(CURRENT, CURRENT, line, 1)).toBeNull();
    });

    it('refuses a blank definition line', () => {
        expect(locateDefinitionInSnapshot('x\n\nimport x\n', CURRENT, 2, 1)).toBeNull();
    });
});

describe('snapshotText', () => {
    const content = (extra: Partial<GitFileDiffContentResponse> = {}): GitFileDiffContentResponse => ({
        path: 'a.ts', fileName: 'a.ts', language: 'typescript',
        base: { content: 'old', ref: 'base', exists: true },
        head: { content: 'new', ref: 'head', exists: true },
        binary: false, tooLarge: false, ...extra,
    });

    it('reads the side the jump revealed on', () => {
        expect(snapshotText(content(), 'original')).toBe('old');
        expect(snapshotText(content(), 'modified')).toBe('new');
    });

    it('has no text for a missing side, binary or oversized content', () => {
        expect(snapshotText(content({ base: { content: '', ref: 'base', exists: false } }), 'original')).toBeNull();
        expect(snapshotText(content({ binary: true }), 'modified')).toBeNull();
        expect(snapshotText(content({ tooLarge: true }), 'modified')).toBeNull();
    });
});
