/**
 * Tests for ScheduleDetail — path wrapping (no truncate, break-all).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockFetchApi = vi.fn();
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
}));

vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => `rel:${d}`,
}));

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

async function getScheduleDetail() {
    const { ScheduleDetail } = await import(
        '../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab'
    );
    return ScheduleDetail;
}

const LONG_PATH_SCHEDULE = {
    id: 'sched-long',
    name: 'Long Path Schedule',
    target: 'very/deeply/nested/folder/structure/with/many/segments/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '0 * * * *',
    cronDescription: 'Every hour',
    params: {},
    onFailure: 'continue',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 3600000).toISOString(),
    createdAt: new Date().toISOString(),
    outputFolder: '/home/user/.coc/repos/workspace-id-hash/tasks/very-long-output-folder-name',
};

function renderDetail(schedule = LONG_PATH_SCHEDULE) {
    return {
        schedule,
        workspaceId: 'ws-1',
        history: [],
        editingId: null,
        onRunNow: vi.fn(),
        onPauseResume: vi.fn(),
        onEdit: vi.fn(),
        onDuplicate: vi.fn(),
        onDelete: vi.fn(),
        onCancelEdit: vi.fn(),
        onSaved: vi.fn(),
    };
}

describe('ScheduleDetail — path wrapping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ history: [] });
    });

    it('target basename does not use truncate class', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const basename = screen.getByTestId('target-basename');
        expect(basename.className).not.toContain('truncate');
        expect(basename.className).toContain('block');
    });

    it('full target path uses break-all for wrapping', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const info = screen.getByTestId('schedule-info');
        // The full path span is the second span in the target dd
        const pathSpans = info.querySelectorAll('span.font-mono');
        const fullPathSpan = Array.from(pathSpans).find(s => s.textContent === LONG_PATH_SCHEDULE.target);
        expect(fullPathSpan).toBeTruthy();
        expect(fullPathSpan!.className).toContain('break-all');
        expect(fullPathSpan!.className).not.toContain('truncate');
    });

    it('output folder does not use truncate and has break-all', async () => {
        const ScheduleDetail = await getScheduleDetail();
        render(
            <Wrap>
                <ScheduleDetail {...renderDetail()} />
            </Wrap>,
        );
        const outputFolder = screen.getByTestId('output-folder');
        expect(outputFolder.className).not.toContain('truncate');
        expect(outputFolder.className).toContain('break-all');
    });
});

describe('RepoSchedulesTab — max-width constraint', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ schedules: [LONG_PATH_SCHEDULE], history: [] });
    });

    it('detail panel content is wrapped in max-w-3xl container', async () => {
        const { RepoSchedulesTab } = await import(
            '../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab'
        );

        // Mock useBreakpoint to return desktop
        vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
            useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
        }));
        vi.mock('../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
            useResizablePanel: () => ({
                width: 288,
                isDragging: false,
                handleMouseDown: vi.fn(),
                handleTouchStart: vi.fn(),
                resetWidth: vi.fn(),
            }),
        }));

        render(
            <Wrap>
                <RepoSchedulesTab workspaceId="ws-1" />
            </Wrap>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('schedules-detail-panel')).toBeTruthy();
        });
        const detailPanel = screen.getByTestId('schedules-detail-panel');
        const maxWidthWrapper = detailPanel.firstElementChild as HTMLElement;
        expect(maxWidthWrapper.className).toContain('max-w-3xl');
    });
});
