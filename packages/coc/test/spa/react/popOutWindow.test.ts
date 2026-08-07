/**
 * `popOutOpened` decides whether a `#popout/*` `window.open` really opened a
 * window. The desktop shell intercepts those opens with `{ action: 'deny' }` and
 * builds a native address-bar window itself, so `window.open` returns null even
 * on success — a plain `if (!handle)` there fires a false "Pop-out blocked"
 * toast and skips the markPoppedOut bookkeeping.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { popOutOpened } from '../../../src/server/spa/client/react/utils/popOutWindow';

type DesktopWindow = typeof globalThis & { cocDesktop?: { isDesktop?: boolean } };

afterEach(() => {
    delete (globalThis as DesktopWindow).cocDesktop;
});

describe('popOutOpened', () => {
    it('treats a returned handle as success in the browser', () => {
        expect(popOutOpened({} as Window)).toBe(true);
    });

    it('treats a null handle as a blocked popup in the browser', () => {
        expect(popOutOpened(null)).toBe(false);
    });

    it('treats a null handle as success inside the desktop shell', () => {
        (globalThis as DesktopWindow).cocDesktop = { isDesktop: true };
        expect(popOutOpened(null)).toBe(true);
        expect(popOutOpened({} as Window)).toBe(true);
    });

    it('still reports a blocked popup when the bridge is present but not the desktop', () => {
        (globalThis as DesktopWindow).cocDesktop = { isDesktop: false };
        expect(popOutOpened(null)).toBe(false);
    });
});
