import { describe, expect, it } from 'vitest';
import { errorMessage } from '../../../../src/server/spa/client/react/utils/errorMessage';
import { getTemplateErrorMessage } from '../../../../src/server/spa/client/react/features/templates/commit-templates/helpers';

describe('errorMessage', () => {
    it.each([
        [new Error('failed'), 'failed'],
        [new Error(''), ''],
        [new Error('  failed  '), '  failed  '],
        ['failed', 'failed'],
        [undefined, 'undefined'],
        [null, 'null'],
        [0, '0'],
        [{ message: 'not an Error' }, '[object Object]'],
    ])('preserves thrown value %j without a fallback policy', (error, expected) => {
        expect(errorMessage(error)).toBe(expected);
        expect(getTemplateErrorMessage(error)).toBe(expected);
    });
});
