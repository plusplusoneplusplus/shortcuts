/**
 * Tests for RunHistoryList — flex layout, ISO date sub-row, no-truncate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

async function getRunHistoryList() {
    const mod = await import('../../../src/server/spa/client/react/features/chat/RunHistoryList');
    return mod.RunHistoryList;
}

const MOCK_RUN = {
    id: 'run-1',
    scheduleId: 'sched-1',
    startedAt: '2026-03-24T02:14:22.000Z',
    completedAt: '2026-03-24T02:19:34.000Z',
    status: 'completed',
    durationMs: 312000,
    exitCode: 0,
    processId: 'proc-1',
};

describe('RunHistoryList — flex layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ history: [] });
    });

    it('uses flex layout instead of grid for run rows', async () => {
        const RunHistoryList = await getRunHistoryList();
        render(
            <Wrap>
                <RunHistoryList
                    runs={[MOCK_RUN]}
                    scheduleId="sched-1"
                    wsId="ws-1"
                    onRunNow={vi.fn()}
                    isRunning={false}
                />
            </Wrap>,
        );
        const row = screen.getByTestId('run-row-run-1');
        const inner = row.firstElementChild as HTMLElement;
        expect(inner.className).toContain('flex');
        expect(inner.className).not.toContain('grid');
        expect(inner.style.gridTemplateColumns).toBeFalsy();
    });

    it('renders ISO date inline beside relative time', async () => {
        const RunHistoryList = await getRunHistoryList();
        render(
            <Wrap>
                <RunHistoryList
                    runs={[MOCK_RUN]}
                    scheduleId="sched-1"
                    wsId="ws-1"
                    onRunNow={vi.fn()}
                    isRunning={false}
                />
            </Wrap>,
        );
        const isoDate = screen.getByTestId('iso-date-run-1');
        expect(isoDate).toBeTruthy();
        expect(isoDate.textContent).toBe('2026-03-24 02:14:22');
        // ISO date is now muted (not monospace) per the redesign.
        expect(isoDate.className).toMatch(/text-\[#656d76\]|text-\[#848484\]/);
    });

    it('does not truncate the start time span', async () => {
        const RunHistoryList = await getRunHistoryList();
        render(
            <Wrap>
                <RunHistoryList
                    runs={[MOCK_RUN]}
                    scheduleId="sched-1"
                    wsId="ws-1"
                    onRunNow={vi.fn()}
                    isRunning={false}
                />
            </Wrap>,
        );
        const row = screen.getByTestId('run-row-run-1');
        const timeSpan = row.querySelector('[title]') as HTMLElement;
        expect(timeSpan.className).not.toContain('truncate');
    });

    it('aligns status icon to top with items-start', async () => {
        const RunHistoryList = await getRunHistoryList();
        render(
            <Wrap>
                <RunHistoryList
                    runs={[MOCK_RUN]}
                    scheduleId="sched-1"
                    wsId="ws-1"
                    onRunNow={vi.fn()}
                    isRunning={false}
                />
            </Wrap>,
        );
        const row = screen.getByTestId('run-row-run-1');
        const inner = row.firstElementChild as HTMLElement;
        expect(inner.className).toContain('items-start');
    });
});
