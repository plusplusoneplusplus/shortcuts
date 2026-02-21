import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
    getDashboardConfig: () => ({ apiBase: 'http://localhost:4000/api' }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

import { WikiAdmin } from '../../../src/server/spa/client/react/wiki/WikiAdmin';
import { fetchApi } from '../../../src/server/spa/client/react/hooks/useApi';

const mockFetchApi = vi.mocked(fetchApi);
const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchApi.mockReset();
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

afterEach(() => {
    vi.restoreAllMocks();
});

function makeCacheStatus(cached: Record<number, boolean>) {
    const phases: Record<string, { cached: boolean }> = {};
    for (const [k, v] of Object.entries(cached)) {
        phases[k] = { cached: v };
    }
    return { phases };
}

function mockSSEResponse(events: Array<{ type: string; [key: string]: any }>) {
    const lines = events.map(e => `data: ${JSON.stringify(e)}`).join('\n') + '\n';
    const encoder = new TextEncoder();
    const encoded = encoder.encode(lines);
    let consumed = false;

    return {
        ok: true,
        body: {
            getReader: () => ({
                read: () => {
                    if (!consumed) {
                        consumed = true;
                        return Promise.resolve({ done: false, value: encoded });
                    }
                    return Promise.resolve({ done: true, value: undefined });
                },
            }),
        },
    };
}

describe('WikiAdmin GenerateTab — Force Rerun', () => {
    describe('Force button visibility', () => {
        it('shows Force button for phases with cached status', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: true, 3: true, 4: false, 5: false,
            }));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(screen.getByText('Discovery')).toBeDefined();
            });

            expect(document.getElementById('phase-force-1')).not.toBeNull();
            expect(document.getElementById('phase-force-2')).not.toBeNull();
            expect(document.getElementById('phase-force-3')).not.toBeNull();
            expect(document.getElementById('phase-force-4')).toBeNull();
            expect(document.getElementById('phase-force-5')).toBeNull();
        });

        it('hides Force button when no phases are cached', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: false, 2: false, 3: false, 4: false, 5: false,
            }));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(screen.getByText('Discovery')).toBeDefined();
            });

            for (let p = 1; p <= 5; p++) {
                expect(document.getElementById(`phase-force-${p}`)).toBeNull();
            }
        });

        it('shows Force button for all phases when all are cached', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: true, 3: true, 4: true, 5: true,
            }));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(screen.getByText('Discovery')).toBeDefined();
            });

            for (let p = 1; p <= 5; p++) {
                expect(document.getElementById(`phase-force-${p}`)).not.toBeNull();
            }
        });
    });

    describe('Force button sends force:true in request body', () => {
        it('clicking Force on a cached phase sends force:true', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: false, 3: false, 4: false, 5: false,
            }));

            mockFetch.mockResolvedValue(mockSSEResponse([
                { type: 'status', phase: 1, state: 'running', message: 'Starting...' },
                { type: 'phase-complete', phase: 1, success: true, message: 'Done' },
                { type: 'done', success: true },
            ]));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('phase-force-1')).not.toBeNull();
            });

            await act(async () => {
                fireEvent.click(document.getElementById('phase-force-1')!);
            });

            const generateCalls = mockFetch.mock.calls.filter(
                ([url]: [string]) => url.includes('/admin/generate') && !url.includes('/status') && !url.includes('/cancel')
            );
            expect(generateCalls.length).toBe(1);
            const body = JSON.parse(generateCalls[0][1].body);
            expect(body.force).toBe(true);
            expect(body.startPhase).toBe(1);
            expect(body.endPhase).toBe(1);
        });

        it('clicking Run does not send force in body', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: false, 3: false, 4: false, 5: false,
            }));

            mockFetch.mockResolvedValue(mockSSEResponse([
                { type: 'status', phase: 1, state: 'running', message: 'Starting...' },
                { type: 'done', success: true },
            ]));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('phase-run-1')).not.toBeNull();
            });

            await act(async () => {
                fireEvent.click(document.getElementById('phase-run-1')!);
            });

            const generateCalls = mockFetch.mock.calls.filter(
                ([url]: [string]) => url.includes('/admin/generate') && !url.includes('/status') && !url.includes('/cancel')
            );
            expect(generateCalls.length).toBe(1);
            const body = JSON.parse(generateCalls[0][1].body);
            expect(body.force).toBeUndefined();
            expect(body.startPhase).toBe(1);
            expect(body.endPhase).toBe(1);
        });
    });

    describe('Force All button', () => {
        it('renders Force All button when not running', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: false, 2: false, 3: false, 4: false, 5: false,
            }));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('force-run-all')).not.toBeNull();
            });
        });

        it('Force All sends force:true with startPhase=1, endPhase=5', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: true, 3: false, 4: false, 5: false,
            }));

            mockFetch.mockResolvedValue(mockSSEResponse([
                { type: 'done', success: true },
            ]));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('force-run-all')).not.toBeNull();
            });

            await act(async () => {
                fireEvent.click(document.getElementById('force-run-all')!);
            });

            const generateCalls = mockFetch.mock.calls.filter(
                ([url]: [string]) => url.includes('/admin/generate') && !url.includes('/status') && !url.includes('/cancel')
            );
            expect(generateCalls.length).toBe(1);
            const body = JSON.parse(generateCalls[0][1].body);
            expect(body.force).toBe(true);
            expect(body.startPhase).toBe(1);
            expect(body.endPhase).toBe(5);
        });

        it('Force All respects fromPhase selection', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: true, 3: true, 4: false, 5: false,
            }));

            mockFetch.mockResolvedValue(mockSSEResponse([
                { type: 'done', success: true },
            ]));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('force-run-all')).not.toBeNull();
            });

            const select = screen.getByDisplayValue('Phase 1: Discovery');
            await act(async () => {
                fireEvent.change(select, { target: { value: '3' } });
            });

            await act(async () => {
                fireEvent.click(document.getElementById('force-run-all')!);
            });

            const generateCalls = mockFetch.mock.calls.filter(
                ([url]: [string]) => url.includes('/admin/generate') && !url.includes('/status') && !url.includes('/cancel')
            );
            expect(generateCalls.length).toBe(1);
            const body = JSON.parse(generateCalls[0][1].body);
            expect(body.force).toBe(true);
            expect(body.startPhase).toBe(3);
            expect(body.endPhase).toBe(5);
        });

        it('Run All does not send force', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: false, 2: false, 3: false, 4: false, 5: false,
            }));

            mockFetch.mockResolvedValue(mockSSEResponse([
                { type: 'done', success: true },
            ]));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(screen.getByText('Run All')).toBeDefined();
            });

            await act(async () => {
                fireEvent.click(screen.getByText('Run All'));
            });

            const generateCalls = mockFetch.mock.calls.filter(
                ([url]: [string]) => url.includes('/admin/generate') && !url.includes('/status') && !url.includes('/cancel')
            );
            expect(generateCalls.length).toBe(1);
            const body = JSON.parse(generateCalls[0][1].body);
            expect(body.force).toBeUndefined();
        });
    });

    describe('Force button disabled state', () => {
        it('Force buttons are disabled while a phase is running', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: true, 3: true, 4: true, 5: true,
            }));

            let resolveSSE: (value: any) => void;
            const ssePromise = new Promise(r => { resolveSSE = r; });
            mockFetch.mockReturnValue(ssePromise);

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('phase-force-1')).not.toBeNull();
            });

            await act(async () => {
                fireEvent.click(document.getElementById('phase-run-1')!);
            });

            for (let p = 1; p <= 5; p++) {
                const forceBtn = document.getElementById(`phase-force-${p}`) as HTMLButtonElement | null;
                if (forceBtn) {
                    expect(forceBtn.disabled).toBe(true);
                }
                const runBtn = document.getElementById(`phase-run-${p}`) as HTMLButtonElement;
                expect(runBtn.disabled).toBe(true);
            }

            resolveSSE!(mockSSEResponse([{ type: 'done', success: true }]));
        });

        it('Force All is hidden while running (Abort shown instead)', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: false, 3: false, 4: false, 5: false,
            }));

            let resolveSSE: (value: any) => void;
            const ssePromise = new Promise(r => { resolveSSE = r; });
            mockFetch.mockReturnValue(ssePromise);

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('force-run-all')).not.toBeNull();
            });

            await act(async () => {
                fireEvent.click(document.getElementById('phase-run-1')!);
            });

            expect(document.getElementById('force-run-all')).toBeNull();
            expect(screen.getByText('Abort')).toBeDefined();

            resolveSSE!(mockSSEResponse([{ type: 'done', success: true }]));
        });
    });

    describe('Cache badge interaction with Force', () => {
        it('cache status refreshes after force rerun completes', async () => {
            let callCount = 0;
            mockFetchApi.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve(makeCacheStatus({ 1: true, 2: false, 3: false, 4: false, 5: false }));
                }
                return Promise.resolve(makeCacheStatus({ 1: true, 2: false, 3: false, 4: false, 5: false }));
            });

            mockFetch.mockResolvedValue(mockSSEResponse([
                { type: 'status', phase: 1, state: 'running', message: 'Starting...' },
                { type: 'phase-complete', phase: 1, success: true, message: 'Done' },
                { type: 'done', success: true },
            ]));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('phase-force-1')).not.toBeNull();
            });

            const initialCallCount = callCount;

            await act(async () => {
                fireEvent.click(document.getElementById('phase-force-1')!);
            });

            await waitFor(() => {
                expect(callCount).toBeGreaterThan(initialCallCount);
            });
        });
    });

    describe('Per-phase Force for specific phases', () => {
        it('Force on phase 3 sends startPhase=3, endPhase=3, force=true', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: true, 3: true, 4: false, 5: false,
            }));

            mockFetch.mockResolvedValue(mockSSEResponse([
                { type: 'done', success: true },
            ]));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('phase-force-3')).not.toBeNull();
            });

            await act(async () => {
                fireEvent.click(document.getElementById('phase-force-3')!);
            });

            const generateCalls = mockFetch.mock.calls.filter(
                ([url]: [string]) => url.includes('/admin/generate') && !url.includes('/status') && !url.includes('/cancel')
            );
            expect(generateCalls.length).toBe(1);
            const body = JSON.parse(generateCalls[0][1].body);
            expect(body.force).toBe(true);
            expect(body.startPhase).toBe(3);
            expect(body.endPhase).toBe(3);
        });

        it('Force on phase 5 sends correct params', async () => {
            mockFetchApi.mockResolvedValue(makeCacheStatus({
                1: true, 2: true, 3: true, 4: true, 5: true,
            }));

            mockFetch.mockResolvedValue(mockSSEResponse([
                { type: 'done', success: true },
            ]));

            await act(async () => {
                render(<WikiAdmin wikiId="test-wiki" initialTab="generate" />);
            });

            await waitFor(() => {
                expect(document.getElementById('phase-force-5')).not.toBeNull();
            });

            await act(async () => {
                fireEvent.click(document.getElementById('phase-force-5')!);
            });

            const generateCalls = mockFetch.mock.calls.filter(
                ([url]: [string]) => url.includes('/admin/generate') && !url.includes('/status') && !url.includes('/cancel')
            );
            expect(generateCalls.length).toBe(1);
            const body = JSON.parse(generateCalls[0][1].body);
            expect(body.force).toBe(true);
            expect(body.startPhase).toBe(5);
            expect(body.endPhase).toBe(5);
        });
    });
});
