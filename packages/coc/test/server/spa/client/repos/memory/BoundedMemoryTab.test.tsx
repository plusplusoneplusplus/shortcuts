/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks — must precede component imports
// ---------------------------------------------------------------------------

vi.mock('@plusplusoneplusplus/forge', () => ({}));

const mockGetBounded = vi.fn();
const mockGetOverview = vi.fn();

vi.mock('../../../../../../src/server/spa/client/react/features/memory/memoryApi', () => ({
    memoryApi: {
        getBounded: (...a: any[]) => mockGetBounded(...a),
        getOverview: (...a: any[]) => mockGetOverview(...a),
        saveBounded: vi.fn(async () => ({ charCount: 0, charLimit: 2200, lastModified: new Date().toISOString() })),
        aggregate: vi.fn(async () => ({ taskId: 't1', processId: 'p1', status: 'queued' })),
    },
}));

vi.mock('../../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi', () => ({
    getWorkspacePreferences: vi.fn(async () => ({ boundedMemory: { enabled: true } })),
    patchWorkspacePreferences: vi.fn(async () => ({})),
}));

vi.mock('../../../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    ToastContext: { Consumer: ({ children }: any) => children(null), Provider: ({ children }: any) => children },
}));

// Mock useModels used by AggregatePanel
vi.mock('../../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false }),
}));

// Mock Dialog used by AggregatePanel
vi.mock('../../../../../../src/server/spa/client/react/ui/Dialog', () => ({
    Dialog: ({ children, open, title, footer }: any) =>
        open ? (
            <div data-testid="dialog" aria-label={title}>
                {children}
                <div data-testid="dialog-footer">{footer}</div>
            </div>
        ) : null,
}));

// Mock getApiBase used by AggregatePanel
vi.mock('../../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000',
}));

import { BoundedMemoryTab } from '../../../../../../src/server/spa/client/react/features/memory/BoundedMemoryTab';

// ---------------------------------------------------------------------------
// Default API responses
// ---------------------------------------------------------------------------

function defaultBoundedResponse() {
    return {
        content: 'Some memory content §\nAnother fact',
        charCount: 500,
        charLimit: 2200,
        lastModified: '2024-04-21T10:00:00Z',
    };
}

function defaultOverviewResponse() {
    return {
        charCount: 500,
        charLimit: 2200,
        lastModified: null,
        pendingRawCount: 5,
        claimedRawCount: 0,
        consolidatedAt: null,
        consolidationStatus: 'idle' as const,
        lastAggregatedAt: '2024-04-20T08:00:00Z',
    };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
    mockGetBounded.mockResolvedValue(defaultBoundedResponse());
    mockGetOverview.mockResolvedValue(defaultOverviewResponse());
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pipeline status strip rendering
// ---------------------------------------------------------------------------

describe('BoundedMemoryTab — pipeline status strip', () => {
    it('fetches overview and shows strip when enabled', async () => {
        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('pipeline-status-strip')).toBeTruthy();
        });
        expect(mockGetOverview).toHaveBeenCalledWith('repo-1');
        expect(screen.getByTestId('pipeline-status-strip').textContent).toContain('5 pending');
    });

    it('hides strip when overview fetch fails gracefully', async () => {
        mockGetOverview.mockRejectedValue(new Error('network error'));
        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('bounded-content')).toBeTruthy();
        });
        expect(screen.queryByTestId('pipeline-status-strip')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Aggregate Now button
// ---------------------------------------------------------------------------

describe('BoundedMemoryTab — Aggregate Now button', () => {
    it('shows Aggregate Now button when memory is enabled and not editing', async () => {
        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('bounded-aggregate-btn')).toBeTruthy();
        });
        expect(screen.getByTestId('bounded-aggregate-btn').textContent).toContain('Aggregate Now');
    });

    it('opens AggregatePanel dialog on click', async () => {
        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('bounded-aggregate-btn')).toBeTruthy();
        });

        await act(async () => {
            await userEvent.click(screen.getByTestId('bounded-aggregate-btn'));
        });

        expect(screen.getByTestId('dialog')).toBeTruthy();
        expect(screen.getByTestId('aggregate-panel')).toBeTruthy();
    });
});
