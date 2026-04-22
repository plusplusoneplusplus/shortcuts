import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

// Mock featureFlags BEFORE importing AdminPanel.
vi.mock('../../../../src/server/spa/client/react/featureFlags', () => ({
    SHOW_WELCOME_TUTORIAL: false,
}));

import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { AdminPanel } from '../../../../src/server/spa/client/react/admin/AdminPanel';

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
        </AppProvider>,
    );
}

describe('AdminPanel with SHOW_WELCOME_TUTORIAL = false', () => {
    it('does not render the Relaunch Welcome Tour button', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
            headers: new Headers(),
        });
        await act(async () => {
            renderWithProviders();
        });
        expect(screen.queryByTestId('relaunch-welcome-btn')).toBeNull();
        expect(screen.queryByText('Welcome Tour')).toBeNull();
    });
});
