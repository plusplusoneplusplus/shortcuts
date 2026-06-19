import { describe, it, expect } from 'vitest';
import { tagBlock, tagGuidanceSuffix } from '../../../src/server/executors/prompt-tags';

describe('tagBlock', () => {
    it('wraps body in an open/close tag on their own lines', () => {
        expect(tagBlock('citing_rule', 'hello')).toBe('<citing_rule>\nhello\n</citing_rule>');
    });

    it('preserves multi-line bodies verbatim between the tags', () => {
        const body = 'line one\nline two';
        expect(tagBlock('demo', body)).toBe('<demo>\nline one\nline two\n</demo>');
    });

    it('does not add the blank-line separator (that is for guidance suffixes)', () => {
        expect(tagBlock('demo', 'x').startsWith('\n')).toBe(false);
    });

    it('handles an empty body without collapsing the tags', () => {
        expect(tagBlock('demo', '')).toBe('<demo>\n\n</demo>');
    });
});

describe('tagGuidanceSuffix', () => {
    it('prefixes the tagged block with the blank-line separator the assembler relies on', () => {
        expect(tagGuidanceSuffix('canvas_tools', 'use canvases')).toBe(
            '\n\n<canvas_tools>\nuse canvases\n</canvas_tools>',
        );
    });

    it('is equivalent to a separator plus tagBlock', () => {
        const tag = 'work_item_tools';
        const body = 'guidance text';
        expect(tagGuidanceSuffix(tag, body)).toBe(`\n\n${tagBlock(tag, body)}`);
    });
});
