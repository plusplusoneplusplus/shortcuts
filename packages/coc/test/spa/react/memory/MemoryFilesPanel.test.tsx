import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryFilesPanel } from '../../../../src/server/spa/client/react/views/memory/MemoryFilesPanel';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

const defaultOverview = {
    global: { rawCount: 3, consolidatedExists: true, lastAggregation: '2026-01-15T10:00:00Z', factCount: 10 },
    repos: [
        { hash: 'repohash1', name: 'my-repo', path: '/home/user/my-repo', rawCount: 2, consolidatedExists: false, lastAggregation: null, factCount: 0 },
    ],
    gitRemotes: [
        { hash: 'remotehash1', name: 'org/shared', remoteUrl: 'https://github.com/org/shared', rawCount: 1, consolidatedExists: true, lastAggregation: null, factCount: 5 },
    ],
};

const defaultFileList = {
    level: 'system',
    files: ['2026-03-01T00-00-00.000Z-review.md', '2026-02-01T00-00-00.000Z-scan.md'],
    consolidatedExists: true,
    stats: { rawCount: 2, consolidatedExists: true, lastAggregation: null, factCount: 0 },
};

function mockOverviewThenFiles() {
    let call = 0;
    mockFetch.mockImplementation(() => {
        call++;
        if (call === 1) {
            // overview
            return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultOverview) });
        }
        // file list
        return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultFileList) });
    });
}

describe('MemoryFilesPanel', () => {
    it('renders loading spinner on mount', async () => {
        mockFetch.mockReturnValue(new Promise(() => {}));
        render(<MemoryFilesPanel />);
        expect(screen.getByLabelText('Loading')).toBeDefined();
    });

    it('renders level cards after loading', async () => {
        mockOverviewThenFiles();
        await act(async () => {
            render(<MemoryFilesPanel />);
        });
        await waitFor(() => {
            expect(screen.getByText('Global')).toBeDefined();
            expect(screen.getByText('my-repo')).toBeDefined();
            expect(screen.getByText('org/shared')).toBeDefined();
        });
    });

    it('shows global stats on the global card', async () => {
        mockOverviewThenFiles();
        await act(async () => {
            render(<MemoryFilesPanel />);
        });
        await waitFor(() => {
            expect(screen.getByText('Cross-repo observations')).toBeDefined();
        });
        // Check stats rendered (use function matcher for robustness)
        expect(screen.getByText((t) => t.includes('3 file'))).toBeDefined();
        // Both global and git-remote have consolidated, so use getAllByText
        expect(screen.getAllByText('consolidated').length).toBeGreaterThanOrEqual(1);
    });

    it('shows "No observation files" when file list is empty', async () => {
        let call = 0;
        mockFetch.mockImplementation(() => {
            call++;
            if (call === 1) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({
                    global: { rawCount: 0, consolidatedExists: false, lastAggregation: null, factCount: 0 },
                    repos: [],
                    gitRemotes: [],
                }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({
                level: 'system', files: [], consolidatedExists: false,
                stats: { rawCount: 0, consolidatedExists: false, lastAggregation: null, factCount: 0 },
            }) });
        });

        await act(async () => {
            render(<MemoryFilesPanel />);
        });
        await waitFor(() => {
            expect(screen.getByText('No observation files at this level.')).toBeDefined();
        });
    });

    it('shows file list with filenames', async () => {
        mockOverviewThenFiles();
        await act(async () => {
            render(<MemoryFilesPanel />);
        });
        await waitFor(() => {
            expect(screen.getByText((text) => text.includes('review.md'))).toBeDefined();
            expect(screen.getByText((text) => text.includes('scan.md'))).toBeDefined();
        });
    });

    it('displays error message on fetch failure', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
        await act(async () => {
            render(<MemoryFilesPanel />);
        });
        await waitFor(() => {
            expect(screen.getByText('HTTP 500')).toBeDefined();
        });
    });

    it('shows observation content when a file is clicked', async () => {
        let call = 0;
        mockFetch.mockImplementation(() => {
            call++;
            if (call === 1) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultOverview) });
            }
            if (call === 2) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultFileList) });
            }
            // file content view
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    metadata: { pipeline: 'review', timestamp: '2026-03-01T00:00:00.000Z', model: 'gpt-4' },
                    content: 'Found unused import',
                    filename: '2026-03-01T00-00-00.000Z-review.md',
                }),
            });
        });

        await act(async () => {
            render(<MemoryFilesPanel />);
        });

        await waitFor(() => {
            expect(screen.getByText((text) => text.includes('review.md'))).toBeDefined();
        });

        // Click a file
        const fileButton = screen.getByText((text) => text.includes('review.md'));
        await act(async () => {
            fireEvent.click(fileButton);
        });

        await waitFor(() => {
            expect(screen.getByText('Found unused import')).toBeDefined();
            expect(screen.getByText('Pipeline: review')).toBeDefined();
            expect(screen.getByText('Model: gpt-4')).toBeDefined();
        });
    });

    it('switches level when repo card is clicked', async () => {
        let call = 0;
        mockFetch.mockImplementation(() => {
            call++;
            if (call === 1) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultOverview) });
            }
            if (call === 2) {
                // initial system file list
                return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultFileList) });
            }
            // repo file list after click
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    level: 'repo', hash: 'repohash1',
                    files: ['2026-04-01T00-00-00.000Z-analyze.md'],
                    consolidatedExists: false,
                    stats: { rawCount: 1, consolidatedExists: false, lastAggregation: null, factCount: 0 },
                }),
            });
        });

        await act(async () => {
            render(<MemoryFilesPanel />);
        });

        await waitFor(() => {
            expect(screen.getByText('my-repo')).toBeDefined();
        });

        // Click the repo card
        await act(async () => {
            fireEvent.click(screen.getByText('my-repo'));
        });

        await waitFor(() => {
            expect(screen.getByText((text) => text.includes('analyze.md'))).toBeDefined();
        });
    });
});
