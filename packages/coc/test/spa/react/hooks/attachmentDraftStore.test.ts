/**
 * Tests for attachmentDraftStore — sessionStorage-backed composer attachment
 * sidecar that lets pasted images survive in-SPA navigation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    saveAttachmentDraft,
    loadAttachmentDraft,
    clearAttachmentDraft,
} from '../../../../src/server/spa/client/react/features/chat/hooks/attachmentDraftStore';
import type { ChatAttachment } from '../../../../src/server/spa/client/react/types/attachments';

const STORAGE_PREFIX = 'coc.attachmentDraft.';

function makeAttachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
    return {
        id: 'client-id-1',
        name: 'screenshot.png',
        mimeType: 'image/png',
        size: 1234,
        dataUrl: 'data:image/png;base64,AAAA',
        category: 'image',
        ...overrides,
    };
}

describe('attachmentDraftStore', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
    });

    // -----------------------------------------------------------------------
    // save / load round-trip
    // -----------------------------------------------------------------------

    it('round-trips attachments through save and load', () => {
        const att = makeAttachment();
        saveAttachmentDraft('new-chat:ws-1', [att]);

        const restored = loadAttachmentDraft('new-chat:ws-1');
        expect(restored).not.toBeNull();
        expect(restored).toHaveLength(1);
        expect(restored![0]).toMatchObject({
            name: 'screenshot.png',
            mimeType: 'image/png',
            size: 1234,
            dataUrl: 'data:image/png;base64,AAAA',
            category: 'image',
        });
    });

    it('persists under the coc.attachmentDraft.<draftKey> key', () => {
        saveAttachmentDraft('new-chat:ws-1', [makeAttachment()]);
        expect(sessionStorage.getItem(`${STORAGE_PREFIX}new-chat:ws-1`)).not.toBeNull();
    });

    it('stores only the wire payload subset (no id, no category) in sessionStorage', () => {
        saveAttachmentDraft('new-chat:ws-1', [makeAttachment()]);
        const raw = sessionStorage.getItem(`${STORAGE_PREFIX}new-chat:ws-1`)!;
        const parsed = JSON.parse(raw);
        expect(parsed[0]).not.toHaveProperty('id');
        expect(parsed[0]).not.toHaveProperty('category');
        expect(parsed[0]).toEqual({
            name: 'screenshot.png',
            mimeType: 'image/png',
            size: 1234,
            dataUrl: 'data:image/png;base64,AAAA',
        });
    });

    it('regenerates a fresh client id on load (does not reuse the stored payload)', () => {
        saveAttachmentDraft('new-chat:ws-1', [makeAttachment({ id: 'original-id' })]);
        const first = loadAttachmentDraft('new-chat:ws-1')!;
        const second = loadAttachmentDraft('new-chat:ws-1')!;
        expect(first[0].id).toBeTruthy();
        expect(first[0].id).not.toBe('original-id');
        // Each load mints a new id.
        expect(first[0].id).not.toBe(second[0].id);
    });

    it('re-derives category from mimeType and name on load', () => {
        saveAttachmentDraft('new-chat:ws-1', [
            makeAttachment({ name: 'a.png', mimeType: 'image/png', category: 'binary' }),
            makeAttachment({ name: 'readme.md', mimeType: 'text/markdown', category: 'binary' }),
            makeAttachment({ name: 'archive.zip', mimeType: 'application/zip', category: 'image' }),
        ]);
        const restored = loadAttachmentDraft('new-chat:ws-1')!;
        expect(restored.map(a => a.category)).toEqual(['image', 'text', 'binary']);
    });

    it('preserves multiple attachments and their order', () => {
        saveAttachmentDraft('new-chat:ws-1', [
            makeAttachment({ name: 'one.png' }),
            makeAttachment({ name: 'two.png' }),
            makeAttachment({ name: 'three.png' }),
        ]);
        const restored = loadAttachmentDraft('new-chat:ws-1')!;
        expect(restored.map(a => a.name)).toEqual(['one.png', 'two.png', 'three.png']);
    });

    // -----------------------------------------------------------------------
    // empty / clear semantics
    // -----------------------------------------------------------------------

    it('loadAttachmentDraft returns null when nothing is stored', () => {
        expect(loadAttachmentDraft('new-chat:ws-1')).toBeNull();
    });

    it('saving an empty list clears any existing sidecar', () => {
        saveAttachmentDraft('new-chat:ws-1', [makeAttachment()]);
        saveAttachmentDraft('new-chat:ws-1', []);
        expect(loadAttachmentDraft('new-chat:ws-1')).toBeNull();
        expect(sessionStorage.getItem(`${STORAGE_PREFIX}new-chat:ws-1`)).toBeNull();
    });

    it('clearAttachmentDraft removes the stored entry', () => {
        saveAttachmentDraft('new-chat:ws-1', [makeAttachment()]);
        clearAttachmentDraft('new-chat:ws-1');
        expect(loadAttachmentDraft('new-chat:ws-1')).toBeNull();
    });

    it('clearAttachmentDraft is a no-op when nothing is stored', () => {
        expect(() => clearAttachmentDraft('new-chat:ws-1')).not.toThrow();
    });

    // -----------------------------------------------------------------------
    // scope isolation
    // -----------------------------------------------------------------------

    it('keeps drafts for different keys isolated', () => {
        saveAttachmentDraft('new-chat:ws-1', [makeAttachment({ name: 'a.png' })]);
        saveAttachmentDraft('new-chat:ws-2', [makeAttachment({ name: 'b.png' })]);

        expect(loadAttachmentDraft('new-chat:ws-1')![0].name).toBe('a.png');
        expect(loadAttachmentDraft('new-chat:ws-2')![0].name).toBe('b.png');

        clearAttachmentDraft('new-chat:ws-1');
        expect(loadAttachmentDraft('new-chat:ws-1')).toBeNull();
        expect(loadAttachmentDraft('new-chat:ws-2')![0].name).toBe('b.png');
    });

    // -----------------------------------------------------------------------
    // empty draftKey guards
    // -----------------------------------------------------------------------

    it('save/load/clear are no-ops for an empty draft key', () => {
        expect(() => saveAttachmentDraft('', [makeAttachment()])).not.toThrow();
        expect(loadAttachmentDraft('')).toBeNull();
        expect(() => clearAttachmentDraft('')).not.toThrow();
        // Nothing was written under any key.
        expect(sessionStorage.length).toBe(0);
    });

    // -----------------------------------------------------------------------
    // size cap
    // -----------------------------------------------------------------------

    it('skips saving and warns when the serialized payload exceeds the cap', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const huge = makeAttachment({ dataUrl: `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024 + 100)}` });

        saveAttachmentDraft('new-chat:ws-1', [huge]);

        expect(sessionStorage.getItem(`${STORAGE_PREFIX}new-chat:ws-1`)).toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipping save'));
    });

    it('leaves a prior valid draft untouched when an oversized save is skipped', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        saveAttachmentDraft('new-chat:ws-1', [makeAttachment({ name: 'small.png' })]);
        const huge = makeAttachment({ dataUrl: `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024 + 100)}` });

        saveAttachmentDraft('new-chat:ws-1', [huge]);

        expect(loadAttachmentDraft('new-chat:ws-1')![0].name).toBe('small.png');
    });

    // -----------------------------------------------------------------------
    // resilience to malformed / hostile data
    // -----------------------------------------------------------------------

    it('loadAttachmentDraft returns null for invalid JSON', () => {
        sessionStorage.setItem(`${STORAGE_PREFIX}new-chat:ws-1`, 'not-valid-json');
        expect(loadAttachmentDraft('new-chat:ws-1')).toBeNull();
    });

    it('loadAttachmentDraft returns null when the stored value is not an array', () => {
        sessionStorage.setItem(`${STORAGE_PREFIX}new-chat:ws-1`, JSON.stringify({ not: 'an array' }));
        expect(loadAttachmentDraft('new-chat:ws-1')).toBeNull();
    });

    it('filters out entries missing required fields', () => {
        sessionStorage.setItem(`${STORAGE_PREFIX}new-chat:ws-1`, JSON.stringify([
            { name: 'good.png', mimeType: 'image/png', size: 10, dataUrl: 'data:image/png;base64,AA' },
            { name: 'no-data-url', mimeType: 'image/png', size: 10 },
            { mimeType: 'image/png', size: 10, dataUrl: 'data:image/png;base64,BB' },
            null,
        ]));
        const restored = loadAttachmentDraft('new-chat:ws-1');
        expect(restored).toHaveLength(1);
        expect(restored![0].name).toBe('good.png');
    });

    it('returns null when every entry is invalid', () => {
        sessionStorage.setItem(`${STORAGE_PREFIX}new-chat:ws-1`, JSON.stringify([{ junk: true }]));
        expect(loadAttachmentDraft('new-chat:ws-1')).toBeNull();
    });

    it('defaults a missing numeric size to 0 on load', () => {
        sessionStorage.setItem(`${STORAGE_PREFIX}new-chat:ws-1`, JSON.stringify([
            { name: 'good.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA' },
        ]));
        const restored = loadAttachmentDraft('new-chat:ws-1')!;
        expect(restored[0].size).toBe(0);
    });

    it('loadAttachmentDraft returns null when sessionStorage.getItem throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage disabled');
        });
        expect(loadAttachmentDraft('new-chat:ws-1')).toBeNull();
    });

    it('saveAttachmentDraft is a no-op when sessionStorage.setItem throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        expect(() => saveAttachmentDraft('new-chat:ws-1', [makeAttachment()])).not.toThrow();
    });
});
