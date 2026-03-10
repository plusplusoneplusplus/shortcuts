/**
 * Tests for useDraftStore — localStorage-backed chat input draft persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDraft, setDraft, clearDraft, pruneExpired } from '../../../../src/server/spa/client/react/hooks/useDraftStore';

// ---------------------------------------------------------------------------
// localStorage mock helpers
// ---------------------------------------------------------------------------

function makeMockStorage(): Storage {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
        get length() { return Object.keys(store).length; },
        key: (i: number) => Object.keys(store)[i] ?? null,
    } as Storage;
}

describe('useDraftStore', () => {
    let mockStorage: Storage;

    beforeEach(() => {
        mockStorage = makeMockStorage();
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation((...args) => mockStorage.getItem(...args));
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation((...args) => mockStorage.setItem(...args));
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((...args) => mockStorage.removeItem(...args));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // -----------------------------------------------------------------------
    // getDraft
    // -----------------------------------------------------------------------

    it('getDraft returns null when storage is empty', () => {
        expect(getDraft('task-1')).toBeNull();
    });

    it('getDraft returns null for unknown taskId', () => {
        setDraft('task-a', 'hello', 'ask');
        expect(getDraft('task-b')).toBeNull();
    });

    // -----------------------------------------------------------------------
    // setDraft / getDraft round-trip
    // -----------------------------------------------------------------------

    it('setDraft persists text and mode; getDraft retrieves them', () => {
        setDraft('task-1', 'my message', 'plan');
        const draft = getDraft('task-1');
        expect(draft).not.toBeNull();
        expect(draft!.text).toBe('my message');
        expect(draft!.mode).toBe('plan');
        expect(typeof draft!.updatedAt).toBe('number');
    });

    it('setDraft updates an existing entry', () => {
        setDraft('task-1', 'first', 'ask');
        setDraft('task-1', 'second', 'autopilot');
        const draft = getDraft('task-1');
        expect(draft!.text).toBe('second');
        expect(draft!.mode).toBe('autopilot');
    });

    it('setDraft stores multiple tasks independently', () => {
        setDraft('task-a', 'alpha', 'ask');
        setDraft('task-b', 'beta', 'plan');
        expect(getDraft('task-a')!.text).toBe('alpha');
        expect(getDraft('task-b')!.text).toBe('beta');
    });

    it('setDraft with empty text calls clearDraft instead', () => {
        setDraft('task-1', 'hello', 'ask');
        setDraft('task-1', '', 'ask');
        expect(getDraft('task-1')).toBeNull();
    });

    it('setDraft records a recent updatedAt timestamp', () => {
        const before = Date.now();
        setDraft('task-1', 'text', 'ask');
        const after = Date.now();
        const draft = getDraft('task-1');
        expect(draft!.updatedAt).toBeGreaterThanOrEqual(before);
        expect(draft!.updatedAt).toBeLessThanOrEqual(after);
    });

    // -----------------------------------------------------------------------
    // clearDraft
    // -----------------------------------------------------------------------

    it('clearDraft removes an existing entry', () => {
        setDraft('task-1', 'hello', 'ask');
        clearDraft('task-1');
        expect(getDraft('task-1')).toBeNull();
    });

    it('clearDraft is a no-op when entry does not exist', () => {
        expect(() => clearDraft('task-nonexistent')).not.toThrow();
    });

    it('clearDraft leaves other entries intact', () => {
        setDraft('task-a', 'alpha', 'ask');
        setDraft('task-b', 'beta', 'plan');
        clearDraft('task-a');
        expect(getDraft('task-a')).toBeNull();
        expect(getDraft('task-b')!.text).toBe('beta');
    });

    // -----------------------------------------------------------------------
    // pruneExpired
    // -----------------------------------------------------------------------

    it('pruneExpired removes entries older than 7 days', () => {
        const OLD = Date.now() - 8 * 24 * 60 * 60 * 1000;
        mockStorage.setItem('coc-chat-drafts', JSON.stringify({
            'old-task': { text: 'stale', mode: 'ask', updatedAt: OLD },
        }));
        pruneExpired();
        expect(getDraft('old-task')).toBeNull();
    });

    it('pruneExpired keeps entries within 7 days', () => {
        const FRESH = Date.now() - 3 * 24 * 60 * 60 * 1000;
        mockStorage.setItem('coc-chat-drafts', JSON.stringify({
            'fresh-task': { text: 'hello', mode: 'plan', updatedAt: FRESH },
        }));
        pruneExpired();
        const draft = getDraft('fresh-task');
        expect(draft).not.toBeNull();
        expect(draft!.text).toBe('hello');
    });

    it('pruneExpired removes only stale entries when mixed', () => {
        const OLD = Date.now() - 8 * 24 * 60 * 60 * 1000;
        const FRESH = Date.now() - 1 * 24 * 60 * 60 * 1000;
        mockStorage.setItem('coc-chat-drafts', JSON.stringify({
            'old-task': { text: 'stale', mode: 'ask', updatedAt: OLD },
            'new-task': { text: 'fresh', mode: 'autopilot', updatedAt: FRESH },
        }));
        pruneExpired();
        expect(getDraft('old-task')).toBeNull();
        expect(getDraft('new-task')!.text).toBe('fresh');
    });

    it('pruneExpired is a no-op on empty storage', () => {
        expect(() => pruneExpired()).not.toThrow();
    });

    // -----------------------------------------------------------------------
    // Error resilience
    // -----------------------------------------------------------------------

    it('getDraft returns empty object when localStorage.getItem throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled'); });
        expect(getDraft('task-1')).toBeNull();
    });

    it('setDraft is a no-op when localStorage.setItem throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
        expect(() => setDraft('task-1', 'text', 'ask')).not.toThrow();
    });

    it('getDraft returns null when stored value is invalid JSON', () => {
        mockStorage.setItem('coc-chat-drafts', 'not-valid-json');
        expect(getDraft('task-1')).toBeNull();
    });
});
