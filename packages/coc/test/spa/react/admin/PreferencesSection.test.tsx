import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../../src/server/spa/client/react/context/AppContext';
import { PreferencesSection } from '../../../../src/server/spa/client/react/admin/PreferencesSection';

const mockFetch = vi.fn();
const onError = vi.fn();
const onSuccess = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    onError.mockReset();
    onSuccess.mockReset();
    global.fetch = mockFetch;
});

function renderSection() {
    return render(
        <AppProvider>
            <PreferencesSection onError={onError} onSuccess={onSuccess} />
        </AppProvider>
    );
}

describe('PreferencesSection', () => {
    it('renders the Preferences heading', async () => {
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        await act(async () => { renderSection(); });
        expect(screen.getByText('Preferences')).toBeDefined();
    });

    it('shows spinner while loading', () => {
        mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
        renderSection();
        expect(screen.getByText('Loading…')).toBeDefined();
    });

    it('populates controls from fetched preferences', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                theme: 'dark',
                lastModel: 'gpt-4',
                lastDepth: 'deep',
                lastEffort: 'high',
                lastSkill: 'my-skill',
                reposSidebarCollapsed: true,
            }),
        });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            const themeSelect = screen.getByTestId('pref-theme') as HTMLSelectElement;
            expect(themeSelect.value).toBe('dark');

            const modelInput = screen.getByTestId('pref-last-model') as HTMLInputElement;
            expect(modelInput.value).toBe('gpt-4');

            const depthSelect = screen.getByTestId('pref-last-depth') as HTMLSelectElement;
            expect(depthSelect.value).toBe('deep');

            const effortSelect = screen.getByTestId('pref-last-effort') as HTMLSelectElement;
            expect(effortSelect.value).toBe('high');

            const skillInput = screen.getByTestId('pref-last-skill') as HTMLInputElement;
            expect(skillInput.value).toBe('my-skill');

            const toggle = screen.getByTestId('pref-repos-sidebar-collapsed') as HTMLInputElement;
            expect(toggle.checked).toBe(true);
        });
    });

    it('calls PATCH when theme select changes', async () => {
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (options?.method === 'PATCH') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ theme: 'light' }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ theme: 'auto' }) });
        });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('pref-theme')).toBeDefined();
        });

        await act(async () => {
            fireEvent.change(screen.getByTestId('pref-theme'), { target: { value: 'light' } });
        });

        await waitFor(() => {
            const patchCalls = mockFetch.mock.calls.filter(
                ([_url, opts]: [string, any]) => opts?.method === 'PATCH'
            );
            expect(patchCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(patchCalls[0][1].body);
            expect(body.theme).toBe('light');
        });

        expect(onSuccess).toHaveBeenCalledWith('Preference saved');
    });

    it('calls PATCH on lastModel input blur', async () => {
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (options?.method === 'PATCH') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastModel: 'claude-3' }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ lastModel: '' }) });
        });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('pref-last-model')).toBeDefined();
        });

        const input = screen.getByTestId('pref-last-model') as HTMLInputElement;
        await act(async () => {
            fireEvent.change(input, { target: { value: 'claude-3' } });
            fireEvent.blur(input);
        });

        await waitFor(() => {
            const patchCalls = mockFetch.mock.calls.filter(
                ([_url, opts]: [string, any]) => opts?.method === 'PATCH'
            );
            expect(patchCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(patchCalls[0][1].body);
            expect(body.lastModel).toBe('claude-3');
        });
    });

    it('calls PATCH when reposSidebarCollapsed toggle changes', async () => {
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (options?.method === 'PATCH') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ reposSidebarCollapsed: true }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ reposSidebarCollapsed: false }) });
        });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('pref-repos-sidebar-collapsed')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('pref-repos-sidebar-collapsed'));
        });

        await waitFor(() => {
            const patchCalls = mockFetch.mock.calls.filter(
                ([_url, opts]: [string, any]) => opts?.method === 'PATCH'
            );
            expect(patchCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(patchCalls[0][1].body);
            expect(typeof body.reposSidebarCollapsed).toBe('boolean');
        });
    });

    it('shows pinned chats info and clear button when pinnedChats is non-empty', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                pinnedChats: { 'workspace-a': ['chat1', 'chat2'] },
            }),
        });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(screen.getByText(/1 workspace/)).toBeDefined();
            expect(screen.getByTestId('pref-clear-pins')).toBeDefined();
        });
    });

    it('does not show clear button when pinnedChats is empty', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ pinnedChats: {} }),
        });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(screen.queryByTestId('pref-clear-pins')).toBeNull();
        });
    });

    it('clear pins sends PATCH with empty pinnedChats', async () => {
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (options?.method === 'PATCH') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    pinnedChats: { 'workspace-a': ['chat1'] },
                }),
            });
        });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('pref-clear-pins')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('pref-clear-pins'));
        });

        await waitFor(() => {
            const patchCalls = mockFetch.mock.calls.filter(
                ([_url, opts]: [string, any]) => opts?.method === 'PATCH'
            );
            expect(patchCalls.length).toBe(1);
            const body = JSON.parse(patchCalls[0][1].body);
            expect(body.pinnedChats).toEqual({});
        });

        expect(onSuccess).toHaveBeenCalledWith('Pinned chats cleared');
    });

    it('calls onError when fetch fails on load', async () => {
        mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(onError).toHaveBeenCalled();
        });
    });

    it('calls onError when PATCH fails', async () => {
        mockFetch.mockImplementation((url: string, options?: any) => {
            if (options?.method === 'PATCH') {
                return Promise.resolve({
                    ok: false,
                    json: () => Promise.resolve({ error: 'Write failed' }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ theme: 'auto' }) });
        });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('pref-theme')).toBeDefined();
        });

        await act(async () => {
            fireEvent.change(screen.getByTestId('pref-theme'), { target: { value: 'light' } });
        });

        await waitFor(() => {
            expect(onError).toHaveBeenCalledWith('Write failed');
        });
    });
});
