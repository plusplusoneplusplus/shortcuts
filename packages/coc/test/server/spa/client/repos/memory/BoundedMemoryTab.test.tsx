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
const mockWipeRepoBounded = vi.fn();

vi.mock('../../../../../../src/server/spa/client/react/features/memory/memoryApi', () => ({
    memoryApi: {
        getBounded: (...a: any[]) => mockGetBounded(...a),
        getOverview: (...a: any[]) => mockGetOverview(...a),
        saveBounded: vi.fn(async () => ({ charCount: 0, charLimit: 2200, lastModified: new Date().toISOString() })),
        promote: vi.fn(async () => ({ taskId: 't1', processId: 'p1', operation: 'promotion', status: 'queued' })),
        wipeRepoBounded: (...a: any[]) => mockWipeRepoBounded(...a),
    },
}));

vi.mock('../../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi', () => ({
    getWorkspacePreferences: vi.fn(async () => ({ boundedMemory: { enabled: true, writeFrequency: 'medium' } })),
    patchWorkspacePreferences: vi.fn(async () => ({})),
}));

vi.mock('../../../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    ToastContext: { Consumer: ({ children }: any) => children(null), Provider: ({ children }: any) => children },
}));

// Mock useModels used by the promotion panel
vi.mock('../../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false }),
}));

// Mock Dialog used by the promotion panel
vi.mock('../../../../../../src/server/spa/client/react/ui/Dialog', () => ({
    Dialog: ({ children, open, title, footer }: any) =>
        open ? (
            <div data-testid="dialog" aria-label={title}>
                {children}
                <div data-testid="dialog-footer">{footer}</div>
            </div>
        ) : null,
}));

// Mock getApiBase used by the promotion panel
vi.mock('../../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000',
    isRalphEnabled: () => false,
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
        promotionStatus: 'idle' as const,
        lastPromotedAt: '2024-04-20T08:00:00Z',
    };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.clearAllMocks();
    mockGetBounded.mockResolvedValue(defaultBoundedResponse());
    mockGetOverview.mockResolvedValue(defaultOverviewResponse());
    mockWipeRepoBounded.mockResolvedValue({ success: true });
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
// Promote Memory button
// ---------------------------------------------------------------------------

describe('BoundedMemoryTab — Promote Memory button', () => {
    it('shows Promote Memory button when memory is enabled and not editing', async () => {
        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('bounded-aggregate-btn')).toBeTruthy();
        });
        expect(screen.getByTestId('bounded-aggregate-btn').textContent).toContain('Promote Memory');
    });

    it('opens promotion dialog on click', async () => {
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

// ---------------------------------------------------------------------------
// Wipe Memory button
// ---------------------------------------------------------------------------

describe('BoundedMemoryTab — Wipe Memory button', () => {
    it('shows confirmation before wiping memory', async () => {
        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('bounded-wipe-btn')).toBeTruthy();
        });

        await act(async () => {
            await userEvent.click(screen.getByTestId('bounded-wipe-btn'));
        });

        expect(screen.getByTestId('bounded-wipe-confirm')).toBeTruthy();
        expect(screen.getByText('Confirm Wipe')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
        expect(mockWipeRepoBounded).not.toHaveBeenCalled();
    });

    it('wipes memory and refreshes the empty state on confirmation', async () => {
        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('bounded-content')).toBeTruthy();
        });

        await act(async () => {
            await userEvent.click(screen.getByTestId('bounded-wipe-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('bounded-wipe-confirm-btn')).toBeTruthy();
        });

        await act(async () => {
            await userEvent.click(screen.getByTestId('bounded-wipe-confirm-btn'));
        });

        await waitFor(() => {
            expect(mockWipeRepoBounded).toHaveBeenCalledWith('repo-1');
            expect(screen.getByTestId('bounded-empty')).toBeTruthy();
        });
        expect(screen.queryByTestId('bounded-wipe-confirm')).toBeNull();
        expect(mockGetOverview).toHaveBeenCalledTimes(2);
    });

    it('shows wipe button for disabled repos with raw candidates', async () => {
        const { getWorkspacePreferences } = await import(
            '../../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi'
        );
        (getWorkspacePreferences as any).mockResolvedValue({ boundedMemory: { enabled: false } });
        mockGetBounded.mockResolvedValue({
            content: '',
            charCount: 0,
            charLimit: 2200,
            lastModified: null,
        });
        mockGetOverview.mockResolvedValue({
            ...defaultOverviewResponse(),
            charCount: 0,
            pendingRawCount: 2,
        });

        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('bounded-wipe-btn')).toBeTruthy();
        });
        expect(screen.getByTestId('memory-enabled-toggle').getAttribute('aria-checked')).toBe('false');
    });
});

