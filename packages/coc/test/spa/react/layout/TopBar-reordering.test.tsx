import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';
import { ToastContext } from '../../../../src/server/spa/client/react/contexts/ToastContext';

const mockDispatch = vi.fn();
const mockPatchGlobal = vi.fn();
const mockReplaceGlobal = vi.fn();
const mockGetGlobal = vi.fn();
const mockAddToast = vi.fn();
let mockActiveTab = 'repos';
let mockIsMobile = false;

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: mockGetGlobal,
            patchGlobal: mockPatchGlobal,
            replaceGlobal: mockReplaceGlobal,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: mockActiveTab,
            reposSidebarCollapsed: false,
            wsStatus: 'open',
            selectedRepoId: null,
            repoTabState: {},
            notePathState: {},
        },
        dispatch: mockDispatch,
    }),
    AppProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} }, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
}));

vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'auto', toggleTheme: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/NotificationBell', () => ({
    NotificationBell: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoManagementPopover', () => ({
    RepoManagementPopover: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        breakpoint: mockIsMobile ? 'mobile' : 'desktop',
        isMobile: mockIsMobile,
        isTablet: false,
        isDesktop: !mockIsMobile,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => false,
}));

function renderTopBar() {
    return render(
        <ToastContext.Provider value={{ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }}>
            <TopBar />
        </ToastContext.Provider>
    );
}

function reorderGroupIds(): string[] {
    const group = screen.getByTestId('topbar-reorder-group');
    return within(group).getAllByRole('button')
        .map(button => button.getAttribute('data-topbar-item-id'))
        .filter((id): id is string => Boolean(id));
}

function dataTransfer(id = '') {
    let value = id;
    return {
        effectAllowed: '',
        setData: vi.fn((_type: string, next: string) => { value = next; }),
        getData: vi.fn(() => value),
    };
}

