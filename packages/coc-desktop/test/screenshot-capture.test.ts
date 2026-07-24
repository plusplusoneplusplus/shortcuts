/**
 * Tests for the screenshot-capture Electron-free helpers (AC-01).
 *
 * Covers:
 *   - the exported global accelerator constant;
 *   - `registerScreenshotShortcut` against a MOCK `globalShortcut` — success,
 *     the "already in use" (returns false) path, and the throwing path — proving
 *     it binds `onTrigger` and never crashes;
 *   - `unregisterScreenshotShortcut` releasing the accelerator;
 *   - source-level assertions that `main.ts` wires register-on-ready and
 *     unregister-on-`will-quit`, and that there is exactly one
 *     `globalShortcut.register` call in the source (code-search DoD).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    SCREENSHOT_ACCELERATOR,
    GlobalShortcutLike,
    registerScreenshotShortcut,
    unregisterScreenshotShortcut,
} from '../src/screenshot-capture';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');

function readSrc(file: string): string {
    return readFileSync(path.join(srcDir, file), 'utf8');
}

/** A minimal mock of Electron's globalShortcut that records register calls. */
function mockGlobalShortcut(registerResult: boolean | (() => never)): {
    gs: GlobalShortcutLike;
    register: ReturnType<typeof vi.fn>;
    unregisterAll: ReturnType<typeof vi.fn>;
} {
    const register = vi.fn((_accelerator: string, _cb: () => void) => {
        if (typeof registerResult === 'function') {
            return registerResult();
        }
        return registerResult;
    });
    const unregisterAll = vi.fn();
    return { gs: { register, unregisterAll } as GlobalShortcutLike, register, unregisterAll };
}

describe('SCREENSHOT_ACCELERATOR', () => {
    it('is the documented default (avoids the macOS Cmd+Shift+3/4/5 shortcuts)', () => {
        expect(SCREENSHOT_ACCELERATOR).toBe('CommandOrControl+Shift+2');
    });
});

describe('registerScreenshotShortcut', () => {
    it('registers the default accelerator and returns true on success', () => {
        const { gs, register } = mockGlobalShortcut(true);
        const onTrigger = vi.fn();
        const result = registerScreenshotShortcut(gs, { onTrigger });
        expect(result).toBe(true);
        expect(register).toHaveBeenCalledWith(SCREENSHOT_ACCELERATOR, onTrigger);
    });

    it('honours a custom accelerator override', () => {
        const { gs, register } = mockGlobalShortcut(true);
        const onTrigger = vi.fn();
        registerScreenshotShortcut(gs, { accelerator: 'CommandOrControl+Alt+9', onTrigger });
        expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+9', onTrigger);
    });

    it('invokes onTrigger when the bound accelerator fires', () => {
        const { gs, register } = mockGlobalShortcut(true);
        const onTrigger = vi.fn();
        registerScreenshotShortcut(gs, { onTrigger });
        // Fire the callback the way Electron would on a hotkey press.
        const boundCallback = register.mock.calls[0][1] as () => void;
        boundCallback();
        expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    it('warns and returns false when the combo is already in use (register → false)', () => {
        const { gs } = mockGlobalShortcut(false);
        const onWarn = vi.fn();
        const result = registerScreenshotShortcut(gs, { onTrigger: vi.fn(), onWarn });
        expect(result).toBe(false);
        expect(onWarn).toHaveBeenCalledTimes(1);
        expect(onWarn.mock.calls[0][0]).toContain(SCREENSHOT_ACCELERATOR);
    });

    it('never throws when register throws — warns and returns false', () => {
        const { gs } = mockGlobalShortcut(() => {
            throw new Error('registration blew up');
        });
        const onWarn = vi.fn();
        let result: boolean | undefined;
        expect(() => {
            result = registerScreenshotShortcut(gs, { onTrigger: vi.fn(), onWarn });
        }).not.toThrow();
        expect(result).toBe(false);
        expect(onWarn).toHaveBeenCalledTimes(1);
        expect(onWarn.mock.calls[0][0]).toContain('registration failed');
    });

    it('tolerates a missing onWarn sink on the failure path', () => {
        const { gs } = mockGlobalShortcut(false);
        expect(() => registerScreenshotShortcut(gs, { onTrigger: vi.fn() })).not.toThrow();
    });
});

describe('unregisterScreenshotShortcut', () => {
    it('releases every registered accelerator via unregisterAll', () => {
        const { gs, unregisterAll } = mockGlobalShortcut(true);
        unregisterScreenshotShortcut(gs);
        expect(unregisterAll).toHaveBeenCalledTimes(1);
    });
});

describe('main.ts capture-accelerator wiring (code-search DoD)', () => {
    const mainSrc = readSrc('main.ts');

    it('imports globalShortcut from electron', () => {
        expect(mainSrc).toMatch(/import\s*\{[^}]*\bglobalShortcut\b[^}]*\}\s*from\s*'electron'/s);
    });

    it('registers the shortcut on app ready (inside bootstrap) and only once', () => {
        // The registration is funnelled through the once-guarded setup helper,
        // which bootstrap() calls on app ready.
        expect(mainSrc).toContain('function setupScreenshotShortcut()');
        expect(mainSrc).toContain('registerScreenshotShortcut(globalShortcut');
        expect(mainSrc).toContain('setupScreenshotShortcut();');
    });

    it('unregisters the shortcut on will-quit', () => {
        expect(mainSrc).toMatch(/will-quit/);
        expect(mainSrc).toContain('unregisterScreenshotShortcut(globalShortcut)');
    });

    it('has exactly one globalShortcut.register call across the source', () => {
        const files = ['main.ts', 'screenshot-capture.ts', 'screenshot-capture-host.ts'];
        const combined = files.map(readSrc).join('\n');
        const registerCalls = combined.match(/globalShortcut\.register\b/g) ?? [];
        expect(registerCalls).toHaveLength(1);
        const unregisterCalls = combined.match(/globalShortcut\.unregisterAll\b/g) ?? [];
        expect(unregisterCalls).toHaveLength(1);
    });
});
