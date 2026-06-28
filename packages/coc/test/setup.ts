/**
 * Vitest global setup — Safety net that prevents real Copilot SDK calls in tests.
 *
 * Auto-mocks `sdkServiceRegistry.getOrThrow` from `@plusplusoneplusplus/forge`
 * to return a stub that **throws** if any method is called. Tests that need AI
 * should inject a mock `aiService` via `createExecutionServer({ aiService })`.
 */

import { vi, expect, beforeEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { _clearConfigCache } from '../src/server/spa/client/react/api/staticConfigCache';

expect.extend(matchers);

// The static-config client cache is a module-level singleton that persists for
// the lifetime of a test file. Clear it before every test so a provider/
// workspace config cached by one test never leaks into the next and silently
// suppresses an expected refetch.
beforeEach(() => {
    _clearConfigCache();
});

// Mock @excalidraw/excalidraw — the package imports open-color.json without
// `type: "json"` import assertions, which fails on Node.js ≥ 24. Since tests
// never render a real Excalidraw canvas, a stub component is sufficient.
// We also stub `restoreElements` so `buildViewerInitialData` (which now pipes
// raw elements through it to fill in Excalidraw bookkeeping fields) keeps
// working under the same mock — the identity passthrough mirrors the real
// API's "input shape preserved" contract closely enough for unit tests.
vi.mock('@excalidraw/excalidraw', () => ({
    Excalidraw: () => null,
    restoreElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
    convertToExcalidrawElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
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
    const throwingStub = {
        sendMessage: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
        isAvailable: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
        sendFollowUp: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
        hasKeptAliveSession: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
        canResumeSession: () => { throw new Error('Real SDK call leaked in test — inject a mock aiService'); },
    };
    return {
        ...original,
        sdkServiceRegistry: {
            getOrThrow: (_name: string) => throwingStub,
        },
        loadConfigFile: (filePath?: string) => {
            // Return undefined to allow tests to handle missing config gracefully
            return undefined;
        },
    };
});
