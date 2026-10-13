/**
 * Tests for the Edit ▸ Copy delegation (see `terminal-copy.ts`).
 *
 * REGRESSION: the Edit menu used the stock `role: 'copy'`, i.e.
 * `webContents.copy()`, which copies the native DOM selection. xterm.js paints
 * its own selection instead, so selecting terminal output and pressing Cmd+C
 * copied nothing — and the menu accelerator swallowed the key before the
 * renderer's own handler could see it. Copy now asks the renderer first and
 * only falls back to the native copy when nobody claims it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createMenuCopyDelegate,
    MENU_COPY_CHANNEL,
    MENU_COPY_HANDLED_CHANNEL,
    MENU_COPY_FALLBACK_DELAY_MS,
    type MenuCopyTarget,
} from '../src/terminal-copy';

function makeTarget(id = 7): MenuCopyTarget & { send: ReturnType<typeof vi.fn>; copy: ReturnType<typeof vi.fn> } {
    return { id, send: vi.fn(), copy: vi.fn(), isDestroyed: () => false };
}

describe('createMenuCopyDelegate', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('copies focused DevTools or guest contents immediately without SPA IPC', () => {
        const target = { id: 8, copy: vi.fn(), isDestroyed: () => false };
        const delegate = createMenuCopyDelegate({ getTarget: () => target });

        delegate.requestCopy();

        expect(target.copy).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS);
        expect(target.copy).toHaveBeenCalledTimes(1);
    });

    it('cancels pending SPA copy when Copy is invoked in DevTools', () => {
        const spa = makeTarget();
        const devTools = { id: 8, copy: vi.fn(), isDestroyed: () => false };
        let focused: MenuCopyTarget = spa;
        const delegate = createMenuCopyDelegate({ getTarget: () => focused });
        delegate.requestCopy();
        focused = devTools;

        delegate.requestCopy();
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS);

        expect(spa.copy).not.toHaveBeenCalled();
        expect(devTools.copy).toHaveBeenCalledTimes(1);
    });

    it('ignores a destroyed focused target', () => {
        const target = { ...makeTarget(), isDestroyed: () => true };
        const delegate = createMenuCopyDelegate({ getTarget: () => target });
        delegate.requestCopy();
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS);
        expect(target.send).not.toHaveBeenCalled();
        expect(target.copy).not.toHaveBeenCalled();
    });

    it('does not copy a target destroyed while waiting for terminal delegation', () => {
        let destroyed = false;
        const target = { ...makeTarget(), isDestroyed: () => destroyed };
        const delegate = createMenuCopyDelegate({ getTarget: () => target });
        delegate.requestCopy();
        destroyed = true;
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS);
        expect(target.copy).not.toHaveBeenCalled();
    });

    it('asks the focused renderer before copying anything itself', () => {
        const target = makeTarget();
        const delegate = createMenuCopyDelegate({ getTarget: () => target });

        delegate.requestCopy();

        expect(target.send).toHaveBeenCalledWith(MENU_COPY_CHANNEL);
        expect(target.copy).not.toHaveBeenCalled();
    });

    it('falls back to the native copy when the renderer stays silent', () => {
        const target = makeTarget();
        const delegate = createMenuCopyDelegate({ getTarget: () => target });

        delegate.requestCopy();
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS);

        expect(target.copy).toHaveBeenCalledTimes(1);
    });

    it('skips the fallback once a focused terminal claims the copy', () => {
        const target = makeTarget();
        const delegate = createMenuCopyDelegate({ getTarget: () => target });

        delegate.requestCopy();
        delegate.markHandled(target.id);
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS * 10);

        expect(target.copy).not.toHaveBeenCalled();
    });

    it('ignores a claim from a different webContents', () => {
        const target = makeTarget(7);
        const delegate = createMenuCopyDelegate({ getTarget: () => target });

        delegate.requestCopy();
        delegate.markHandled(99);
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS);

        expect(target.copy).toHaveBeenCalledTimes(1);
    });

    it('ignores a claim that arrives with no request pending', () => {
        const target = makeTarget();
        const delegate = createMenuCopyDelegate({ getTarget: () => target });

        expect(() => delegate.markHandled(target.id)).not.toThrow();
        expect(target.copy).not.toHaveBeenCalled();
    });

    it('does nothing when there is no focused window', () => {
        const delegate = createMenuCopyDelegate({ getTarget: () => null });

        expect(() => delegate.requestCopy()).not.toThrow();
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS);
    });

    it('drops a superseded request so its stale fallback cannot fire', () => {
        const target = makeTarget();
        const delegate = createMenuCopyDelegate({ getTarget: () => target });

        delegate.requestCopy();
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS - 1);
        delegate.requestCopy();
        delegate.markHandled(target.id);
        vi.advanceTimersByTime(MENU_COPY_FALLBACK_DELAY_MS * 10);

        expect(target.send).toHaveBeenCalledTimes(2);
        expect(target.copy).not.toHaveBeenCalled();
    });

    it('uses distinct request and reply channels', () => {
        expect(MENU_COPY_CHANNEL).not.toBe(MENU_COPY_HANDLED_CHANNEL);
    });
});
