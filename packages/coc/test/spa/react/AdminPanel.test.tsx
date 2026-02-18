import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { AdminPanel } from '../../../src/server/spa/client/react/admin/AdminPanel';

// Mock fetch globally
const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

function renderWithProviders() {
    return render(
        <AppProvider>
            <AdminPanel />
        </AppProvider>
    );
}

describe('AdminPanel', () => {
    it('renders the Admin heading', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
            headers: new Headers(),
        });
        await act(async () => {
            renderWithProviders();
        });
        expect(screen.getByText('Admin')).toBeDefined();
    });

    it('renders storage stats section', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/data/stats')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ processCount: 42, wikiCount: 5, totalBytes: 1048576 }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        await waitFor(() => {
            expect(screen.getByTestId('stat-processes').textContent).toBe('42');
            expect(screen.getByTestId('stat-wikis').textContent).toBe('5');
            expect(screen.getByTestId('stat-disk').textContent).toBe('1.0 MB');
        });
    });

    it('renders configuration section with editable fields', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        resolved: { model: 'gpt-4', parallel: 2, timeout: 60, output: 'json' },
                        sources: { model: 'file' },
                        configFilePath: '/home/user/.coc.yaml',
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        await waitFor(() => {
            const modelInput = screen.getByDisplayValue('gpt-4') as HTMLInputElement;
            expect(modelInput).toBeDefined();
        });
    });

    it('renders export section with Export button', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
            headers: new Headers(),
        });
        await act(async () => {
            renderWithProviders();
        });
        expect(screen.getByText('Export Data')).toBeDefined();
        expect(screen.getByText('Export')).toBeDefined();
    });

    it('renders danger zone with wipe button', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
            headers: new Headers(),
        });
        await act(async () => {
            renderWithProviders();
        });
        expect(screen.getByText('Danger Zone')).toBeDefined();
        expect(screen.getByText('Wipe Data')).toBeDefined();
    });

    it('wipe two-step confirm flow — shows confirm after first click', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/data/wipe-token')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ token: 'test-token-123' }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        // Step 1: click Wipe Data
        await act(async () => {
            fireEvent.click(screen.getByText('Wipe Data'));
        });

        // Step 2: Confirm button should appear
        await waitFor(() => {
            expect(screen.getByText('Confirm Wipe')).toBeDefined();
            expect(screen.getByText('Cancel')).toBeDefined();
        });
    });

    it('wipe confirm calls DELETE with token', async () => {
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (url.includes('/admin/data/wipe-token')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ token: 'abc' }),
                });
            }
            if (options?.method === 'DELETE') {
                expect(url).toContain('confirm=abc');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderWithProviders();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Wipe Data'));
        });

        await waitFor(() => {
            expect(screen.getByText('Confirm Wipe')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('Confirm Wipe'));
        });

        // Verify DELETE was called
        const deleteCalls = mockFetch.mock.calls.filter(
            ([_, opts]: [string, any]) => opts?.method === 'DELETE'
        );
        expect(deleteCalls.length).toBe(1);
        expect(deleteCalls[0][0]).toContain('confirm=abc');
    });
});
