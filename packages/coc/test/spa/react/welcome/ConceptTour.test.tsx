import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { ConceptTour } from '../../../../src/server/spa/client/react/welcome/ConceptTour';
import { TOUR_SLIDES } from '../../../../src/server/spa/client/react/welcome/conceptTourSlides';

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

function renderTour(prefs: Record<string, unknown> = {}) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
    }));
    return render(
        <AppProvider>
            <PrefsLoader prefs={prefs}>
                <ConceptTour />
            </PrefsLoader>
        </AppProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('[data-testid="dialog-overlay"]').forEach(el => el.remove());
});

describe('ConceptTour', () => {
    // ── Visibility logic ────────────────────────────────────────────

    it('renders nothing when hasSeenWelcome is false (welcome modal still active)', async () => {
        renderTour({ hasSeenWelcome: false });
        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeNull();
        });
    });

    it('renders nothing when hasCompletedTour is true', async () => {
        renderTour({
            hasSeenWelcome: true,
            onboardingProgress: { hasCompletedTour: true },
        });
        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeNull();
        });
    });

    it('renders nothing when onboarding is dismissed', async () => {
        renderTour({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true },
        });
        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeNull();
        });
    });

    it('renders nothing when preferences have not loaded', async () => {
        // Don't use PrefsLoader — preferencesLoaded stays false
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        }));
        const { container } = render(
            <AppProvider>
                <ConceptTour />
            </AppProvider>,
        );
        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeNull();
        });
        expect(container.innerHTML).toBe('');
    });

    it('renders tour when hasSeenWelcome=true and hasCompletedTour=false', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeTruthy();
        });
        // First slide should be visible
        expect(screen.getByText(TOUR_SLIDES[0].title)).toBeTruthy();
        expect(screen.getByText(TOUR_SLIDES[0].description)).toBeTruthy();
    });

    // ── Navigation ──────────────────────────────────────────────────

    it('starts on the first slide with no Back button', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(screen.getByText(TOUR_SLIDES[0].title)).toBeTruthy();
        });
        expect(screen.queryByTestId('tour-back')).toBeNull();
        expect(screen.getByTestId('tour-next')).toBeTruthy();
        expect(screen.getByTestId('tour-next').textContent).toContain('Next');
    });

    it('navigates forward through slides', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(screen.getByText(TOUR_SLIDES[0].title)).toBeTruthy();
        });

        // Click Next to go to slide 2
        fireEvent.click(screen.getByTestId('tour-next'));
        expect(screen.getByText(TOUR_SLIDES[1].title)).toBeTruthy();
        expect(screen.getByTestId('tour-back')).toBeTruthy();
    });

    it('navigates backward through slides', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(screen.getByText(TOUR_SLIDES[0].title)).toBeTruthy();
        });

        // Go forward then back
        fireEvent.click(screen.getByTestId('tour-next'));
        expect(screen.getByText(TOUR_SLIDES[1].title)).toBeTruthy();

        fireEvent.click(screen.getByTestId('tour-back'));
        expect(screen.getByText(TOUR_SLIDES[0].title)).toBeTruthy();
        expect(screen.queryByTestId('tour-back')).toBeNull();
    });

    it('shows "Let\'s Go →" on the last slide', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(screen.getByText(TOUR_SLIDES[0].title)).toBeTruthy();
        });

        // Navigate to the last slide
        for (let i = 0; i < TOUR_SLIDES.length - 1; i++) {
            fireEvent.click(screen.getByTestId('tour-next'));
        }

        expect(screen.getByText(TOUR_SLIDES[TOUR_SLIDES.length - 1].title)).toBeTruthy();
        expect(screen.getByTestId('tour-next').textContent).toContain("Let's Go");
    });

    it('renders correct number of page dots', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(screen.getByTestId('tour-dots')).toBeTruthy();
        });
        const dots = screen.getByTestId('tour-dots').children;
        expect(dots.length).toBe(TOUR_SLIDES.length);
    });

    // ── Completion / Skip ───────────────────────────────────────────

    it('"Let\'s Go" on last slide closes tour and persists', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(screen.getByText(TOUR_SLIDES[0].title)).toBeTruthy();
        });

        // Navigate to last slide
        for (let i = 0; i < TOUR_SLIDES.length - 1; i++) {
            fireEvent.click(screen.getByTestId('tour-next'));
        }

        fireEvent.click(screen.getByTestId('tour-next'));

        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeNull();
        });

        // Verify PATCH was called with hasCompletedTour
        const fetchMock = vi.mocked(global.fetch);
        const patchCalls = fetchMock.mock.calls.filter(
            ([, opts]) => (opts as any)?.method === 'PATCH',
        );
        const bodies = patchCalls.map(([, opts]) => JSON.parse((opts as any).body));
        const tourPatch = bodies.find((b: any) => b.onboardingProgress?.hasCompletedTour);
        expect(tourPatch).toBeTruthy();
        expect(tourPatch.onboardingProgress.hasCompletedTour).toBe(true);
    });

    it('"Skip tour" closes tour on first slide', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(screen.getByTestId('tour-skip')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('tour-skip'));

        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeNull();
        });

        const fetchMock = vi.mocked(global.fetch);
        const patchCalls = fetchMock.mock.calls.filter(
            ([, opts]) => (opts as any)?.method === 'PATCH',
        );
        const bodies = patchCalls.map(([, opts]) => JSON.parse((opts as any).body));
        const tourPatch = bodies.find((b: any) => b.onboardingProgress?.hasCompletedTour);
        expect(tourPatch).toBeTruthy();
    });

    it('"Skip tour" closes tour on a middle slide', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(screen.getByText(TOUR_SLIDES[0].title)).toBeTruthy();
        });

        // Go to slide 2
        fireEvent.click(screen.getByTestId('tour-next'));
        expect(screen.getByText(TOUR_SLIDES[1].title)).toBeTruthy();

        fireEvent.click(screen.getByTestId('tour-skip'));

        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeNull();
        });
    });

    it('Escape key closes the tour', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeTruthy();
        });

        fireEvent.keyDown(document, { key: 'Escape' });

        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeNull();
        });
    });

    it('keeps the tour open when completion persistence fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
        render(
            <AppProvider>
                <PrefsLoader prefs={{ hasSeenWelcome: true }}>
                    <ConceptTour />
                </PrefsLoader>
            </AppProvider>,
        );
        await waitFor(() => {
            expect(screen.getByTestId('tour-skip')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('tour-skip'));

        await waitFor(() => expect(screen.getByText(/Failed to save onboarding preferences/)).toBeTruthy());
        expect(document.getElementById('concept-tour')).toBeTruthy();
    });

    // ── Slide content ───────────────────────────────────────────────

    it('renders emoji icon with correct aria-label', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(screen.getByText(TOUR_SLIDES[0].title)).toBeTruthy();
        });
        const icon = screen.getByRole('img', { name: TOUR_SLIDES[0].title });
        expect(icon.textContent).toBe(TOUR_SLIDES[0].icon);
    });

    it('does not render Dialog header or close button', async () => {
        renderTour({ hasSeenWelcome: true });
        await waitFor(() => {
            expect(document.getElementById('concept-tour')).toBeTruthy();
        });
        expect(screen.queryByTestId('dialog-close-btn')).toBeNull();
    });
});
