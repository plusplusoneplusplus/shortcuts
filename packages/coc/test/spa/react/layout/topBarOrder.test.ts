import { describe, expect, it } from 'vitest';
import {
    mergeVisibleTopBarOrder,
    moveTopBarItem,
    moveTopBarItemToIndex,
    resolveTopBarItemOrder,
    type TopBarItemId,
} from '../../../../src/server/spa/client/react/layout/topBarOrder';

describe('topBarOrder', () => {
    it('applies known saved IDs first, ignores unknown IDs, and appends new defaults', () => {
        expect(resolveTopBarItemOrder(['skills', 'logs', 'stats', 'models'] as const, ['models', 'unknown', 'skills']))
            .toEqual(['models', 'skills', 'logs', 'stats']);
    });

    it('deduplicates saved IDs', () => {
        expect(resolveTopBarItemOrder(['skills', 'logs', 'stats'] as const, ['logs', 'logs', 'skills']))
            .toEqual(['logs', 'skills', 'stats']);
    });

    it('preserves hidden saved IDs when visible items are reordered', () => {
        const previous = ['wiki', 'skills', 'memory', 'logs', 'stats', 'models', 'servers', 'admin'];
        const visible = ['models', 'skills', 'logs', 'stats', 'admin'] as TopBarItemId[];

        expect(mergeVisibleTopBarOrder(previous, visible)).toEqual([
            'wiki',
            'models',
            'memory',
            'skills',
            'logs',
            'stats',
            'servers',
            'admin',
        ]);
    });

    it('moves a dragged item before or after a target item', () => {
        expect(moveTopBarItem(['skills', 'logs', 'stats', 'models'], 'skills', 'models', 'after'))
            .toEqual(['logs', 'stats', 'models', 'skills']);
        expect(moveTopBarItem(['skills', 'logs', 'stats', 'models'], 'models', 'logs', 'before'))
            .toEqual(['skills', 'models', 'logs', 'stats']);
    });

    it('moves a keyboard-dragged item to a clamped index', () => {
        expect(moveTopBarItemToIndex(['skills', 'logs', 'stats'], 'skills', 2))
            .toEqual(['logs', 'stats', 'skills']);
        expect(moveTopBarItemToIndex(['skills', 'logs', 'stats'], 'stats', -1))
            .toEqual(['stats', 'skills', 'logs']);
    });
});