describe('TopBar reordering', () => {
    beforeEach(() => {
        location.hash = '';
        mockActiveTab = 'repos';
        mockIsMobile = false;
        mockDispatch.mockClear();
        mockPatchGlobal.mockReset();
        mockReplaceGlobal.mockReset();
        mockGetGlobal.mockReset();
        mockAddToast.mockClear();
        mockGetGlobal.mockResolvedValue({});
        mockPatchGlobal.mockImplementation(async patch => patch);
        mockReplaceGlobal.mockImplementation(async prefs => prefs);
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        location.hash = '';
    });

    it('applies persisted utility order and appends missing default destinations', async () => {
        mockGetGlobal.mockResolvedValue({ topBarItemOrder: ['models', 'unknown', 'skills'] });

        renderTopBar();

        await waitFor(() => expect(reorderGroupIds()).toEqual(['models', 'skills', 'logs', 'stats', 'admin']));
    });

    it('persists a desktop drag reorder optimistically', async () => {
        renderTopBar();
        await waitFor(() => expect(reorderGroupIds()[0]).toBe('skills'));

        const group = screen.getByTestId('topbar-reorder-group');
        const skills = within(group).getByLabelText('Skills');
        const models = within(group).getByLabelText('Models');
        const transfer = dataTransfer();

        fireEvent.dragStart(skills.parentElement!, { dataTransfer: transfer });
        fireEvent.dragOver(models.parentElement!, { dataTransfer: transfer, clientX: 10 });
        fireEvent.drop(models.parentElement!, { dataTransfer: transfer, clientX: 10 });

        await waitFor(() => {
            expect(mockPatchGlobal).toHaveBeenCalledWith({
                topBarItemOrder: ['wiki', 'logs', 'stats', 'memory', 'models', 'skills', 'servers', 'admin'],
            });
        });
        expect(reorderGroupIds()).toEqual(['logs', 'stats', 'models', 'skills', 'admin']);
    });

    it('uses drag language for keyboard reorder and saves the dropped order', async () => {
        renderTopBar();
        await waitFor(() => expect(reorderGroupIds()[0]).toBe('skills'));

        const skills = screen.getByLabelText('Skills');
        fireEvent.keyDown(skills, { key: ' ' });
        expect(screen.getByText('Picked up Skills, position 1 of 5.')).toBeTruthy();
        fireEvent.keyDown(skills, { key: 'End' });
        expect(screen.getByText('Drop position after Admin.')).toBeTruthy();
        fireEvent.keyDown(skills, { key: 'Enter' });

        await waitFor(() => {
            expect(mockPatchGlobal).toHaveBeenCalledWith({
                topBarItemOrder: ['wiki', 'logs', 'stats', 'memory', 'models', 'admin', 'servers', 'skills'],
            });
        });
        expect(screen.getByText('Dropped Skills, position 5 of 5.')).toBeTruthy();
    });

    it('keeps an optimistic order and shows a toast when persistence fails', async () => {
        mockPatchGlobal.mockRejectedValue(new Error('offline'));
        renderTopBar();
        await waitFor(() => expect(reorderGroupIds()[0]).toBe('skills'));

        const group = screen.getByTestId('topbar-reorder-group');
        const logs = within(group).getByLabelText('Logs');
        const admin = within(group).getByLabelText('Admin');
        const transfer = dataTransfer();

        fireEvent.dragStart(logs.parentElement!, { dataTransfer: transfer });
        fireEvent.dragOver(admin.parentElement!, { dataTransfer: transfer, clientX: 10 });
        fireEvent.drop(admin.parentElement!, { dataTransfer: transfer, clientX: 10 });

        await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(
            'offline. The order will stay for this session and retry on the next reorder.',
            'error',
        ));
        expect(reorderGroupIds()).toEqual(['skills', 'stats', 'models', 'admin', 'logs']);
    });

    it('enters direct reorder mode with long-press and drops between top-bar items', async () => {
        renderTopBar();
        await waitFor(() => expect(reorderGroupIds()[0]).toBe('skills'));

        vi.useFakeTimers();
        const group = screen.getByTestId('topbar-reorder-group');
        const skills = within(group).getByLabelText('Skills');
        const admin = within(group).getByLabelText('Admin');
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            value: vi.fn(() => admin),
        });
        vi.spyOn(admin, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            right: 20,
            top: 0,
            bottom: 20,
            width: 20,
            height: 20,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        fireEvent.pointerDown(skills, { pointerId: 1, clientX: 1, clientY: 1 });
        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(screen.getByText('Picked up Skills, position 1 of 5.')).toBeTruthy();
        expect(screen.getByText('Drag icons to reorder. Long-press an icon to pick it up. Esc to finish.')).toBeTruthy();

        fireEvent.pointerMove(skills, { pointerId: 1, clientX: 19, clientY: 1 });
        fireEvent.pointerUp(skills, { pointerId: 1, clientX: 19, clientY: 1 });
        vi.useRealTimers();

        await waitFor(() => {
            expect(mockPatchGlobal).toHaveBeenCalledWith({
                topBarItemOrder: ['wiki', 'logs', 'stats', 'memory', 'models', 'admin', 'servers', 'skills'],
            });
        });
        expect(reorderGroupIds()).toEqual(['logs', 'stats', 'models', 'admin', 'skills']);
    });

    it('does not open a right-click customization menu', async () => {
        renderTopBar();
        await waitFor(() => expect(reorderGroupIds()[0]).toBe('skills'));

        fireEvent.contextMenu(document.querySelector('header')!, { clientX: 20, clientY: 30 });

        expect(screen.queryByRole('menuitem', { name: 'Customize top bar' })).toBeNull();
        expect(screen.queryByRole('menuitem', { name: 'Reset order' })).toBeNull();
    });

    it('uses the same direct long-press reorder path on mobile-sized layouts', async () => {
        mockIsMobile = true;
        renderTopBar();
        await waitFor(() => expect(reorderGroupIds()).toContain('admin'));

        vi.useFakeTimers();
        const admin = screen.getByLabelText('Admin');
        fireEvent.pointerDown(admin, { pointerId: 2, clientX: 1, clientY: 1 });
        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(screen.getByText('Picked up Admin, position 5 of 5.')).toBeTruthy();
        expect(screen.queryByRole('dialog', { name: 'Customize top bar' })).toBeNull();
    });
});
