/**
 * The hand-over between Peek and the read-only tab it opens.
 *
 * The capability behind an external definition belongs to the attachment that
 * received the definition response — the very pane that navigation is about to
 * unmount. So the content is published once and reference-counted, and the tab
 * holds a retain instead of re-reading through a connection that is going away.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EXTERNAL_SOURCE_ORPHAN_TIMEOUT_MS,
    publishExternalSource,
    readExternalSourceRecord,
    resetExternalSourceStoreForTests,
    retainExternalSource,
} from '../../../../src/server/spa/client/react/features/language-servers/externalSourceStore';

const RECORD = { resourceId: 'cap-1', content: 'class string_view;', displayName: 'string_view' };

describe('external source store', () => {
    beforeEach(() => {
        resetExternalSourceStoreForTests();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        resetExternalSourceStoreForTests();
    });

    it('keeps a published record alive long enough for the tab to mount', () => {
        publishExternalSource(RECORD);

        // The gap between Peek loading the source and the user confirming it is
        // a React commit, not a minute.
        vi.advanceTimersByTime(EXTERNAL_SOURCE_ORPHAN_TIMEOUT_MS - 1);
        expect(readExternalSourceRecord('cap-1')).toMatchObject(RECORD);

        vi.advanceTimersByTime(2);
        expect(readExternalSourceRecord('cap-1')).toBeUndefined();
    });

    it('survives its whole retained lifetime, and goes when the last consumer does', () => {
        publishExternalSource(RECORD);
        const release = retainExternalSource('cap-1');

        vi.advanceTimersByTime(EXTERNAL_SOURCE_ORPHAN_TIMEOUT_MS * 10);
        expect(readExternalSourceRecord('cap-1')).toMatchObject(RECORD);

        release();
        vi.advanceTimersByTime(EXTERNAL_SOURCE_ORPHAN_TIMEOUT_MS + 1);
        expect(readExternalSourceRecord('cap-1')).toBeUndefined();
    });

    it('needs every consumer to release before it drops', () => {
        publishExternalSource(RECORD);
        const first = retainExternalSource('cap-1');
        const second = retainExternalSource('cap-1');

        first();
        vi.advanceTimersByTime(EXTERNAL_SOURCE_ORPHAN_TIMEOUT_MS + 1);
        expect(readExternalSourceRecord('cap-1')).toMatchObject(RECORD);

        second();
        vi.advanceTimersByTime(EXTERNAL_SOURCE_ORPHAN_TIMEOUT_MS + 1);
        expect(readExternalSourceRecord('cap-1')).toBeUndefined();
    });

    it('ignores a second release from the same consumer', () => {
        publishExternalSource(RECORD);
        const first = retainExternalSource('cap-1');
        retainExternalSource('cap-1');

        first();
        first();

        vi.advanceTimersByTime(EXTERNAL_SOURCE_ORPHAN_TIMEOUT_MS + 1);
        expect(readExternalSourceRecord('cap-1')).toMatchObject(RECORD);
    });

    it('retaining something that was never published is harmless', () => {
        expect(() => retainExternalSource('cap-missing')()).not.toThrow();
        expect(readExternalSourceRecord('cap-missing')).toBeUndefined();
    });
});
