import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock featureFlags BEFORE importing components.
vi.mock('../../../../src/server/spa/client/react/featureFlags', () => ({
    SHOW_WELCOME_TUTORIAL: false,
}));

const repositoryServiceMocks = vi.hoisted(() => ({
    browseWorkspaceFolders: vi.fn().mockResolvedValue({ path: '', parent: null, entries: [] }),
    cloneRepository: vi.fn().mockResolvedValue({ clonedPath: '/repo' }),
    getGlobalPreferences: vi.fn().mockResolvedValue({}),
    getRepositoryApiErrorMessage: vi.fn((error: unknown, fallback: string, networkFallback?: string) => {
        if (error instanceof Error && error.message) return error.message;
        return networkFallback ?? fallback;
    }),
    registerWorkspace: vi.fn().mockResolvedValue({}),
    updateGlobalPreferences: vi.fn().mockResolvedValue({}),
    updateWorkspace: vi.fn().mockResolvedValue({ workspace: {} }),
}));

vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    ...repositoryServiceMocks,
}));

import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/contexts/ToastContext';
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
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('ReposGrid with SHOW_WELCOME_TUTORIAL = false', () => {
    it('shows ReposEmptyState instead of FirstStepsCard when flag is false and no repos', async () => {
        render(
            <Wrap>
                <ReposGrid repos={[]} onRefresh={vi.fn()} />
            </Wrap>,
        );
        await waitFor(() => {
            expect(screen.getByTestId('repos-empty')).toBeTruthy();
        });
        expect(screen.getByText('No repositories yet')).toBeTruthy();
        expect(screen.getByText('+ Add Repository')).toBeTruthy();
        expect(screen.queryByTestId('first-steps-card')).toBeNull();
    });

    it('CTA button click opens AddRepoDialog', async () => {
        render(
            <Wrap>
                <ReposGrid repos={[]} onRefresh={vi.fn()} />
            </Wrap>,
        );
        await waitFor(() => {
            expect(screen.getByTestId('repos-empty')).toBeTruthy();
        });
        const ctaButton = screen.getByText('+ Add Repository');
        fireEvent.click(ctaButton);
        await waitFor(() => {
            expect(document.getElementById('add-repo-overlay')).toBeTruthy();
        });
    });
});
