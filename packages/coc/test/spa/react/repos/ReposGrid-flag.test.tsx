import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock featureFlags BEFORE importing components.
vi.mock('../../../../src/server/spa/client/react/featureFlags', () => ({
    SHOW_WELCOME_TUTORIAL: false,
}));

import { AppProvider } from '../../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/context/ToastContext';
import { ReposGrid } from '../../../../src/server/spa/client/react/repos/ReposGrid';

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ReposGrid with SHOW_WELCOME_TUTORIAL = false', () => {
    it('shows empty state instead of FirstStepsCard when flag is false and no repos', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        }));
        render(
            <Wrap>
                <ReposGrid repos={[]} onRefresh={vi.fn()} />
            </Wrap>,
        );
        await waitFor(() => {
            expect(screen.getByTestId('repos-empty')).toBeTruthy();
        });
        expect(screen.queryByTestId('first-steps-card')).toBeNull();
    });
});
