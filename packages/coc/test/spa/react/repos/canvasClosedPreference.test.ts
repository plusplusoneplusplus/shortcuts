/**
 * Unit tests for the per-conversation agent-canvas "closed" persistence helper.
 *
 * Covers AC-01: a deliberately-closed canvas is remembered in localStorage,
 * keyed per conversation, with sparse storage (only closed chats keep a key)
 * and guarded access that never throws.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    canvasClosedStorageKey,
    readCanvasClosed,
    writeCanvasClosed,
} from '../../../../src/server/spa/client/react/features/chat/canvasClosedPreference';

describe('canvasClosedPreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    describe('canvasClosedStorageKey', () => {
        it('mirrors the per-workspace width key shape, scoped per conversation', () => {
            expect(canvasClosedStorageKey('ws-1', 'proc-9')).toBe(
                'coc.canvasPanel.closed.ws-1.proc-9',
            );
        });

        it('encodes workspace and pid components', () => {
            expect(canvasClosedStorageKey('ws/a b', 'p.c#1')).toBe(
                `coc.canvasPanel.closed.${encodeURIComponent('ws/a b')}.${encodeURIComponent('p.c#1')}`,
            );
        });

        it('returns null when either identity is missing', () => {
            expect(canvasClosedStorageKey(null, 'p')).toBeNull();
            expect(canvasClosedStorageKey('ws', null)).toBeNull();
            expect(canvasClosedStorageKey('', 'p')).toBeNull();
            expect(canvasClosedStorageKey('ws', '')).toBeNull();
            expect(canvasClosedStorageKey(undefined, undefined)).toBeNull();
        });
    });

    describe('read/write round-trip', () => {
        it('defaults to open (false) when nothing is persisted', () => {
            expect(readCanvasClosed('ws-1', 'proc-9')).toBe(false);
        });

        it('persists a deliberate close and reads it back as closed', () => {
            writeCanvasClosed('ws-1', 'proc-9', true);
            expect(localStorage.getItem('coc.canvasPanel.closed.ws-1.proc-9')).not.toBeNull();
            expect(readCanvasClosed('ws-1', 'proc-9')).toBe(true);
        });

        it('clears the flag on reopen and removes the key so storage stays sparse', () => {
            writeCanvasClosed('ws-1', 'proc-9', true);
            writeCanvasClosed('ws-1', 'proc-9', false);
            expect(localStorage.getItem('coc.canvasPanel.closed.ws-1.proc-9')).toBeNull();
            expect(readCanvasClosed('ws-1', 'proc-9')).toBe(false);
        });

        it('keeps the flag scoped per conversation', () => {
            writeCanvasClosed('ws-1', 'proc-A', true);
            expect(readCanvasClosed('ws-1', 'proc-A')).toBe(true);
            expect(readCanvasClosed('ws-1', 'proc-B')).toBe(false);
            expect(readCanvasClosed('ws-2', 'proc-A')).toBe(false);
        });

        it('survives a simulated reload (value remains in storage across reads)', () => {
            writeCanvasClosed('ws-1', 'proc-9', true);
            // No clear() — emulates a page reload reading the same backing store.
            expect(readCanvasClosed('ws-1', 'proc-9')).toBe(true);
        });
    });

    describe('no-op when identity is missing', () => {
        it('write does nothing without workspace or pid', () => {
            writeCanvasClosed(null, 'p', true);
            writeCanvasClosed('ws', null, true);
            expect(localStorage.length).toBe(0);
        });

        it('read returns false without workspace or pid', () => {
            expect(readCanvasClosed(null, 'p')).toBe(false);
            expect(readCanvasClosed('ws', null)).toBe(false);
        });
    });

    describe('guarded access', () => {
        it('read swallows storage errors and defaults to false', () => {
            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('storage disabled');
            });
            expect(() => readCanvasClosed('ws-1', 'proc-9')).not.toThrow();
            expect(readCanvasClosed('ws-1', 'proc-9')).toBe(false);
        });

        it('write swallows quota-exceeded errors', () => {
            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });
            expect(() => writeCanvasClosed('ws-1', 'proc-9', true)).not.toThrow();
        });

        it('write swallows removeItem errors on clear', () => {
            vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
                throw new Error('storage disabled');
            });
            expect(() => writeCanvasClosed('ws-1', 'proc-9', false)).not.toThrow();
        });
    });
});
