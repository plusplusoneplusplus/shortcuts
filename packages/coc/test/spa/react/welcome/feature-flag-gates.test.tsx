import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

// Mock featureFlags BEFORE importing any component that uses it.
vi.mock('../../../../src/server/spa/client/react/featureFlags', () => ({
    SHOW_WELCOME_TUTORIAL: false,
}));

import { AppProvider, useApp } from '../../../../src/server/spa/client/react/context/AppContext';
import { WelcomeModal } from '../../../../src/server/spa/client/react/welcome/WelcomeModal';
import { FeatureTip } from '../../../../src/server/spa/client/react/welcome/FeatureTip';

function PrefsLoader({ prefs, children }: { prefs: Record<string, unknown>; children: ReactNode }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_WELCOME_PREFERENCES', payload: prefs });
    }, []);
    return <>{children}</>;
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('[data-testid="dialog-overlay"]').forEach(el => el.remove());
});

describe('Feature flag gates (SHOW_WELCOME_TUTORIAL = false)', () => {
    it('WelcomeModal does not render when flag is false', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        }));
        render(
            <AppProvider>
                <PrefsLoader prefs={{ hasSeenWelcome: false }}>
                    <WelcomeModal />
                </PrefsLoader>
            </AppProvider>,
        );
        // Even with hasSeenWelcome=false, modal should not appear
        await waitFor(() => {
            expect(screen.queryByText('Welcome to CoC')).toBeNull();
        });
        expect(document.getElementById('welcome-modal')).toBeNull();
    });

    it('FeatureTip returns null when flag is false', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        }));
        const { container } = render(
            <AppProvider>
                <PrefsLoader prefs={{ dismissedTips: [] }}>
                    <FeatureTip tipId="memory-intro" />
                </PrefsLoader>
            </AppProvider>,
        );
        await waitFor(() => {
            expect(screen.queryByTestId('feature-tip-memory-intro')).toBeNull();
        });
        // FeatureTip should render nothing
        expect(container.innerHTML).toBe('');
    });
});
