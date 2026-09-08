/**
 * notes-order — unit tests for the sibling sort.
 *
 * `.order.json` persistence moved into the native `notes_fs` core; its tests
 * live in `packages/coc-native/rust/core/tests/notes_fs_order.rs`.
 */

import { describe, it, expect } from 'vitest';
import { applyOrder } from '../../src/server/notes/notes-order';

// ── applyOrder ─────────────────────────────────────────────────────────

describe('applyOrder', () => {
    const items = ['alpha', 'beta', 'gamma', 'delta'];
    const id = (s: string) => s;

    it('returns items unchanged when explicitOrder is empty', () => {
        const result = applyOrder(items, id, []);
        expect(result).toEqual(items);
    });

    it('places explicitly-ordered items first in specified order', () => {
        const result = applyOrder(items, id, ['gamma', 'alpha']);
        expect(result).toEqual(['gamma', 'alpha', 'beta', 'delta']);
    });

    it('unlisted items preserve their original relative order', () => {
        // items = ['alpha','beta','gamma','delta'], order first = ['delta']
        // unlisted = ['alpha','beta','gamma'] — should stay in that order
        const result = applyOrder(items, id, ['delta']);
        expect(result).toEqual(['delta', 'alpha', 'beta', 'gamma']);
    });

    it('handles explicit order with all items', () => {
        const result = applyOrder(items, id, ['delta', 'gamma', 'beta', 'alpha']);
        expect(result).toEqual(['delta', 'gamma', 'beta', 'alpha']);
    });

    it('ignores names in explicitOrder that are not in items', () => {
        const result = applyOrder(items, id, ['nonexistent', 'beta']);
        expect(result).toEqual(['beta', 'alpha', 'gamma', 'delta']);
    });

    it('works with objects using a custom getName function', () => {
        const objs = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
        const result = applyOrder(objs, o => o.name, ['c', 'a']);
        expect(result.map(o => o.name)).toEqual(['c', 'a', 'b']);
    });
});
