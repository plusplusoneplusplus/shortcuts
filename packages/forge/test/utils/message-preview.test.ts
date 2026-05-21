import { describe, it, expect } from 'vitest';
import { computeMessagePreview } from '../../src/utils/message-preview';

describe('computeMessagePreview', () => {
    it('returns undefined for empty/nullish input', () => {
        expect(computeMessagePreview('')).toBeUndefined();
        expect(computeMessagePreview(undefined)).toBeUndefined();
        expect(computeMessagePreview(null)).toBeUndefined();
        expect(computeMessagePreview('   \n   ')).toBeUndefined();
    });

    it('strips fenced code blocks', () => {
        const r = computeMessagePreview('Before\n```ts\nconst x = 1;\n```\nAfter');
        expect(r).toBe('Before After');
    });

    it('strips inline code', () => {
        expect(computeMessagePreview('Use `npm run build` to compile')).toBe('Use to compile');
    });

    it('strips image markdown and unwraps links', () => {
        expect(computeMessagePreview('![alt](x.png) see [docs](http://x)')).toBe('see docs');
    });

    it('strips html tags', () => {
        expect(computeMessagePreview('<b>hi</b> <i>there</i>')).toBe('hi there');
    });

    it('collapses whitespace', () => {
        expect(computeMessagePreview('a\n\n\tb   c')).toBe('a b c');
    });

    it('truncates to maxLength', () => {
        const long = 'x'.repeat(200);
        const out = computeMessagePreview(long, 50);
        expect(out?.length).toBe(50);
    });
});