// ---------------------------------------------------------------------------
// Write frequency selector
// ---------------------------------------------------------------------------

describe('BoundedMemoryTab — write frequency selector', () => {
    it('renders frequency selector with Low / Medium / High buttons', async () => {
        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('write-frequency-selector')).toBeTruthy();
        });

        expect(screen.getByTestId('write-frequency-low')).toBeTruthy();
        expect(screen.getByTestId('write-frequency-medium')).toBeTruthy();
        expect(screen.getByTestId('write-frequency-high')).toBeTruthy();
    });

    it('highlights medium by default', async () => {
        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('write-frequency-medium')).toBeTruthy();
        });

        const mediumBtn = screen.getByTestId('write-frequency-medium');
        expect(mediumBtn.className).toContain('bg-[#0078d4]');
    });

    it('calls patchWorkspacePreferences on frequency change', async () => {
        const { patchWorkspacePreferences } = await import(
            '../../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi'
        );

        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('write-frequency-high')).toBeTruthy();
        });

        await act(async () => {
            await userEvent.click(screen.getByTestId('write-frequency-high'));
        });

        expect(patchWorkspacePreferences).toHaveBeenCalledWith('repo-1', expect.objectContaining({
            boundedMemory: expect.objectContaining({ writeFrequency: 'high' }),
        }));
    });

    it('dims frequency selector when memory is disabled', async () => {
        const { getWorkspacePreferences } = await import(
            '../../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi'
        );
        (getWorkspacePreferences as any).mockResolvedValue({ boundedMemory: { enabled: false } });

        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('write-frequency-section')).toBeTruthy();
        });

        const section = screen.getByTestId('write-frequency-section');
        expect(section.className).toContain('opacity-50');
    });
});

// ---------------------------------------------------------------------------
// Memory read tools toggle
// ---------------------------------------------------------------------------

describe('BoundedMemoryTab — memory read tools toggle', () => {
    it('renders disabled by default and patches readTools.enabled on toggle', async () => {
        const { getWorkspacePreferences, patchWorkspacePreferences } = await import(
            '../../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi'
        );
        (getWorkspacePreferences as any).mockResolvedValue({
            boundedMemory: {
                enabled: true,
                writeFrequency: 'medium',
                readTools: {
                    enabled: false,
                    maxResults: 5,
                },
            },
        });

        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('memory-read-tools-toggle')).toBeTruthy();
        });

        const toggle = screen.getByTestId('memory-read-tools-toggle');
        expect(toggle.getAttribute('aria-checked')).toBe('false');

        await act(async () => {
            await userEvent.click(toggle);
        });

        expect(patchWorkspacePreferences).toHaveBeenCalledWith('repo-1', {
            boundedMemory: expect.objectContaining({
                enabled: true,
                readTools: {
                    enabled: true,
                    maxResults: 5,
                },
            }),
        });
    });

    it('dims read tools settings when memory is disabled', async () => {
        const { getWorkspacePreferences } = await import(
            '../../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi'
        );
        (getWorkspacePreferences as any).mockResolvedValue({ boundedMemory: { enabled: false } });

        render(<BoundedMemoryTab repoId="repo-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('memory-read-tools-section')).toBeTruthy();
        });

        expect(screen.getByTestId('memory-read-tools-section').className).toContain('opacity-50');
        expect((screen.getByTestId('memory-read-tools-toggle') as HTMLButtonElement).disabled).toBe(true);
    });
});
