/**
 * @vitest-environment jsdom
 *
 * Unit tests for the `#repo_name` mention picker's pure core:
 *  - `getRepoMentionContext` — word-boundary trigger detection (AC-01)
 *  - `filterRepoMembers` — case-insensitive substring filtering (AC-02)
 *  - `useRepoMentions` — menu state, keyboard model, plain-text insert (AC-03)
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getRepoMentionContext } from '../../../../../src/server/spa/client/react/features/chat/slash-command-parser';
import { filterRepoMembers } from '../../../../../src/server/spa/client/react/features/chat/RepoMentionMenu';
import { useRepoMentions } from '../../../../../src/server/spa/client/react/features/chat/hooks/useRepoMentions';
import type { RepoGroupMember } from '../../../../../src/server/spa/client/react/repos/repoGroupService';
import type { RichTextInputHandle } from '../../../../../src/server/spa/client/react/shared/RichTextInput';

function member(name: string, extra: Partial<RepoGroupMember> = {}): RepoGroupMember {
    return { workspaceId: `ws-${name}`, stale: false, name, ...extra };
}

const MEMBERS: RepoGroupMember[] = [
    member('coc'),
    member('coc-client', { description: 'the SDK wrapper' }),
    member('shortcuts', { stale: true, staleReason: 'path-missing' }),
];

describe('getRepoMentionContext', () => {
    it('activates on a `#` at the start of the input', () => {
        expect(getRepoMentionContext('#', 1)).toEqual({ active: true, prefix: '', startIndex: 0 });
    });

    it('activates on a `#` preceded by whitespace and captures the typed prefix', () => {
        expect(getRepoMentionContext('look at #co', 11)).toEqual({
            active: true, prefix: 'co', startIndex: 8,
        });
    });

    it('does not activate for a `#` that is not at a word boundary', () => {
        expect(getRepoMentionContext('issue#12', 8)).toBeNull();
        expect(getRepoMentionContext('abc#', 4)).toBeNull();
    });

    it('does not activate when there is no `#` before the cursor', () => {
        expect(getRepoMentionContext('plain text', 10)).toBeNull();
    });

    it('deactivates once the token contains a space', () => {
        expect(getRepoMentionContext('#coc and more', 13)).toBeNull();
    });

    it('does not activate when the caret sits inside a longer token', () => {
        // caret between "co" and "c" — the token continues past the cursor
        expect(getRepoMentionContext('#coc', 3)).toBeNull();
    });

    it('accepts dots, dashes and underscores in a repo name', () => {
        expect(getRepoMentionContext('#my_repo.v2-beta', 16)).toEqual({
            active: true, prefix: 'my_repo.v2-beta', startIndex: 0,
        });
    });
});

describe('filterRepoMembers', () => {
    it('returns every named member for an empty prefix', () => {
        expect(filterRepoMembers(MEMBERS, '').map(m => m.name)).toEqual(['coc', 'coc-client', 'shortcuts']);
    });

    it('matches case-insensitively on a substring of the name', () => {
        expect(filterRepoMembers(MEMBERS, 'CLIENT').map(m => m.name)).toEqual(['coc-client']);
        expect(filterRepoMembers(MEMBERS, 'coc').map(m => m.name)).toEqual(['coc', 'coc-client']);
    });

    it('returns nothing when the prefix matches no member', () => {
        expect(filterRepoMembers(MEMBERS, 'zzz')).toEqual([]);
    });

    it('keeps stale members but drops members whose workspace was removed (no name)', () => {
        const withRemoved = [
            ...MEMBERS,
            { workspaceId: 'ws-gone', stale: true, staleReason: 'workspace-removed' } as RepoGroupMember,
        ];
        const names = filterRepoMembers(withRemoved, '').map(m => m.name);
        expect(names).toEqual(['coc', 'coc-client', 'shortcuts']);
        expect(filterRepoMembers(withRemoved, 'short')[0].stale).toBe(true);
    });
});

describe('useRepoMentions', () => {
    it('opens the menu on `#` in a repo-group workspace and lists the group members', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('#', 1));
        expect(result.current.menuVisible).toBe(true);
        expect(result.current.filteredMembers.map(m => m.name)).toEqual(['coc', 'coc-client', 'shortcuts']);
    });

    it('stays closed outside a repo-group workspace', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, false));
        act(() => result.current.handleInputChange('#', 1));
        expect(result.current.menuVisible).toBe(false);
    });

    it('stays closed while membership is still loading', () => {
        const { result } = renderHook(() => useRepoMentions(undefined, true));
        act(() => result.current.handleInputChange('#', 1));
        expect(result.current.menuVisible).toBe(false);
    });

    it('stays closed for a `#` that is not at a word boundary', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('issue#1', 7));
        expect(result.current.menuVisible).toBe(false);
    });

    it('narrows the list as characters are typed after `#`', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('#co', 3));
        expect(result.current.filteredMembers.map(m => m.name)).toEqual(['coc', 'coc-client']);
        act(() => result.current.handleInputChange('#coc-', 5));
        expect(result.current.filteredMembers.map(m => m.name)).toEqual(['coc-client']);
    });

    it('closes the menu when the filter matches nothing', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('#c', 2));
        expect(result.current.menuVisible).toBe(true);
        act(() => result.current.handleInputChange('#czz', 4));
        expect(result.current.menuVisible).toBe(false);
    });

    it('never lists a repo that is not a member of this group', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('#', 1));
        expect(result.current.filteredMembers.map(m => m.name)).not.toContain('some-other-repo');
    });

    it('moves the highlight with ArrowDown/ArrowUp and wraps', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('#', 1));
        const key = (k: string) => ({ key: k, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent<HTMLElement>;
        act(() => { result.current.handleKeyDown(key('ArrowDown')); });
        expect(result.current.highlightIndex).toBe(1);
        act(() => { result.current.handleKeyDown(key('ArrowUp')); });
        act(() => { result.current.handleKeyDown(key('ArrowUp')); });
        expect(result.current.highlightIndex).toBe(2);
    });

    it('consumes Enter and Tab so the composer does not send or cycle mode', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('#', 1));
        for (const k of ['Enter', 'Tab']) {
            const e = { key: k, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>;
            let consumed = false;
            act(() => { consumed = result.current.handleKeyDown(e); });
            expect(consumed).toBe(true);
            expect(e.preventDefault).toHaveBeenCalled();
        }
    });

    it('dismisses on Escape without touching the text', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('#', 1));
        const e = { key: 'Escape', preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>;
        let consumed = false;
        act(() => { consumed = result.current.handleKeyDown(e); });
        expect(consumed).toBe(true);
        expect(result.current.menuVisible).toBe(false);
    });

    it('passes keys through when the menu is closed', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        const e = { key: 'Enter', preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>;
        expect(result.current.handleKeyDown(e)).toBe(false);
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('inserts `#name ` as plain text and puts the caret after the space', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('check #co', 9));
        const setText = vi.fn();
        const handle = { setValue: vi.fn(), getValue: vi.fn(), focus: vi.fn() } as RichTextInputHandle;
        const ref = { current: handle } as React.RefObject<RichTextInputHandle>;
        act(() => result.current.selectMember('coc-client', 'check #co', setText, ref));
        expect(setText).toHaveBeenCalledWith('check #coc-client ');
        expect(handle.setValue).toHaveBeenCalledWith('check #coc-client ', 18);
        expect(result.current.menuVisible).toBe(false);
    });

    it('replaces only the partial token, keeping text after the caret', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        act(() => result.current.handleInputChange('see #c please', 6));
        const setText = vi.fn();
        act(() => result.current.selectMember('coc', 'see #c please', setText));
        expect(setText).toHaveBeenCalledWith('see #coc  please');
    });

    it('supports two mentions in one message', () => {
        const { result } = renderHook(() => useRepoMentions(MEMBERS, true));
        const setText = vi.fn();
        act(() => result.current.handleInputChange('#c', 2));
        act(() => result.current.selectMember('coc', '#c', setText));
        expect(setText).toHaveBeenLastCalledWith('#coc ');
        act(() => result.current.handleInputChange('#coc #s', 7));
        act(() => result.current.selectMember('shortcuts', '#coc #s', setText));
        expect(setText).toHaveBeenLastCalledWith('#coc #shortcuts ');
    });

    it('inserts a name containing whitespace verbatim', () => {
        const spaced = [member('my repo')];
        const { result } = renderHook(() => useRepoMentions(spaced, true));
        const setText = vi.fn();
        act(() => result.current.handleInputChange('#my', 3));
        act(() => result.current.selectMember('my repo', '#my', setText));
        expect(setText).toHaveBeenCalledWith('#my repo ');
    });
});
