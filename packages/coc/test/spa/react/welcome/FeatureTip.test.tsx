import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/context/AppContext';
import { FeatureTip } from '../../../../src/server/spa/client/react/welcome/FeatureTip';
import { TIPS } from '../../../../src/server/spa/client/react/welcome/tips';

/**
 * Helper that dispatches SET_WELCOME_PREFERENCES on mount so the
 * component under test sees preferencesLoaded=true with the given prefs.
 */
function PrefsLoader({ prefs, children }: { prefs: Record<string, unknown>; children: ReactNode }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_WELCOME_PREFERENCES', payload: prefs });
    }, []);
    return <>{children}</>;
}

function renderFeatureTip(
    tipId: string,
    prefs: Record<string, unknown> = {},
    props: { className?: string } = {},
) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
    }));
    return render(
        <AppProvider>
            <PrefsLoader prefs={prefs}>
                <FeatureTip tipId={tipId} {...props} />
            </PrefsLoader>
        </AppProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('FeatureTip', () => {
    it('renders tip when not dismissed', async () => {
        renderFeatureTip('memory-intro', { dismissedTips: [] });
        await waitFor(() => {
            expect(screen.getByTestId('feature-tip-memory-intro')).toBeTruthy();
        });
        expect(screen.getByText('AI Memory')).toBeTruthy();
        expect(screen.getByText(TIPS['memory-intro'].body)).toBeTruthy();
    });

    it('does not render when tipId is in dismissedTips', async () => {
        renderFeatureTip('memory-intro', { dismissedTips: ['memory-intro'] });
        await waitFor(() => {
            expect(screen.queryByTestId('feature-tip-memory-intro')).toBeNull();
        });
    });

    it('does not render for unknown tipId', async () => {
        renderFeatureTip('nonexistent', { dismissedTips: [] });
        await waitFor(() => {
            expect(screen.queryByTestId('feature-tip-nonexistent')).toBeNull();
        });
    });

    it('dismiss button dispatches DISMISS_TIP', async () => {
        renderFeatureTip('memory-intro', { dismissedTips: [] });
        await waitFor(() => {
            expect(screen.getByTestId('dismiss-tip-memory-intro')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('dismiss-tip-memory-intro'));
        // After dismiss, the tip should disappear
        await waitFor(() => {
            expect(screen.queryByTestId('feature-tip-memory-intro')).toBeNull();
        });
        // Verify PATCH was sent with dismissedTips
        const fetchMock = vi.mocked(global.fetch);
        const patchCalls = fetchMock.mock.calls.filter(
            ([, opts]) => (opts as any)?.method === 'PATCH',
        );
        const bodies = patchCalls.map(([, opts]) => JSON.parse((opts as any).body));
        const tipPatch = bodies.find((b: any) => b.dismissedTips);
        expect(tipPatch).toBeTruthy();
        expect(tipPatch.dismissedTips).toContain('memory-intro');
    });

    it('renders correct content for each registered tip', async () => {
        for (const [tipId, content] of Object.entries(TIPS)) {
            const { unmount } = renderFeatureTip(tipId, { dismissedTips: [] });
            await waitFor(() => {
                expect(screen.getByTestId(`feature-tip-${tipId}`)).toBeTruthy();
            });
            expect(screen.getByText(content.title)).toBeTruthy();
            expect(screen.getByText(content.body)).toBeTruthy();
            unmount();
        }
    });

    it('applies custom className', async () => {
        renderFeatureTip('memory-intro', { dismissedTips: [] }, { className: 'my-extra' });
        await waitFor(() => {
            expect(screen.getByTestId('feature-tip-memory-intro')).toBeTruthy();
        });
        const el = screen.getByTestId('feature-tip-memory-intro');
        expect(el.className).toContain('my-extra');
    });

    it('fade-in: starts with opacity-0, transitions to opacity-100', async () => {
        renderFeatureTip('memory-intro', { dismissedTips: [] });
        await waitFor(() => {
            expect(screen.getByTestId('feature-tip-memory-intro')).toBeTruthy();
        });
        const el = screen.getByTestId('feature-tip-memory-intro');
        // After effects flush, should have opacity-100
        await waitFor(() => {
            expect(el.className).toContain('opacity-100');
        });
    });

    it('accessibility: dismiss button has aria-label', async () => {
        renderFeatureTip('memory-intro', { dismissedTips: [] });
        await waitFor(() => {
            expect(screen.getByTestId('dismiss-tip-memory-intro')).toBeTruthy();
        });
        const btn = screen.getByTestId('dismiss-tip-memory-intro');
        expect(btn.getAttribute('aria-label')).toBe('Dismiss AI Memory tip');
    });
});
