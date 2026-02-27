/**
 * Smoke tests for shared test utilities.
 * Validates that mock factories produce correctly shaped defaults and
 * that renderWithProviders mounts without errors.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';

import {
    createMockAppContext,
    createMockQueueContext,
    createMockTaskContext,
    createMockToastContext,
    createMockFetch,
    renderWithProviders,
} from './test-utils';

// ── createMockAppContext ───────────────────────────────────────────────

describe('createMockAppContext', () => {
    it('returns state with expected defaults', () => {
        const { state, dispatch } = createMockAppContext();
        expect(state.processes).toEqual([]);
        expect(state.activeTab).toBe('repos');
        expect(state.workspace).toBe('__all');
        expect(state.wsStatus).toBe('closed');
        expect(dispatch).toEqual(expect.any(Function));
    });

    it('merges overrides into state', () => {
        const { state } = createMockAppContext({ activeTab: 'wiki', selectedId: 'p1' });
        expect(state.activeTab).toBe('wiki');
        expect(state.selectedId).toBe('p1');
        // Other defaults still intact
        expect(state.workspace).toBe('__all');
    });
});

// ── createMockQueueContext ─────────────────────────────────────────────

describe('createMockQueueContext', () => {
    it('returns state with expected defaults', () => {
        const { state, dispatch } = createMockQueueContext();
        expect(state.queued).toEqual([]);
        expect(state.running).toEqual([]);
        expect(state.stats.queued).toBe(0);
        expect(state.queueInitialized).toBe(false);
        expect(dispatch).toEqual(expect.any(Function));
    });

    it('merges overrides into state', () => {
        const { state } = createMockQueueContext({ draining: true, selectedTaskId: 't1' });
        expect(state.draining).toBe(true);
        expect(state.selectedTaskId).toBe('t1');
    });
});

// ── createMockTaskContext ──────────────────────────────────────────────

describe('createMockTaskContext', () => {
    it('returns state with expected defaults', () => {
        const { state, dispatch } = createMockTaskContext();
        expect(state.openFilePath).toBeNull();
        expect(state.selectedFilePaths).toBeInstanceOf(Set);
        expect(state.selectedFilePaths.size).toBe(0);
        expect(state.showContextFiles).toBe(true);
        expect(dispatch).toEqual(expect.any(Function));
    });

    it('merges overrides into state', () => {
        const paths = new Set(['a.ts', 'b.ts']);
        const { state } = createMockTaskContext({ openFilePath: '/test', selectedFilePaths: paths });
        expect(state.openFilePath).toBe('/test');
        expect(state.selectedFilePaths).toBe(paths);
    });
});

// ── createMockToastContext ─────────────────────────────────────────────

describe('createMockToastContext', () => {
    it('returns stubs with expected shape', () => {
        const ctx = createMockToastContext();
        expect(ctx.toasts).toEqual([]);
        expect(ctx.addToast).toEqual(expect.any(Function));
        expect(ctx.removeToast).toEqual(expect.any(Function));
    });

    it('accepts overrides', () => {
        const toasts = [{ id: '1', message: 'hello' }];
        const ctx = createMockToastContext({ toasts });
        expect(ctx.toasts).toBe(toasts);
    });
});

// ── createMockFetch ────────────────────────────────────────────────────

describe('createMockFetch', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns 404 for unmatched routes', async () => {
        const fetchMock = createMockFetch();
        const res = await fetchMock('/api/unknown');
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json).toEqual({ error: 'Not Found' });
    });

    it('matches routes by URL substring', async () => {
        const fetchMock = createMockFetch({
            '/api/processes': { body: [{ id: 'p1' }] },
        });
        const res = await fetchMock('http://localhost:4000/api/processes?ws=all');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual([{ id: 'p1' }]);
    });

    it('supports custom status codes', async () => {
        const fetchMock = createMockFetch({
            '/api/error': { status: 500, body: { error: 'fail' } },
        });
        const res = await fetchMock('/api/error');
        expect(res.status).toBe(500);
    });

    it('accepts plain objects as shorthand for body', async () => {
        const fetchMock = createMockFetch({
            '/api/data': [1, 2, 3],
        });
        const res = await fetchMock('/api/data');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual([1, 2, 3]);
    });

    it('sets globalThis.fetch', () => {
        const fetchMock = createMockFetch();
        expect(globalThis.fetch).toBe(fetchMock);
    });
});

// ── renderWithProviders ────────────────────────────────────────────────

describe('renderWithProviders', () => {
    it('renders a simple component inside all providers', () => {
        renderWithProviders(<div data-testid="child">hello</div>);
        expect(screen.getByTestId('child')).toHaveTextContent('hello');
    });

    it('returns toastContext with mock functions', () => {
        const { toastContext } = renderWithProviders(<div />);
        expect(toastContext.addToast).toEqual(expect.any(Function));
        expect(toastContext.removeToast).toEqual(expect.any(Function));
        expect(toastContext.toasts).toEqual([]);
    });

    it('accepts custom toast overrides', () => {
        const customAdd = vi.fn();
        const { toastContext } = renderWithProviders(<div />, {
            toastValue: { addToast: customAdd },
        });
        expect(toastContext.addToast).toBe(customAdd);
    });
});
