/**
 * Vitest global setup — Safety net that prevents real Copilot SDK calls in tests.
 *
 * Auto-mocks `getCopilotSDKService` from `@plusplusoneplusplus/forge`
 * to return a stub that **throws** if any method is called. Tests that need AI
 * should inject a mock `aiService` via `createExecutionServer({ aiService })`.
 */

import { vi, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// Node.js ≥ 25 ships a built-in `globalThis.localStorage` (behind --localstorage-file).
// Vitest's populateGlobal() only overwrites keys that are in its hardcoded KEYS list;
// `localStorage`/`sessionStorage` are not in that list, so the Node.js stub (a plain
// object with no getItem/setItem/clear methods) shadows jsdom's working implementation.
// Fix: when running under jsdom, re-assign from the jsdom window object.
if (typeof window !== 'undefined') {
    const jsdomDoc = (globalThis as any).jsdom;
    const jsdomWin = jsdomDoc?.window ?? window;
    if (jsdomWin.localStorage?.getItem && typeof globalThis.localStorage?.getItem !== 'function') {
        Object.defineProperty(globalThis, 'localStorage', {
            value: jsdomWin.localStorage,
            configurable: true,
            writable: true,
        });
    }
    if (jsdomWin.sessionStorage?.getItem && typeof globalThis.sessionStorage?.getItem !== 'function') {
        Object.defineProperty(globalThis, 'sessionStorage', {
            value: jsdomWin.sessionStorage,
            configurable: true,
            writable: true,
        });
    }
    // jsdom does not implement ResizeObserver — provide a no-op stub so components
    // that use it (e.g. BottomNav) don't throw in tests.
    if (typeof (globalThis as any).ResizeObserver === 'undefined') {
        (globalThis as any).ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    }
}

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const original = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...original,
        getCopilotSDKService: () => ({
            sendMessage: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
            isAvailable: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
            sendFollowUp: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
            hasKeptAliveSession: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
            canResumeSession: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
        }),
    };
});
