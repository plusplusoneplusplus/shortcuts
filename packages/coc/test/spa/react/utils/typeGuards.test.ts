import { describe, expect, it } from 'vitest';
import { isRecord } from '../../../../src/server/spa/client/react/utils/typeGuards';
import { getApplyPatchText } from '../../../../src/server/spa/client/react/utils/applyPatchParser';
import { normalizeToolArgs } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolNormalization';

describe('isRecord', () => {
    it.each([null, undefined, [], ['value'], '', 'value', 0, true, () => ({})])(
        'rejects non-record payload %j',
        value => expect(isRecord(value)).toBe(false),
    );

    it('accepts object records without imposing plain-object or schema validation', () => {
        expect(isRecord({})).toBe(true);
        expect(isRecord(Object.create(null))).toBe(true);
        expect(isRecord(new Date(0))).toBe(true);
        const value: unknown = { field: 'value' };
        if (!isRecord(value)) throw new Error('Expected record');
        expect(value.field).toBe('value');
    });

    it('keeps array-like patch and tool payloads outside object normalization', () => {
        const patchArray = Object.assign([], { diff: 'not a patch payload' });
        expect(getApplyPatchText(patchArray)).toBe('');
        expect(getApplyPatchText({ diff: 'patch body' })).toBe('patch body');
        expect(normalizeToolArgs('edit', patchArray)).toBe(patchArray);
    });
});
