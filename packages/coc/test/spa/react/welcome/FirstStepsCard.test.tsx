import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { FirstStepsCard, STEPS } from '../../../../src/server/spa/client/react/welcome/FirstStepsCard';

/**
 * Helper that dispatches SET_WELCOME_PREFERENCES + optional WORKSPACES_LOADED
 * so the component under test sees preferencesLoaded=true.
 */
function StateLoader({
    children,
    prefs = {},
    workspaces,
}: {
    children: ReactNode;
    prefs?: Record<string, unknown>;
    workspaces?: unknown[];
}) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_WELCOME_PREFERENCES', payload: prefs });
        if (workspaces?.length) {
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });
        }
    }, []);
    return <>{children}</>;
}

/** Reads activeTab from context so we can assert navigation dispatches. */
function ActiveTabSpy() {
    const { state } = useApp();
    return <div data-testid="active-tab">{state.activeTab}</div>;
}

function renderCard(
    opts: {
        prefs?: Record<string, unknown>;
        workspaces?: unknown[];
        onAddRepo?: () => void;
    } = {},
) {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const onAddRepo = opts.onAddRepo ?? vi.fn();
    const result = render(
        <AppProvider>
            <StateLoader prefs={opts.prefs} workspaces={opts.workspaces}>
                <FirstStepsCard onAddRepo={onAddRepo} />
                <ActiveTabSpy />
            </StateLoader>
        </AppProvider>,
    );
    return { ...result, onAddRepo };
}

