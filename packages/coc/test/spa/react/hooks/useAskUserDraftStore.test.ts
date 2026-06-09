/**
 * Tests for localStorage-backed ask_user batch draft persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    clearAskUserDraft,
    clearAskUserDraftsForProcess,
    clearOtherAskUserDraftsForProcess,
    getAskUserDraft,
    pruneExpiredAskUserDrafts,
    setAskUserDraft,
} from '../../../../src/server/spa/client/react/features/chat/hooks/useAskUserDraftStore';

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

describe('useAskUserDraftStore', () => {
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

    it('persists and retrieves a draft scoped by process id and batch id', () => {
        setAskUserDraft('proc-1', 'batch-1', {
            'q-1': { value: 'draft answer', customText: '', disposition: 'answer', note: '' },
        });

        const draft = getAskUserDraft('proc-1', 'batch-1');
        expect(draft?.answers['q-1']).toMatchObject({
            value: 'draft answer',
            disposition: 'answer',
        });
        expect(typeof draft?.updatedAt).toBe('number');
    });

    it('does not return drafts for a different process or batch', () => {
        setAskUserDraft('proc-1', 'batch-1', {
            'q-1': { value: true, customText: '', disposition: 'answer', note: '' },
        });

        expect(getAskUserDraft('proc-2', 'batch-1')).toBeNull();
        expect(getAskUserDraft('proc-1', 'batch-2')).toBeNull();
        expect(getAskUserDraft('proc-1', 'batch-1')?.answers['q-1'].value).toBe(true);
    });

    it('stores deferred draft metadata and notes', () => {
        setAskUserDraft('proc-1', 'batch-1', {
            'q-1': {
                value: null,
                customText: '',
                disposition: 'needs-context',
                note: 'Need the available environments',
            },
        });

        expect(getAskUserDraft('proc-1', 'batch-1')?.answers['q-1']).toMatchObject({
            disposition: 'needs-context',
            note: 'Need the available environments',
        });
    });

    it('clears one batch draft without removing other batches for the same process', () => {
        setAskUserDraft('proc-1', 'batch-1', {
            'q-1': { value: 'one', customText: '', disposition: 'answer', note: '' },
        });
        setAskUserDraft('proc-1', 'batch-2', {
            'q-2': { value: 'two', customText: '', disposition: 'answer', note: '' },
        });

        clearAskUserDraft('proc-1', 'batch-1');

        expect(getAskUserDraft('proc-1', 'batch-1')).toBeNull();
        expect(getAskUserDraft('proc-1', 'batch-2')?.answers['q-2'].value).toBe('two');
    });

    it('clears all drafts for a cancelled process only', () => {
        setAskUserDraft('proc-1', 'batch-1', {
            'q-1': { value: 'one', customText: '', disposition: 'answer', note: '' },
        });
        setAskUserDraft('proc-2', 'batch-1', {
            'q-1': { value: 'two', customText: '', disposition: 'answer', note: '' },
        });

        clearAskUserDraftsForProcess('proc-1');

        expect(getAskUserDraft('proc-1', 'batch-1')).toBeNull();
        expect(getAskUserDraft('proc-2', 'batch-1')?.answers['q-1'].value).toBe('two');
    });

    it('clears older batches for a process while preserving the active batch', () => {
        setAskUserDraft('proc-1', 'old-batch', {
            'q-1': { value: 'old', customText: '', disposition: 'answer', note: '' },
        });
        setAskUserDraft('proc-1', 'active-batch', {
            'q-2': { value: 'active', customText: '', disposition: 'answer', note: '' },
        });

        clearOtherAskUserDraftsForProcess('proc-1', 'active-batch');

        expect(getAskUserDraft('proc-1', 'old-batch')).toBeNull();
        expect(getAskUserDraft('proc-1', 'active-batch')?.answers['q-2'].value).toBe('active');
    });

    it('prunes drafts older than seven days', () => {
        mockStorage.setItem('coc-ask-user-drafts', JSON.stringify({
            'proc-1': {
                stale: {
                    updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
                    answers: {
                        'q-1': { value: 'old', customText: '', disposition: 'answer', note: '' },
                    },
                },
                fresh: {
                    updatedAt: Date.now(),
                    answers: {
                        'q-2': { value: 'new', customText: '', disposition: 'answer', note: '' },
                    },
                },
            },
        }));

        pruneExpiredAskUserDrafts();

        expect(getAskUserDraft('proc-1', 'stale')).toBeNull();
        expect(getAskUserDraft('proc-1', 'fresh')?.answers['q-2'].value).toBe('new');
    });

    it('returns null when stored JSON is invalid', () => {
        mockStorage.setItem('coc-ask-user-drafts', 'not-json');
        expect(getAskUserDraft('proc-1', 'batch-1')).toBeNull();
    });

    it('does not throw when storage writes fail', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        expect(() => setAskUserDraft('proc-1', 'batch-1', {
            'q-1': { value: 'x', customText: '', disposition: 'answer', note: '' },
        })).not.toThrow();
    });
});
