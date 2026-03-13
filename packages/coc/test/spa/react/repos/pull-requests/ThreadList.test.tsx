/**
 * Tests for ThreadList component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/repos/pull-requests/pr-utils', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, formatRelativeTime: (d: string) => d ?? '' };
});

const makeSingleThread = (overrides: Partial<any> = {}) => ({
    id: 1,
    comments: [
        { id: 1, author: { displayName: 'Alice' }, content: 'LGTM', publishedDate: '2024-01-01' },
    ],
    ...overrides,
});

const makeMultiThread = (overrides: Partial<any> = {}) => ({
    id: 2,
    comments: [
        { id: 1, author: { displayName: 'Bob' }, content: 'Can you add a test?', publishedDate: '2024-01-01' },
        { id: 2, author: { displayName: 'Alice' }, content: 'Done, check the latest commit.', publishedDate: '2024-01-02' },
    ],
    ...overrides,
});

async function renderThreadList(threads: any[]) {
    const { ThreadList } = await import(
        '../../../../../src/server/spa/client/react/repos/pull-requests/ThreadList'
    );
    return render(<ThreadList threads={threads} />);
}

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
});

// ── Empty state ────────────────────────────────────────────────────────────────

describe('empty state', () => {
    it('renders empty message when no threads', async () => {
        await act(async () => { await renderThreadList([]); });
        expect(screen.getByTestId('threads-empty')).toBeInTheDocument();
    });
});

// ── Single-comment threads ─────────────────────────────────────────────────────

describe('single-comment thread', () => {
    it('shows comment body without toggle arrow', async () => {
        await act(async () => { await renderThreadList([makeSingleThread()]); });
        expect(screen.getByTestId('thread-body')).toBeInTheDocument();
        expect(screen.getByTestId('thread-comment')).toBeInTheDocument();
        // No expand/collapse arrow for single-comment threads
        const header = screen.getByTestId('thread-header');
        expect(header.textContent).not.toContain('▶');
    });
});

// ── Multi-comment threads ──────────────────────────────────────────────────────

describe('multi-comment thread', () => {
    it('is collapsed by default for multi-comment threads', async () => {
        await act(async () => { await renderThreadList([makeMultiThread()]); });
        expect(screen.queryByTestId('thread-body')).not.toBeInTheDocument();
        expect(screen.getByTestId('thread-header').textContent).toContain('▶');
    });

    it('expands when header is clicked', async () => {
        await act(async () => { await renderThreadList([makeMultiThread()]); });
        fireEvent.click(screen.getByTestId('thread-header'));
        expect(screen.getByTestId('thread-body')).toBeInTheDocument();
        expect(screen.getAllByTestId('thread-comment')).toHaveLength(2);
        expect(screen.getByTestId('thread-header').textContent).toContain('▼');
    });

    it('collapses again when header is clicked a second time', async () => {
        await act(async () => { await renderThreadList([makeMultiThread()]); });
        fireEvent.click(screen.getByTestId('thread-header'));
        expect(screen.getByTestId('thread-body')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('thread-header'));
        expect(screen.queryByTestId('thread-body')).not.toBeInTheDocument();
    });
});

// ── Multiple threads ───────────────────────────────────────────────────────────

describe('multiple threads', () => {
    it('renders the correct number of thread cards', async () => {
        await act(async () => {
            await renderThreadList([makeSingleThread({ id: 1 }), makeMultiThread({ id: 2 }), makeSingleThread({ id: 3 })]);
        });
        expect(screen.getAllByTestId('comment-thread')).toHaveLength(3);
    });

    it('expanding one thread does not expand others', async () => {
        await act(async () => {
            await renderThreadList([makeMultiThread({ id: 1 }), makeMultiThread({ id: 2 })]);
        });
        const headers = screen.getAllByTestId('thread-header');
        fireEvent.click(headers[0]);
        // Only the first thread should be expanded
        expect(screen.getAllByTestId('thread-body')).toHaveLength(1);
    });
});
