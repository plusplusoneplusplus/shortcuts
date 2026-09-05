/**
 * MonacoFileEditor now lives in `shared/file-viewer/`, but ~15 existing tests
 * module-mock it through its old home, `features/repo-detail/explorer/
 * MonacoFileEditor`, and those tests must not be edited (AC-07). A RegExp alias
 * in vitest.config.ts collapses the two specifiers onto one module id so a
 * `vi.mock` on the legacy path also covers anything rendering through the
 * shared viewer.
 *
 * This test guards that collapse: if the alias is dropped or its pattern stops
 * matching, the mocks in those 15 files go inert and real Monaco loads under
 * jsdom — a failure that would otherwise surface as a pile of unrelated,
 * hard-to-read breakages.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => null,
    getMonacoLanguage: () => 'mocked-language',
}));

import { getMonacoLanguage as fromShared } from '../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor';
import { getMonacoLanguage as fromLegacy } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor';

describe('MonacoFileEditor module identity', () => {
    it('mocking the legacy explorer path also mocks the shared module', () => {
        expect(fromShared('a.ts')).toBe('mocked-language');
    });

    it('resolves both specifiers to the same module', () => {
        expect(fromShared).toBe(fromLegacy);
    });
});
