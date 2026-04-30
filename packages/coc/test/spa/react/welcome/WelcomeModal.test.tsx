import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { WelcomeModal } from '../../../../src/server/spa/client/react/welcome/WelcomeModal';

/**
 * Helper that dispatches SET_WELCOME_PREFERENCES on mount so the
 * component under test sees preferencesLoaded=true.
 */
function PrefsLoader({ prefs, children }: { prefs: Record<string, unknown>; children: ReactNode }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_WELCOME_PREFERENCES', payload: prefs });
    }, []);
    return <>{children}</>;
}

function renderWelcomeModal(
    prefs: Record<string, unknown> = {},
    props: { onGetStarted?: () => void } = {},
) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
    }));
    return render(
        <AppProvider>
            <PrefsLoader prefs={prefs}>
                <WelcomeModal {...props} />
            </PrefsLoader>
        </AppProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('[data-testid="dialog-overlay"]').forEach(el => el.remove());
});

describe('WelcomeModal', () => {
    it('renders nothing when hasSeenWelcome is true', async () => {
        renderWelcomeModal({ hasSeenWelcome: true });
        // Give effects time to flush
        await waitFor(() => {
            expect(screen.queryByText('Welcome to CoC')).toBeNull();
        });
        expect(document.getElementById('welcome-modal')).toBeNull();
    });

    it('renders modal when hasSeenWelcome is false (default)', async () => {
        renderWelcomeModal({});
        await waitFor(() => {
            expect(screen.getByText('Welcome to CoC')).toBeTruthy();
        });
        expect(document.getElementById('welcome-modal')).toBeTruthy();
        expect(screen.getByText('Your AI-powered development companion')).toBeTruthy();
        expect(screen.getByText('AI Chat')).toBeTruthy();
        expect(screen.getByText('Workflows')).toBeTruthy();
        expect(screen.getByText('Memory')).toBeTruthy();
        expect(screen.getByText('Skills')).toBeTruthy();
        expect(screen.getByTestId('welcome-get-started')).toBeTruthy();
        expect(screen.getByTestId('welcome-skip-tour')).toBeTruthy();
    });

    it('"Get Started" button dismisses modal', async () => {
        renderWelcomeModal({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-get-started')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-get-started'));
        await waitFor(() => {
            expect(document.getElementById('welcome-modal')).toBeNull();
        });
        const fetchMock = vi.mocked(global.fetch);
        const patchCalls = fetchMock.mock.calls.filter(
            ([, opts]) => (opts as any)?.method === 'PATCH',
        );
        expect(patchCalls.length).toBeGreaterThanOrEqual(1);
        const bodies = patchCalls.map(([, opts]) => JSON.parse((opts as any).body));
        expect(bodies).toContainEqual({ hasSeenWelcome: true });
    });

    it('"Get Started" calls onGetStarted callback', async () => {
        const onGetStarted = vi.fn();
        renderWelcomeModal({}, { onGetStarted });
        await waitFor(() => {
            expect(screen.getByTestId('welcome-get-started')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-get-started'));
        await waitFor(() => expect(onGetStarted).toHaveBeenCalledTimes(1));
    });

    it('"Skip tour" dismisses modal and marks onboarding dismissed', async () => {
        renderWelcomeModal({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-skip-tour')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-skip-tour'));
        await waitFor(() => {
            expect(document.getElementById('welcome-modal')).toBeNull();
        });
        const fetchMock = vi.mocked(global.fetch);
        const patchCalls = fetchMock.mock.calls.filter(
            ([, opts]) => (opts as any)?.method === 'PATCH',
        );
        const bodies = patchCalls.map(([, opts]) => JSON.parse((opts as any).body));
        expect(bodies).toContainEqual({
            hasSeenWelcome: true,
            onboardingProgress: {
                hasRunWorkflow: false,
                hasOpenedWiki: false,
                hasUsedChat: false,
                settingsVisited: false,
                dismissed: true,
                hasCompletedTour: false,
            },
        });
    });

    it('"Skip tour" does NOT call onGetStarted callback', async () => {
        const onGetStarted = vi.fn();
        renderWelcomeModal({}, { onGetStarted });
        await waitFor(() => {
            expect(screen.getByTestId('welcome-skip-tour')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-skip-tour'));
        expect(onGetStarted).not.toHaveBeenCalled();
    });

    it('Escape key dismisses modal (via Get Started path)', async () => {
        renderWelcomeModal({});
        await waitFor(() => {
            expect(document.getElementById('welcome-modal')).toBeTruthy();
        });
        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => {
            expect(document.getElementById('welcome-modal')).toBeNull();
        });
        const fetchMock = vi.mocked(global.fetch);
        const patchCalls = fetchMock.mock.calls.filter(
            ([, opts]) => (opts as any)?.method === 'PATCH',
        );
        const bodies = patchCalls.map(([, opts]) => JSON.parse((opts as any).body));
        expect(bodies).toContainEqual({ hasSeenWelcome: true });
    });

    it('"Get Started" keeps the modal open when persistence fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
        render(
            <AppProvider>
                <PrefsLoader prefs={{}}>
                    <WelcomeModal />
                </PrefsLoader>
            </AppProvider>,
        );
        await waitFor(() => {
            expect(screen.getByTestId('welcome-get-started')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('welcome-get-started'));

        await waitFor(() => expect(screen.getByText(/Failed to save onboarding preferences/)).toBeTruthy());
        expect(document.getElementById('welcome-modal')).toBeTruthy();
    });

    it('renders all four feature cards', async () => {
        renderWelcomeModal({});
        await waitFor(() => {
            expect(screen.getByText('AI Chat')).toBeTruthy();
        });
        expect(screen.getByText('Have AI conversations about your code, scoped to each repo')).toBeTruthy();
        expect(screen.getByText('Workflows')).toBeTruthy();
        expect(screen.getByText('Run YAML-defined AI pipelines with DAG execution')).toBeTruthy();
        expect(screen.getByText('Memory')).toBeTruthy();
        expect(screen.getByText('AI learns from past sessions and improves over time')).toBeTruthy();
        expect(screen.getByText('Skills')).toBeTruthy();
        expect(screen.getByText('Extend AI capabilities with installable agent skills')).toBeTruthy();
    });

    it('does not render built-in Dialog header or close button', async () => {
        renderWelcomeModal({});
        await waitFor(() => {
            expect(document.getElementById('welcome-modal')).toBeTruthy();
        });
        expect(screen.queryByTestId('dialog-close-btn')).toBeNull();
    });
});
