/**
 * unifiedPanelAddresses — the phase 1 `coc://` addresses: parsing (case,
 * trailing slash, query/hash rejection, unknown hosts), formatting and the
 * label a web tab shows for each page.
 */
import { describe, expect, it } from 'vitest';
import {
    COC_ADDRESS_INVALID,
    COC_ADDRESS_UNSUPPORTED,
    cocAddressLabel,
    formatCocAddress,
    isCocAddressText,
    parseCocAddress,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelAddresses';
import { browserLabelForUrl } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';

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
        ['coc://canvas/plan-1', { kind: 'canvas', canvasId: 'plan-1' }],
        ['COC://Canvas/Plan-1/', { kind: 'canvas', canvasId: 'Plan-1' }],
        ['coc://notes', { kind: 'notes' }],
        ['coc://notes/Plans/Release.md', { kind: 'notes', notePath: 'Plans/Release.md' }],
        ['coc://notes/My%20Note.md/', { kind: 'notes', notePath: 'My Note.md' }],
        ['coc://git', { kind: 'git' }],
        ['COC://GIT/', { kind: 'git' }],
        ['coc://git/member/repo-2', { kind: 'git', gitMemberId: 'repo-2' }],
        ['coc://git/member', { kind: 'git' }],
        ['coc://git/abc123', { kind: 'git', view: { type: 'commit', hash: 'abc123' } }],
        ['coc://git/abc123/src%2Findex.ts', { kind: 'git', view: { type: 'commit-file', hash: 'abc123', filePath: 'src/index.ts' } }],
        ['coc://git/branch-range', { kind: 'git', view: { type: 'branch-range' } }],
        ['coc://git/branch-range/src%2Findex.ts', { kind: 'git', view: { type: 'branch-file', filePath: 'src/index.ts' } }],
        ['coc://git/working-changes', { kind: 'git', view: { type: 'working-tree-all' } }],
        ['coc://git/member/repo-2/abc123', { kind: 'git', gitMemberId: 'repo-2', view: { type: 'commit', hash: 'abc123' } }],
        [
            'coc://git/member/repo-2/branch-range/src%2Findex.ts',
            { kind: 'git', gitMemberId: 'repo-2', view: { type: 'branch-file', filePath: 'src/index.ts' } },
        ],
    ])('parses %j', (text, expected) => {
        expect(parseCocAddress(text)).toEqual(expected);
    });

    it.each(['coc://file/a.ts', 'coc://calendar'])('reports unknown host %j as not supported yet', text => {
        expect(parseCocAddress(text)).toEqual({ error: COC_ADDRESS_UNSUPPORTED });
    });

    it.each([
        'coc://settings?tab=ai', 'coc://todo#x', 'coc://todo/a?b', 'coc://', 'coc:///settings', 'coc://settings/extra',
        'coc://todo/a/b', 'coc://todo//a', 'coc://todo/%E0%A4%A', 'https://settings', 'settings', 'coc:settings',
        'coc://canvas', 'coc://canvas/', 'coc://canvas/plan/extra', 'coc://canvas/bad id', 'coc://canvas/_no',
        'coc://notes/../secret', 'coc://notes//Plans', 'coc://notes/./here',
        'coc://git/abc123/path/extra', 'coc://git/member/repo-2/abc123/path/extra',
        'coc://git/member//abc123', 'coc://git/%E0%A4%A',
    ])('rejects %j', text => {
        expect(parseCocAddress(text)).toEqual({ error: COC_ADDRESS_INVALID });
    });

    it('detects coc:// text regardless of validity', () => {
        expect(isCocAddressText(' COC://git')).toBe(true);
        expect(isCocAddressText('https://example.com')).toBe(false);
        expect(isCocAddressText('coc')).toBe(false);
    });

    it('round-trips through formatCocAddress', () => {
        for (const text of [
            'coc://settings', 'coc://terminal', 'coc://todo', 'coc://todo/item-1', 'coc://todo/a%20b', 'coc://canvas/plan-1',
            'coc://notes', 'coc://notes/Plans/Release.md', 'coc://notes/My%20Note.md',
            'coc://git', 'coc://git/member/repo-2', 'coc://git/abc123', 'coc://git/abc123/src%2Findex.ts',
            'coc://git/branch-range', 'coc://git/branch-range/src%2Findex.ts', 'coc://git/working-changes',
            'coc://git/member/repo-2/abc123', 'coc://git/member/repo-2/branch-range/src%2Findex.ts',
        ]) {
            const parsed = parseCocAddress(text);
            expect('error' in parsed).toBe(false);
            if (!('error' in parsed)) expect(formatCocAddress(parsed)).toBe(text);
        }
    });
});

describe('coc:// labels', () => {
    it('labels each page and web tabs at its address', () => {
        expect(cocAddressLabel({ kind: 'settings' })).toBe('Settings');
        expect(cocAddressLabel({ kind: 'terminal' })).toBe('Terminal');
        expect(cocAddressLabel({ kind: 'todo', itemId: 'x' })).toBe('To-do');
        expect(cocAddressLabel({ kind: 'canvas', canvasId: 'plan-1' })).toBe('Canvas');
        expect(browserLabelForUrl('coc://canvas/plan-1')).toBe('Canvas');
        expect(cocAddressLabel({ kind: 'notes', notePath: 'Plans/Release.md' })).toBe('Notes');
        expect(browserLabelForUrl('coc://notes/Plans/Release.md')).toBe('Notes');
        expect(browserLabelForUrl('coc://todo/item-1')).toBe('To-do');
        expect(cocAddressLabel({ kind: 'git' })).toBe('Git');
        expect(browserLabelForUrl('coc://git')).toBe('Git');
        expect(browserLabelForUrl('coc://git/member/repo-2/abc123')).toBe('Git');
        expect(browserLabelForUrl('https://example.com/a')).toBe('example.com');
    });
});
