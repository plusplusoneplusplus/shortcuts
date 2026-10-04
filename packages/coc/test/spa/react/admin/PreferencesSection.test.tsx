import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { PreferencesSection } from '../../../../src/server/spa/client/react/admin/PreferencesSection';

const mocks = vi.hoisted(() => ({
    preferences: {
        getGlobal: vi.fn(),
        patchGlobal: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ preferences: mocks.preferences }),
    };
});

const onError = vi.fn();
const onSuccess = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.preferences.getGlobal.mockReset();
    mocks.preferences.patchGlobal.mockReset();
    onError.mockReset();
    onSuccess.mockReset();
});

function renderSection() {
    return render(
        <AppProvider>
            <PreferencesSection onError={onError} onSuccess={onSuccess} />
        </AppProvider>
    );
}

describe('PreferencesSection', () => {
    it('renders the Preferences section', async () => {
        mocks.preferences.getGlobal.mockResolvedValue({});
        await act(async () => { renderSection(); });
        expect(screen.getByTestId('preferences-section')).toBeDefined();
    });

    it('shows spinner while loading', () => {
        mocks.preferences.getGlobal.mockReturnValue(new Promise(() => {})); // never resolves
        renderSection();
        expect(screen.getByText('Loading…')).toBeDefined();
    });

    it('populates controls from fetched preferences', async () => {
        mocks.preferences.getGlobal.mockResolvedValue({
            theme: 'dark',
            reposSidebarCollapsed: true,
        });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            const themeSelect = screen.getByTestId('pref-theme') as HTMLSelectElement;
            expect(themeSelect.value).toBe('dark');

            const toggle = screen.getByTestId('pref-repos-sidebar-collapsed') as HTMLInputElement;
            expect(toggle.checked).toBe(true);
        });
    });

    it('calls patchGlobal when theme select changes', async () => {
        mocks.preferences.getGlobal.mockResolvedValue({ theme: 'auto' });
        mocks.preferences.patchGlobal.mockResolvedValue({ theme: 'light' });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('pref-theme')).toBeDefined();
        });

        await act(async () => {
            fireEvent.change(screen.getByTestId('pref-theme'), { target: { value: 'light' } });
        });

        await waitFor(() => {
            expect(mocks.preferences.patchGlobal).toHaveBeenCalledWith(
                expect.objectContaining({ theme: 'light' })
            );
        });

        expect(onSuccess).toHaveBeenCalledWith('Preference saved');
    });

    it('calls patchGlobal when reposSidebarCollapsed toggle changes', async () => {
        mocks.preferences.getGlobal.mockResolvedValue({ reposSidebarCollapsed: false });
        mocks.preferences.patchGlobal.mockResolvedValue({ reposSidebarCollapsed: true });

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(screen.getByTestId('pref-repos-sidebar-collapsed')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('pref-repos-sidebar-collapsed'));
        });

        await waitFor(() => {
            expect(mocks.preferences.patchGlobal).toHaveBeenCalledWith(
                expect.objectContaining({ reposSidebarCollapsed: true })
            );
        });
    });

    it('calls onError when getGlobal rejects on load', async () => {
        mocks.preferences.getGlobal.mockRejectedValue(new Error('connection refused'));

        await act(async () => { renderSection(); });

        await waitFor(() => {
            expect(onError).toHaveBeenCalled();
        });
    });

    it('calls onError when patchGlobal rejects', async () => {
        mocks.preferences.getGlobal.mockResolvedValue({ theme: 'auto' });
        mocks.preferences.patchGlobal.mockRejectedValue(
            new CocApiError({ status: 400, statusText: 'Bad Request', url: '/preferences', message: 'Save failed', body: { error: 'Write failed' } })
        );

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


describe('classic dashboard preferences', () => {
    it('has no layout-mode picker', async () => {
        mocks.preferences.getGlobal.mockResolvedValue({});
        await act(async () => { renderSection(); });
        expect(screen.queryByTestId('pref-ui-layout-mode')).toBeNull();
    });
});
