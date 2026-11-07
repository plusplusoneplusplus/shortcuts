/**
 * unifiedPanelAddresses — the phase 1 `coc://` addresses: parsing (case,
 * trailing slash, query/hash rejection, unknown hosts) and the address each
 * tab kind shows.
 */
import { describe, expect, it } from 'vitest';
import {
    COC_ADDRESS_INVALID,
    COC_ADDRESS_UNSUPPORTED,
    cocAddressForTab,
    formatCocAddress,
    isCocAddressText,
    parseCocAddress,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelAddresses';
import { ALL_UNIFIED_TAB_KINDS } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

describe('parseCocAddress', () => {
    it.each([
        ['coc://settings', { kind: 'settings' }],
        ['coc://terminal', { kind: 'terminal' }],
        ['coc://todo', { kind: 'todo' }],
        ['coc://todo/item-1', { kind: 'todo', itemId: 'item-1' }],
        ['COC://SETTINGS', { kind: 'settings' }],
        ['Coc://Todo/Item-A', { kind: 'todo', itemId: 'Item-A' }],
        ['coc://terminal/', { kind: 'terminal' }],
        ['coc://todo/item-1/', { kind: 'todo', itemId: 'item-1' }],
        ['  coc://settings  ', { kind: 'settings' }],
        ['coc://todo/a%20b', { kind: 'todo', itemId: 'a b' }],
    ])('parses %j', (text, expected) => {
        expect(parseCocAddress(text)).toEqual(expected);
    });

    it.each(['coc://git', 'coc://file/a.ts', 'coc://notes'])('reports unknown host %j as not supported yet', text => {
        expect(parseCocAddress(text)).toEqual({ error: COC_ADDRESS_UNSUPPORTED });
    });

    it.each([
        'coc://settings?tab=ai', 'coc://todo#x', 'coc://todo/a?b', 'coc://', 'coc:///settings', 'coc://settings/extra',
        'coc://todo/a/b', 'coc://todo//a', 'coc://todo/%E0%A4%A', 'https://settings', 'settings', 'coc:settings',
    ])('rejects %j', text => {
        expect(parseCocAddress(text)).toEqual({ error: COC_ADDRESS_INVALID });
    });

    it('detects coc:// text regardless of validity', () => {
        expect(isCocAddressText(' COC://git')).toBe(true);
        expect(isCocAddressText('https://example.com')).toBe(false);
        expect(isCocAddressText('coc')).toBe(false);
    });

    it('round-trips through formatCocAddress', () => {
        for (const text of ['coc://settings', 'coc://terminal', 'coc://todo', 'coc://todo/item-1', 'coc://todo/a%20b']) {
            const parsed = parseCocAddress(text);
            expect('error' in parsed).toBe(false);
            if (!('error' in parsed)) expect(formatCocAddress(parsed)).toBe(text);
        }
    });
});

describe('cocAddressForTab', () => {
    it('addresses only To-do, Settings and Terminal tabs', () => {
        const addressed = ALL_UNIFIED_TAB_KINDS.filter(kind => cocAddressForTab({ kind }) !== null);
        expect(addressed.sort()).toEqual(['settings', 'terminal', 'todo']);
        expect(cocAddressForTab({ kind: 'external' })).toBeNull();
        expect(cocAddressForTab(null)).toBeNull();
    });

    it('shows the selected To-do item', () => {
        expect(cocAddressForTab({ kind: 'todo' })).toBe('coc://todo');
        expect(cocAddressForTab({ kind: 'todo' }, null)).toBe('coc://todo');
        expect(cocAddressForTab({ kind: 'todo' }, 'item-1')).toBe('coc://todo/item-1');
        expect(cocAddressForTab({ kind: 'settings' }, 'item-1')).toBe('coc://settings');
        expect(cocAddressForTab({ kind: 'terminal' })).toBe('coc://terminal');
    });
});
