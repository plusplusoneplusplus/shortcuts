import { describe, it, expect, vi } from 'vitest';
import {
    SCOPE_WINDOW_PARAM,
    getScopeWindowName,
    buildScopePopOutUrl,
    readLockedWorkspaceId,
    openScopePopOut,
} from '../../../src/server/spa/client/react/features/scope-window/scopeWindow';

describe('scopeWindow helpers', () => {
    describe('getScopeWindowName', () => {
        it('is a deterministic per-scope target so repeats reuse one window (AC-03)', () => {
            expect(getScopeWindowName('ws-v2-abc')).toBe('coc-window-ws-v2-abc');
            // Same id → same name twice (repeat pop-out targets the same window).
            expect(getScopeWindowName('ws-v2-abc')).toBe(getScopeWindowName('ws-v2-abc'));
            // Different scopes → different windows.
            expect(getScopeWindowName('my_work')).not.toBe(getScopeWindowName('my_life'));
        });
    });

    describe('buildScopePopOutUrl', () => {
        it('appends ?window=<id> to the base', () => {
            expect(buildScopePopOutUrl('https://host/app', 'ws-v2-abc')).toBe(
                'https://host/app?window=ws-v2-abc',
            );
        });

        it('encodes ids that need escaping', () => {
            const url = buildScopePopOutUrl('/', 'ws v2/abc');
            // URLSearchParams encodes space and slash.
            expect(url).toBe('/?window=ws+v2%2Fabc');
            expect(readLockedWorkspaceId(new URL('http://x/' + url.slice(1)).search)).toBe('ws v2/abc');
        });

        it('handles virtual scope ids identically to repos (AC-04)', () => {
            expect(buildScopePopOutUrl('/', 'my_work')).toBe('/?window=my_work');
            expect(buildScopePopOutUrl('/', 'my_life')).toBe('/?window=my_life');
        });
    });

    describe('readLockedWorkspaceId', () => {
        it('returns the locked id when ?window= is present', () => {
            expect(readLockedWorkspaceId('?window=ws-v2-abc')).toBe('ws-v2-abc');
            expect(readLockedWorkspaceId('?foo=1&window=my_work')).toBe('my_work');
        });

        it('returns null for a normal (unlocked) window', () => {
            expect(readLockedWorkspaceId('')).toBeNull();
            expect(readLockedWorkspaceId('?workspace=ws-v2-abc')).toBeNull();
            expect(readLockedWorkspaceId('?window=')).toBeNull();
        });

        it('uses the param key constant', () => {
            expect(readLockedWorkspaceId(`?${SCOPE_WINDOW_PARAM}=x`)).toBe('x');
        });
    });

    describe('openScopePopOut', () => {
        it('opens with the scope URL and deterministic window name, then focuses', () => {
            const focus = vi.fn();
            const open = vi.fn().mockReturnValue({ focus } as unknown as Window);
            const result = openScopePopOut({ workspaceId: 'ws-v2-abc', open });

            expect(open).toHaveBeenCalledTimes(1);
            const [url, name] = open.mock.calls[0];
            expect(url).toContain('?window=ws-v2-abc');
            expect(name).toBe('coc-window-ws-v2-abc');
            expect(focus).toHaveBeenCalledTimes(1);
            expect(result).not.toBeNull();
        });

        it('a repeat pop-out targets the same window name (focus existing, AC-03)', () => {
            const open = vi.fn().mockReturnValue({ focus: vi.fn() } as unknown as Window);
            openScopePopOut({ workspaceId: 'ws-v2-abc', open });
            openScopePopOut({ workspaceId: 'ws-v2-abc', open });
            expect(open.mock.calls[0][1]).toBe(open.mock.calls[1][1]);
        });

        it('toasts and returns null when the popup is blocked', () => {
            const addToast = vi.fn();
            const open = vi.fn().mockReturnValue(null);
            const result = openScopePopOut({ workspaceId: 'my_work', open, addToast });
            expect(result).toBeNull();
            expect(addToast).toHaveBeenCalledWith(expect.stringContaining('Pop-out blocked'), 'error');
        });

        it('virtual scopes open through the exact same path (AC-04)', () => {
            const open = vi.fn().mockReturnValue({ focus: vi.fn() } as unknown as Window);
            openScopePopOut({ workspaceId: 'my_life', open });
            const [url, name] = open.mock.calls[0];
            expect(url).toContain('?window=my_life');
            expect(name).toBe('coc-window-my_life');
        });
    });
});
