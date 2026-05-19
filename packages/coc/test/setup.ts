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

// Mock @excalidraw/excalidraw — the package imports open-color.json without
// `type: "json"` import assertions, which fails on Node.js ≥ 24. Since tests
// never render a real Excalidraw canvas, a stub component is sufficient.
vi.mock('@excalidraw/excalidraw', () => ({
    Excalidraw: () => null,
}));

// Ensure `git commit` works in tests even when the host machine has no
// git user.email / user.name configured (e.g. fresh CI runners). These
// env vars are read by git directly and bypass the need for `git config`,
// and they are inherited by every child process spawned via execGit.
if (!process.env.GIT_AUTHOR_NAME) process.env.GIT_AUTHOR_NAME = 'CoC Test';
if (!process.env.GIT_AUTHOR_EMAIL) process.env.GIT_AUTHOR_EMAIL = 'coc-test@example.com';
if (!process.env.GIT_COMMITTER_NAME) process.env.GIT_COMMITTER_NAME = process.env.GIT_AUTHOR_NAME;
if (!process.env.GIT_COMMITTER_EMAIL) process.env.GIT_COMMITTER_EMAIL = process.env.GIT_AUTHOR_EMAIL;

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
    // jsdom does not implement ResizeObserver; provide a no-op stub so components
    // that use it (e.g. DiffMiniMap) don't crash in unit tests.
    if (typeof globalThis.ResizeObserver === 'undefined') {
        globalThis.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
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
