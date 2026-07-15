/**
 * Unit tests for the WelcomeTour onboarding modal.
 *
 * Covers:
 *   - Visibility gates (SHOW_WELCOME_TUTORIAL, preferencesLoaded,
 *     preferencesLoadFailed, hasSeenWelcome)
 *   - Step navigation (next, back, click step)
 *   - Buttons (Get started, Skip, Close X)
 *   - Keyboard (Enter / ArrowRight / ArrowLeft / Escape)
 *   - Backend persistence shape (PATCH body matches existing
 *     useOnboardingPreferences contract)
 *   - Persistence-failure path (modal stays open, toast shown)
 *   - CoC icon renders in header brand and hero (welcome step)
 *   - Tour reset to slide 0 when reopened (e.g. via "Relaunch Welcome Tour")
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { WelcomeTour } from '../../../../src/server/spa/client/react/welcome/WelcomeTour';
import { WELCOME_TOUR_STEPS } from '../../../../src/server/spa/client/react/welcome/welcomeTourSteps';

const TOTAL = WELCOME_TOUR_STEPS.length;

const FULL_DEFAULT_ONBOARDING = {
    hasRunWorkflow: false,
    hasOpenedWiki: false,
    hasUsedChat: false,
    settingsVisited: false,
    dismissed: false,
    hasCompletedTour: false,
};

const GET_STARTED_PATCH = {
    hasSeenWelcome: true,
    onboardingProgress: { ...FULL_DEFAULT_ONBOARDING, hasCompletedTour: true },
};

const SKIP_PATCH = {
    hasSeenWelcome: true,
    onboardingProgress: { ...FULL_DEFAULT_ONBOARDING, dismissed: true },
};

function PrefsLoader({ prefs, children }: { prefs: Record<string, unknown>; children: ReactNode }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_WELCOME_PREFERENCES', payload: prefs });
    }, []);
    return <>{children}</>;
}

function renderTour(prefs: Record<string, unknown> = {}, props: { onGetStarted?: () => void } = {}) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
    }));
    return render(
        <AppProvider>
            <PrefsLoader prefs={prefs}>
                <WelcomeTour {...props} />
            </PrefsLoader>
        </AppProvider>,
    );
}

function getPatchBodies(): any[] {
    const fetchMock = vi.mocked(global.fetch);
    return fetchMock.mock.calls
        .filter(([, opts]) => (opts as any)?.method === 'PATCH')
        .map(([, opts]) => JSON.parse((opts as any).body));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── Visibility gates ───────────────────────────────────────────────

describe('WelcomeTour visibility', () => {
    it('renders nothing when hasSeenWelcome is true', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeNull();
        });
    });

    it('renders nothing when preferences have not loaded', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        }));
        render(
            <AppProvider>
                <WelcomeTour />
            </AppProvider>,
        );
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeNull();
        });
    });

    it('renders nothing when preferences load failed', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        }));
        function FailedLoader({ children }: { children: ReactNode }) {
            const { dispatch } = useApp();
            useEffect(() => {
                dispatch({ type: 'SET_PREFERENCES_LOAD_FAILED' });
            }, []);
            return <>{children}</>;
        }
        render(
            <AppProvider>
                <FailedLoader>
                    <WelcomeTour />
                </FailedLoader>
            </AppProvider>,
        );
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeNull();
        });
    });

    it('renders the tour when preferences loaded and hasSeenWelcome=false', async () => {
        renderTour({});
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeTruthy();
        });
        expect(screen.getByTestId('welcome-tour-scrim')).toBeTruthy();
        expect(screen.getByTestId('welcome-tour-counter').textContent).toBe(`1 of ${TOTAL}`);
    });
});

// ── Step navigation ────────────────────────────────────────────────

describe('WelcomeTour navigation', () => {
    it('starts on the welcome step with the Back button disabled', async () => {
        renderTour({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-back')).toBeTruthy();
        });
        expect((screen.getByTestId('welcome-tour-back') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId('welcome-tour-next-label').textContent).toBe('Next');
    });

    it('advances forward through every step', async () => {
        renderTour({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-counter')).toBeTruthy();
        });
        for (let i = 0; i < TOTAL - 1; i++) {
            const stepEl = screen.getByTestId(`welcome-tour-panel-${WELCOME_TOUR_STEPS[i].id}`);
            expect(stepEl).toBeTruthy();
            fireEvent.click(screen.getByTestId('welcome-tour-next'));
        }
        expect(screen.getByTestId(`welcome-tour-panel-${WELCOME_TOUR_STEPS[TOTAL - 1].id}`)).toBeTruthy();
        expect(screen.getByTestId('welcome-tour-counter').textContent).toBe(`${TOTAL} of ${TOTAL}`);
        expect(screen.getByTestId('welcome-tour-next-label').textContent).toBe('Get started');
    });

    it('navigates backward via the Back button', async () => {
        renderTour({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-next')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-tour-next'));
        expect(screen.getByTestId(`welcome-tour-panel-${WELCOME_TOUR_STEPS[1].id}`)).toBeTruthy();
        fireEvent.click(screen.getByTestId('welcome-tour-back'));
        expect(screen.getByTestId(`welcome-tour-panel-${WELCOME_TOUR_STEPS[0].id}`)).toBeTruthy();
        expect((screen.getByTestId('welcome-tour-back') as HTMLButtonElement).disabled).toBe(true);
    });

    it('jumps directly to a step when its header chip is clicked', async () => {
        renderTour({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-step-queue')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-tour-step-queue'));
        expect(screen.getByTestId('welcome-tour-panel-queue')).toBeTruthy();
        expect(screen.getByTestId('welcome-tour-counter').textContent).toBe('3 of 5');
    });

    it('renders one dot per step in the footer', async () => {
        renderTour({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-dots')).toBeTruthy();
        });
        expect(screen.getByTestId('welcome-tour-dots').children.length).toBe(TOTAL);
    });
});

// ── Get started / Skip / Close ─────────────────────────────────────

describe('WelcomeTour completion', () => {
    it('clicking Get started on the last step persists hasSeenWelcome+hasCompletedTour and closes', async () => {
        renderTour({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-next')).toBeTruthy();
        });
        for (let i = 0; i < TOTAL - 1; i++) {
            fireEvent.click(screen.getByTestId('welcome-tour-next'));
        }
        fireEvent.click(screen.getByTestId('welcome-tour-next'));

        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeNull();
        });
        expect(getPatchBodies()).toContainEqual(GET_STARTED_PATCH);
    });

    it('Get started invokes the onGetStarted callback exactly once', async () => {
        const onGetStarted = vi.fn();
        renderTour({}, { onGetStarted });
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-next')).toBeTruthy();
        });
        for (let i = 0; i < TOTAL - 1; i++) {
            fireEvent.click(screen.getByTestId('welcome-tour-next'));
        }
        fireEvent.click(screen.getByTestId('welcome-tour-next'));
        await waitFor(() => expect(onGetStarted).toHaveBeenCalledTimes(1));
    });

    it('Skip tour persists hasSeenWelcome+dismissed and closes', async () => {
        const onGetStarted = vi.fn();
        renderTour({}, { onGetStarted });
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-skip')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-tour-skip'));
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeNull();
        });
        expect(getPatchBodies()).toContainEqual(SKIP_PATCH);
        expect(onGetStarted).not.toHaveBeenCalled();
    });

    it('Close X button skips the tour', async () => {
        renderTour({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-close')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-tour-close'));
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeNull();
        });
        expect(getPatchBodies()).toContainEqual(SKIP_PATCH);
    });

    it('keeps the tour open and surfaces a toast when persistence fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
        render(
            <AppProvider>
                <PrefsLoader prefs={{}}>
                    <WelcomeTour />
                </PrefsLoader>
            </AppProvider>,
        );
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-skip')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-tour-skip'));
        await waitFor(() =>
            expect(screen.getByText(/Failed to save onboarding preferences/)).toBeTruthy(),
        );
        expect(document.getElementById('welcome-tour')).toBeTruthy();
    });
});

// ── Keyboard ───────────────────────────────────────────────────────

describe('WelcomeTour keyboard navigation', () => {
    it('Enter advances to the next step', async () => {
        renderTour({});
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeTruthy();
        });
        fireEvent.keyDown(document, { key: 'Enter' });
        expect(screen.getByTestId(`welcome-tour-panel-${WELCOME_TOUR_STEPS[1].id}`)).toBeTruthy();
    });

    it('ArrowRight advances and ArrowLeft retreats', async () => {
        renderTour({});
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeTruthy();
        });
        fireEvent.keyDown(document, { key: 'ArrowRight' });
        expect(screen.getByTestId(`welcome-tour-panel-${WELCOME_TOUR_STEPS[1].id}`)).toBeTruthy();
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
        expect(screen.getByTestId(`welcome-tour-panel-${WELCOME_TOUR_STEPS[0].id}`)).toBeTruthy();
    });

    it('Escape skips the tour and persists the dismissed patch', async () => {
        renderTour({});
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeTruthy();
        });
        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeNull();
        });
        expect(getPatchBodies()).toContainEqual(SKIP_PATCH);
    });

    it('keyboard handler is removed once the tour closes', async () => {
        renderTour({});
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-tour-skip'));
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeNull();
        });
        // Should not throw; ArrowRight is a no-op once unmounted.
        fireEvent.keyDown(document, { key: 'ArrowRight' });
    });
});

// ── Branding ───────────────────────────────────────────────────────

describe('WelcomeTour branding', () => {
    it('renders the CoC icon in the header brand', async () => {
        renderTour({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-brand-icon')).toBeTruthy();
        });
        const icon = screen.getByTestId('welcome-tour-brand-icon');
        expect(icon.tagName.toLowerCase()).toBe('svg');
        expect(icon.getAttribute('aria-label')).toBe('CoC');
    });

    it('renders the CoC icon as the welcome hero (not an emoji)', async () => {
        renderTour({});
        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-hero-icon')).toBeTruthy();
        });
        // The hero must not be the legacy 🚀 emoji or a literal "C" letter.
        const panel = screen.getByTestId('welcome-tour-panel-welcome');
        expect(panel.textContent || '').not.toContain('🚀');
    });
});

// ── Lifecycle ──────────────────────────────────────────────────────

describe('WelcomeTour lifecycle', () => {
    it('resets to the first step when the tour is reopened after being dismissed', async () => {
        function ResetHarness() {
            const { dispatch } = useApp();
            useEffect(() => {
                dispatch({
                    type: 'SET_WELCOME_PREFERENCES',
                    payload: { hasSeenWelcome: false },
                });
            }, []);
            return (
                <>
                    <button
                        type="button"
                        data-testid="reopen"
                        onClick={() =>
                            dispatch({
                                type: 'SET_WELCOME_PREFERENCES',
                                payload: { hasSeenWelcome: false, onboardingProgress: FULL_DEFAULT_ONBOARDING },
                            })
                        }
                    />
                    <WelcomeTour />
                </>
            );
        }

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
        render(
            <AppProvider>
                <ResetHarness />
            </AppProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('welcome-tour-counter')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('welcome-tour-next'));
        fireEvent.click(screen.getByTestId('welcome-tour-next'));
        expect(screen.getByTestId('welcome-tour-counter').textContent).toBe('3 of 5');

        fireEvent.click(screen.getByTestId('welcome-tour-skip'));
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeNull();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('reopen'));
        });
        await waitFor(() => {
            expect(document.getElementById('welcome-tour')).toBeTruthy();
        });
        // Should be reset back to step 1.
        expect(screen.getByTestId('welcome-tour-counter').textContent).toBe('1 of 5');
    });
});