describe('FirstStepsCard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // 1. Renders card with all 4 steps when onboarding not dismissed
    it('renders card with all 4 steps', () => {
        renderCard();
        expect(screen.getByTestId('first-steps-card')).toBeTruthy();
        expect(screen.getByTestId('first-step-add-repo')).toBeTruthy();
        expect(screen.getByTestId('first-step-use-chat')).toBeTruthy();
        expect(screen.getByTestId('first-step-run-workflow')).toBeTruthy();
        expect(screen.getByTestId('first-step-open-wiki')).toBeTruthy();
        expect(screen.getByTestId('first-steps-progress').textContent).toBe(
            `0 of ${STEPS.length} complete`,
        );
    });

    // 2. Shows completed steps with checkmark and strikethrough
    it('shows completed steps with checkmark', () => {
        renderCard({
            prefs: { onboardingProgress: { hasUsedChat: true, hasRunWorkflow: true } },
            workspaces: [{ id: 'w1', path: '/repo' }],
        });
        // Step 1 (add-repo) done via workspaces, step 2 (use-chat) done, step 3 (run-workflow) done
        const step1 = screen.getByTestId('first-step-add-repo');
        const step2 = screen.getByTestId('first-step-use-chat');
        expect(step1.textContent).toContain('✓');
        expect(step2.textContent).toContain('✓');
        // Progress = 3 of 4 (add-repo + hasUsedChat + hasRunWorkflow)
        expect(screen.getByTestId('first-steps-progress').textContent).toBe(
            '3 of 4 complete',
        );
    });

    // 3. Active step is highlighted
    it('highlights the first incomplete step whose predecessors are done', () => {
        renderCard({
            workspaces: [{ id: 'w1', path: '/repo' }],
        });
        // Step 1 done (workspaces exist), step 2 is first incomplete → active
        const step2 = screen.getByTestId('first-step-use-chat');
        expect(step2.className).toContain('bg-');
        // Step 3 should not be active (step 2 not done)
        const step3 = screen.getByTestId('first-step-run-workflow');
        expect(step3.className).not.toContain('bg-');
    });

    // 4. "+ Add Repository" button calls onAddRepo
    it('"+ Add Repository" button calls onAddRepo', () => {
        const onAddRepo = vi.fn();
        renderCard({ onAddRepo });
        fireEvent.click(screen.getByTestId('first-steps-add-repo'));
        expect(onAddRepo).toHaveBeenCalledOnce();
    });

    // 5. "Open Wiki" button navigates to wiki tab
    it('"Open Wiki" button navigates to wiki tab', () => {
        renderCard();
        fireEvent.click(screen.getByTestId('first-steps-open-wiki'));
        expect(screen.getByTestId('active-tab').textContent).toBe('wiki');
    });

    // 6. "Dismiss" button dispatches UPDATE_ONBOARDING with dismissed:true
    it('"Dismiss" persists dismissed:true', async () => {
        renderCard();
        await act(async () => {
            fireEvent.click(screen.getByTestId('first-steps-dismiss'));
            await Promise.resolve();
            await Promise.resolve();
        });
        // UPDATE_ONBOARDING triggers a PATCH fetch
        const fetchMock = vi.mocked(globalThis.fetch);
        const patchCalls = fetchMock.mock.calls.filter(
            (c) => typeof c[1] === 'object' && c[1]?.method === 'PATCH',
        );
        expect(patchCalls.length).toBeGreaterThanOrEqual(1);
        const body = JSON.parse(patchCalls[patchCalls.length - 1][1]!.body as string);
        expect(body.onboardingProgress.dismissed).toBe(true);
    });

    // 7. Celebration state when all 4 steps complete
    it('shows celebration when all steps are complete', () => {
        renderCard({
            prefs: {
                onboardingProgress: {
                    hasUsedChat: true,
                    hasRunWorkflow: true,
                    hasOpenedWiki: true,
                },
            },
            workspaces: [{ id: 'w1', path: '/repo' }],
        });
        expect(screen.getByTestId('first-steps-celebration')).toBeTruthy();
        expect(screen.getByTestId('first-steps-celebration').textContent).toContain(
            'all set',
        );
    });

    // 8. Celebration auto-dismisses after 3 seconds
    it('celebration auto-dismisses after 3 seconds', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

        function DismissedIndicator() {
            const { state } = useApp();
            return <div data-testid="dismissed">{String(state.onboardingProgress.dismissed)}</div>;
        }

        render(
            <AppProvider>
                <StateLoader
                    prefs={{
                        onboardingProgress: {
                            hasUsedChat: true,
                            hasRunWorkflow: true,
                            hasOpenedWiki: true,
                        },
                    }}
                    workspaces={[{ id: 'w1', path: '/repo' }]}
                >
                    <FirstStepsCard onAddRepo={vi.fn()} />
                    <DismissedIndicator />
                </StateLoader>
            </AppProvider>,
        );

        expect(screen.getByTestId('first-steps-celebration')).toBeTruthy();
        expect(screen.getByTestId('dismissed').textContent).toBe('false');

        await act(async () => {
            vi.runAllTimers();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.getByTestId('dismissed').textContent).toBe('true');
    });

    // 9. Step 1 shows as complete when workspaces exist
    it('marks step 1 complete when workspaces exist', () => {
        renderCard({
            workspaces: [{ id: 'w1', path: '/repo' }],
        });
        const step1 = screen.getByTestId('first-step-add-repo');
        expect(step1.textContent).toContain('✓');
        expect(screen.getByTestId('first-steps-progress').textContent).toBe(
            '1 of 4 complete',
        );
    });

    // 10. Helper text shown only for incomplete steps
    it('shows helper text only for incomplete steps', () => {
        renderCard({
            prefs: { onboardingProgress: { hasUsedChat: true } },
            workspaces: [{ id: 'w1', path: '/repo' }],
        });
        // Step 1 (add-repo) done → no helper
        const step1 = screen.getByTestId('first-step-add-repo');
        expect(step1.textContent).not.toContain('Register a local git repository');
        // Step 2 (use-chat) done → no helper
        const step2 = screen.getByTestId('first-step-use-chat');
        expect(step2.textContent).not.toContain('Ask AI about your codebase');
        // Step 3 (run-workflow) not done → shows helper
        const step3 = screen.getByTestId('first-step-run-workflow');
        expect(step3.textContent).toContain('Define and execute reusable AI pipelines');
    });

    // 11. No action button for steps 2 and 3
    it('renders action buttons only for steps 1 and 4', () => {
        renderCard();
        expect(screen.getByTestId('first-steps-add-repo')).toBeTruthy();
        expect(screen.getByTestId('first-steps-open-wiki')).toBeTruthy();
        // Steps 2 and 3 should not have action buttons
        expect(screen.queryByTestId('first-steps-use-chat')).toBeNull();
        expect(screen.queryByTestId('first-steps-run-workflow')).toBeNull();
    });
});
